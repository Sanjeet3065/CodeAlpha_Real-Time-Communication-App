import { useState, useEffect, useRef } from 'react';
import { X, Upload, FileText, Image as ImageIcon, Archive, Download, File } from 'lucide-react';
import { getFiles, uploadFile, getFileUrl } from '@/services/meetingApi';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { toast } from '@/stores/toastStore';
import { formatFileSize, formatTime } from '@/lib/utils';
import { MAX_FILE_SIZE, ALLOWED_FILE_EXTENSIONS } from '@/lib/constants';
import type { SharedFile } from '@/types';

export function FilesPanel({ meetingId, onClose }: { meetingId: string; onClose: () => void }) {
  const profile = useAuthStore((s) => s.profile);
  const [files, setFiles] = useState<SharedFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadFiles();

    const channelName = `files:${meetingId}`;
    const existingChannel = supabase.getChannels().find((ch: any) => ch.topic === channelName);
    if (existingChannel) {
      supabase.removeChannel(existingChannel);
    }

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'shared_files', filter: `meeting_id=eq.${meetingId}` },
        (payload) => {
          const newFile = payload.new as SharedFile;
          if (newFile.uploader_id !== profile?.id) {
            setFiles((prev) => [newFile, ...prev]);
            toast.info(`New file shared: ${newFile.filename}`);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [meetingId, profile?.id]);

  async function loadFiles() {
    try {
      const f = await getFiles(meetingId);
      setFiles(f);
    } catch (err) {
      // silent
    } finally {
      setLoading(false);
    }
  }

  async function handleUpload(file: File) {
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    if (!ALLOWED_FILE_EXTENSIONS.includes(ext)) {
      toast.error('File type not supported');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      toast.error('File too large (max 100MB)');
      return;
    }

    setUploading(true);
    setProgress(0);
    try {
      const sharedFile = await uploadFile(meetingId, file, setProgress);
      setFiles((prev) => [sharedFile, ...prev]);
      toast.success('File uploaded');
    } catch (err: any) {
      toast.error(err.message || 'Upload failed');
    } finally {
      setUploading(false);
      setProgress(0);
    }
  }

  async function handleDownload(file: SharedFile) {
    const url = await getFileUrl(file.file_path);
    window.open(url, '_blank');
  }

  function getFileIcon(mime: string) {
    if (mime.startsWith('image/')) return ImageIcon;
    if (mime.includes('pdf')) return FileText;
    if (mime.includes('zip') || mime.includes('compressed')) return Archive;
    return File;
  }

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900">
      <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-800">
        <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
          <File className="w-5 h-5" /> Files
        </h3>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="p-3 border-b border-gray-200 dark:border-gray-800">
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleUpload(file);
            e.target.value = '';
          }}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="w-full px-4 py-3 border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-xl text-sm text-gray-600 dark:text-gray-400 hover:border-blue-400 hover:text-blue-500 transition flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {uploading ? (
            <>
              <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              Uploading... {progress}%
            </>
          ) : (
            <>
              <Upload className="w-5 h-5" /> Upload File
            </>
          )}
        </button>
        {uploading && (
          <div className="mt-2 h-1.5 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 transition-all" style={{ width: `${progress}%` }} />
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading ? (
          <p className="text-center text-sm text-gray-400 py-4">Loading files...</p>
        ) : files.length === 0 ? (
          <div className="text-center py-8">
            <File className="w-10 h-10 text-gray-300 dark:text-gray-700 mx-auto mb-2" />
            <p className="text-sm text-gray-400">No files shared yet</p>
          </div>
        ) : (
          files.map((file) => {
            const Icon = getFileIcon(file.mime_type || '');
            return (
              <div key={file.id} className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 transition">
                <div className="w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-950/50 flex items-center justify-center flex-shrink-0">
                  <Icon className="w-5 h-5 text-blue-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{file.filename}</p>
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <span>{formatFileSize(file.file_size)}</span>
                    <span>·</span>
                    <span>{formatTime(file.created_at)}</span>
                  </div>
                </div>
                <button
                  onClick={() => handleDownload(file)}
                  className="w-8 h-8 rounded-lg bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300 hover:bg-blue-100 dark:hover:bg-blue-900 hover:text-blue-600 flex items-center justify-center transition flex-shrink-0"
                  title="Download"
                >
                  <Download className="w-4 h-4" />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
