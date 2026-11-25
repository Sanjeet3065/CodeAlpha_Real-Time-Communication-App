import type { Request, Response } from 'express';
import { fileService } from '../services/file.service.js';
import {
  initUploadSchema,
  completeUploadSchema,
  listMeetingFilesQuerySchema,
} from '../schemas/file.schema.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { BadRequestError, UnauthorizedError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

function requireUserId(req: Request): string {
  const userId = req.user?.sub;
  if (!userId) {
    throw new UnauthorizedError('Authentication required.');
  }
  return userId;
}

/**
 * Direct file upload endpoint (multipart/form-data via Multer)
 */
export async function uploadMeetingFile(req: Request, res: Response): Promise<void> {
  const userId = requireUserId(req);
  const meetingCode = req.params.meetingCode;

  if (!req.file) {
    throw new BadRequestError('No file was uploaded.', 'FILE_REQUIRED');
  }

  const result = await fileService.uploadFileDirect(meetingCode, userId, {
    tempFilePath: req.file.path,
    buffer: req.file.buffer,
    originalname: req.file.originalname,
    mimetype: req.file.mimetype,
    size: req.file.size,
  });

  sendSuccess(res, result, 201, { message: 'File uploaded successfully.' });
}

/**
 * Initiates presigned upload for direct client-to-storage uploads
 */
export async function initPresignedUpload(req: Request, res: Response): Promise<void> {
  const userId = requireUserId(req);
  const meetingCode = req.params.meetingCode;
  const input = initUploadSchema.parse(req.body);

  const result = await fileService.initPresignedUpload(meetingCode, userId, input);
  sendSuccess(res, result, 201, { message: 'Upload initiated.' });
}

/**
 * Completes presigned upload after verifying presence in storage
 */
export async function completePresignedUpload(req: Request, res: Response): Promise<void> {
  const userId = requireUserId(req);
  const meetingCode = req.params.meetingCode;
  const fileId = req.params.fileId;
  const input = completeUploadSchema.parse(req.body || {});

  const result = await fileService.completePresignedUpload(meetingCode, userId, fileId, input);
  sendSuccess(res, result, 200, { message: 'Upload completed successfully.' });
}

/**
 * Lists files shared in a meeting room
 */
export async function listMeetingFiles(req: Request, res: Response): Promise<void> {
  const userId = requireUserId(req);
  const meetingCode = req.params.meetingCode;
  const query = listMeetingFilesQuerySchema.parse(req.query);

  const result = await fileService.listMeetingFiles(meetingCode, userId, query);
  sendSuccess(res, result, 200);
}

/**
 * Downloads a shared meeting file securely
 */
export async function downloadMeetingFile(req: Request, res: Response): Promise<void> {
  const userId = requireUserId(req);
  const meetingCode = req.params.meetingCode;
  const fileId = req.params.fileId;

  const download = await fileService.getFileForDownload(meetingCode, userId, fileId);

  // If storage provider returned a presigned URL, redirect or return URL
  if (download.presignedUrl) {
    res.redirect(download.presignedUrl);
    return;
  }

  if (!download.stream) {
    throw new BadRequestError('File download stream unavailable.', 'STREAM_UNAVAILABLE');
  }

  // Set strict security and attachment headers
  const sanitizedFilename = encodeURIComponent(download.filename);
  res.setHeader('Content-Type', download.contentType || 'application/octet-stream');
  res.setHeader('Content-Length', download.contentLength.toString());
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${sanitizedFilename}"; filename*=UTF-8''${sanitizedFilename}`
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  download.stream.pipe(res);

  download.stream.on('error', (err) => {
    logger.error('[FileController] Error during file download streaming', {
      error: err instanceof Error ? err.message : String(err),
      fileId,
    });
    if (!res.headersSent) {
      res.status(500).json({
        status: 500,
        code: 'STREAM_ERROR',
        message: 'An error occurred while streaming the file.',
      });
    }
  });
}

/**
 * Deletes a shared file (uploader or host/co-host only)
 */
export async function deleteMeetingFile(req: Request, res: Response): Promise<void> {
  const userId = requireUserId(req);
  const meetingCode = req.params.meetingCode;
  const fileId = req.params.fileId;

  const result = await fileService.deleteFile(meetingCode, userId, fileId);
  sendSuccess(res, result, 200, { message: 'File deleted successfully.' });
}

/**
 * Retrieves all files shared across meetings attended by the user
 */
export async function getUserSharedFiles(req: Request, res: Response): Promise<void> {
  const userId = requireUserId(req);
  const files = await fileService.getUserSharedFiles(userId);
  sendSuccess(res, { files }, 200);
}
