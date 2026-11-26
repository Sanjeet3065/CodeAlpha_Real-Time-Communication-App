/**
 * CONNECTLY — Phase 13 File Sharing REST API Client
 */

import { fetchWithAuth, authStorage, ApiError } from './authApi.ts';
import type {
  SharedFile,
  ListMeetingFilesQuery,
  ListMeetingFilesResponse,
  PresignedUploadInitResponse,
} from '@/types/files';
import type { ISharedFileItem } from '@/types/dashboard';

const API_BASE_URL = (import.meta.env?.VITE_API_BASE_URL as string) || '/api/v1';

async function parseFileResponse<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError({
      status: body?.status || res.status,
      code: body?.code || 'FILE_API_ERROR',
      message: body?.message || `Request failed with status ${res.status}`,
      errors: body?.errors,
      timestamp: body?.timestamp || new Date().toISOString(),
    });
  }
  return (body?.data ?? body) as T;
}

export const fileApi = {
  /**
   * Fetch paginated list of shared files in an active meeting room
   */
  async listMeetingFiles(
    meetingCode: string,
    query: ListMeetingFilesQuery = {}
  ): Promise<ListMeetingFilesResponse> {
    const encoded = encodeURIComponent(meetingCode);
    const params = new URLSearchParams();
    if (query.limit) params.set('limit', String(query.limit));
    if (query.before) params.set('before', query.before);
    if (query.search) params.set('search', query.search);

    const queryString = params.toString() ? `?${params.toString()}` : '';
    const res = await fetchWithAuth(`${API_BASE_URL}/meetings/${encoded}/files${queryString}`, {
      method: 'GET',
    });
    return parseFileResponse<ListMeetingFilesResponse>(res);
  },

  /**
   * Initializes a presigned upload for direct client-to-storage uploads (DEF-13-15)
   */
  async initPresignedUpload(
    meetingCode: string,
    input: { filename: string; mimeType: string; sizeBytes: number }
  ): Promise<PresignedUploadInitResponse> {
    const encoded = encodeURIComponent(meetingCode);
    const res = await fetchWithAuth(`${API_BASE_URL}/meetings/${encoded}/files/init-upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return parseFileResponse<PresignedUploadInitResponse>(res);
  },

  /**
   * Completes a presigned upload after storage receipt and triggers server validation (DEF-13-15)
   */
  async completePresignedUpload(
    meetingCode: string,
    fileId: string,
    input?: { checksumSha256?: string }
  ): Promise<SharedFile> {
    const encoded = encodeURIComponent(meetingCode);
    const encodedId = encodeURIComponent(fileId);
    const res = await fetchWithAuth(
      `${API_BASE_URL}/meetings/${encoded}/files/${encodedId}/complete`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input || {}),
      }
    );
    return parseFileResponse<SharedFile>(res);
  },

  /**
   * Direct Presigned POST upload flow to private S3/storage boundary (DEF-13-15).
   * 1. Requests signed POST policy conditions from backend (/init-upload)
   * 2. Appends signed fields and streams multipart body directly to storage URL
   * 3. Triggers authenticated server completion and authoritative validation (/complete)
   */
  async uploadMeetingFilePresigned(
    meetingCode: string,
    file: File,
    onProgress?: (percent: number) => void,
    abortSignal?: AbortSignal
  ): Promise<SharedFile> {
    // 1. Initialize presigned upload
    const initRes = await this.initPresignedUpload(meetingCode, {
      filename: file.name,
      mimeType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
    });

    // 2. Perform direct POST to storage URL with signed policy fields
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      if (abortSignal) {
        abortSignal.addEventListener('abort', () => {
          xhr.abort();
          reject(new Error('Upload aborted by user.'));
        });
      }

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && onProgress) {
          const percent = Math.min(100, Math.round((event.loaded / event.total) * 100));
          onProgress(percent);
        }
      };

      xhr.onload = () => {
        // S3 Presigned POST returns 200 or 204 No Content on success
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          reject(
            new ApiError({
              status: xhr.status,
              code: 'STORAGE_UPLOAD_REJECTED',
              message: `Storage upload rejected with status ${xhr.status}.`,
              timestamp: new Date().toISOString(),
            })
          );
        }
      };

      xhr.onerror = () => {
        reject(
          new ApiError({
            status: 0,
            code: 'STORAGE_NETWORK_ERROR',
            message: 'Network error during direct storage upload.',
            timestamp: new Date().toISOString(),
          })
        );
      };

      const method = (initRes.method || 'POST').toUpperCase();
      xhr.open(method, initRes.uploadUrl, true);

      const formData = new FormData();
      // Important: signed fields must precede file field for S3 POST policies
      if (initRes.fields) {
        for (const [key, value] of Object.entries(initRes.fields)) {
          formData.append(key, value);
        }
      }
      // Supabase Storage signed upload URLs expect PUT FormData with an unnamed binary field (''),
      // whereas S3 Presigned POST expects POST FormData with field name 'file'.
      const fileFieldName =
        method === 'PUT' && initRes.uploadUrl.includes('/object/upload/sign/') ? '' : 'file';
      formData.append(fileFieldName, file);
      xhr.send(formData);
    });

    // 3. Complete and finalize upload on backend
    return this.completePresignedUpload(meetingCode, initRes.fileId);
  },

  /**
   * Direct multipart upload with real-time XHR progress tracking and abort support
   */
  uploadMeetingFileDirect(
    meetingCode: string,
    file: File,
    onProgress?: (percent: number) => void,
    abortSignal?: AbortSignal
  ): Promise<SharedFile> {
    return new Promise((resolve, reject) => {
      const encoded = encodeURIComponent(meetingCode);
      const url = `${API_BASE_URL}/meetings/${encoded}/files/upload`;
      const xhr = new XMLHttpRequest();

      if (abortSignal) {
        abortSignal.addEventListener('abort', () => {
          xhr.abort();
          reject(new Error('Upload aborted by user.'));
        });
      }

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && onProgress) {
          const percent = Math.min(100, Math.round((event.loaded / event.total) * 100));
          onProgress(percent);
        }
      };

      xhr.onload = () => {
        try {
          const data = JSON.parse(xhr.responseText || '{}');
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve((data.data || data) as SharedFile);
          } else {
            reject(
              new ApiError({
                status: data.status || xhr.status,
                code: data.code || 'UPLOAD_FAILED',
                message: data.message || `Upload failed with status ${xhr.status}`,
                timestamp: data.timestamp || new Date().toISOString(),
              })
            );
          }
        } catch {
          reject(
            new ApiError({
              status: xhr.status,
              code: 'PARSE_ERROR',
              message: 'Failed to parse upload response.',
              timestamp: new Date().toISOString(),
            })
          );
        }
      };

      xhr.onerror = () => {
        reject(
          new ApiError({
            status: 0,
            code: 'NETWORK_ERROR',
            message: 'Network error during file upload.',
            timestamp: new Date().toISOString(),
          })
        );
      };

      xhr.open('POST', url, true);
      xhr.withCredentials = true;

      // Include Bearer token
      const token = authStorage.getAccessToken();
      if (token) {
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      }

      // Include CSRF headers
      xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
      xhr.setRequestHeader('X-CSRF-Protection', '1');

      const formData = new FormData();
      formData.append('file', file);
      xhr.send(formData);
    });
  },

  /**
   * Securely download a file and trigger browser save
   */
  async downloadMeetingFile(
    meetingCode: string,
    fileId: string,
    filename: string
  ): Promise<void> {
    const encodedCode = encodeURIComponent(meetingCode);
    const encodedId = encodeURIComponent(fileId);
    const url = `${API_BASE_URL}/meetings/${encodedCode}/files/${encodedId}/download`;

    const res = await fetchWithAuth(url, {
      method: 'GET',
    });

    if (!res.ok) {
      throw await parseFileResponse(res);
    }

    const blob = await res.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = downloadUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    window.URL.revokeObjectURL(downloadUrl);
  },

  /**
   * Delete a shared file (uploader or host/co-host)
   */
  async deleteMeetingFile(
    meetingCode: string,
    fileId: string
  ): Promise<{ success: boolean; fileId: string }> {
    const encodedCode = encodeURIComponent(meetingCode);
    const encodedId = encodeURIComponent(fileId);
    const res = await fetchWithAuth(`${API_BASE_URL}/meetings/${encodedCode}/files/${encodedId}`, {
      method: 'DELETE',
    });
    return parseFileResponse<{ success: boolean; fileId: string }>(res);
  },

  /**
   * Fetch all files shared across meetings attended by the authenticated user.
   * Directly integrates with the Dashboard Downloads page and widgets!
   */
  async getUserSharedFiles(): Promise<ISharedFileItem[]> {
    const res = await fetchWithAuth(`${API_BASE_URL}/users/me/shared-files`, {
      method: 'GET',
    });
    const parsed = await parseFileResponse<{ files: ISharedFileItem[] }>(res);
    return parsed.files || [];
  },
};
