import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { DashboardLayout } from '@/components/dashboard/DashboardLayout';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import {
  FolderDown,
  Search,
  ArrowLeft,
  FileText,
  FileSpreadsheet,
  FileArchive,
  Image as ImageIcon,
  Download,
  Video,
  Loader2,
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

function getFileIcon(extension: string) {
  const ext = extension.toLowerCase();
  switch (ext) {
    case 'pdf':
      return <FileText className="w-5 h-5 text-red-500" />;
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
      return <ImageIcon className="w-5 h-5 text-emerald-500" />;
    case 'xlsx':
    case 'xls':
    case 'csv':
      return <FileSpreadsheet className="w-5 h-5 text-green-600" />;
    case 'docx':
    case 'doc':
      return <FileText className="w-5 h-5 text-blue-500" />;
    case 'zip':
    case 'tar':
    case 'gz':
    case '7z':
      return <FileArchive className="w-5 h-5 text-amber-500" />;
    default:
      return <FileText className="w-5 h-5 text-[#168B83]" />;
  }
}

export const DownloadsPage: React.FC = () => {
  const [files, setFiles] = useState<ISharedFileItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMeeting, setSelectedMeeting] = useState('All');
  const [selectedType, setSelectedType] = useState('All');
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        setIsLoading(true);
        const data = await fileApi.getUserSharedFiles();
        if (mounted) {
          setFiles(data);
        }
      } catch (err) {
        console.error('Failed to load shared files:', err);
      } finally {
        if (mounted) setIsLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

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

  const handleDownload = async (file: ISharedFileItem) => {
    try {
      setDownloadingId(file.id);
      await fileApi.downloadMeetingFile(file.associatedMeetingCode, file.id, file.name);
    } catch (err) {
      console.error('Download error:', err);
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <DashboardLayout
      title="Downloads & Shared Files"
      subtitle="Centralized repository of files and media exchanged during meetings"
    >
      {/* Top Header & Storage Badge */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link
              to="/dashboard"
              className="text-xs text-[#168B83] hover:text-[#11706A] flex items-center gap-1 font-medium transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to Overview</span>
            </Link>
          </div>
          <h2 className="font-display text-2xl font-bold tracking-tight text-[#172B3A]">
            Downloads & Shared Files
          </h2>
          <p className="text-xs sm:text-sm text-[#6B8092] mt-0.5">
            Every shared document is permanently traceable to its original meeting session.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="neutral" className="px-3 py-1 text-xs">
            {files.length} files • {totalMb} MB storage used
          </Badge>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <Card className="p-4 bg-white border-[#E3E1D9] shadow-xs rounded-2xl mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
          {/* Search Input */}
          <div className="sm:col-span-6 relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#6B8092]">
              <Search className="w-4 h-4" />
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search files by name, meeting, or uploader..."
              aria-label="Search files by name or keyword"
              className="w-full pl-9 pr-3 py-2 bg-[#F7F6F2] border border-[#E3E1D9] rounded-xl text-xs text-[#172B3A] placeholder-[#6B8092] focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#168B83]/30 focus:border-[#168B83] transition-all"
            />
          </div>

          {/* Associated Meeting Filter */}
          <div className="sm:col-span-3">
            <select
              value={selectedMeeting}
              onChange={(e) => setSelectedMeeting(e.target.value)}
              aria-label="Filter by associated meeting"
              className="w-full px-3 py-2 bg-[#F7F6F2] border border-[#E3E1D9] rounded-xl text-xs text-[#172B3A] focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#168B83]/30 focus:border-[#168B83] transition-all"
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
              className="w-full px-3 py-2 bg-[#F7F6F2] border border-[#E3E1D9] rounded-xl text-xs text-[#172B3A] focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#168B83]/30 focus:border-[#168B83] transition-all"
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

      {/* Content: Loading, List, or Screen 23 Empty State */}
      {isLoading ? (
        <Card className="p-12 bg-white border-[#E3E1D9] shadow-xs rounded-2xl text-center flex flex-col items-center justify-center min-h-[300px]">
          <Loader2 className="w-8 h-8 animate-spin text-[#168B83] mb-3" />
          <p className="text-sm font-medium text-[#172B3A]">Loading your shared files...</p>
        </Card>
      ) : filteredFiles.length > 0 ? (
        <Card className="bg-white border-[#E3E1D9] shadow-xs rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse" data-table="downloads-files">
              <thead>
                <tr className="border-b border-[#E3E1D9] bg-[#F7F6F2]/60 text-[11px] font-semibold text-[#6B8092] uppercase tracking-wider">
                  <th className="py-3 px-4">File Name</th>
                  <th className="py-3 px-4">Meeting Session</th>
                  <th className="py-3 px-4">Shared By</th>
                  <th className="py-3 px-4">Size</th>
                  <th className="py-3 px-4">Shared Date</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E3E1D9]/60 text-xs text-[#172B3A]">
                {filteredFiles.map((file) => (
                  <tr
                    key={file.id}
                    data-row-file={file.id}
                    className="hover:bg-[#F7F6F2]/40 transition-colors"
                  >
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-[#F7F6F2] border border-[#E3E1D9] flex items-center justify-center shrink-0">
                          {getFileIcon(file.extension)}
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold truncate max-w-[200px] sm:max-w-[260px]">
                            {file.name}
                          </p>
                          <span className="text-[10px] text-[#6B8092] uppercase font-mono">
                            .{file.extension}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1.5 text-[#172B3A]">
                        <Video className="w-3.5 h-3.5 text-[#168B83] shrink-0" />
                        <span className="truncate max-w-[160px] font-medium">
                          {file.associatedMeetingName}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-[#6B8092]">{file.sharedBy.name}</span>
                    </td>
                    <td className="py-3 px-4 font-mono text-[#6B8092]">
                      {formatBytes(file.sizeBytes)}
                    </td>
                    <td className="py-3 px-4 text-[#6B8092]">
                      {new Date(file.sharedAt).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        data-action="download-file"
                        onClick={() => handleDownload(file)}
                        disabled={downloadingId === file.id}
                        aria-label={`Download ${file.name}`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#DCEDE8] hover:bg-[#cbe5de] text-[#168B83] transition-colors disabled:opacity-50"
                      >
                        {downloadingId === file.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Download className="w-3.5 h-3.5" />
                        )}
                        <span>Download</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        /* Screen 23 Empty State */
        <Card className="p-12 bg-white border-[#E3E1D9] shadow-xs rounded-2xl text-center flex flex-col items-center justify-center min-h-[380px]">
          <div className="w-16 h-16 rounded-2xl bg-[#DCEDE8] text-[#168B83] flex items-center justify-center mb-4">
            <FolderDown className="w-8 h-8" aria-hidden="true" />
          </div>
          <h3 className="font-display text-base sm:text-lg font-bold text-[#172B3A] mb-1">
            No Files Downloaded or Shared Yet
          </h3>
          <p className="text-xs sm:text-sm text-[#6B8092] max-w-md mx-auto mb-6 leading-relaxed">
            Documents, presentations, and code snippets shared during active video rooms will automatically be indexed here with their associated meeting name and download actions.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link to="/dashboard">
              <Button variant="primary" size="sm">
                Return to Dashboard
              </Button>
            </Link>
            <Link to="/meetings">
              <Button variant="outline" size="sm">
                View Scheduled Meetings
              </Button>
            </Link>
          </div>
        </Card>
      )}
    </DashboardLayout>
  );
};

export default DownloadsPage;
