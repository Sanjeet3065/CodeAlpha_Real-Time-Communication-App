import type { Readable } from 'node:stream';

export interface StorageObjectMetadata {
  exists: boolean;
  sizeBytes: number;
  contentType: string;
  etag?: string;
  versionId?: string;
  checksumSha256?: string;
}

export interface PresignedUploadResult {
  uploadUrl: string;
  method?: 'POST' | 'PUT';
  fields?: Record<string, string>;
  headers?: Record<string, string>;
  expiresInSeconds: number;
}

export interface UploadStreamResult {
  sizeBytes: number;
  etag?: string;
  versionId?: string;
}

export interface DownloadStreamResult {
  stream: Readable;
  contentType: string;
  contentLength: number;
}

/**
 * Storage provider abstraction interface for CONNECTLY Phase 13 File Sharing.
 * Supports private S3-compatible object stores, sandboxed local dev storage, and test memory storage.
 */
export interface IStorageProvider {
  readonly name: string;

  /**
   * Streams file data directly into private object storage.
   */
  uploadStream(
    key: string,
    stream: Readable,
    contentType: string,
    contentLength?: number
  ): Promise<UploadStreamResult>;

  /**
   * Retrieves a readable stream for authenticated file download, optionally bound to an exact immutable VersionId.
   */
  downloadStream(key: string, versionId?: string): Promise<DownloadStreamResult>;

  /**
   * Generates a short-lived presigned URL for direct client upload to private storage.
   */
  generatePresignedUploadUrl(
    key: string,
    contentType: string,
    contentLength: number,
    expiresInSeconds: number
  ): Promise<PresignedUploadResult>;

  /**
   * Generates a short-lived presigned URL for secure client download.
   */
  generatePresignedDownloadUrl(
    key: string,
    downloadFilename: string,
    expiresInSeconds: number
  ): Promise<string>;

  /**
   * Deletes an object from storage (optionally targeting a specific immutable VersionId).
   */
  deleteObject(key: string, versionId?: string): Promise<boolean>;

  /**
   * Retrieves metadata and existence status for an object in storage.
   */
  headObject(key: string): Promise<StorageObjectMetadata | null>;

  /**
   * Reads an exact byte slice from storage for binary signature & magic byte verification,
   * pinned to an immutable VersionId when supplied (DEF-13-13).
   */
  readByteRange(key: string, start: number, end: number, versionId?: string): Promise<Buffer>;
}
