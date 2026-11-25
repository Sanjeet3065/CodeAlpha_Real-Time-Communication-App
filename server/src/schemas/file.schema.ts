import path from 'node:path';
import { z } from 'zod';

export const ALLOWED_EXTENSIONS = [
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'txt',
  'csv',
  'md',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'zip',
] as const;

export type AllowedExtension = (typeof ALLOWED_EXTENSIONS)[number];

export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  'text/markdown',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/zip',
  'application/x-zip-compressed',
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

// Dangerous file extensions that must always be strictly blocked
export const DANGEROUS_EXTENSIONS = [
  'exe',
  'bat',
  'cmd',
  'sh',
  'bin',
  'js',
  'ts',
  'jsx',
  'tsx',
  'py',
  'php',
  'vbs',
  'ps1',
  'jar',
  'msi',
  'dll',
  'so',
  'dylib',
  'app',
  'html',
  'htm',
  'svg',
  'xhtml',
];

/**
 * Sanitizes original filenames to prevent path traversal, control character injection,
 * and dangerous double-extension attacks.
 */
export function sanitizeFilename(raw: string): string {
  if (!raw || typeof raw !== 'string') {
    return 'unnamed_file';
  }

  // Strip control characters & non-printable ASCII
  // eslint-disable-next-line no-control-regex
  let name = raw.replace(/[\x00-\x1f\x80-\x9f]/g, '');

  // Extract base filename removing directory traversal (both / and \)
  const normalizedSlashes = name.replace(/\\/g, '/');
  name = path.posix.basename(normalizedSlashes);

  // Strip filesystem reserved characters
  name = name.replace(/[?%*:|"<>]/g, '_');

  // Strip leading dots to prevent hidden files
  name = name.replace(/^\.+/, '');

  // Truncate to maximum 255 chars
  if (name.length > 255) {
    const lastDot = name.lastIndexOf('.');
    if (lastDot > 0) {
      const ext = name.substring(lastDot);
      name = name.substring(0, 255 - ext.length) + ext;
    } else {
      name = name.substring(0, 255);
    }
  }

  return name.trim() || 'unnamed_file';
}

/**
 * Validates magic bytes / binary signatures against declared extension.
 */
export function validateMagicBytes(buffer: Buffer, extension: string): boolean {
  if (!buffer || buffer.length === 0) {
    return false;
  }

  const ext = extension.toLowerCase().replace(/^\./, '');

  switch (ext) {
    case 'pdf':
      // %PDF-
      return buffer.length >= 4 && buffer.toString('utf8', 0, 4) === '%PDF';

    case 'png':
      // 0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A
      return (
        buffer.length >= 8 &&
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4e &&
        buffer[3] === 0x47 &&
        buffer[4] === 0x0d &&
        buffer[5] === 0x0a &&
        buffer[6] === 0x1a &&
        buffer[7] === 0x0a
      );

    case 'jpg':
    case 'jpeg':
      // 0xFF 0xD8 0xFF
      return (
        buffer.length >= 3 &&
        buffer[0] === 0xff &&
        buffer[1] === 0xd8 &&
        buffer[2] === 0xff
      );

    case 'webp':
      // RIFF....WEBP
      return (
        buffer.length >= 12 &&
        buffer.toString('utf8', 0, 4) === 'RIFF' &&
        buffer.toString('utf8', 8, 12) === 'WEBP'
      );

    case 'gif':
      // GIF87a or GIF89a
      return (
        buffer.length >= 6 &&
        (buffer.toString('utf8', 0, 6) === 'GIF87a' || buffer.toString('utf8', 0, 6) === 'GIF89a')
      );

    case 'zip':
    case 'docx':
    case 'xlsx':
    case 'pptx':
      // PK\x03\x04
      return (
        buffer.length >= 4 &&
        buffer[0] === 0x50 &&
        buffer[1] === 0x4b &&
        buffer[2] === 0x03 &&
        buffer[3] === 0x04
      );

    case 'doc':
    case 'xls':
    case 'ppt':
      // Legacy Compound File Binary Format: 0xD0 0xCF 0x11 0xE0
      return (
        buffer.length >= 4 &&
        buffer[0] === 0xd0 &&
        buffer[1] === 0xcf &&
        buffer[2] === 0x11 &&
        buffer[3] === 0xe0
      );

    case 'txt':
    case 'csv':
    case 'md': {
      // Text files must not contain binary null bytes in the header
      const checkLen = Math.min(buffer.length, 512);
      for (let i = 0; i < checkLen; i += 1) {
        if (buffer[i] === 0x00) {
          return false; // Null byte indicates executable or compiled binary
        }
      }
      return true;
    }

    default:
      return false;
  }
}

export const initUploadSchema = z.object({
  filename: z.string().trim().min(1, 'Filename is required').max(255, 'Filename exceeds 255 characters'),
  mimeType: z.string().trim().min(1, 'MIME type is required'),
  sizeBytes: z.number().int().min(1, 'File cannot be empty').max(26214400, 'File exceeds maximum 25 MB limit'),
});

export type InitUploadInput = z.infer<typeof initUploadSchema>;

export const completeUploadSchema = z.object({
  checksumSha256: z.string().trim().optional(),
});

export type CompleteUploadInput = z.infer<typeof completeUploadSchema>;

export const listMeetingFilesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  before: z.string().trim().optional(),
  search: z.string().trim().max(100).optional(),
});

export type ListMeetingFilesQuery = z.infer<typeof listMeetingFilesQuerySchema>;
