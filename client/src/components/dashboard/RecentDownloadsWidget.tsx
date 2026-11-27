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
    <Card className="p-5 bg-[#FAF9F6] dark:bg-[#1C1F24] border-[#DDDAD0] dark:border-[#2B3038] shadow-xs rounded-2xl flex flex-col flex-1">
      <div className="flex items-center justify-between pb-3 mb-3 border-b border-[#DDDAD0]/80 dark:border-[#2B3038]">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-[#E2ECE9] dark:bg-[#1F302E] text-[#2F6F68] dark:text-[#5FA399] flex items-center justify-center shrink-0">
            <FolderDown className="w-3.5 h-3.5" aria-hidden="true" />
          </div>
          <h3 className="font-display text-sm font-bold text-[#1F2428] dark:text-[#EAECEE]">
            Downloads & Files
          </h3>
        </div>
        <Link
          to="/downloads"
          className="text-xs font-semibold text-[#2F6F68] dark:text-[#5FA399] hover:text-[#255A54] dark:hover:text-[#6EB2A8] flex items-center gap-1 transition-colors"
        >
          <span>View All</span>
          <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
        </Link>
      </div>

      {files.length === 0 ? (
        <div className="py-5 px-2 text-center flex-1 flex flex-col items-center justify-center">
          <FolderDown className="w-7 h-7 text-[#7C848D] dark:text-[#747C86] mb-2 opacity-65" aria-hidden="true" />
          <p className="text-xs font-semibold text-[#1F2428] dark:text-[#EAECEE] mb-0.5">
            No shared files yet
          </p>
          <p className="text-[11px] text-[#7C848D] dark:text-[#8E96A0]">
            Files shared in meetings appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {files.map((file) => (
            <div
              key={file.id}
              className="p-2.5 rounded-xl bg-[#F3F2EE] dark:bg-[#141619] border border-[#DDDAD0]/70 dark:border-[#2B3038] flex items-center justify-between gap-3"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-[#FAF9F6] dark:bg-[#1C1F24] border border-[#DDDAD0] dark:border-[#2B3038] flex items-center justify-center text-[#2F6F68] dark:text-[#5FA399] shrink-0">
                  <FileText className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-[#1F2428] dark:text-[#EAECEE] truncate">{file.name}</p>
                  <p className="text-[11px] text-[#7C848D] dark:text-[#A3AAB2] truncate flex items-center gap-1">
                    <Video className="w-3 h-3 text-[#2F6F68] dark:text-[#5FA399]" />
                    <span className="truncate">{file.associatedMeetingName}</span>
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[11px] font-mono text-[#7C848D] dark:text-[#A3AAB2]">
                  {(file.sizeBytes / (1024 * 1024)).toFixed(1)} MB
                </span>
                <button
                  type="button"
                  onClick={() => handleDownload(file)}
                  disabled={downloadingId === file.id}
                  aria-label={`Download ${file.name} from ${file.associatedMeetingName}`}
                  className="p-1.5 rounded-lg text-[#2F6F68] dark:text-[#5FA399] hover:bg-[#E2ECE9] dark:hover:bg-[#1F302E] transition-colors disabled:opacity-50"
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
