import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { Types } from 'mongoose';
import { SharedFile, toSharedFileDto, type SharedFileDto } from '../models/SharedFile.model.js';
import { MeetingParticipant } from '../models/MeetingParticipant.model.js';
import { Meeting } from '../models/Meeting.model.js';
import { meetingService } from './meeting.service.js';
import { meetingRealtime } from '../realtime/meetingSocket.js';
import { chatRedisService, ChatRedisService } from './chatRedis.service.js';
import { getStorageProvider } from '../storage/storageFactory.js';
import type { IStorageProvider } from '../storage/storageProvider.interface.js';
import {
  ALLOWED_EXTENSIONS,
  ALLOWED_MIME_TYPES,
  DANGEROUS_EXTENSIONS,
  sanitizeFilename,
  validateMagicBytes,
  type InitUploadInput,
  type CompleteUploadInput,
  type ListMeetingFilesQuery,
} from '../schemas/file.schema.js';
import {
  validateStorageArchive,
  validateOpenXmlPackage,
  validateZipPayloadSecurity,
} from '../utils/archiveValidation.js';
import { fileCleanupWorker, type CleanupCycleReport } from './fileCleanupWorker.service.js';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  AppError,
} from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';

export const FILE_UPLOAD_RATE_LIMIT_WINDOW_MS = 60000; // 1 minute
export const FILE_UPLOAD_RATE_LIMIT_MAX_UPLOADS = 15; // 15 uploads per minute

export const FILE_DOWNLOAD_RATE_LIMIT_WINDOW_MS = 60000; // 1 minute
export const FILE_DOWNLOAD_RATE_LIMIT_MAX_DOWNLOADS = 60; // 60 downloads per minute

export interface DirectUploadPayload {
  buffer?: Buffer;
  tempFilePath?: string;
  originalname: string;
  mimetype: string;
  size: number;
}

export interface FileDownloadResult {
  file: SharedFileDto;
  stream?: Readable;
  presignedUrl?: string;
  filename: string;
  contentType: string;
  contentLength: number;
}

export class FileService {
  private _storageProvider: IStorageProvider | null = null;
  private readonly redisService: ChatRedisService;

  constructor(customStorage?: IStorageProvider, customRedis?: ChatRedisService) {
    if (customStorage) {
      this._storageProvider = customStorage;
    }
    this.redisService = customRedis ?? chatRedisService;
  }

  private get storageProvider(): IStorageProvider {
    this.assertFileSharingEnabled();
    if (!this._storageProvider) {
      this._storageProvider = getStorageProvider();
    }
    return this._storageProvider;
  }

  public assertFileSharingEnabled(): void {
    if (!env.ENABLE_FILE_SHARING || env.STORAGE_PROVIDER === 'disabled') {
      throw new ForbiddenError('File sharing is currently disabled', 'FEATURE_DISABLED');
    }
  }

  /**
   * Helper to verify participant admission status and meeting active state.
   */
  private async getAdmittedParticipant(meetingCodeOrId: string, userId: string) {
    const meeting = await meetingService.findMeetingAndEnforceExpiration(meetingCodeOrId);
    if (!meeting) {
      throw new NotFoundError('Meeting room not found or has expired.', 'MEETING_NOT_FOUND');
    }

    if (meeting.status === 'ENDED' || meeting.status === 'EXPIRED') {
      throw new AppError(
        'This meeting is no longer active.',
        410,
        meeting.status === 'EXPIRED' ? 'MEETING_EXPIRED' : 'MEETING_ENDED'
      );
    }

    const participant = await MeetingParticipant.findOne({
      meetingId: meeting._id,
      userId,
    });

    if (!participant || participant.admissionStatus !== 'ADMITTED') {
      throw new ForbiddenError(
        'Only admitted participants can access meeting files.',
        'FILE_ACCESS_DENIED'
      );
    }

    return { meeting, participant };
  }

  /**
   * Validates file metadata and binary magic bytes strictly before storage.
   */
  private validateFileSecurity(filename: string, mimeType: string, sizeBytes: number, bufferSample?: Buffer) {
    if (!filename || filename.trim().length === 0) {
      throw new BadRequestError('Filename cannot be empty.', 'INVALID_FILENAME');
    }

    if (sizeBytes <= 0) {
      throw new BadRequestError('Empty files (0 bytes) are not permitted.', 'EMPTY_FILE');
    }

    if (sizeBytes > env.STORAGE_MAX_FILE_SIZE_BYTES) {
      throw new BadRequestError(
        `File exceeds maximum allowed size of ${(env.STORAGE_MAX_FILE_SIZE_BYTES / (1024 * 1024)).toFixed(0)} MB.`,
        'FILE_TOO_LARGE'
      );
    }

    const ext = path.extname(filename).toLowerCase().replace(/^\./, '');
    if (!ext) {
      throw new BadRequestError('File must possess a valid extension.', 'MISSING_EXTENSION');
    }

    if (DANGEROUS_EXTENSIONS.includes(ext)) {
      throw new BadRequestError(`Executable and script files (.${ext}) are strictly prohibited.`, 'DANGEROUS_FILE_TYPE');
    }

    if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) {
      throw new BadRequestError(
        `File type .${ext} is not supported. Supported formats include PDF, Office documents, text, images, and archives.`,
        'UNSUPPORTED_EXTENSION'
      );
    }

    const normalizedMime = mimeType.toLowerCase().trim();
    if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(normalizedMime)) {
      throw new BadRequestError(`MIME type '${mimeType}' is not supported.`, 'UNSUPPORTED_MIME_TYPE');
    }

    if (bufferSample && bufferSample.length > 0) {
      const isValidMagic = validateMagicBytes(bufferSample, ext);
      if (!isValidMagic) {
        throw new BadRequestError(
          'File binary content does not match its declared extension (magic byte mismatch).',
          'MAGIC_BYTE_MISMATCH'
        );
      }

      if (['docx', 'xlsx', 'pptx'].includes(ext)) {
        validateOpenXmlPackage(bufferSample, ext);
      } else if (ext === 'zip') {
        validateZipPayloadSecurity(bufferSample);
      }
    }

    return { ext, normalizedMime, sanitizedName: sanitizeFilename(filename) };
  }

  /**
   * Directly uploads file via multipart stream.
   * Validates magic bytes, streams to storage, records in MongoDB, and emits real-time event.
   */
  public async uploadFileDirect(
    meetingCodeOrId: string,
    userId: string,
    uploadPayload: DirectUploadPayload
  ): Promise<SharedFileDto> {
    this.assertFileSharingEnabled();
    const { meeting, participant } = await this.getAdmittedParticipant(meetingCodeOrId, userId);
    const meetingIdStr = meeting._id.toString();

    // Distributed rate limit check for uploads
    const rateLimitKey = `connectly:rl:file:upload:${meetingIdStr}:${userId}`;
    const allowed = await this.redisService.checkRateLimit(
      rateLimitKey,
      FILE_UPLOAD_RATE_LIMIT_WINDOW_MS,
      FILE_UPLOAD_RATE_LIMIT_MAX_UPLOADS
    );

    if (!allowed) {
      if (uploadPayload.tempFilePath) {
        await fs.promises.unlink(uploadPayload.tempFilePath).catch(() => {});
      }
      throw new AppError(
        'Upload rate limit exceeded. Please wait a moment before sharing more files.',
        429,
        'RATE_LIMIT_EXCEEDED'
      );
    }

    let bufferSample: Buffer | undefined = uploadPayload.buffer;
    let actualSize = uploadPayload.size;

    try {
      if (uploadPayload.tempFilePath) {
        const stat = await fs.promises.stat(uploadPayload.tempFilePath);
        actualSize = stat.size;
        // Read initial sample for magic bytes
        const fd = await fs.promises.open(uploadPayload.tempFilePath, 'r');
        try {
          const sampleBuf = Buffer.alloc(Math.min(actualSize, 65536));
          const { bytesRead } = await fd.read(sampleBuf, 0, sampleBuf.length, 0);
          bufferSample = sampleBuf.subarray(0, bytesRead);
        } finally {
          await fd.close();
        }
      }

      // Security, magic bytes & OpenXML validation
      const { ext, normalizedMime, sanitizedName } = this.validateFileSecurity(
        uploadPayload.originalname,
        uploadPayload.mimetype,
        actualSize,
        bufferSample
      );

      const fileObjectId = new Types.ObjectId();
      const storageKey = `meetings/${meetingIdStr}/${fileObjectId.toString()}/${sanitizedName}`;

      // Compute checksum and prepare readable stream
      let checksumSha256: string;
      let readableStream: Readable;

      if (uploadPayload.tempFilePath) {
        // Stream directly from temporary disk file to storage provider with bounded memory
        const fileStreamForHash = fs.createReadStream(uploadPayload.tempFilePath);
        const hash = crypto.createHash('sha256');
        await new Promise<void>((resolve, reject) => {
          fileStreamForHash.on('data', (chunk) => hash.update(chunk));
          fileStreamForHash.on('end', () => resolve());
          fileStreamForHash.on('error', (err) => reject(err));
        });
        checksumSha256 = hash.digest('hex');
        readableStream = fs.createReadStream(uploadPayload.tempFilePath);
      } else if (uploadPayload.buffer) {
        readableStream = Readable.from(uploadPayload.buffer);
        checksumSha256 = crypto.createHash('sha256').update(uploadPayload.buffer).digest('hex');
      } else {
        throw new BadRequestError('Upload payload missing file data.', 'INVALID_PAYLOAD');
      }

      // Stream upload to storage provider
      const uploadResult = await this.storageProvider.uploadStream(storageKey, readableStream, normalizedMime, actualSize);

      // Persist metadata to MongoDB
      const sharedFile = await SharedFile.create({
        _id: fileObjectId,
        meetingId: meeting._id,
        uploaderId: participant.userId,
        uploaderName: participant.displayName,
        uploaderRole: participant.role,
        uploaderAvatarUrl: participant.avatarUrl || null,
        originalFilename: uploadPayload.originalname,
        sanitizedFilename: sanitizedName,
        storageKey,
        storageProvider: this.storageProvider.name,
        mimeType: normalizedMime,
        extension: ext,
        sizeBytes: actualSize,
        status: 'AVAILABLE',
        checksumSha256,
        versionId: uploadResult?.versionId || null,
        isDeleted: false,
      });

      const fileDto = toSharedFileDto(sharedFile, {
        meetingCode: meeting.meetingCode,
        meetingTitle: meeting.title,
      });

      // Broadcast file:shared event in real time across the room
      meetingRealtime.emitFileShared(meetingIdStr, fileDto);

      logger.info('[FileService] File uploaded successfully', {
        metadata: {
          meetingId: meetingIdStr,
          userId,
          fileId: sharedFile._id.toString(),
          filename: sanitizedName,
          sizeBytes: actualSize,
        },
      });

      return fileDto;
    } finally {
      // Memory-safe cleanup: Always unlink temporary disk upload file
      if (uploadPayload.tempFilePath) {
        await fs.promises.unlink(uploadPayload.tempFilePath).catch(() => {});
      }
    }
  }

  /**
   * Initiates presigned upload for direct client-to-storage uploads.
   */
  public async initPresignedUpload(
    meetingCodeOrId: string,
    userId: string,
    input: InitUploadInput
  ): Promise<{
    fileId: string;
    uploadUrl: string;
    method: 'POST' | 'PUT';
    fields?: Record<string, string>;
    headers?: Record<string, string>;
    expiresInSeconds: number;
    file: SharedFileDto;
  }> {
    this.assertFileSharingEnabled();
    const { meeting, participant } = await this.getAdmittedParticipant(meetingCodeOrId, userId);
    const meetingIdStr = meeting._id.toString();

    // Distributed rate limit check
    const rateLimitKey = `connectly:rl:file:upload:${meetingIdStr}:${userId}`;
    const allowed = await this.redisService.checkRateLimit(
      rateLimitKey,
      FILE_UPLOAD_RATE_LIMIT_WINDOW_MS,
      FILE_UPLOAD_RATE_LIMIT_MAX_UPLOADS
    );

    if (!allowed) {
      throw new AppError(
        'Upload rate limit exceeded. Please wait a moment before uploading more files.',
        429,
        'RATE_LIMIT_EXCEEDED'
      );
    }

    const { ext, normalizedMime, sanitizedName } = this.validateFileSecurity(
      input.filename,
      input.mimeType,
      input.sizeBytes
    );

    const fileObjectId = new Types.ObjectId();
    const storageKey = `meetings/${meetingIdStr}/${fileObjectId.toString()}/${sanitizedName}`;

    const presigned = await this.storageProvider.generatePresignedUploadUrl(
      storageKey,
      normalizedMime,
      input.sizeBytes,
      env.STORAGE_SIGNED_URL_TTL_SECONDS
    );

    const sharedFile = await SharedFile.create({
      _id: fileObjectId,
      meetingId: meeting._id,
      uploaderId: participant.userId,
      uploaderName: participant.displayName,
      uploaderRole: participant.role,
      uploaderAvatarUrl: participant.avatarUrl || null,
      originalFilename: input.filename,
      sanitizedFilename: sanitizedName,
      storageKey,
      storageProvider: this.storageProvider.name,
      mimeType: normalizedMime,
      extension: ext,
      sizeBytes: input.sizeBytes,
      status: 'PENDING',
      pendingExpiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 minutes TTL
      cleanupStatus: 'NONE',
      cleanupRetries: 0,
      isDeleted: false,
    });

    const fileDto = toSharedFileDto(sharedFile, {
      meetingCode: meeting.meetingCode,
      meetingTitle: meeting.title,
    });

    return {
      fileId: sharedFile._id.toString(),
      uploadUrl: presigned.uploadUrl,
      method: presigned.method || 'POST',
      fields: presigned.fields,
      headers: presigned.headers,
      expiresInSeconds: presigned.expiresInSeconds,
      file: fileDto,
    };
  }

  /**
   * Completes a presigned upload after verifying the object exists in storage.
   * Enforces actual storage size assertion, magic byte & OpenXML/ZIP integrity (DEF-13-01),
   * and atomic state transition to prevent duplicate broadcast race conditions (DEF-13-02).
   */
  public async completePresignedUpload(
    meetingCodeOrId: string,
    userId: string,
    fileId: string,
    input?: CompleteUploadInput
  ): Promise<SharedFileDto> {
    this.assertFileSharingEnabled();
    const { meeting } = await this.getAdmittedParticipant(meetingCodeOrId, userId);

    if (!Types.ObjectId.isValid(fileId)) {
      throw new BadRequestError('Invalid file identifier.', 'INVALID_IDENTIFIER');
    }

    const file = await SharedFile.findOne({
      _id: new Types.ObjectId(fileId),
      meetingId: meeting._id,
      isDeleted: false,
    });

    if (!file) {
      throw new NotFoundError('File record not found.', 'FILE_NOT_FOUND');
    }

    if (file.uploaderId.toString() !== userId) {
      throw new ForbiddenError('Only the uploader can finalize this upload.', 'NOT_UPLOADER');
    }

    // Idempotency: if already available, return without broadcasting again
    if (file.status === 'AVAILABLE') {
      return toSharedFileDto(file, {
        meetingCode: meeting.meetingCode,
        meetingTitle: meeting.title,
      });
    }

    // DEF-13-12: Reject files that are already undergoing cleanup or failed
    if (file.status === 'CLEANING' || file.status === 'FAILED') {
      throw new BadRequestError(
        'File upload has expired or is being cleaned up.',
        'FILE_EXPIRED_OR_CLEANED'
      );
    }

    // Verify object existence in storage provider
    const head = await this.storageProvider.headObject(file.storageKey);
    if (!head || !head.exists) {
      file.status = 'FAILED';
      file.cleanupStatus = 'CLEANED';
      await file.save();
      throw new BadRequestError('Uploaded file object could not be verified in storage.', 'STORAGE_VERIFICATION_FAILED');
    }

    // Enforce actual storage size bounds (DEF-13-01)
    if (head.sizeBytes <= 0) {
      await this.storageProvider.deleteObject(file.storageKey, head.versionId).catch(() => {});
      file.status = 'FAILED';
      file.cleanupStatus = 'CLEANED';
      await file.save();
      throw new BadRequestError('Uploaded file is empty (0 bytes).', 'FILE_EMPTY');
    }

    if (head.sizeBytes > env.STORAGE_MAX_FILE_SIZE_BYTES) {
      await this.storageProvider.deleteObject(file.storageKey, head.versionId).catch(() => {});
      file.status = 'FAILED';
      file.cleanupStatus = 'CLEANED';
      await file.save();
      throw new BadRequestError(
        `Uploaded file size (${(head.sizeBytes / (1024 * 1024)).toFixed(1)} MB) exceeds maximum permitted limit of 25 MB.`,
        'FILE_TOO_LARGE'
      );
    }

    // DEF-13-09 & DEF-13-13: Complete Archive and OpenXML validation over full archive via Central Directory / EOCD
    // pinned to the exact immutable VersionId
    if (['zip', 'docx', 'xlsx', 'pptx'].includes(file.extension)) {
      try {
        await validateStorageArchive(
          this.storageProvider,
          file.storageKey,
          head.sizeBytes,
          file.extension,
          head.versionId
        );
      } catch (err) {
        await this.storageProvider.deleteObject(file.storageKey, head.versionId).catch(() => {});
        file.status = 'FAILED';
        file.cleanupStatus = 'CLEANED';
        await file.save();
        throw err;
      }
    } else {
      // DEF-13-13: Read byte sample to verify magic bytes for non-archives pinned to exact versionId
      const sampleLength = Math.min(head.sizeBytes, 65536);
      const sampleBuffer = await this.storageProvider.readByteRange(
        file.storageKey,
        0,
        sampleLength - 1,
        head.versionId
      );

      const isValidMagic = validateMagicBytes(sampleBuffer, file.extension);
      if (!isValidMagic) {
        await this.storageProvider.deleteObject(file.storageKey, head.versionId).catch(() => {});
        file.status = 'FAILED';
        file.cleanupStatus = 'CLEANED';
        await file.save();
        throw new BadRequestError(
          'File binary content does not match its declared extension (magic byte mismatch).',
          'MAGIC_BYTE_MISMATCH'
        );
      }
    }

    // DEF-13-10: Authoritative Server-Side SHA-256 Hash Computation across stored bytes
    const download = await this.storageProvider.downloadStream(file.storageKey, head.versionId);
    const hash = crypto.createHash('sha256');
    await new Promise<void>((resolve, reject) => {
      download.stream.on('data', (chunk) => hash.update(chunk));
      download.stream.on('end', () => resolve());
      download.stream.on('error', (err) => reject(err));
    });
    const authoritativeSha256 = hash.digest('hex');

    // If client supplied checksum, verify match against authoritative hash
    if (input?.checksumSha256) {
      if (input.checksumSha256.toLowerCase() !== authoritativeSha256.toLowerCase()) {
        await this.storageProvider.deleteObject(file.storageKey, head.versionId).catch(() => {});
        file.status = 'FAILED';
        file.cleanupStatus = 'CLEANED';
        await file.save();
        throw new BadRequestError(
          'Client-provided checksum does not match verified storage object bytes.',
          'CHECKSUM_MISMATCH'
        );
      }
    }

    // DEF-13-02, DEF-13-10 & DEF-13-12: Atomic conditional transition from PENDING to AVAILABLE
    // Mutually exclusive with cleanup worker: rejects if status is no longer PENDING or if claimed by cleanup
    const updatedFile = await SharedFile.findOneAndUpdate(
      {
        _id: file._id,
        meetingId: meeting._id,
        status: 'PENDING',
        cleanupClaimToken: null,
        isDeleted: false,
      },
      {
        $set: {
          status: 'AVAILABLE',
          sizeBytes: head.sizeBytes,
          checksumSha256: authoritativeSha256,
          versionId: head.versionId || null,
          pendingExpiresAt: null,
          cleanupStatus: 'NONE',
          cleanupClaimedAt: null,
          cleanupClaimedBy: null,
          cleanupClaimToken: null,
        },
      },
      { new: true }
    );

    // If update returned null, check whether it was already completed or claimed by cleanup
    if (!updatedFile) {
      const currentFile = await SharedFile.findOne({ _id: file._id, meetingId: meeting._id });
      if (currentFile && currentFile.status === 'AVAILABLE') {
        return toSharedFileDto(currentFile, {
          meetingCode: meeting.meetingCode,
          meetingTitle: meeting.title,
        });
      }
      if (currentFile && (currentFile.status === 'CLEANING' || currentFile.status === 'FAILED')) {
        throw new BadRequestError(
          'File upload has expired, been cancelled, or was cleaned up.',
          'FILE_EXPIRED_OR_CLEANED'
        );
      }
      throw new BadRequestError('File upload could not be finalized.', 'FILE_FINALIZATION_FAILED');
    }

    const fileDto = toSharedFileDto(updatedFile, {
      meetingCode: meeting.meetingCode,
      meetingTitle: meeting.title,
    });

    // Broadcast file:shared to the room ONLY on successful atomic transition
    meetingRealtime.emitFileShared(meeting._id.toString(), fileDto);

    return fileDto;
  }

  /**
   * Lists files shared in a meeting with pagination and search.
   */
  public async listMeetingFiles(
    meetingCodeOrId: string,
    userId: string,
    query: ListMeetingFilesQuery
  ): Promise<{ files: SharedFileDto[]; hasMore: boolean; nextCursor: string | null }> {
    this.assertFileSharingEnabled();
    const { meeting } = await this.getAdmittedParticipant(meetingCodeOrId, userId);
    const limit = Math.min(Math.max(query.limit || 20, 1), 50);

    const filter: Record<string, any> = {
      meetingId: meeting._id,
      isDeleted: false,
      status: 'AVAILABLE',
    };

    if (query.search && query.search.trim().length > 0) {
      const sanitizedSearch = query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.originalFilename = { $regex: sanitizedSearch, $options: 'i' };
    }

    if (query.before) {
      const parts = query.before.split('_');
      if (parts.length === 2) {
        const cursorDate = new Date(parts[0]);
        const cursorId = parts[1];
        if (!isNaN(cursorDate.getTime()) && Types.ObjectId.isValid(cursorId)) {
          filter.$or = [
            { createdAt: { $lt: cursorDate } },
            { createdAt: cursorDate, _id: { $lt: new Types.ObjectId(cursorId) } },
          ];
        }
      }
    }

    const docs = await SharedFile.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1);

    const hasMore = docs.length > limit;
    const pagedDocs = hasMore ? docs.slice(0, limit) : docs;

    const files = pagedDocs.map((doc) =>
      toSharedFileDto(doc, {
        meetingCode: meeting.meetingCode,
        meetingTitle: meeting.title,
      })
    );

    let nextCursor: string | null = null;
    if (hasMore && pagedDocs.length > 0) {
      const last = pagedDocs[pagedDocs.length - 1];
      nextCursor = `${last.createdAt.toISOString()}_${last._id.toString()}`;
    }

    return { files, hasMore, nextCursor };
  }

  /**
   * Retrieves file metadata and generates secure streaming/presigned download.
   */
  public async getFileForDownload(
    meetingCodeOrId: string,
    userId: string,
    fileId: string
  ): Promise<FileDownloadResult> {
    this.assertFileSharingEnabled();
    const { meeting } = await this.getAdmittedParticipant(meetingCodeOrId, userId);

    if (!Types.ObjectId.isValid(fileId)) {
      throw new BadRequestError('Invalid file identifier.', 'INVALID_IDENTIFIER');
    }

    // Rate limit check on downloads
    const rateLimitKey = `connectly:rl:file:download:${meeting._id.toString()}:${userId}`;
    const allowed = await this.redisService.checkRateLimit(
      rateLimitKey,
      FILE_DOWNLOAD_RATE_LIMIT_WINDOW_MS,
      FILE_DOWNLOAD_RATE_LIMIT_MAX_DOWNLOADS
    );

    if (!allowed) {
      throw new AppError('Download rate limit exceeded. Please slow down.', 429, 'RATE_LIMIT_EXCEEDED');
    }

    const file = await SharedFile.findOne({
      _id: new Types.ObjectId(fileId),
      meetingId: meeting._id,
      isDeleted: false,
      status: 'AVAILABLE',
    });

    if (!file) {
      throw new NotFoundError('File not found or no longer available.', 'FILE_NOT_FOUND');
    }

    const fileDto = toSharedFileDto(file, {
      meetingCode: meeting.meetingCode,
      meetingTitle: meeting.title,
    });

    // Always stream file download through the backend to enforce participant admission in real-time (DEF-13-05)
    // Downloads target the verified, immutable versionId (DEF-13-10)
    const download = await this.storageProvider.downloadStream(file.storageKey, file.versionId || undefined);
    return {
      file: fileDto,
      stream: download.stream,
      filename: file.sanitizedFilename,
      contentType: file.mimeType || download.contentType,
      contentLength: file.sizeBytes || download.contentLength,
    };
  }

  /**
   * Deletes a shared file. Only the original uploader or room host/co-host can delete.
   * Tracks storage deletion status and retries on failure (DEF-13-04).
   */
  public async deleteFile(
    meetingCodeOrId: string,
    userId: string,
    fileId: string
  ): Promise<{ success: boolean; fileId: string }> {
    this.assertFileSharingEnabled();
    const { meeting, participant } = await this.getAdmittedParticipant(meetingCodeOrId, userId);

    if (!Types.ObjectId.isValid(fileId)) {
      throw new BadRequestError('Invalid file identifier.', 'INVALID_IDENTIFIER');
    }

    const file = await SharedFile.findOne({
      _id: new Types.ObjectId(fileId),
      meetingId: meeting._id,
      isDeleted: false,
    });

    if (!file) {
      throw new NotFoundError('File not found or already deleted.', 'FILE_NOT_FOUND');
    }

    // Permission check: uploader or host/co-host
    const isOwner = file.uploaderId.toString() === userId;
    const isElevated = participant.role === 'host' || participant.role === 'co-host';

    if (!isOwner && !isElevated) {
      throw new ForbiddenError('You do not have permission to delete this file.', 'DELETE_NOT_AUTHORIZED');
    }

    // Soft delete metadata and initiate storage cleanup tracking
    file.isDeleted = true;
    file.status = 'DELETED';
    file.deletedAt = new Date();
    file.deletedBy = new Types.ObjectId(userId);
    file.cleanupStatus = 'PENDING_STORAGE_DELETE';
    await file.save();

    // Remove from physical storage targeting specific versionId
    try {
      await this.storageProvider.deleteObject(file.storageKey, file.versionId || undefined);
      file.cleanupStatus = 'CLEANED';
      await file.save();
    } catch (storageErr) {
      logger.error('[FileService] Failed to delete object from storage provider', {
        metadata: {
          fileId: file._id.toString(),
          storageKey: file.storageKey,
          versionId: file.versionId,
          error: storageErr instanceof Error ? storageErr.message : String(storageErr),
        },
      });
      file.cleanupStatus = 'STORAGE_DELETE_FAILED';
      file.cleanupRetries = 1;
      await file.save();
    }

    // Broadcast file:deleted to the room
    meetingRealtime.emitFileDeleted(meeting._id.toString(), {
      fileId: file._id.toString(),
      meetingId: meeting._id.toString(),
    });

    logger.info('[FileService] File deleted successfully', {
      metadata: {
        meetingId: meeting._id.toString(),
        userId,
        fileId,
      },
    });

    return { success: true, fileId: file._id.toString() };
  }

  /**
   * DEF-13-04 & DEF-13-11: Sweeper that delegates to fileCleanupWorker for distributed, lease-safe cleanup.
   */
  public async cleanupExpiredAndOrphanedFiles(): Promise<CleanupCycleReport & { failedDeletionsRetried: number }> {
    const report = await fileCleanupWorker.runCleanupCycle();
    return {
      ...report,
      failedDeletionsRetried: report.failedDeletionsClaimed,
    };
  }

  /**
   * Retrieves all available files shared in meetings attended by the user.
   * Integrates seamlessly with the Phase 06 User Dashboard & Downloads page!
   */
  public async getUserSharedFiles(userId: string): Promise<any[]> {
    this.assertFileSharingEnabled();
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestError('Invalid user identifier.', 'INVALID_IDENTIFIER');
    }

    // Find all meetings where the user was an admitted participant
    const memberships = await MeetingParticipant.find({
      userId: new Types.ObjectId(userId),
      admissionStatus: 'ADMITTED',
    }).select('meetingId');

    const meetingIds = memberships.map((m) => m.meetingId);

    if (meetingIds.length === 0) {
      return [];
    }

    // Fetch meetings to get title & code
    const meetings = await Meeting.find({
      _id: { $in: meetingIds },
    }).select('_id title meetingCode');

    const meetingMap = new Map<string, { title: string; code: string }>();
    for (const m of meetings) {
      meetingMap.set(m._id.toString(), { title: m.title, code: m.meetingCode });
    }

    const files = await SharedFile.find({
      meetingId: { $in: meetingIds },
      isDeleted: false,
      status: 'AVAILABLE',
    })
      .sort({ createdAt: -1 })
      .limit(100);

    // Map to Dashboard ISharedFileItem contract
    return files.map((f) => {
      const meet = meetingMap.get(f.meetingId.toString());
      return {
        id: f._id.toString(),
        name: f.originalFilename,
        extension: f.extension,
        sizeBytes: f.sizeBytes,
        sharedAt: f.createdAt.toISOString(),
        associatedMeetingName: meet?.title || 'Meeting Session',
        associatedMeetingCode: meet?.code || 'cly-000-000',
        sharedBy: {
          id: f.uploaderId.toString(),
          name: f.uploaderName,
          avatarUrl: f.uploaderAvatarUrl || null,
        },
        mimeType: f.mimeType,
      };
    });
  }
}

export const fileService = new FileService();
