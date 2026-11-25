import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type {
  IStorageProvider,
  StorageObjectMetadata,
  PresignedUploadResult,
  UploadStreamResult,
  DownloadStreamResult,
} from './storageProvider.interface.js';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';

export class LocalStorageProvider implements IStorageProvider {
  public readonly name = 'local';
  private readonly baseDir: string;

  constructor(customBaseDir?: string) {
    if (env.NODE_ENV === 'production') {
      throw new AppError(
        'CRITICAL: LocalStorageProvider cannot be initialized in production mode.',
        500,
        'LOCAL_STORAGE_PROHIBITED_IN_PROD'
      );
    }
    this.baseDir = path.resolve(process.cwd(), customBaseDir || env.STORAGE_LOCAL_DIR || 'uploads');
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  /**
   * Strictly validates that the storage key resolves within the sandboxed base directory.
   */
  private resolveSafePath(key: string): string {
    const resolved = path.resolve(this.baseDir, key);
    if (!resolved.startsWith(this.baseDir + path.sep) && resolved !== this.baseDir) {
      throw new AppError('Path traversal detected in storage key.', 400, 'PATH_TRAVERSAL_DETECTED');
    }
    return resolved;
  }

  public async uploadStream(
    key: string,
    stream: Readable,
    _contentType: string,
    _contentLength?: number
  ): Promise<UploadStreamResult> {
    const filePath = this.resolveSafePath(key);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const writeStream = fs.createWriteStream(filePath);
    let sizeBytes = 0;
    const hash = crypto.createHash('sha256');

    stream.on('data', (chunk) => {
      sizeBytes += chunk.length;
      hash.update(chunk);
    });

    await pipeline(stream, writeStream);

    return {
      sizeBytes,
      etag: hash.digest('hex'),
    };
  }

  public async downloadStream(key: string, _versionId?: string): Promise<DownloadStreamResult> {
    const filePath = this.resolveSafePath(key);
    if (!fs.existsSync(filePath)) {
      throw new AppError('Storage object not found.', 404, 'STORAGE_NOT_FOUND');
    }

    const stat = fs.statSync(filePath);
    const stream = fs.createReadStream(filePath);

    return {
      stream,
      contentType: 'application/octet-stream',
      contentLength: stat.size,
    };
  }

  public async generatePresignedUploadUrl(
    key: string,
    contentType: string,
    contentLength: number,
    expiresInSeconds = 900
  ): Promise<PresignedUploadResult> {
    const token = crypto.randomBytes(24).toString('hex');
    const uploadUrl = `/api/v1/storage/direct-upload/${encodeURIComponent(key)}?token=${token}`;

    return {
      uploadUrl,
      method: 'POST',
      fields: {
        key,
        'Content-Type': contentType,
        'content-length-range': '1-26214400',
      },
      headers: {
        'Content-Type': contentType,
        'Content-Length': contentLength.toString(),
      },
      expiresInSeconds,
    };
  }

  public async generatePresignedDownloadUrl(
    key: string,
    downloadFilename: string,
    expiresInSeconds = 900
  ): Promise<string> {
    const token = crypto.randomBytes(24).toString('hex');
    return `/api/v1/storage/direct-download/${encodeURIComponent(key)}?filename=${encodeURIComponent(
      downloadFilename
    )}&token=${token}&expires=${Date.now() + expiresInSeconds * 1000}`;
  }

  public async deleteObject(key: string, _versionId?: string): Promise<boolean> {
    try {
      const filePath = this.resolveSafePath(key);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        return true;
      }
      return false;
    } catch (err: unknown) {
      logger.warn('[LocalStorage] Delete object failed', {
        metadata: { key, error: err instanceof Error ? err.message : String(err) },
      });
      return false;
    }
  }

  public async headObject(key: string): Promise<StorageObjectMetadata | null> {
    const filePath = this.resolveSafePath(key);
    try {
      if (!fs.existsSync(filePath)) {
        return null;
      }
      const stat = fs.statSync(filePath);
      return {
        exists: true,
        sizeBytes: stat.size,
        contentType: 'application/octet-stream',
      };
    } catch {
      return null;
    }
  }

  public async readByteRange(
    key: string,
    start: number,
    end: number,
    _versionId?: string
  ): Promise<Buffer> {
    const filePath = this.resolveSafePath(key);
    try {
      if (!fs.existsSync(filePath)) {
        throw new AppError('File not found in local storage.', 404, 'STORAGE_NOT_FOUND');
      }
      const length = end - start + 1;
      const buffer = Buffer.alloc(length);
      const fd = fs.openSync(filePath, 'r');
      try {
        const bytesRead = fs.readSync(fd, buffer, 0, length, start);
        return buffer.subarray(0, bytesRead);
      } finally {
        fs.closeSync(fd);
      }
    } catch (err: unknown) {
      if (err instanceof AppError) throw err;
      logger.error('[LocalStorage] Read byte range failed', {
        metadata: { key, error: err instanceof Error ? err.message : String(err) },
      });
      throw new AppError('Failed to read local file byte range.', 500, 'STORAGE_READ_FAILED');
    }
  }
}
