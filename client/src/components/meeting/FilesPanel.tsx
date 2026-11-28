/**
 * CONNECTLY — Phase 13 FilesPanel Component
 * Drag-and-drop file upload, live upload progress tracking,
 * shared file listing, safe preview modal, download trigger, and deletion.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  FolderDown,
  Upload,
  FileText,
  FileSpreadsheet,
  FileCode,
  FileArchive,
  Image as ImageIcon,
  Download,
  Trash2,
  X,
  Search,
  Loader2,
  AlertCircle,
  Eye,
} from 'lucide-react';
import type { SharedFile, FileUploadProgress } from '@/types/files';
import type { ParticipantRole } from '@/types/meeting';
import { ConfirmActionDialog } from './ConfirmActionDialog';
import { FILE_TONE_CLASSES, getFileToneKey } from '@/lib/studioTokens';

interface FilesPanelProps {
  files: SharedFile[];
  activeUploads: FileUploadProgress[];
  isLoading: boolean;
  error: string | null;
  onClearError: () => void;
  onUploadFile: (file: File) => Promise<unknown>;
  onCancelUpload: (uploadId: string) => void;
  onDismissUpload: (uploadId: string) => void;
  onDownloadFile: (fileId: string, filename: string) => Promise<void>;
  onDeleteFile: (fileId: string) => Promise<void>;
  currentUserId?: string;
  currentUserRole?: ParticipantRole;
  onClose?: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function getFileIcon(extension: string) {
  const ext = extension.toLowerCase();
  const tone = FILE_TONE_CLASSES[getFileToneKey(ext)];
  const cls = `w-5 h-5 ${tone.iconColor}`;
  switch (ext) {
    case 'pdf':
    case 'docx':
    case 'doc':
      return <FileText className={cls} />;
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
      return <ImageIcon className={cls} />;
    case 'xlsx':
    case 'xls':
    case 'csv':
      return <FileSpreadsheet className={cls} />;
    case 'zip':
    case 'tar':
    case 'gz':
    case '7z':
      return <FileArchive className={cls} />;
    case 'json':
    case 'js':
    case 'ts':
    case 'html':
    case 'css':
      return <FileCode className={cls} />;
    default:
      return <FileText className={cls} />;
  }
}

export const FilesPanel: React.FC<FilesPanelProps> = ({
  files,
  activeUploads,
  isLoading,
  error,
  onClearError,
  onUploadFile,
  onCancelUpload,
  onDismissUpload,
  onDownloadFile,
  onDeleteFile,
  currentUserId,
  currentUserRole = 'participant',
  onClose,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [previewFile, setPreviewFile] = useState<SharedFile | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingDeleteFileId, setPendingDeleteFileId] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [liveAnnouncement, setLiveAnnouncement] = useState<string>('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewModalRef = useRef<HTMLDivElement>(null);
  const triggerButtonRef = useRef<HTMLElement | null>(null);

  // Announce file list updates to screen readers (WCAG 2.2 live updates)
  useEffect(() => {
    if (files.length > 0) {
      setLiveAnnouncement(`${files.length} shared file${files.length === 1 ? '' : 's'} available.`);
    }
  }, [files.length]);

  const handleClosePreview = useCallback(() => {
    setPreviewFile(null);
    if (previewUrl) {
      window.URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
  }, [previewUrl]);

  // DEF-13-07: Safe preview modal keyboard trap and Escape key dismissal
  useEffect(() => {
    if (!previewFile) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClosePreview();
      } else if (e.key === 'Tab' && previewModalRef.current) {
        const focusableElements = previewModalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusableElements.length === 0) return;

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstElement) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    // Focus the first focusable button inside modal on open
    const timer = setTimeout(() => {
      if (previewModalRef.current) {
        const firstBtn = previewModalRef.current.querySelector<HTMLElement>('button');
        firstBtn?.focus();
      }
    }, 50);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      clearTimeout(timer);
      triggerButtonRef.current?.focus();
    };
  }, [previewFile, handleClosePreview]);

  const filteredFiles = files.filter((f) =>
    f.originalFilename.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleFileSelection = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setValidationError(null);

    const file = fileList[0];

    // Client-side validation: 25MB max
    if (file.size > 26214400) {
      const err = 'File exceeds the 25 MB limit. Please select a smaller file.';
      setValidationError(err);
      setLiveAnnouncement(err);
      return;
    }

    if (file.size <= 0) {
      const err = 'Empty files (0 bytes) cannot be shared.';
      setValidationError(err);
      setLiveAnnouncement(err);
      return;
    }

    const ext = file.name.split('.').pop()?.toLowerCase();
    const dangerousExts = ['exe', 'bat', 'cmd', 'sh', 'php', 'vbs', 'msi', 'com'];
    if (ext && dangerousExts.includes(ext)) {
      const err = `Executable files (.${ext}) are not permitted for security reasons.`;
      setValidationError(err);
      setLiveAnnouncement(err);
      return;
    }

    setLiveAnnouncement(`Starting upload for ${file.name}`);
    try {
      await onUploadFile(file);
      setLiveAnnouncement(`${file.name} uploaded successfully.`);
    } catch {
      setLiveAnnouncement(`Upload failed for ${file.name}.`);
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) {
      await handleFileSelection(e.dataTransfer.files);
    }
  };

  const handleDownload = async (file: SharedFile) => {
    try {
      setDownloadingId(file.id);
      await onDownloadFile(file.id, file.sanitizedFilename || file.originalFilename);
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDelete = async (fileId: string) => {
    try {
      setDeletingId(fileId);
      await onDeleteFile(fileId);
      setLiveAnnouncement('Shared file deleted successfully.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleOpenPreview = async (file: SharedFile) => {
    setPreviewFile(file);
  };

  const canDelete = (file: SharedFile) => {
    return (
      file.uploaderId === currentUserId ||
      currentUserRole === 'host' ||
      currentUserRole === 'co-host'
    );
  };

  return (
    <div
      data-panel="files-panel"
      className="flex flex-col h-full bg-[#1C1F24] text-white select-none border-l border-white/10"
    >
      {/* Panel Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          <FolderDown className="w-5 h-5 text-[#5FA399]" />
          <h3 className="font-semibold text-sm text-white">Files</h3>
          <span className="px-2 py-0.5 text-xs font-bold bg-[#2F6F68]/30 text-[#5FA399] rounded-full border border-[#5FA399]/20">
            {files.length}
          </span>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close files panel"
            className="p-1 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Error Banners */}
      {(error || validationError) && (
        <div className="m-3 p-2.5 rounded-xl bg-[#C24D4D]/20 border border-[#C24D4D]/40 flex items-start justify-between gap-2 text-xs text-[#D46A6A]">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{validationError || error}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              setValidationError(null);
              onClearError();
            }}
            className="p-0.5 rounded hover:bg-white/10"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Drag & Drop Upload Dropzone */}
      <div className="px-3 pt-3">
        <div
          data-dropzone="file-upload"
          tabIndex={0}
          role="button"
          aria-label="Upload files: press Enter or space to browse files, or drag and drop"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              fileInputRef.current?.click();
            }
          }}
          className={`p-4 rounded-xl border-2 border-dashed transition-all cursor-pointer text-center flex flex-col items-center justify-center gap-1.5 focus:outline-none focus:ring-2 focus:ring-[#5FA399] focus:ring-offset-2 focus:ring-offset-[#1C1F24] ${
            isDragging
              ? 'border-[#5FA399] bg-[#2F6F68]/20'
              : 'border-white/20 bg-white/5 hover:border-[#5FA399]/60 hover:bg-white/10'
          }`}
        >
          <input
            type="file"
            ref={fileInputRef}
            onChange={(e) => handleFileSelection(e.target.files)}
            className="hidden"
            aria-label="Upload file"
          />
          <div className="w-8 h-8 rounded-full bg-[#2F6F68]/30 text-[#5FA399] flex items-center justify-center">
            <Upload className="w-4 h-4" />
          </div>
          <p className="text-xs font-medium text-white">
            <span className="text-[#5FA399] underline">Click to upload</span> or drag and drop
          </p>
          <p className="text-[10px] text-white/50">
            PDF, DOCX, XLSX, Images, ZIP up to 25 MB
          </p>
        </div>
      </div>

      {/* Active Uploads List */}
      {activeUploads.length > 0 && (
        <div className="px-3 pt-3 space-y-2">
          {activeUploads.map((upload) => (
            <div
              key={upload.uploadId}
              data-upload-card={upload.uploadId}
              className="p-2.5 rounded-xl bg-white/5 border border-white/10 text-xs space-y-1.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-white truncate max-w-[180px]">
                  {upload.filename}
                </span>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-white/60">
                    {upload.status === 'uploading' && `${upload.progressPercent}%`}
                    {upload.status === 'processing' && 'Processing...'}
                    {upload.status === 'completed' && 'Completed'}
                    {upload.status === 'failed' && 'Failed'}
                  </span>
                  {upload.status === 'uploading' ? (
                    <button
                      type="button"
                      onClick={() => onCancelUpload(upload.uploadId)}
                      aria-label="Cancel upload"
                      className="p-1 rounded text-white/60 hover:text-[#D46A6A]"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onDismissUpload(upload.uploadId)}
                      aria-label="Dismiss upload"
                      className="p-1 rounded text-white/60 hover:text-white"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Progress bar */}
              <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-200 ${
                    upload.status === 'failed'
                      ? 'bg-[#C24D4D]'
                      : upload.status === 'completed'
                      ? 'bg-emerald-500'
                      : 'bg-[#2F6F68]'
                  }`}
                  style={{ width: `${upload.progressPercent}%` }}
                />
              </div>

              {upload.error && (
                <p className="text-[10px] text-[#D46A6A] truncate">{upload.error}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Search Bar */}
      {files.length > 3 && (
        <div className="px-3 pt-3">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-white/40 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search shared files..."
              className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-white placeholder-white/40 focus:outline-none focus:ring-1 focus:ring-[#5FA399]"
            />
          </div>
        </div>
      )}

      {/* Files List or Empty State */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {isLoading && files.length === 0 ? (
          <div className="py-8 flex flex-col items-center justify-center gap-2 text-white/60">
            <Loader2 className="w-6 h-6 animate-spin text-[#5FA399]" />
            <p className="text-xs">Loading files...</p>
          </div>
        ) : filteredFiles.length === 0 ? (
          <div className="py-12 px-4 text-center flex flex-col items-center justify-center">
            <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-white/40 mb-3">
              <FolderDown className="w-6 h-6" />
            </div>
            <h4 className="text-xs font-semibold text-white mb-1">
              {searchQuery ? 'No matching files found' : 'No Files Shared Yet'}
            </h4>
            <p className="text-[11px] text-white/60 max-w-[200px] leading-relaxed">
              {searchQuery
                ? 'Try a different search term or clear the filter.'
                : 'Upload documents, slides, and images to collaborate in real time.'}
            </p>
          </div>
        ) : (
          filteredFiles.map((file) => (
            <div
              key={file.id}
              data-file-item={file.id}
              className="p-3 rounded-xl bg-white/5 border border-white/10 hover:border-white/20 transition-all flex items-center justify-between gap-2.5 group"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${FILE_TONE_CLASSES[getFileToneKey(file.extension)].iconWrap}`}
                >
                  {getFileIcon(file.extension)}
                </div>
                <div className="min-w-0">
                  <p
                    className="text-xs font-semibold text-white truncate max-w-[150px] sm:max-w-[170px]"
                    title={file.originalFilename}
                  >
                    {file.originalFilename}
                  </p>
                  <div className="flex items-center gap-1.5 text-[10px] text-white/60 mt-0.5">
                    <span>{formatBytes(file.sizeBytes)}</span>
                    <span>•</span>
                    <span className="truncate max-w-[80px]">{file.uploaderName}</span>
                    <span>•</span>
                    <span>{formatTime(file.createdAt)}</span>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-1 shrink-0">
                {/* Preview Button for images and text */}
                {['png', 'jpg', 'jpeg', 'webp', 'gif', 'txt', 'pdf'].includes(
                  file.extension.toLowerCase()
                ) && (
                  <button
                    type="button"
                    onClick={(e) => {
                      triggerButtonRef.current = e.currentTarget;
                      handleOpenPreview(file);
                    }}
                    aria-label={`Preview ${file.originalFilename}`}
                    title="Preview file"
                    className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                  >
                    <Eye className="w-3.5 h-3.5" />
                  </button>
                )}

                {/* Download Button */}
                <button
                  type="button"
                  data-action="download-file"
                  onClick={() => handleDownload(file)}
                  disabled={downloadingId === file.id}
                  aria-label={`Download ${file.originalFilename}`}
                  title="Download file"
                  className="p-1.5 rounded-lg text-[#5FA399] hover:bg-[#2F6F68]/30 transition-colors disabled:opacity-50"
                >
                  {downloadingId === file.id ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Download className="w-3.5 h-3.5" />
                  )}
                </button>

                {/* Delete Button (Authorized Only) */}
                {canDelete(file) && (
                  <button
                    type="button"
                    data-action="delete-file"
                    onClick={() => setPendingDeleteFileId(file.id)}
                    disabled={deletingId === file.id}
                    aria-label={`Delete ${file.originalFilename}`}
                    title="Delete file"
                    className="p-1.5 rounded-lg text-white/40 hover:text-[#D46A6A] hover:bg-[#C24D4D]/10 transition-colors disabled:opacity-50"
                  >
                    {deletingId === file.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="w-3.5 h-3.5" />
                    )}
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      {pendingDeleteFileId && (
        <ConfirmActionDialog
          isOpen={!!pendingDeleteFileId}
          title="Delete file?"
          description="This shared file will be permanently removed for everyone in the meeting."
          confirmLabel="Delete"
          cancelLabel="Cancel"
          variant="danger"
          onConfirm={() => {
            const id = pendingDeleteFileId;
            setPendingDeleteFileId(null);
            void handleDelete(id);
          }}
          onCancel={() => setPendingDeleteFileId(null)}
        />
      )}

      {/* Safe Preview Modal */}
      {previewFile && (
        <div
          data-modal="file-preview"
          role="dialog"
          aria-modal="true"
          aria-labelledby="preview-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 "
        >
          <div
            ref={previewModalRef}
            className="bg-[#1C1F24] border border-white/20 rounded-2xl w-full max-w-lg p-5 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2 min-w-0">
                {getFileIcon(previewFile.extension)}
                <h4 id="preview-modal-title" className="text-sm font-bold text-white truncate max-w-[280px]">
                  {previewFile.originalFilename}
                </h4>
              </div>
              <button
                type="button"
                onClick={handleClosePreview}
                aria-label="Close preview"
                className="p-1 rounded-lg text-white/60 hover:text-white hover:bg-white/10"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="bg-[#111316] rounded-xl p-4 flex flex-col items-center justify-center min-h-[160px] text-center">
              <div className="space-y-2">
                <p className="text-xs text-white/80">
                  Shared by <span className="font-semibold text-white">{previewFile.uploaderName}</span> ({previewFile.uploaderRole})
                </p>
                <p className="text-xs text-white/60">
                  Size: {formatBytes(previewFile.sizeBytes)} • Type: {previewFile.mimeType}
                </p>
                <p className="text-[11px] text-white/40 font-mono">
                  SHA-256: {previewFile.checksumSha256 ? `${previewFile.checksumSha256.substring(0, 16)}...` : 'Verified'}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={handleClosePreview}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-white/10 hover:bg-white/20 text-white transition-colors"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => {
                  handleDownload(previewFile);
                  handleClosePreview();
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-[#2F6F68] hover:bg-[#255A54] text-white transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download File</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Screen Reader Live Announcements */}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
        data-testid="files-panel-announcer"
      >
        {liveAnnouncement}
      </div>
    </div>
  );
};
