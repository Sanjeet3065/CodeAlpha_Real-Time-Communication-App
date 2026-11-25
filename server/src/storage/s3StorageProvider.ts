import { Readable } from 'node:stream';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  GetBucketVersioningCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import type {
  IStorageProvider,
  StorageObjectMetadata,
  PresignedUploadResult,
  UploadStreamResult,
  DownloadStreamResult,
} from './storageProvider.interface.js';
import { logger } from '../utils/logger.js';
import { AppError } from '../utils/errors.js';

const DEFAULT_MAX_FILE_SIZE_BYTES = 26_214_400; // 25 MB fallback if env was not imported eagerly

export interface S3StorageConfig {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
  maxFileSizeBytes?: number;
}

export class S3StorageProvider implements IStorageProvider {
  public readonly name = 's3';
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly maxFileSizeBytes: number;

  constructor(config: S3StorageConfig) {
    this.bucket = config.bucket;
    const configuredMax = Number(process.env.STORAGE_MAX_FILE_SIZE_BYTES);
    this.maxFileSizeBytes =
      config.maxFileSizeBytes ??
      (Number.isFinite(configuredMax) && configuredMax > 0 ? configuredMax : DEFAULT_MAX_FILE_SIZE_BYTES);
    const clientConfig: ConstructorParameters<typeof S3Client>[0] = {
      region: config.region,
      forcePathStyle: config.forcePathStyle ?? false,
    };

    if (config.endpoint) {
      clientConfig.endpoint = config.endpoint;
    }

    if (config.accessKeyId && config.secretAccessKey) {
      clientConfig.credentials = {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      };
    }

    this.client = new S3Client(clientConfig);
  }

  public async uploadStream(
    key: string,
    stream: Readable,
    contentType: string,
    contentLength?: number
  ): Promise<UploadStreamResult> {
    try {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: stream,
        ContentType: contentType,
        ContentLength: contentLength,
        ServerSideEncryption: 'AES256',
      });

      const response = await this.client.send(command);

      return {
        sizeBytes: contentLength || 0,
        etag: response.ETag?.replace(/"/g, ''),
        versionId: response.VersionId,
      };
    } catch (err: unknown) {
      logger.error('[S3Storage] Upload stream failed', {
        metadata: {
          key,
          bucket: this.bucket,
          error: err instanceof Error ? err.message : String(err),
        },
      });
      throw new AppError('Storage upload failed.', 502, 'STORAGE_UPLOAD_FAILED');
    }
  }

  public async downloadStream(key: string, versionId?: string): Promise<DownloadStreamResult> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ...(versionId ? { VersionId: versionId } : {}),
      });

      const response = await this.client.send(command);
      if (!response.Body) {
        throw new Error('S3 response body is empty.');
      }

      const stream = response.Body as Readable;
      return {
        stream,
        contentType: response.ContentType || 'application/octet-stream',
        contentLength: response.ContentLength || 0,
      };
    } catch (err: unknown) {
      logger.error('[S3Storage] Download stream failed', {
        metadata: {
          key,
          bucket: this.bucket,
          versionId,
          error: err instanceof Error ? err.message : String(err),
        },
      });
      throw new AppError('Storage object could not be retrieved.', 404, 'STORAGE_NOT_FOUND');
    }
  }

  public async generatePresignedUploadUrl(
    key: string,
    contentType: string,
    _contentLength: number,
    expiresInSeconds = 900
  ): Promise<PresignedUploadResult> {
    try {
      // DEF-13-08: Enforce content-length-range strictly (1 byte to 25MB) at the S3 upload boundary
      const presignedPost = await createPresignedPost(this.client, {
        Bucket: this.bucket,
        Key: key,
        Conditions: [
          ['content-length-range', 1, this.maxFileSizeBytes],
          ['eq', '$Content-Type', contentType],
        ],
        Fields: {
          'Content-Type': contentType,
        },
        Expires: expiresInSeconds,
      });

      return {
        uploadUrl: presignedPost.url,
        method: 'POST',
        fields: presignedPost.fields,
        expiresInSeconds,
      };
    } catch (err: unknown) {
      logger.error('[S3Storage] Generate presigned POST URL failed', {
        metadata: { key, error: err instanceof Error ? err.message : String(err) },
      });
      throw new AppError('Failed to generate upload URL.', 500, 'STORAGE_PRESIGN_FAILED');
    }
  }

  public async generatePresignedDownloadUrl(
    key: string,
    downloadFilename: string,
    expiresInSeconds = 900
  ): Promise<string> {
    try {
      const sanitizedFilename = downloadFilename.replace(/["\r\n]/g, '_');
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: `attachment; filename="${sanitizedFilename}"`,
      });

      return await getSignedUrl(this.client, command, {
        expiresIn: expiresInSeconds,
      });
    } catch (err: unknown) {
      logger.error('[S3Storage] Generate presigned download URL failed', {
        metadata: { key, error: err instanceof Error ? err.message : String(err) },
      });
      throw new AppError('Failed to generate download URL.', 500, 'STORAGE_PRESIGN_FAILED');
    }
  }

  public async deleteObject(key: string, versionId?: string): Promise<boolean> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ...(versionId ? { VersionId: versionId } : {}),
      });
      await this.client.send(command);
      return true;
    } catch (err: unknown) {
      logger.warn('[S3Storage] Delete object failed', {
        metadata: { key, versionId, error: err instanceof Error ? err.message : String(err) },
      });
      return false;
    }
  }

  public async headObject(key: string): Promise<StorageObjectMetadata | null> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      const response = await this.client.send(command);
      return {
        exists: true,
        sizeBytes: response.ContentLength || 0,
        contentType: response.ContentType || 'application/octet-stream',
        etag: response.ETag?.replace(/"/g, ''),
        versionId: response.VersionId,
      };
    } catch (err: any) {
      if (err?.name === 'NotFound' || err?.$metadata?.httpStatusCode === 404) {
        return null;
      }
      logger.warn('[S3Storage] HeadObject error', {
        metadata: { key, error: err instanceof Error ? err.message : String(err) },
      });
      return null;
    }
  }

  public async readByteRange(
    key: string,
    start: number,
    end: number,
    versionId?: string
  ): Promise<Buffer> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Range: `bytes=${start}-${end}`,
        ...(versionId ? { VersionId: versionId } : {}),
      });
      const response = await this.client.send(command);
      if (!response.Body) {
        throw new Error('S3 byte range response body is empty.');
      }
      const chunks: Buffer[] = [];
      for await (const chunk of response.Body as Readable) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    } catch (err: unknown) {
      logger.error('[S3Storage] Read byte range failed', {
        metadata: { key, versionId, error: err instanceof Error ? err.message : String(err) },
      });
      throw new AppError('Failed to read storage byte range.', 500, 'STORAGE_READ_FAILED');
    }
  }

  /**
   * Verifies that the configured S3 bucket has Bucket Versioning enabled (DEF-13-14).
   * Fails closed in production if versioning is disabled, suspended, or verification fails.
   */
  public async verifyBucketVersioning(): Promise<boolean> {
    try {
      const command = new GetBucketVersioningCommand({
        Bucket: this.bucket,
      });
      const response = await this.client.send(command);
      if (response.Status !== 'Enabled') {
        logger.error('[S3Storage] S3 Bucket Versioning is not enabled', {
          metadata: { bucket: this.bucket, status: response.Status || 'Disabled' },
        });
        throw new AppError(
          `S3 Bucket Versioning is not enabled on bucket "${this.bucket}". Status: ${response.Status || 'Disabled'}. Immutable file sharing requires bucket versioning.`,
          503,
          'S3_VERSIONING_REQUIRED'
        );
      }
      logger.info('[S3Storage] S3 Bucket Versioning verified successfully', {
        metadata: { bucket: this.bucket, status: response.Status },
      });
      return true;
    } catch (err: unknown) {
      if (err instanceof AppError) throw err;
      logger.error('[S3Storage] Failed to verify S3 bucket versioning', {
        metadata: { bucket: this.bucket, error: err instanceof Error ? err.message : String(err) },
      });
      throw new AppError(
        `Failed to verify S3 Bucket Versioning on bucket "${this.bucket}": ${err instanceof Error ? err.message : String(err)}`,
        503,
        'S3_VERSIONING_REQUIRED'
      );
    }
  }
}
