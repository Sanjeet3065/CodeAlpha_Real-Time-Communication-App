import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import type {
  IStorageProvider,
  StorageObjectMetadata,
  PresignedUploadResult,
  UploadStreamResult,
  DownloadStreamResult,
} from './storageProvider.interface.js';
import { AppError } from '../utils/errors.js';

interface MemoryObjectVersion {
  versionId: string;
  data: Buffer;
  contentType: string;
  etag: string;
  updatedAt: number;
}

export class MemoryStorageProvider implements IStorageProvider {
  public readonly name = 'memory';
  private readonly store = new Map<string, MemoryObjectVersion[]>();

  public async uploadStream(
    key: string,
    stream: Readable,
    contentType: string,
    _contentLength?: number
  ): Promise<UploadStreamResult> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const data = Buffer.concat(chunks);
    const etag = crypto.createHash('sha256').update(data).digest('hex');
    const versionId = crypto.randomUUID();

    const versions = this.store.get(key) || [];
    versions.push({
      versionId,
      data,
      contentType,
      etag,
      updatedAt: Date.now(),
    });
    this.store.set(key, versions);

    return {
      sizeBytes: data.length,
      etag,
      versionId,
    };
  }

  public async downloadStream(key: string, versionId?: string): Promise<DownloadStreamResult> {
    const versions = this.store.get(key);
    if (!versions || versions.length === 0) {
      throw new AppError('Storage object not found.', 404, 'STORAGE_NOT_FOUND');
    }

    const target = versionId
      ? versions.find((v) => v.versionId === versionId)
      : versions[versions.length - 1];

    if (!target) {
      throw new AppError(`Storage object version ${versionId} not found.`, 404, 'VERSION_NOT_FOUND');
    }

    const stream = Readable.from(target.data);
    return {
      stream,
      contentType: target.contentType,
      contentLength: target.data.length,
    };
  }

  public async generatePresignedUploadUrl(
    key: string,
    contentType: string,
    contentLength: number,
    expiresInSeconds = 900
  ): Promise<PresignedUploadResult> {
    return {
      uploadUrl: `memory://upload/${encodeURIComponent(key)}`,
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
    _expiresInSeconds = 900
  ): Promise<string> {
    return `memory://download/${encodeURIComponent(key)}?filename=${encodeURIComponent(downloadFilename)}`;
  }

  public async deleteObject(key: string, versionId?: string): Promise<boolean> {
    if (!versionId) {
      this.store.delete(key);
      return true;
    }
    const versions = this.store.get(key);
    if (!versions) return true;
    const remaining = versions.filter((v) => v.versionId !== versionId);
    if (remaining.length === 0) {
      this.store.delete(key);
      return true;
    }
    this.store.set(key, remaining);
    return true;
  }

  public async headObject(key: string): Promise<StorageObjectMetadata | null> {
    const versions = this.store.get(key);
    if (!versions || versions.length === 0) {
      return null;
    }
    const latest = versions[versions.length - 1];
    return {
      exists: true,
      sizeBytes: latest.data.length,
      contentType: latest.contentType,
      etag: latest.etag,
      versionId: latest.versionId,
    };
  }

  public async readByteRange(
    key: string,
    start: number,
    end: number,
    versionId?: string
  ): Promise<Buffer> {
    const versions = this.store.get(key);
    if (!versions || versions.length === 0) {
      throw new AppError('File not found in memory storage.', 404, 'STORAGE_NOT_FOUND');
    }
    const targetVersion = versionId
      ? versions.find((v) => v.versionId === versionId)
      : versions[versions.length - 1];

    if (!targetVersion) {
      throw new AppError(
        `File version ${versionId} not found in memory storage.`,
        404,
        'STORAGE_VERSION_NOT_FOUND'
      );
    }

    const sliceEnd = Math.min(end + 1, targetVersion.data.length);
    return targetVersion.data.subarray(start, sliceEnd);
  }

  public clear(): void {
    this.store.clear();
  }
}
