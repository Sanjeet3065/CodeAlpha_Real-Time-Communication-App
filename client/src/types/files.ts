/**
 * CONNECTLY — Phase 13 File Sharing Types & Domain Models
 */

export interface SharedFile {
  id: string;
  meetingId: string;
  meetingCode: string;
  meetingTitle?: string;
  uploaderId: string;
  uploaderName: string;
  uploaderRole: 'host' | 'co-host' | 'participant';
  uploaderAvatarUrl: string | null;
  originalFilename: string;
  sanitizedFilename: string;
  storageProvider: string;
  mimeType: string;
  extension: string;
  sizeBytes: number;
  status: 'PENDING' | 'CLEANING' | 'AVAILABLE' | 'FAILED' | 'DELETED';
  versionId?: string | null;
  checksumSha256?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FileUploadProgress {
  uploadId: string;
  filename: string;
  sizeBytes: number;
  progressPercent: number;
  status: 'uploading' | 'processing' | 'completed' | 'failed' | 'aborted';
  error?: string;
  abortController?: AbortController;
}

export interface ListMeetingFilesQuery {
  limit?: number;
  before?: string;
  search?: string;
}

export interface ListMeetingFilesResponse {
  files: SharedFile[];
  hasMore: boolean;
  nextCursor: string | null;
}

export interface PresignedUploadInitResponse {
  fileId: string;
  uploadUrl: string;
  method?: 'POST' | 'PUT';
  fields?: Record<string, string>;
  headers?: Record<string, string>;
  expiresInSeconds: number;
  file: SharedFile;
}
