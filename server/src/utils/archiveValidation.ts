/**
 * CONNECTLY Phase 13 — Complete Archive & OpenXML Structure Validation
 * Parses ZIP central directory & cross-checks local file headers to enforce:
 * - End of Central Directory (EOCD) tail discovery & signature integrity
 * - Central directory bounds, entry counts, and record length sanity
 * - Format-specific OpenXML component verification ([Content_Types].xml, word/, xl/, ppt/)
 * - Explicit ZIP64 rejection (ZIP64_NOT_SUPPORTED) for bounded collaboration attachments
 * - Decompression ratio limits (ZIP bomb defense: max 20:1 ratio, max 50 MB uncompressed)
 * - Path traversal defense (rejection of ../, /.., absolute paths)
 * - Ambiguous duplicate package entry defense (DUPLICATE_ARCHIVE_ENTRY)
 * - Executable payload rejection inside generic ZIP archives (DANGEROUS_FILE_IN_ARCHIVE)
 * - Cross-checking of local file headers against central directory records (ARCHIVE_HEADER_MISMATCH)
 */

import path from 'node:path';
import { BadRequestError } from './errors.js';
import { DANGEROUS_EXTENSIONS } from '../schemas/file.schema.js';
import type { IStorageProvider } from '../storage/storageProvider.interface.js';

export const MAX_ARCHIVE_ENTRIES = 1000;
export const MAX_UNCOMPRESSED_SIZE_BYTES = 52428800; // 50 MB
export const MAX_DECOMPRESSION_RATIO = 20; // 20:1 ratio

export interface ZipEntryInfo {
  filename: string;
  compressedSize: number;
  uncompressedSize: number;
  isDirectory: boolean;
  localHeaderOffset: number;
  nameLen: number;
}

export interface ArchiveValidationResult {
  isValid: boolean;
  entries: ZipEntryInfo[];
  totalCompressedSize: number;
  totalUncompressedSize: number;
  decompressionRatio: number;
}

interface ParsedEocd {
  diskNumber: number;
  cdStartDisk: number;
  totalEntriesDisk: number;
  totalEntries: number;
  cdSize: number;
  cdOffset: number;
  commentLength: number;
  eocdOffset: number;
}

/**
 * Searches backwards for End of Central Directory (EOCD) record in a tail buffer.
 */
function findEocdInTail(tailBuffer: Buffer, totalFileSize: number, tailOffsetInFile: number): ParsedEocd {
  if (!tailBuffer || tailBuffer.length < 22) {
    throw new BadRequestError('Invalid or truncated archive payload.', 'CORRUPTED_ARCHIVE');
  }

  let eocdRelOffset = -1;
  const minSearch = Math.max(0, tailBuffer.length - 65557);

  for (let i = tailBuffer.length - 22; i >= minSearch; i -= 1) {
    if (tailBuffer.readUInt32LE(i) === 0x06054b50) {
      eocdRelOffset = i;
      break;
    }
  }

  if (eocdRelOffset < 0) {
    throw new BadRequestError(
      'Archive End of Central Directory (EOCD) record not found.',
      'CORRUPTED_ARCHIVE'
    );
  }

  // Check for ZIP64 locator immediately preceding standard EOCD (20 bytes before EOCD)
  if (eocdRelOffset >= 20) {
    const possibleZip64Locator = tailBuffer.readUInt32LE(eocdRelOffset - 20);
    if (possibleZip64Locator === 0x07064b50) {
      throw new BadRequestError(
        'ZIP64 archives are not supported for collaboration attachments.',
        'ZIP64_NOT_SUPPORTED'
      );
    }
  }

  const diskNumber = tailBuffer.readUInt16LE(eocdRelOffset + 4);
  const cdStartDisk = tailBuffer.readUInt16LE(eocdRelOffset + 6);
  const totalEntriesDisk = tailBuffer.readUInt16LE(eocdRelOffset + 8);
  const totalEntries = tailBuffer.readUInt16LE(eocdRelOffset + 10);
  const cdSize = tailBuffer.readUInt32LE(eocdRelOffset + 12);
  const cdOffset = tailBuffer.readUInt32LE(eocdRelOffset + 16);
  const commentLength = tailBuffer.readUInt16LE(eocdRelOffset + 20);

  // Explicit ZIP64 overflow indicator checks
  if (
    diskNumber === 0xffff ||
    cdStartDisk === 0xffff ||
    totalEntriesDisk === 0xffff ||
    totalEntries === 0xffff ||
    cdSize === 0xffffffff ||
    cdOffset === 0xffffffff
  ) {
    throw new BadRequestError(
      'ZIP64 archives are not supported for collaboration attachments.',
      'ZIP64_NOT_SUPPORTED'
    );
  }

  // Multi-disk archives prohibited
  if (diskNumber !== 0 || cdStartDisk !== 0 || totalEntriesDisk !== totalEntries) {
    throw new BadRequestError(
      'Multi-disk or segmented archives are not supported.',
      'CORRUPTED_ARCHIVE'
    );
  }

  const absoluteEocdOffset = tailOffsetInFile + eocdRelOffset;

  // Sanity check central directory bounds
  if (cdOffset < 0 || cdSize <= 0 || cdOffset + cdSize > absoluteEocdOffset) {
    throw new BadRequestError(
      'Malformed central directory bounds or overlapping headers in archive.',
      'MALFORMED_CENTRAL_DIRECTORY'
    );
  }

  if (totalEntries === 0) {
    throw new BadRequestError('Empty archive is not permitted.', 'EMPTY_ARCHIVE');
  }

  if (totalEntries > MAX_ARCHIVE_ENTRIES) {
    throw new BadRequestError(
      `Archive entry count (${totalEntries}) exceeds maximum limit of ${MAX_ARCHIVE_ENTRIES}.`,
      'ARCHIVE_TOO_MANY_ENTRIES'
    );
  }

  return {
    diskNumber,
    cdStartDisk,
    totalEntriesDisk,
    totalEntries,
    cdSize,
    cdOffset,
    commentLength,
    eocdOffset: absoluteEocdOffset,
  };
}

/**
 * Parses Central Directory buffer records into structured entry metadata.
 */
function parseCentralDirectoryBuffer(
  cdBuffer: Buffer,
  expectedEntries: number,
  cdOffset: number
): { entries: ZipEntryInfo[]; totalCompressedSize: number; totalUncompressedSize: number } {
  const entries: ZipEntryInfo[] = [];
  const seenNormalizedNames = new Set<string>();
  let totalCompressedSize = 0;
  let totalUncompressedSize = 0;
  let cursor = 0;

  while (cursor + 46 <= cdBuffer.length) {
    const signature = cdBuffer.readUInt32LE(cursor);
    if (signature !== 0x02014b50) {
      break; // End of Central Directory records
    }

    const compSize = cdBuffer.readUInt32LE(cursor + 20);
    const uncompSize = cdBuffer.readUInt32LE(cursor + 24);
    const nameLen = cdBuffer.readUInt16LE(cursor + 28);
    const extraLen = cdBuffer.readUInt16LE(cursor + 30);
    const commentLen = cdBuffer.readUInt16LE(cursor + 32);
    const localHeaderOffset = cdBuffer.readUInt32LE(cursor + 42);

    if (cursor + 46 + nameLen + extraLen + commentLen > cdBuffer.length) {
      throw new BadRequestError(
        'Truncated central directory record encountered.',
        'MALFORMED_CENTRAL_DIRECTORY'
      );
    }

    if (localHeaderOffset < 0 || localHeaderOffset >= cdOffset) {
      throw new BadRequestError(
        'Central directory contains invalid local file header offset.',
        'MALFORMED_CENTRAL_DIRECTORY'
      );
    }

    const filename = cdBuffer.toString('utf8', cursor + 46, cursor + 46 + nameLen);
    if (filename.includes('\0')) {
      throw new BadRequestError('Archive contains invalid filename with null byte.', 'MALFORMED_FILENAME');
    }

    const normalizedName = filename.toLowerCase().replace(/\\/g, '/');

    // Reject ambiguous duplicate filenames within the package
    if (seenNormalizedNames.has(normalizedName)) {
      throw new BadRequestError(
        `Archive contains ambiguous duplicate file entry: ${filename}`,
        'DUPLICATE_ARCHIVE_ENTRY'
      );
    }
    seenNormalizedNames.add(normalizedName);

    // Path Traversal Security Check
    if (
      normalizedName.includes('../') ||
      normalizedName.includes('/../') ||
      normalizedName.startsWith('../') ||
      normalizedName.startsWith('/') ||
      /^[a-zA-Z]:/.test(filename)
    ) {
      throw new BadRequestError(
        'Archive contains unsafe path traversal directory entries.',
        'PATH_TRAVERSAL_IN_ARCHIVE'
      );
    }

    const isDirectory = filename.endsWith('/') || filename.endsWith('\\');

    entries.push({
      filename,
      compressedSize: compSize,
      uncompressedSize: uncompSize,
      isDirectory,
      localHeaderOffset,
      nameLen,
    });

    totalCompressedSize += compSize;
    totalUncompressedSize += uncompSize;

    cursor += 46 + nameLen + extraLen + commentLen;
  }

  if (entries.length !== expectedEntries) {
    throw new BadRequestError(
      `Central directory entry count mismatch (expected ${expectedEntries}, found ${entries.length}).`,
      'MALFORMED_CENTRAL_DIRECTORY'
    );
  }

  return { entries, totalCompressedSize, totalUncompressedSize };
}

/**
 * Validates uncompressed size limits and compression ratio (ZIP bomb defense).
 */
function assertArchiveSizeSecurity(
  totalCompressedSize: number,
  totalUncompressedSize: number,
  entryCount: number
): void {
  if (entryCount > MAX_ARCHIVE_ENTRIES) {
    throw new BadRequestError(
      `Archive entry count (${entryCount}) exceeds maximum limit of ${MAX_ARCHIVE_ENTRIES}.`,
      'ARCHIVE_TOO_MANY_ENTRIES'
    );
  }

  if (totalUncompressedSize > MAX_UNCOMPRESSED_SIZE_BYTES) {
    throw new BadRequestError(
      `Archive uncompressed size (${(totalUncompressedSize / (1024 * 1024)).toFixed(1)} MB) exceeds 50 MB limit.`,
      'ARCHIVE_TOO_LARGE'
    );
  }

  const decompressionRatio = totalUncompressedSize / Math.max(totalCompressedSize, 1);
  if (totalUncompressedSize > 1048576 && decompressionRatio > MAX_DECOMPRESSION_RATIO) {
    throw new BadRequestError(
      `Suspicious compression ratio (${decompressionRatio.toFixed(1)}:1) detected. Archive rejected.`,
      'ARCHIVE_BOMB_DETECTED'
    );
  }
}

/**
 * Synchronous in-memory parser for unit tests, fixtures, and direct buffer payloads.
 * Strictly parses EOCD from the tail, reads Central Directory, and cross-checks local headers.
 */
export function inspectZipArchive(buffer: Buffer): ArchiveValidationResult {
  if (!buffer || buffer.length < 22) {
    throw new BadRequestError('Invalid or truncated archive payload.', 'CORRUPTED_ARCHIVE');
  }

  const isLocalHeader = buffer.readUInt32LE(0) === 0x04034b50;
  const isEocd = buffer.readUInt32LE(0) === 0x06054b50;
  if (!isLocalHeader && !isEocd) {
    throw new BadRequestError('Invalid ZIP archive signature.', 'INVALID_ZIP_SIGNATURE');
  }

  const tailLength = Math.min(buffer.length, 65557);
  const tailBuffer = buffer.subarray(buffer.length - tailLength);
  const eocd = findEocdInTail(tailBuffer, buffer.length, buffer.length - tailLength);

  const cdBuffer = buffer.subarray(eocd.cdOffset, eocd.cdOffset + eocd.cdSize);
  const { entries, totalCompressedSize, totalUncompressedSize } = parseCentralDirectoryBuffer(
    cdBuffer,
    eocd.totalEntries,
    eocd.cdOffset
  );

  assertArchiveSizeSecurity(totalCompressedSize, totalUncompressedSize, entries.length);

  // Overlap verification for local headers
  const sortedByOffset = [...entries].sort((a, b) => a.localHeaderOffset - b.localHeaderOffset);
  for (let i = 0; i < sortedByOffset.length; i += 1) {
    const cur = sortedByOffset[i];
    if (cur.localHeaderOffset < 0 || cur.localHeaderOffset + 30 + cur.nameLen > eocd.cdOffset) {
      throw new BadRequestError(
        'Local file header offset overlaps with Central Directory or is invalid.',
        'MALFORMED_LOCAL_HEADER'
      );
    }
    if (i + 1 < sortedByOffset.length) {
      const next = sortedByOffset[i + 1];
      const curPayloadEnd = cur.localHeaderOffset + 30 + cur.nameLen + cur.compressedSize;
      if (curPayloadEnd > next.localHeaderOffset) {
        throw new BadRequestError(
          `Archive contains overlapping local file header or payload records for ${cur.filename} and ${next.filename}.`,
          'MALFORMED_LOCAL_HEADER'
        );
      }
    }
  }

  // Cross-check local headers in buffer against Central Directory records
  for (const entry of entries) {
    const loc = entry.localHeaderOffset;
    if (loc + 30 + entry.nameLen > buffer.length) {
      throw new BadRequestError(
        'Truncated local file header encountered in archive.',
        'MALFORMED_LOCAL_HEADER'
      );
    }
    const localSig = buffer.readUInt32LE(loc);
    if (localSig !== 0x04034b50) {
      throw new BadRequestError(
        `Local file header signature invalid at offset ${loc} for entry: ${entry.filename}`,
        'ARCHIVE_HEADER_MISMATCH'
      );
    }
    const localName = buffer.toString('utf8', loc + 30, loc + 30 + entry.nameLen);
    if (localName !== entry.filename) {
      throw new BadRequestError(
        `Local file header filename (${localName}) does not match central directory (${entry.filename}).`,
        'ARCHIVE_HEADER_MISMATCH'
      );
    }
  }

  return {
    isValid: true,
    entries,
    totalCompressedSize,
    totalUncompressedSize,
    decompressionRatio: totalUncompressedSize / Math.max(totalCompressedSize, 1),
  };
}

/**
 * Asynchronous storage-level archive validation.
 * Performs bounded byte-range reads to locate EOCD at archive tail, parse Central Directory,
 * and cross-check local file headers without reading the entire archive into memory.
 */
export async function validateStorageArchive(
  storageProvider: IStorageProvider,
  storageKey: string,
  totalSizeBytes: number,
  extension: string,
  versionId?: string
): Promise<ArchiveValidationResult> {
  if (totalSizeBytes < 22) {
    throw new BadRequestError('Invalid or truncated archive payload.', 'CORRUPTED_ARCHIVE');
  }

  // 1. Verify initial magic bytes
  const headerBuf = await storageProvider.readByteRange(
    storageKey,
    0,
    Math.min(totalSizeBytes, 4) - 1,
    versionId
  );
  if (headerBuf.length < 4) {
    throw new BadRequestError('Invalid or truncated archive payload.', 'CORRUPTED_ARCHIVE');
  }
  const initialSig = headerBuf.readUInt32LE(0);
  if (initialSig !== 0x04034b50 && initialSig !== 0x06054b50) {
    throw new BadRequestError('Invalid ZIP archive signature.', 'INVALID_ZIP_SIGNATURE');
  }

  // 2. Read tail to locate End of Central Directory (EOCD)
  const tailLength = Math.min(totalSizeBytes, 65557);
  const tailOffsetInFile = totalSizeBytes - tailLength;
  const tailBuffer = await storageProvider.readByteRange(
    storageKey,
    tailOffsetInFile,
    totalSizeBytes - 1,
    versionId
  );

  const eocd = findEocdInTail(tailBuffer, totalSizeBytes, tailOffsetInFile);

  // 3. Read Central Directory through bounded range read
  const cdBuffer = await storageProvider.readByteRange(
    storageKey,
    eocd.cdOffset,
    eocd.cdOffset + eocd.cdSize - 1,
    versionId
  );

  const { entries, totalCompressedSize, totalUncompressedSize } = parseCentralDirectoryBuffer(
    cdBuffer,
    eocd.totalEntries,
    eocd.cdOffset
  );

  assertArchiveSizeSecurity(totalCompressedSize, totalUncompressedSize, entries.length);

  // 4. Overlap & bounds verification for local headers
  const sortedByOffset = [...entries].sort((a, b) => a.localHeaderOffset - b.localHeaderOffset);
  for (let i = 0; i < sortedByOffset.length; i += 1) {
    const cur = sortedByOffset[i];
    if (cur.localHeaderOffset < 0 || cur.localHeaderOffset + 30 + cur.nameLen > eocd.cdOffset) {
      throw new BadRequestError(
        'Local file header offset overlaps with Central Directory or is invalid.',
        'MALFORMED_LOCAL_HEADER'
      );
    }
    if (i + 1 < sortedByOffset.length) {
      const next = sortedByOffset[i + 1];
      const curPayloadEnd = cur.localHeaderOffset + 30 + cur.nameLen + cur.compressedSize;
      if (curPayloadEnd > next.localHeaderOffset) {
        throw new BadRequestError(
          `Archive contains overlapping local file header or payload records for ${cur.filename} and ${next.filename}.`,
          'MALFORMED_LOCAL_HEADER'
        );
      }
    }
  }

  // 5. Cross-check local file headers for ALL entries (DEF-13-09 residual)
  for (const entry of entries) {
    const loc = entry.localHeaderOffset;
    const localHeaderBuf = await storageProvider.readByteRange(
      storageKey,
      loc,
      loc + 30 + entry.nameLen - 1,
      versionId
    );

    if (localHeaderBuf.length < 30 + entry.nameLen) {
      throw new BadRequestError('Truncated local header in archive.', 'MALFORMED_LOCAL_HEADER');
    }

    if (localHeaderBuf.readUInt32LE(0) !== 0x04034b50) {
      throw new BadRequestError(
        `Local file header signature invalid for entry: ${entry.filename}`,
        'ARCHIVE_HEADER_MISMATCH'
      );
    }

    const localFilename = localHeaderBuf.toString('utf8', 30, 30 + entry.nameLen);
    if (localFilename !== entry.filename) {
      throw new BadRequestError(
        `Local file header filename does not match central directory for ${entry.filename}.`,
        'ARCHIVE_HEADER_MISMATCH'
      );
    }
  }

  // 6. Format-specific security validation
  const normalizedExt = extension.toLowerCase().replace(/^\./, '');

  if (normalizedExt === 'zip') {
    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const fileExt = path.extname(entry.filename).toLowerCase().replace(/^\./, '');
      if (DANGEROUS_EXTENSIONS.includes(fileExt)) {
        throw new BadRequestError(
          `ZIP archive contains prohibited executable file type (.${fileExt}): ${entry.filename}`,
          'DANGEROUS_FILE_IN_ARCHIVE'
        );
      }
    }
  } else if (['docx', 'xlsx', 'pptx'].includes(normalizedExt)) {
    const filenames = entries.map((e) => e.filename.replace(/\\/g, '/'));

    const hasContentTypes = filenames.some(
      (f) => f === '[Content_Types].xml' || f.endsWith('/[Content_Types].xml')
    );
    if (!hasContentTypes) {
      throw new BadRequestError(
        `File is not a valid ${normalizedExt.toUpperCase()} document (missing [Content_Types].xml).`,
        'INVALID_DOCUMENT_STRUCTURE'
      );
    }

    if (normalizedExt === 'docx') {
      const hasWord = filenames.some((f) => f.startsWith('word/'));
      if (!hasWord) {
        throw new BadRequestError(
          'Word document does not contain required word/ document parts.',
          'INVALID_DOCUMENT_STRUCTURE'
        );
      }
    } else if (normalizedExt === 'xlsx') {
      const hasXl = filenames.some((f) => f.startsWith('xl/'));
      if (!hasXl) {
        throw new BadRequestError(
          'Excel workbook does not contain required xl/ workbook parts.',
          'INVALID_DOCUMENT_STRUCTURE'
        );
      }
    } else if (normalizedExt === 'pptx') {
      const hasPpt = filenames.some((f) => f.startsWith('ppt/'));
      if (!hasPpt) {
        throw new BadRequestError(
          'PowerPoint presentation does not contain required ppt/ presentation parts.',
          'INVALID_DOCUMENT_STRUCTURE'
        );
      }
    }
  }

  return {
    isValid: true,
    entries,
    totalCompressedSize,
    totalUncompressedSize,
    decompressionRatio: totalUncompressedSize / Math.max(totalCompressedSize, 1),
  };
}

/**
 * Validates Office OpenXML documents (DOCX, XLSX, PPTX) against genuine package container rules.
 */
export function validateOpenXmlPackage(buffer: Buffer, extension: string): void {
  const result = inspectZipArchive(buffer);
  const normalizedExt = extension.toLowerCase().replace(/^\./, '');

  if (result.entries.length === 0) {
    throw new BadRequestError(
      `Invalid or empty ${normalizedExt.toUpperCase()} document container.`,
      'INVALID_DOCUMENT_STRUCTURE'
    );
  }

  const filenames = result.entries.map((e) => e.filename.replace(/\\/g, '/'));

  const hasContentTypes = filenames.some(
    (f) => f === '[Content_Types].xml' || f.endsWith('/[Content_Types].xml')
  );

  if (!hasContentTypes) {
    throw new BadRequestError(
      `File is not a valid ${normalizedExt.toUpperCase()} document (missing [Content_Types].xml).`,
      'INVALID_DOCUMENT_STRUCTURE'
    );
  }

  if (normalizedExt === 'docx') {
    const hasWord = filenames.some((f) => f.startsWith('word/'));
    if (!hasWord) {
      throw new BadRequestError(
        'Word document does not contain required word/ document parts.',
        'INVALID_DOCUMENT_STRUCTURE'
      );
    }
  } else if (normalizedExt === 'xlsx') {
    const hasXl = filenames.some((f) => f.startsWith('xl/'));
    if (!hasXl) {
      throw new BadRequestError(
        'Excel workbook does not contain required xl/ workbook parts.',
        'INVALID_DOCUMENT_STRUCTURE'
      );
    }
  } else if (normalizedExt === 'pptx') {
    const hasPpt = filenames.some((f) => f.startsWith('ppt/'));
    if (!hasPpt) {
      throw new BadRequestError(
        'PowerPoint presentation does not contain required ppt/ presentation parts.',
        'INVALID_DOCUMENT_STRUCTURE'
      );
    }
  }
}

/**
 * Validates generic ZIP archives to ensure they do not harbor dangerous executable payloads.
 */
export function validateZipPayloadSecurity(buffer: Buffer): void {
  const result = inspectZipArchive(buffer);

  for (const entry of result.entries) {
    if (entry.isDirectory) continue;
    const ext = path.extname(entry.filename).toLowerCase().replace(/^\./, '');
    if (DANGEROUS_EXTENSIONS.includes(ext)) {
      throw new BadRequestError(
        `ZIP archive contains prohibited executable file type (.${ext}): ${entry.filename}`,
        'DANGEROUS_FILE_IN_ARCHIVE'
      );
    }
  }
}
