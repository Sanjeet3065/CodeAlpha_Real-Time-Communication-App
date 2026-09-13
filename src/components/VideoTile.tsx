import { useEffect, useRef } from 'react';
import { MicOff, Crown, Monitor } from 'lucide-react';
import { UserAvatar } from '@/components/UserAvatar';

interface VideoTileProps {
  stream: MediaStream | null;
  name: string;
  avatarUrl?: string | null;
  email?: string;
  micOn: boolean;
  cameraOn: boolean;
  isPresenting?: boolean;
  isHost?: boolean;
  isLocal?: boolean;
  className?: string;
}

export function VideoTile({
  stream,
  name,
  avatarUrl,
  email,
  micOn,
  cameraOn,
  isPresenting,
  isHost,
  isLocal,
  className = '',
}: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && stream && cameraOn) {
      if (videoRef.current.srcObject !== stream) {
        videoRef.current.srcObject = stream;
      }
      videoRef.current.play().catch(() => {});
    }
  }, [stream, cameraOn]);

  return (
    <div className={`relative bg-gray-800 rounded-xl overflow-hidden flex items-center justify-center group ${className}`}>
      {cameraOn && stream ? (
        <video
          ref={(el) => {
            (videoRef as any).current = el;
            if (el && stream && el.srcObject !== stream) {
              el.srcObject = stream;
              el.play().catch(() => {});
            }
          }}
          autoPlay
          muted={isLocal}
          playsInline
          className={`w-full h-full object-cover ${isLocal ? '-scale-x-100' : ''}`}
        />
      ) : (
        <div className="flex flex-col items-center gap-3">
          <UserAvatar
            name={name}
            email={email}
            avatarUrl={avatarUrl}
            size="xl"
          />
        </div>
      )}

      {/* Bottom bar */}
      <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/60 to-transparent flex items-center gap-2">
        {!micOn && (
          <div className="w-6 h-6 rounded-full bg-rose-500 flex items-center justify-center">
            <MicOff className="w-3 h-3 text-white" />
          </div>
        )}
        <span className="text-sm text-white font-medium truncate">
          {name} {isLocal && '(You)'}
        </span>
        {isHost && (
          <span className="ml-auto flex items-center gap-1 text-amber-400">
            <Crown className="w-3.5 h-3.5" />
          </span>
        )}
        {isPresenting && (
          <span className={`ml-auto flex items-center gap-1 text-blue-400 ${isHost ? 'ml-1' : ''}`}>
            <Monitor className="w-3.5 h-3.5" />
          </span>
        )}
      </div>
    </div>
  );
}
