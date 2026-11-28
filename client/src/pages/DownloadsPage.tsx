import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { DashboardLayout } from '@/components/dashboard/DashboardLayout';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ModalShell } from '@/components/ui/ModalShell';
import { cn } from '@/lib/utils';
import {
  FILE_TONE_CLASSES,
  getFileToneKey,
  STUDIO_INPUT_CLASS,
  STUDIO_ALERT_DANGER_CLASS,
} from '@/lib/studioTokens';
import {
  FolderDown,
  Search,
  FileText,
  FileSpreadsheet,
  FileArchive,
  FileCode,
  Film,
  Image as ImageIcon,
  Download,
  Video,
  Loader2,
  AlertCircle,
  RefreshCw,
  X,
  Trash2,
} from 'lucide-react';
import type { ISharedFileItem } from '@/types/dashboard';
import { fileApi } from '@/services/fileApi';

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function renderFileIcon(extension: string) {
  const toneKey = getFileToneKey(extension);
  const iconClass = cn('w-4 h-4', FILE_TONE_CLASSES[toneKey].iconColor);

  switch (toneKey) {
    case 'image':
      return <ImageIcon className={iconClass} aria-hidden="true" />;
    case 'sheet':
      return <FileSpreadsheet className={iconClass} aria-hidden="true" />;
    case 'archive':
      return <FileArchive className={iconClass} aria-hidden="true" />;
    case 'video':
      return <Film className={iconClass} aria-hidden="true" />;
    case 'code':
      return <FileCode className={iconClass} aria-hidden="true" />;
    default:
      return <FileText className={iconClass} aria-hidden="true" />;
  }
}

export const DownloadsPage: React.FC = () => {
  const [files, setFiles] = useState<ISharedFileItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [failedDownloadFile, setFailedDownloadFile] = useState<ISharedFileItem | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMeeting, setSelectedMeeting] = useState('All');
  const [selectedType, setSelectedType] = useState('All');
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [pendingDeleteFile, setPendingDeleteFile] = useState<ISharedFileItem | null>(null);
  const [isDeletingFile, setIsDeletingFile] = useState(false);
  const cancelDeleteBtnRef = useRef<HTMLButtonElement>(null);
  const mountedRef = useRef(true);

  const fetchSharedFiles = useCallback(async () => {
    try {
      setIsLoading(true);
      setLoadError(null);
      const data = await fileApi.getUserSharedFiles();
      if (mountedRef.current) {
        setFiles(data);
      }
    } catch (err: unknown) {
      if (mountedRef.current) {
        setLoadError(err instanceof Error ? err.message : 'Unable to load shared files.');
      }
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void fetchSharedFiles();
    return () => {
      mountedRef.current = false;
    };
  }, [fetchSharedFiles]);

  const totalBytes = files.reduce((acc, f) => acc + (f.sizeBytes || 0), 0);
  const totalMb = (totalBytes / (1024 * 1024)).toFixed(1);

  // Extract unique meetings for filter
  const uniqueMeetings = Array.from(
    new Set(files.map((f) => f.associatedMeetingName).filter(Boolean))
  );

  const filteredFiles = files.filter((file) => {
    const matchesSearch =
      file.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      file.associatedMeetingName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      file.sharedBy.name.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesMeeting =
      selectedMeeting === 'All' || file.associatedMeetingName === selectedMeeting;

    const ext = file.extension.toLowerCase();
    let matchesType = true;
    if (selectedType === 'pdf') matchesType = ext === 'pdf';
    else if (selectedType === 'doc') matchesType = ['doc', 'docx', 'txt', 'md'].includes(ext);
    else if (selectedType === 'sheet') matchesType = ['xls', 'xlsx', 'csv'].includes(ext);
    else if (selectedType === 'image') matchesType = ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext);
    else if (selectedType === 'archive') matchesType = ['zip', 'tar', 'gz', '7z'].includes(ext);

    return matchesSearch && matchesMeeting && matchesType;
  });

  const hasActiveFilters = Boolean(
    searchQuery.trim() || selectedMeeting !== 'All' || selectedType !== 'All'
  );

  const clearFilters = () => {
    setSearchQuery('');
    setSelectedMeeting('All');
    setSelectedType('All');
  };

  const handleDownload = async (file: ISharedFileItem) => {
    try {
      setDownloadError(null);
      setFailedDownloadFile(null);
      setDownloadingId(file.id);
      await fileApi.downloadMeetingFile(file.associatedMeetingCode, file.id, file.name);
    } catch (err: unknown) {
      if (mountedRef.current) {
        setDownloadError(err instanceof Error ? err.message : `Unable to download ${file.name}.`);
        setFailedDownloadFile(file);
      }
    } finally {
      if (mountedRef.current) {
        setDownloadingId(null);
      }
    }
  };

  const handleConfirmRemove = async () => {
    if (!pendingDeleteFile) return;
    try {
      setIsDeletingFile(true);
      setDownloadError(null);
      await fileApi.removeUserSharedFile(pendingDeleteFile.id);
      if (mountedRef.current) {
        setFiles((prev) => prev.filter((f) => f.id !== pendingDeleteFile.id));
        setPendingDeleteFile(null);
      }
    } catch (err: unknown) {
      if (mountedRef.current) {
        setDownloadError(err instanceof Error ? err.message : 'Unable to remove file from downloads.');
        setPendingDeleteFile(null);
      }
    } finally {
      if (mountedRef.current) {
        setIsDeletingFile(false);
      }
    }
  };

  return (
    <DashboardLayout title="Downloads & Shared Files">
      {/* Contextual Summary Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <p className="text-xs sm:text-sm text-[#555D66] dark:text-[#A3AAB2]">
          Every shared document is permanently traceable to its original meeting session.
        </p>

        <div className="flex items-center gap-2 shrink-0">
          <Badge variant="neutral" className="px-3 py-1 text-xs">
            {files.length} {files.length === 1 ? 'file' : 'files'} · {totalMb} MB storage used
          </Badge>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <Card className="p-3.5 sm:p-4 bg-[#FAF9F6] dark:bg-[#1C1F24] border-[#DDDAD0] dark:border-[#2B3038] shadow-cly-sm rounded-2xl mb-6">
        <div className="grid grid-cols-2 sm:grid-cols-12 gap-2.5 sm:gap-3">
          {/* Search Input */}
          <div className="col-span-2 sm:col-span-6 relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#636B74] dark:text-[#A3AAB2]">
              <Search className="w-4 h-4" aria-hidden="true" />
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search files by name, meeting, or uploader..."
              aria-label="Search files by name or keyword"
              className={cn(STUDIO_INPUT_CLASS, 'pl-9 text-xs sm:text-sm')}
            />
          </div>

          {/* Associated Meeting Filter */}
          <div className="sm:col-span-3">
            <select
              value={selectedMeeting}
              onChange={(e) => setSelectedMeeting(e.target.value)}
              aria-label="Filter by associated meeting"
              className={cn(
                STUDIO_INPUT_CLASS,
                'text-xs sm:text-sm [color-scheme:light] dark:[color-scheme:dark]'
              )}
            >
              <option value="All">All Meetings ({uniqueMeetings.length})</option>
              {uniqueMeetings.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          {/* File Type Filter */}
          <div className="sm:col-span-3">
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              aria-label="Filter by file type"
              className={cn(
                STUDIO_INPUT_CLASS,
                'text-xs sm:text-sm [color-scheme:light] dark:[color-scheme:dark]'
              )}
            >
              <option value="All">All File Types</option>
              <option value="pdf">PDF Documents</option>
              <option value="doc">Documents (Word/Markdown)</option>
              <option value="sheet">Spreadsheets</option>
              <option value="image">Images & Media</option>
              <option value="archive">Archives (ZIP/TAR)</option>
            </select>
          </div>
        </div>
      </Card>

      {/* Inline Download Error Banner */}
      {downloadError && (
        <div
          role="alert"
          className={cn(
            'mb-4 p-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs cly-animate-fade',
            STUDIO_ALERT_DANGER_CLASS
          )}
        >
          <div className="flex items-start gap-2.5 min-w-0">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
            <span className="leading-relaxed">{downloadError}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {failedDownloadFile && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handleDownload(failedDownloadFile)}
                leftIcon={<RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />}
              >
                Retry
              </Button>
            )}
            <button
              type="button"
              onClick={() => {
                setDownloadError(null);
                setFailedDownloadFile(null);
              }}
              aria-label="Dismiss download error"
              className="p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {/* Content: Loading, Load Error, Populated (Table + Mobile Cards), or Empty/Filtered-Empty */}
      {isLoading ? (
        <Card className="p-12 bg-[#FAF9F6] dark:bg-[#1C1F24] border-[#DDDAD0] dark:border-[#2B3038] shadow-cly-sm rounded-2xl text-center flex flex-col items-center justify-center min-h-[300px]">
          <Loader2 className="w-8 h-8 animate-spin text-[#2F6F68] dark:text-[#5FA399] mb-3" aria-hidden="true" />
          <p className="text-sm font-medium text-[#1F2428] dark:text-[#EAECEE]">
            Loading your shared files...
          </p>
        </Card>
      ) : loadError ? (
        <Card className={cn('p-8 text-center flex flex-col items-center justify-center min-h-[260px]', STUDIO_ALERT_DANGER_CLASS)}>
          <AlertCircle className="w-8 h-8 text-[#C24D4D] dark:text-[#D46A6A] mb-2" aria-hidden="true" />
          <h3 className="font-display text-sm font-bold text-[#9E3939] dark:text-[#E58484] mb-1">
            Failed to load shared files
          </h3>
          <p className="text-xs text-[#9E3939]/90 dark:text-[#E58484]/90 max-w-md mb-4">
            {loadError}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void fetchSharedFiles()}
            leftIcon={<RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />}
          >
            Retry
          </Button>
        </Card>
      ) : filteredFiles.length > 0 ? (
        <Card className="p-0 bg-[#FAF9F6] dark:bg-[#1C1F24] border-[#DDDAD0] dark:border-[#2B3038] shadow-cly-sm rounded-2xl overflow-hidden">
          {/* Desktop Table (768px+) */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left border-collapse" data-table="downloads-files">
              <thead>
                <tr className="border-b border-[#DDDAD0] dark:border-[#2B3038] bg-[#F3F2EE]/80 dark:bg-[#141619] text-[11px] font-semibold text-[#555D66] dark:text-[#A3AAB2] uppercase tracking-wider">
                  <th className="py-3 px-4">File Name</th>
                  <th className="py-3 px-4">Meeting Session</th>
                  <th className="py-3 px-4">Shared By</th>
                  <th className="py-3 px-4">Size</th>
                  <th className="py-3 px-4">Shared Date</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#DDDAD0]/70 dark:divide-[#2B3038] text-xs text-[#1F2428] dark:text-[#EAECEE]">
                {filteredFiles.map((file) => {
                  const tone = FILE_TONE_CLASSES[getFileToneKey(file.extension)];
                  return (
                    <tr
                      key={file.id}
                      data-row-file={file.id}
                      className="hover:bg-[#EAE8E1]/50 dark:hover:bg-[#24282E]/60 transition-colors"
                    >
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3 min-w-0">
                          <div
                            className={cn(
                              'w-8 h-8 rounded-lg flex items-center justify-center shrink-0',
                              tone.iconWrap
                            )}
                          >
                            {renderFileIcon(file.extension)}
                          </div>
                          <div className="min-w-0">
                            <p className="font-semibold truncate max-w-[200px] sm:max-w-[260px]">
                              {file.name}
                            </p>
                            <span
                              className={cn(
                                'inline-flex items-center px-1.5 py-0.5 mt-0.5 rounded text-[10px] font-mono font-semibold uppercase border',
                                tone.chipClass
                              )}
                            >
                              .{file.extension}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5 text-[#1F2428] dark:text-[#EAECEE]">
                          <Video className="w-3.5 h-3.5 text-[#2F6F68] dark:text-[#5FA399] shrink-0" aria-hidden="true" />
                          <span className="truncate max-w-[160px] font-medium">
                            {file.associatedMeetingName}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-[#555D66] dark:text-[#A3AAB2]">{file.sharedBy.name}</span>
                      </td>
                      <td className="py-3 px-4 font-mono text-[#555D66] dark:text-[#A3AAB2]">
                        {formatBytes(file.sizeBytes)}
                      </td>
                      <td className="py-3 px-4 text-[#555D66] dark:text-[#A3AAB2]">
                        {new Date(file.sharedAt).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            data-action="download-file"
                            onClick={() => void handleDownload(file)}
                            disabled={downloadingId === file.id}
                            aria-label={`Save ${file.name} to device`}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#E2ECE9] dark:bg-[#1F302E] hover:bg-[#D2E1DC] dark:hover:bg-[#273C39] text-[#2F6F68] dark:text-[#5FA399] transition-colors disabled:opacity-50"
                          >
                            {downloadingId === file.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                            ) : (
                              <Download className="w-3.5 h-3.5" aria-hidden="true" />
                            )}
                            <span>Save to Device</span>
                          </button>
                          <button
                            type="button"
                            data-action="remove-saved-file"
                            onClick={() => setPendingDeleteFile(file)}
                            aria-label={`Delete ${file.name} from downloads`}
                            title="Delete from Downloads"
                            className="inline-flex items-center justify-center p-1.5 rounded-lg text-[#555D66] dark:text-[#A3AAB2] hover:text-[#C24D4D] dark:hover:text-[#D46A6A] hover:bg-[#F6E6E6] dark:hover:bg-[#332022] transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile Card List (320px–767px) */}
          <div className="md:hidden divide-y divide-[#DDDAD0]/70 dark:divide-[#2B3038]">
            {filteredFiles.map((file) => {
              const tone = FILE_TONE_CLASSES[getFileToneKey(file.extension)];
              return (
                <div key={file.id} data-mobile-file={file.id} className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <div
                        className={cn(
                          'w-9 h-9 rounded-lg flex items-center justify-center shrink-0',
                          tone.iconWrap
                        )}
                      >
                        {renderFileIcon(file.extension)}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-[#1F2428] dark:text-[#EAECEE] break-words">
                          {file.name}
                        </p>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <span
                            className={cn(
                              'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold uppercase border',
                              tone.chipClass
                            )}
                          >
                            .{file.extension}
                          </span>
                          <span className="text-[11px] font-mono text-[#555D66] dark:text-[#A3AAB2]">
                            {formatBytes(file.sizeBytes)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2.5 text-[11px] text-[#555D66] dark:text-[#A3AAB2]">
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-1.5 text-[#1F2428] dark:text-[#EAECEE]">
                        <Video className="w-3.5 h-3.5 text-[#2F6F68] dark:text-[#5FA399] shrink-0" aria-hidden="true" />
                        <span className="truncate font-medium">{file.associatedMeetingName}</span>
                      </div>
                      <p className="truncate">
                        {file.sharedBy.name} ·{' '}
                        {new Date(file.sharedAt).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 pt-2.5 border-t border-[#DDDAD0]/70 dark:border-[#2B3038]">
                      <button
                        type="button"
                        onClick={() => void handleDownload(file)}
                        disabled={downloadingId === file.id}
                        aria-label={`Save ${file.name} to device`}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 min-h-[38px] rounded-lg text-xs font-semibold bg-[#E2ECE9] dark:bg-[#1F302E] hover:bg-[#D2E1DC] dark:hover:bg-[#273C39] text-[#2F6F68] dark:text-[#5FA399] transition-colors disabled:opacity-50"
                      >
                        {downloadingId === file.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                        ) : (
                          <Download className="w-3.5 h-3.5" aria-hidden="true" />
                        )}
                        <span>Save to Device</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingDeleteFile(file)}
                        aria-label={`Delete ${file.name} from downloads`}
                        className="inline-flex items-center justify-center min-w-[38px] min-h-[38px] p-2 rounded-lg border border-[#DDDAD0] dark:border-[#2B3038] text-[#555D66] dark:text-[#A3AAB2] hover:text-[#C24D4D] dark:hover:text-[#D46A6A] hover:bg-[#F6E6E6] dark:hover:bg-[#332022] transition-colors shrink-0"
                      >
                        <Trash2 className="w-4 h-4" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      ) : files.length === 0 && !hasActiveFilters ? (
        <Card className="p-12 bg-[#FAF9F6] dark:bg-[#1C1F24] border-[#DDDAD0] dark:border-[#2B3038] shadow-cly-sm rounded-2xl text-center flex flex-col items-center justify-center min-h-[380px]">
          <div className="w-16 h-16 rounded-2xl bg-[#E2ECE9] dark:bg-[#1F302E] text-[#2F6F68] dark:text-[#5FA399] flex items-center justify-center mb-4">
            <FolderDown className="w-8 h-8" aria-hidden="true" />
          </div>
          <h3 className="font-display text-base sm:text-lg font-bold text-[#1F2428] dark:text-[#EAECEE] mb-1">
            No shared files yet
          </h3>
          <p className="text-xs sm:text-sm text-[#555D66] dark:text-[#A3AAB2] max-w-md mx-auto mb-6 leading-relaxed">
            Documents, presentations, and code snippets shared during active video rooms appear here with their meeting name and download actions.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/dashboard"
              className="inline-flex items-center justify-center h-9 px-3 text-xs font-medium rounded-md bg-[#2F6F68] text-[#FAF9F6] hover:bg-[#255A54] dark:bg-[#5FA399] dark:text-[#141619] dark:hover:bg-[#6EB2A8] shadow-cly-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6F68] dark:focus-visible:ring-[#5FA399]"
            >
              Return to Dashboard
            </Link>
            <Link
              to="/meetings"
              className="inline-flex items-center justify-center h-9 px-3 text-xs font-medium rounded-md bg-transparent border border-[#DDDAD0] text-[#1F2428] hover:bg-[#EAE8E1] dark:border-[#2B3038] dark:text-[#EAECEE] dark:hover:bg-[#24282E] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6F68] dark:focus-visible:ring-[#5FA399]"
            >
              View Scheduled Meetings
            </Link>
          </div>
        </Card>
      ) : (
        <Card className="p-12 bg-[#FAF9F6] dark:bg-[#1C1F24] border-[#DDDAD0] dark:border-[#2B3038] shadow-cly-sm rounded-2xl text-center flex flex-col items-center justify-center min-h-[320px]">
          <div className="w-14 h-14 rounded-2xl bg-[#F3F2EE] dark:bg-[#141619] text-[#636B74] dark:text-[#A3AAB2] flex items-center justify-center mb-4">
            <Search className="w-7 h-7" aria-hidden="true" />
          </div>
          <h3 className="font-display text-base sm:text-lg font-bold text-[#1F2428] dark:text-[#EAECEE] mb-1">
            No matching files
          </h3>
          <p className="text-xs sm:text-sm text-[#555D66] dark:text-[#A3AAB2] max-w-md mx-auto mb-6 leading-relaxed">
            No shared files match your current search or filter criteria.
          </p>
          <Button type="button" variant="outline" size="sm" onClick={clearFilters}>
            Clear Filters
          </Button>
        </Card>
      )}

      {/* Remove from Downloads Confirmation Modal */}
      <ModalShell
        isOpen={Boolean(pendingDeleteFile)}
        onClose={() => {
          if (!isDeletingFile) setPendingDeleteFile(null);
        }}
        title="Delete from Downloads?"
        titleId="remove-download-modal-title"
        size="sm"
        variant="danger"
        disableClose={isDeletingFile}
        initialFocusRef={cancelDeleteBtnRef}
        closeLabel="Cancel remove download"
        footer={
          <div className="flex items-center justify-end gap-2.5">
            <Button
              ref={cancelDeleteBtnRef}
              type="button"
              variant="outline"
              size="sm"
              disabled={isDeletingFile}
              onClick={() => setPendingDeleteFile(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={isDeletingFile}
              onClick={() => void handleConfirmRemove()}
            >
              {isDeletingFile ? 'Deleting...' : 'Delete'}
            </Button>
          </div>
        }
      >
        {pendingDeleteFile && (
          <p className="text-xs sm:text-sm text-[#555D66] dark:text-[#A3AAB2] leading-relaxed">
            Remove <strong className="text-[#1F2428] dark:text-[#EAECEE]">{pendingDeleteFile.name}</strong> from your Downloads list? You can save it to your device first before deleting.
          </p>
        )}
      </ModalShell>
    </DashboardLayout>
  );
};

export default DownloadsPage;
