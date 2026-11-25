/**
 * CONNECTLY — Phase 13 useMeetingFiles Hook
 * Real-time file sharing, live upload progress, abortable direct uploads,
 * download triggers, deletion, and Socket.IO real-time synchronization.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { Socket } from 'socket.io-client';
import type { SharedFile, FileUploadProgress } from '@/types/files';
import { fileApi } from '@/services/fileApi';

interface UseMeetingFilesOptions {
  meetingCode: string;
  socket: Socket | null;
  isAdmitted: boolean;
  currentUserId?: string;
}

export function useMeetingFiles({
  meetingCode,
  socket,
  isAdmitted,
}: UseMeetingFilesOptions) {
  const [files, setFiles] = useState<SharedFile[]>([]);
  const [activeUploads, setActiveUploads] = useState<FileUploadProgress[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const isInitialLoadedRef = useRef<boolean>(false);

  // Fetch files from server
  const loadFiles = useCallback(async () => {
    if (!meetingCode || !isAdmitted || import.meta.env?.VITE_ENABLE_FILE_SHARING === 'false') return;
    try {
      setIsLoading(true);
      setError(null);
      const res = await fileApi.listMeetingFiles(meetingCode, { limit: 50 });
      setFiles(res.files || []);
      isInitialLoadedRef.current = true;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Failed to load meeting files.';
      setError(errMsg);
    } finally {
      setIsLoading(false);
    }
  }, [meetingCode, isAdmitted]);

  // Initial load
  useEffect(() => {
    if (isAdmitted && !isInitialLoadedRef.current) {
      void loadFiles();
    }
  }, [isAdmitted, loadFiles]);

  // Real-time Socket.IO listeners
  useEffect(() => {
    if (!socket || !isAdmitted || import.meta.env?.VITE_ENABLE_FILE_SHARING === 'false') return;

    const handleFileShared = (newFile: SharedFile) => {
      setFiles((prev) => {
        // Prevent duplicates
        if (prev.some((f) => f.id === newFile.id)) {
          return prev.map((f) => (f.id === newFile.id ? newFile : f));
        }
        return [newFile, ...prev];
      });
    };

    const handleFileDeleted = (payload: { fileId: string; meetingId: string }) => {
      setFiles((prev) => prev.filter((f) => f.id !== payload.fileId));
    };

    const handleReconnect = () => {
      void loadFiles();
    };

    socket.on('file:shared', handleFileShared);
    socket.on('file:deleted', handleFileDeleted);
    socket.on('connect', handleReconnect);

    return () => {
      socket.off('file:shared', handleFileShared);
      socket.off('file:deleted', handleFileDeleted);
      socket.off('connect', handleReconnect);
    };
  }, [socket, isAdmitted, loadFiles]);

  // Upload file with progress & abort capability
  const uploadFile = useCallback(
    async (file: File) => {
      const uploadId = `upload_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const abortController = new AbortController();

      const newUpload: FileUploadProgress = {
        uploadId,
        filename: file.name,
        sizeBytes: file.size,
        progressPercent: 0,
        status: 'uploading',
        abortController,
      };

      setActiveUploads((prev) => [newUpload, ...prev]);

      try {
        // DEF-13-15: Wire presigned POST upload flow as primary UI upload path
        let uploadedFile: SharedFile;
        try {
          uploadedFile = await fileApi.uploadMeetingFilePresigned(
            meetingCode,
            file,
            (percent) => {
              setActiveUploads((prev) =>
                prev.map((u) =>
                  u.uploadId === uploadId
                    ? {
                        ...u,
                        progressPercent: percent,
                        status: percent >= 100 ? 'processing' : 'uploading',
                      }
                    : u
                )
              );
            },
            abortController.signal
          );
        } catch (presignedErr: unknown) {
          const err = presignedErr as { code?: string; status?: number } | undefined;
          // If presigned endpoint is unsupported or fallback is needed, fallback to direct upload
          if (err?.code === 'ROUTE_NOT_FOUND' || err?.status === 404) {
            uploadedFile = await fileApi.uploadMeetingFileDirect(
              meetingCode,
              file,
              (percent) => {
                setActiveUploads((prev) =>
                  prev.map((u) =>
                    u.uploadId === uploadId
                      ? {
                          ...u,
                          progressPercent: percent,
                          status: percent >= 100 ? 'processing' : 'uploading',
                        }
                      : u
                  )
                );
              },
              abortController.signal
            );
          } else {
            throw presignedErr;
          }
        }

        // Mark completed
        setActiveUploads((prev) =>
          prev.map((u) =>
            u.uploadId === uploadId
              ? { ...u, progressPercent: 100, status: 'completed' }
              : u
          )
        );

        // Add to files state if not already received via socket
        setFiles((prev) => {
          if (prev.some((f) => f.id === uploadedFile.id)) return prev;
          return [uploadedFile, ...prev];
        });

        // Remove from active uploads after 2 seconds
        setTimeout(() => {
          setActiveUploads((prev) => prev.filter((u) => u.uploadId !== uploadId));
        }, 2000);

        return uploadedFile;
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : 'File upload failed.';
        if (errMsg.includes('aborted')) {
          setActiveUploads((prev) =>
            prev.map((u) => (u.uploadId === uploadId ? { ...u, status: 'aborted' } : u))
          );
        } else {
          setActiveUploads((prev) =>
            prev.map((u) =>
              u.uploadId === uploadId ? { ...u, status: 'failed', error: errMsg } : u
            )
          );
          setError(errMsg);
        }
        throw err;
      }
    },
    [meetingCode]
  );

  // Cancel an active upload
  const cancelUpload = useCallback((uploadId: string) => {
    setActiveUploads((prev) => {
      const target = prev.find((u) => u.uploadId === uploadId);
      if (target?.abortController) {
        target.abortController.abort();
      }
      return prev.filter((u) => u.uploadId !== uploadId);
    });
  }, []);

  // Dismiss a failed upload card
  const dismissUpload = useCallback((uploadId: string) => {
    setActiveUploads((prev) => prev.filter((u) => u.uploadId !== uploadId));
  }, []);

  // Download a shared file
  const downloadFile = useCallback(
    async (fileId: string, filename: string) => {
      try {
        setError(null);
        await fileApi.downloadMeetingFile(meetingCode, fileId, filename);
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : 'Failed to download file.';
        setError(errMsg);
      }
    },
    [meetingCode]
  );

  // Delete a shared file
  const deleteFile = useCallback(
    async (fileId: string) => {
      const originalFiles = [...files];
      setFiles((prev) => prev.filter((f) => f.id !== fileId));

      try {
        setError(null);
        await fileApi.deleteMeetingFile(meetingCode, fileId);
      } catch (err: unknown) {
        // Rollback on failure
        setFiles(originalFiles);
        const errMsg = err instanceof Error ? err.message : 'Failed to delete file.';
        setError(errMsg);
      }
    },
    [meetingCode, files]
  );

  const clearError = useCallback(() => setError(null), []);

  return {
    files,
    activeUploads,
    isLoading,
    error,
    uploadFile,
    cancelUpload,
    dismissUpload,
    downloadFile,
    deleteFile,
    refreshFiles: loadFiles,
    clearError,
  };
}
