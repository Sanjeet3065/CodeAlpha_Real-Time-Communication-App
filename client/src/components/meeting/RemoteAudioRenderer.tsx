import React, { useEffect, useRef } from 'react';
import { isAudioOutputSelectionSupported } from '@/utils/mediaDevices';
import type { AttachableMediaTrack, ParticipantMediaState } from '@/types/meeting';

interface RemoteAudioTrackPlayerProps {
  identity: string;
  track: AttachableMediaTrack;
  audioOutputDeviceId?: string;
}

const RemoteAudioTrackPlayer: React.FC<RemoteAudioTrackPlayerProps> = React.memo(
  ({ identity, track, audioOutputDeviceId }) => {
    const audioRef = useRef<HTMLAudioElement | null>(null);

    useEffect(() => {
      const el = audioRef.current;
      if (!el) return;

      track.attach(el);
      return () => {
        try {
          track.detach(el);
        } catch {
          // ignore detach error during cleanup
        }
        el.srcObject = null;
      };
    }, [track]);

    useEffect(() => {
      const el = audioRef.current as (HTMLAudioElement & {
        setSinkId?: (sinkId: string) => Promise<void>;
      }) | null;
      if (!el || !audioOutputDeviceId || !isAudioOutputSelectionSupported()) {
        return;
      }
      if (typeof el.setSinkId === 'function') {
        void el.setSinkId(audioOutputDeviceId).catch(() => {
          // Gracefully ignore sink switch errors on restricted outputs
        });
      }
    }, [audioOutputDeviceId]);

    return (
      <audio
        ref={audioRef}
        autoPlay
        playsInline
        data-remote-audio={identity}
        className="sr-only"
      />
    );
  }
);

RemoteAudioTrackPlayer.displayName = 'RemoteAudioTrackPlayer';

interface RemoteAudioRendererProps {
  participants: ParticipantMediaState[];
  audioOutputDeviceId?: string;
}

/**
 * Attaches ONLY remote participants' subscribed audio tracks (strictly excludes
 * local microphone to prevent audio feedback loops) with clean detach on leave.
 */
export const RemoteAudioRenderer: React.FC<RemoteAudioRendererProps> = ({
  participants,
  audioOutputDeviceId,
}) => {
  const remoteWithAudio = participants.filter(
    (p): p is ParticipantMediaState & { audioTrack: AttachableMediaTrack } =>
      !p.isLocal && Boolean(p.audioTrack)
  );

  if (remoteWithAudio.length === 0) return null;

  return (
    <div aria-hidden="true" data-remote-audio-container="true">
      {remoteWithAudio.map((p) => (
        <RemoteAudioTrackPlayer
          key={p.audioTrack.sid ? `${p.identity}:${p.audioTrack.sid}` : p.identity}
          identity={p.identity}
          track={p.audioTrack}
          audioOutputDeviceId={audioOutputDeviceId}
        />
      ))}
    </div>
  );
};
