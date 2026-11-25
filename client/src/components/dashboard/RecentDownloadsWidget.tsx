import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { FolderDown, FileText, ArrowRight, Download, Video, Loader2 } from 'lucide-react';
import type { ISharedFileItem } from '@/types/dashboard';
import { fileApi } from '@/services/fileApi';

interface RecentDownloadsWidgetProps {
  files?: ISharedFileItem[];
}

export const RecentDownloadsWidget: React.FC<RecentDownloadsWidgetProps> = ({
  files: initialFiles,
}) => {
  const [files, setFiles] = useState<ISharedFileItem[]>(initialFiles || []);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  useEffect(() => {
    if (initialFiles) {
      setFiles(initialFiles);
      return;
    }

    let mounted = true;
    void (async () => {
      try {
        const data = await fileApi.getUserSharedFiles();
        if (mounted) {
          setFiles(data.slice(0, 4));
        }
      } catch {
        // Handled silently
      }
    })();
    return () => {
      mounted = false;
    };
  }, [initialFiles]);

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
    <Card className="p-5 bg-white border-[#E3E1D9] shadow-xs rounded-2xl">
      <div className="flex items-center justify-between pb-3 mb-3 border-b border-[#E3E1D9]/70">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-[#DCEDE8] text-[#168B83] flex items-center justify-center">
            <FolderDown className="w-3.5 h-3.5" aria-hidden="true" />
          </div>
          <h3 className="font-display text-sm font-bold text-[#172B3A]">
            Downloads & Files
          </h3>
        </div>
        <Link
          to="/downloads"
          className="text-xs font-semibold text-[#168B83] hover:text-[#11706A] flex items-center gap-1 transition-colors"
        >
          <span>View All</span>
          <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
        </Link>
      </div>

      {files.length === 0 ? (
        <div className="py-6 px-2 text-center">
          <FolderDown className="w-8 h-8 text-[#A0AEC0] mx-auto mb-2 opacity-60" aria-hidden="true" />
          <p className="text-xs font-semibold text-[#172B3A] mb-1">
            No Shared Files Yet
          </p>
          <p className="text-[11px] text-[#6B8092] leading-relaxed mb-3">
            Documents, slides, and media shared during meetings will be saved here with their associated meeting name.
          </p>
          <Link
            to="/downloads"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#F7F6F2] hover:bg-[#E3E1D9] text-[#172B3A] text-xs font-medium transition-colors"
          >
            <span>Open Repository</span>
            <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
      ) : (
        <div className="space-y-2.5">
          {files.map((file) => (
            <div
              key={file.id}
              className="p-2.5 rounded-xl bg-[#F7F6F2] border border-[#E3E1D9]/60 flex items-center justify-between gap-3"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-white border border-[#E3E1D9] flex items-center justify-center text-[#168B83] shrink-0">
                  <FileText className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-[#172B3A] truncate">{file.name}</p>
                  <p className="text-[11px] text-[#6B8092] truncate flex items-center gap-1">
                    <Video className="w-3 h-3 text-[#168B83]" />
                    <span className="truncate">{file.associatedMeetingName}</span>
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[11px] font-mono text-[#6B8092]">
                  {(file.sizeBytes / (1024 * 1024)).toFixed(1)} MB
                </span>
                <button
                  type="button"
                  onClick={() => handleDownload(file)}
                  disabled={downloadingId === file.id}
                  aria-label={`Download ${file.name} from ${file.associatedMeetingName}`}
                  className="p-1.5 rounded-lg text-[#168B83] hover:bg-[#DCEDE8] transition-colors disabled:opacity-50"
                >
                  {downloadingId === file.id ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
};
