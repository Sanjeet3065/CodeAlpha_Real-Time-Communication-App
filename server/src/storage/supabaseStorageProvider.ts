import { Readable } from 'node:stream';
import type {
  IStorageProvider,
  StorageObjectMetadata,
  PresignedUploadResult,
  UploadStreamResult,
  DownloadStreamResult,
} from './storageProvider.interface.js';
import { getSupabase } from '../config/supabase.js';
import { logger } from '../utils/logger.js';
import { AppError } from '../utils/errors.js';

const DEFAULT_MAX_FILE_SIZE_BYTES = 26_214_400; // 25 MB

export interface SupabaseStorageConfig {
  bucket: string;
  maxFileSizeBytes?: number;
}

/**
 * Private Object Storage Provider backed by Supabase Storage.
 * Stores meeting file binaries in a private Supabase bucket with signed URLs
 * and bounded byte-range downloads for magic-byte / ZIP integrity verification.
 */
export class SupabaseStorageProvider implements IStorageProvider {
  public readonly name = 'supabase';
  private readonly bucket: string;
  private readonly maxFileSizeBytes: number;
  private bucketVerified = false;

  constructor(config: SupabaseStorageConfig) {
    this.bucket = config.bucket.trim() || 'connectly-files';
    const configuredMax = Number(process.env.STORAGE_MAX_FILE_SIZE_BYTES);
    this.maxFileSizeBytes =
      config.maxFileSizeBytes ??
      (Number.isFinite(configuredMax) && configuredMax > 0
        ? configuredMax
        : DEFAULT_MAX_FILE_SIZE_BYTES);
  }

  /**
   * Ensures the target private Supabase Storage bucket exists and is accessible.
   */
  public async verifyBucketExists(): Promise<void> {
    if (this.bucketVerified) return;

    const sb = getSupabase();
    const { data: buckets, error: listErr } = await sb.storage.listBuckets();
    if (listErr) {
      logger.error('[SupabaseStorage] Failed to list storage buckets', {
        metadata: { bucket: this.bucket, error: listErr.message },
      });
      throw new AppError(
        `Supabase Storage unreachable: ${listErr.message}`,
        502,
        'SUPABASE_STORAGE_UNAVAILABLE'
      );
    }

    const exists = Array.isArray(buckets) && buckets.some((b) => b.name === this.bucket);
    if (!exists) {
      const { error: createErr } = await sb.storage.createBucket(this.bucket, {
        public: false,
        fileSizeLimit: this.maxFileSizeBytes,
      });
      if (createErr && !String(createErr.message || '').toLowerCase().includes('already exists')) {
        logger.error('[SupabaseStorage] Failed to auto-create private bucket', {
          metadata: { bucket: this.bucket, error: createErr.message },
        });
        throw new AppError(
          `Supabase Storage bucket '${this.bucket}' could not be created: ${createErr.message}`,
          500,
          'SUPABASE_BUCKET_INIT_FAILED'
        );
      }
      logger.info('[SupabaseStorage] Created private Supabase Storage bucket', {
        metadata: { bucket: this.bucket },
      });
    }

    this.bucketVerified = true;
  }

  private async readBoundedBuffer(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of stream) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (total > this.maxFileSizeBytes) {
        throw new AppError(
          `File stream exceeded maximum allowed size of ${this.maxFileSizeBytes} bytes.`,
          413,
          'FILE_TOO_LARGE'
        );
      }
      chunks.push(buf);
    }
    return Buffer.concat(chunks, total);
  }

  public async uploadStream(
    key: string,
    stream: Readable,
    contentType: string,
    _contentLength?: number
  ): Promise<UploadStreamResult> {
    await this.verifyBucketExists();
    const buffer = await this.readBoundedBuffer(stream);
    const sb = getSupabase();

    const { data, error } = await sb.storage.from(this.bucket).upload(key, buffer, {
      contentType: contentType || 'application/octet-stream',
      upsert: false,
    });

    if (error) {
      logger.error('[SupabaseStorage] Upload failed', {
        metadata: { bucket: this.bucket, key, error: error.message },
      });
      throw new AppError(`Supabase Storage upload failed: ${error.message}`, 502, 'STORAGE_UPLOAD_FAILED');
    }

    return {
      sizeBytes: buffer.length,
      etag: data?.id,
      versionId: (data as { fullPath?: string } | null)?.fullPath || undefined,
    };
  }

  public async downloadStream(key: string, _versionId?: string): Promise<DownloadStreamResult> {
    const sb = getSupabase();
    const [{ data, error }, meta] = await Promise.all([
      sb.storage.from(this.bucket).download(key),
      this.headObject(key),
    ]);

    if (error || !data) {
      logger.warn('[SupabaseStorage] Download failed', {
        metadata: { bucket: this.bucket, key, error: error?.message || 'Empty response' },
      });
      throw new AppError('Storage object could not be retrieved.', 404, 'STORAGE_NOT_FOUND');
    }

    const buffer = Buffer.from(await data.arrayBuffer());
    return {
      stream: Readable.from(buffer),
      contentType: meta?.contentType || data.type || 'application/octet-stream',
      contentLength: meta?.sizeBytes || buffer.length,
    };
  }

  public async generatePresignedUploadUrl(
    key: string,
    contentType: string,
    contentLength: number,
    expiresInSeconds = 900
  ): Promise<PresignedUploadResult> {
    await this.verifyBucketExists();
    const sb = getSupabase();

    const { data, error } = await sb.storage.from(this.bucket).createSignedUploadUrl(key);
    if (error || !data?.signedUrl) {
      logger.error('[SupabaseStorage] Signed upload URL generation failed', {
        metadata: { bucket: this.bucket, key, error: error?.message || 'Missing signedUrl' },
      });
      throw new AppError(
        'Failed to generate Supabase Storage signed upload URL.',
        502,
        'STORAGE_PRESIGN_FAILED'
      );
    }

    return {
      uploadUrl: data.signedUrl,
      method: 'PUT',
      fields: {
        cacheControl: '3600',
      },
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(contentLength),
      },
      expiresInSeconds,
    };
  }

  public async generatePresignedDownloadUrl(
    key: string,
    downloadFilename: string,
    expiresInSeconds = 900
  ): Promise<string> {
    const sb = getSupabase();
    const { data, error } = await sb.storage
      .from(this.bucket)
      .createSignedUrl(key, expiresInSeconds, { download: downloadFilename });

    if (error || !data?.signedUrl) {
      logger.error('[SupabaseStorage] Signed download URL generation failed', {
        metadata: { bucket: this.bucket, key, error: error?.message || 'Missing signedUrl' },
      });
      throw new AppError(
        'Failed to generate Supabase Storage download URL.',
        502,
        'STORAGE_DOWNLOAD_PRESIGN_FAILED'
      );
    }

    return data.signedUrl;
  }

  public async deleteObject(key: string, _versionId?: string): Promise<boolean> {
    const sb = getSupabase();
    const { error } = await sb.storage.from(this.bucket).remove([key]);
    if (error) {
      logger.warn('[SupabaseStorage] Delete failed', {
        metadata: { bucket: this.bucket, key, error: error.message },
      });
      return false;
    }
    return true;
  }

  public async headObject(key: string): Promise<StorageObjectMetadata | null> {
    const sb = getSupabase();
    const { data, error } = await sb.storage.from(this.bucket).info(key);
    if (error || !data) {
      return null;
    }
    return {
      exists: true,
      sizeBytes: Number(data.size || 0),
      contentType: data.contentType || 'application/octet-stream',
      etag: data.etag ? String(data.etag).replace(/"/g, '') : undefined,
      versionId: data.version || undefined,
    };
  }

  public async readByteRange(
    key: string,
    start: number,
    end: number,
    _versionId?: string
  ): Promise<Buffer> {
    const sb = getSupabase();
    const { data, error } = await sb.storage.from(this.bucket).createSignedUrl(key, 60);
    if (error || !data?.signedUrl) {
      throw new AppError('Failed to read byte range from Supabase Storage.', 502, 'STORAGE_READ_FAILED');
    }

    const res = await fetch(data.signedUrl, {
      headers: {
        Range: `bytes=${start}-${end}`,
      },
    });

    if (!res.ok) {
      throw new AppError(
        `Failed byte-range fetch from Supabase Storage (HTTP ${res.status}).`,
        res.status === 404 ? 404 : 502,
        'STORAGE_READ_FAILED'
      );
    }

    const buf = Buffer.from(await res.arrayBuffer());
    // If upstream ignored Range and returned 200 OK full body, slice strictly to requested bounds
    if (res.status === 200 && buf.length > end - start + 1) {
      return buf.subarray(start, end + 1);
    }
    return buf;
  }
}
