import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Card } from '@/components/ui/Card';
import {
  AlertCircle,
  Check,
  Mic,
  MicOff,
  Sliders,
  Video,
  VideoOff,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { preferencesApi } from '@/services/preferencesApi';
import { classifyMediaDeviceError } from '@/utils/mediaDevices';

const AUDIO_LEVEL_BARS = [0.16, 0.32, 0.5, 0.7, 0.88];

function stopStreamTracks(stream: MediaStream | null): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      // ignore track cleanup error
    }
  }
}

export const PreCallStudioWidget: React.FC = () => {
  const { user, updateUserPreferences } = useAuth();

  const [audioMuted, setAudioMuted] = useState<boolean>(
    user?.preferences?.defaultAudioMuted ?? true
  );
  const [videoOff, setVideoOff] = useState<boolean>(
    user?.preferences?.defaultVideoOff ?? false
  );
  const [syncLabel, setSyncLabel] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const [isTesting, setIsTesting] = useState(false);
  const [isStartingTest, setIsStartingTest] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [micLevel, setMicLevel] = useState(0);
  const [cameraLabel, setCameraLabel] = useState<string | null>(null);
  const [micLabel, setMicLabel] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const testSessionSeqRef = useRef(0);

  // Sync authoritative preference values + seed knownFieldVersions on mount (prevents 409 conflict)
  useEffect(() => {
    mountedRef.current = true;
    let active = true;

    void (async () => {
      const remote = await preferencesApi.getPreferences();
      if (!active || !remote) return;
      setAudioMuted(remote.defaultAudioMuted);
      setVideoOff(remote.defaultVideoOff);
      updateUserPreferences({
        defaultAudioMuted: remote.defaultAudioMuted,
        defaultVideoOff: remote.defaultVideoOff,
      });
    })();

    return () => {
      active = false;
      mountedRef.current = false;
    };
  }, [user?.id, updateUserPreferences]);

  useEffect(() => {
    if (typeof user?.preferences?.defaultAudioMuted === 'boolean') {
      setAudioMuted(user.preferences.defaultAudioMuted);
    }
    if (typeof user?.preferences?.defaultVideoOff === 'boolean') {
      setVideoOff(user.preferences.defaultVideoOff);
    }
  }, [user?.preferences?.defaultAudioMuted, user?.preferences?.defaultVideoOff]);

  const stopStudioTest = useCallback(() => {
    testSessionSeqRef.current += 1;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    stopStreamTracks(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    if (mountedRef.current) {
      setIsTesting(false);
      setIsStartingTest(false);
      setMicLevel(0);
      setCameraLabel(null);
      setMicLabel(null);
    }
  }, []);

  useEffect(() => {
    const handlePageHide = () => stopStudioTest();
    window.addEventListener('beforeunload', handlePageHide);
    window.addEventListener('pagehide', handlePageHide);
    return () => {
      window.removeEventListener('beforeunload', handlePageHide);
      window.removeEventListener('pagehide', handlePageHide);
      mountedRef.current = false;
      stopStudioTest();
    };
  }, [stopStudioTest]);

  useEffect(() => {
    if (!isTesting || !videoRef.current || !streamRef.current) return;
    const hasVideo = streamRef.current.getVideoTracks().length > 0;
    if (hasVideo) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [isTesting, cameraLabel]);

  const handleToggleDefault = async (field: 'audio' | 'video') => {
    const prevAudio = audioMuted;
    const prevVideo = videoOff;
    const nextAudio = field === 'audio' ? !prevAudio : prevAudio;
    const nextVideo = field === 'video' ? !prevVideo : prevVideo;

    setAudioMuted(nextAudio);
    setVideoOff(nextVideo);
    updateUserPreferences({
      defaultAudioMuted: nextAudio,
      defaultVideoOff: nextVideo,
    });
    setSyncLabel('saving');

    const payload =
      field === 'audio'
        ? { defaultAudioMuted: nextAudio }
        : { defaultVideoOff: nextVideo };

    let res = await preferencesApi.updatePreferences(payload);
    if (!res.success && res.status === 409) {
      // Refresh field versions once and retry automatically
      await preferencesApi.getPreferences();
      res = await preferencesApi.updatePreferences(payload);
    }

    if (!mountedRef.current) return;

    if (res.success && res.data) {
      setAudioMuted(res.data.defaultAudioMuted);
      setVideoOff(res.data.defaultVideoOff);
      updateUserPreferences({
        defaultAudioMuted: res.data.defaultAudioMuted,
        defaultVideoOff: res.data.defaultVideoOff,
      });
      setSyncLabel('saved');
      setTimeout(() => {
        if (mountedRef.current) {
          setSyncLabel((cur) => (cur === 'saved' ? 'idle' : cur));
        }
      }, 2000);
    } else {
      // Revert optimistic state if server sync failed
      setAudioMuted(prevAudio);
      setVideoOff(prevVideo);
      updateUserPreferences({
        defaultAudioMuted: prevAudio,
        defaultVideoOff: prevVideo,
      });
      setSyncLabel('error');
    }
  };

  const handleStartStudioTest = async () => {
    if (isTesting || isStartingTest) {
      stopStudioTest();
      return;
    }

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setTestError('Browser media preview is unavailable in this environment.');
      return;
    }

    setTestError(null);
    setIsStartingTest(true);
    const seq = ++testSessionSeqRef.current;

    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      } catch (bothErr) {
        const classified = classifyMediaDeviceError(bothErr, 'camera');
        if (classified.code === 'PERMISSION_DENIED') {
          throw bothErr;
        }
        // Only fall back to single-device capture on missing/in-use/overconstrained hardware
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        }
      }

      if (!mountedRef.current || testSessionSeqRef.current !== seq) {
        stopStreamTracks(stream);
        return;
      }

      streamRef.current = stream;
      const vTrack = stream.getVideoTracks()[0];
      const aTrack = stream.getAudioTracks()[0];
      setCameraLabel(vTrack?.label || (vTrack ? 'Camera Active' : null));
      setMicLabel(aTrack?.label || (aTrack ? 'Default Microphone' : null));

      if (aTrack && typeof AudioContext !== 'undefined') {
        const audioCtx = new AudioContext();
        audioCtxRef.current = audioCtx;
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        const timeDomain = new Uint8Array(analyser.fftSize);
        let lastUiUpdateMs = 0;

        const tick = (nowMs: number) => {
          if (!mountedRef.current || testSessionSeqRef.current !== seq || !audioCtxRef.current) {
            return;
          }
          if (nowMs - lastUiUpdateMs >= 65) {
            lastUiUpdateMs = nowMs;
            analyser.getByteTimeDomainData(timeDomain);
            let sumSquares = 0;
            for (let i = 0; i < timeDomain.length; i += 1) {
              const centered = (timeDomain[i] - 128) / 128;
              sumSquares += centered * centered;
            }
            const rms = Math.sqrt(sumSquares / timeDomain.length);
            setMicLevel(Math.min(1, rms * 4.5));
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      }

      setIsTesting(true);
    } catch (err) {
      if (!mountedRef.current || testSessionSeqRef.current !== seq) {
        return;
      }
      const classified = classifyMediaDeviceError(err, 'camera');
      setTestError(classified.message);
      stopStudioTest();
    } finally {
      if (mountedRef.current && testSessionSeqRef.current === seq) {
        setIsStartingTest(false);
      }
    }
  };

  return (
    <Card className="p-5 bg-[#FAF9F6] dark:bg-[#1C1F24] border-[#DDDAD0] dark:border-[#2B3038] shadow-xs rounded-2xl flex flex-col">
      <div className="flex items-center justify-between pb-3 mb-3 border-b border-[#DDDAD0]/80 dark:border-[#2B3038]">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-[#E2ECE9] dark:bg-[#1F302E] text-[#2F6F68] dark:text-[#5FA399] flex items-center justify-center shrink-0">
            <Sliders className="w-3.5 h-3.5" aria-hidden="true" />
          </div>
          <h3 className="font-display text-sm font-bold text-[#1F2428] dark:text-[#EAECEE]">
            Pre-Call Studio
          </h3>
        </div>

        <button
          type="button"
          onClick={() => void handleStartStudioTest()}
          disabled={isStartingTest}
          className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors ${
            isTesting
              ? 'bg-[#F6E6E6] dark:bg-[#342023] text-[#C24D4D] dark:text-[#D46A6A]'
              : 'bg-[#E2ECE9] dark:bg-[#1F302E] text-[#2F6F68] dark:text-[#5FA399] hover:opacity-90'
          }`}
        >
          {isStartingTest ? 'Starting...' : isTesting ? 'Stop Test' : 'Test Cam & Mic'}
        </button>
      </div>

      {/* Synced Join Defaults */}
      <div className="grid grid-cols-2 gap-2.5">
        <button
          type="button"
          onClick={() => void handleToggleDefault('audio')}
          aria-pressed={audioMuted}
          className={`p-2.5 rounded-xl border text-left transition-colors flex items-center gap-2.5 ${
            audioMuted
              ? 'bg-[#F3F2EE] dark:bg-[#141619] border-[#DDDAD0] dark:border-[#2B3038]'
              : 'bg-[#E2ECE9]/60 dark:bg-[#1F302E]/60 border-[#2F6F68]/30 dark:border-[#5FA399]/35'
          }`}
        >
          <span
            className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
              audioMuted
                ? 'bg-[#EAE8E1] dark:bg-[#24282E] text-[#7C848D] dark:text-[#A3AAB2]'
                : 'bg-[#2F6F68] dark:bg-[#5FA399] text-[#FAF9F6] dark:text-[#141619]'
            }`}
          >
            {audioMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-bold text-[#1F2428] dark:text-[#EAECEE] truncate">
              Mic {audioMuted ? 'Muted' : 'Live'}
            </p>
            <p className="text-[10px] text-[#7C848D] dark:text-[#8E96A0] truncate">
              Join default
            </p>
          </div>
        </button>

        <button
          type="button"
          onClick={() => void handleToggleDefault('video')}
          aria-pressed={!videoOff}
          className={`p-2.5 rounded-xl border text-left transition-colors flex items-center gap-2.5 ${
            videoOff
              ? 'bg-[#F3F2EE] dark:bg-[#141619] border-[#DDDAD0] dark:border-[#2B3038]'
              : 'bg-[#E2ECE9]/60 dark:bg-[#1F302E]/60 border-[#2F6F68]/30 dark:border-[#5FA399]/35'
          }`}
        >
          <span
            className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
              videoOff
                ? 'bg-[#EAE8E1] dark:bg-[#24282E] text-[#7C848D] dark:text-[#A3AAB2]'
                : 'bg-[#2F6F68] dark:bg-[#5FA399] text-[#FAF9F6] dark:text-[#141619]'
            }`}
          >
            {videoOff ? <VideoOff className="w-3.5 h-3.5" /> : <Video className="w-3.5 h-3.5" />}
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-bold text-[#1F2428] dark:text-[#EAECEE] truncate">
              Camera {videoOff ? 'Off' : 'On'}
            </p>
            <p className="text-[10px] text-[#7C848D] dark:text-[#8E96A0] truncate">
              Join default
            </p>
          </div>
        </button>
      </div>

      {/* Sync Indicator */}
      {syncLabel !== 'idle' && (
        <div className="mt-2 flex items-center justify-end text-[10px] font-medium">
          {syncLabel === 'saving' && (
            <span className="text-[#7C848D] dark:text-[#8E96A0]">Syncing defaults...</span>
          )}
          {syncLabel === 'saved' && (
            <span className="text-[#2F6F68] dark:text-[#5FA399] inline-flex items-center gap-1">
              <Check className="w-3 h-3" />
              Synced to account
            </span>
          )}
          {syncLabel === 'error' && (
            <span className="text-[#C24D4D] dark:text-[#D46A6A]">Cloud sync unavailable</span>
          )}
        </div>
      )}

      {/* Optional On-Demand Hardware Preview */}
      {isTesting && (
        <div className="mt-3 p-3 rounded-xl bg-[#F3F2EE] dark:bg-[#141619] border border-[#DDDAD0] dark:border-[#2B3038] space-y-2.5">
          {cameraLabel ? (
            <div className="relative rounded-lg overflow-hidden bg-[#141619] aspect-video">
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                className="w-full h-full object-cover scale-x-[-1]"
              />
              <span className="absolute bottom-1.5 left-2 px-2 py-0.5 rounded bg-black/65 text-[10px] text-white truncate max-w-[85%]">
                {cameraLabel}
              </span>
            </div>
          ) : (
            <div className="py-3 px-2 rounded-lg bg-[#EAE8E1]/60 dark:bg-[#1C1F24] text-center text-[11px] text-[#646D77] dark:text-[#8E96A0]">
              Microphone-only preview active (no webcam detected)
            </div>
          )}

          {/* Live Mic Meter */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-[#555D66] dark:text-[#A3AAB2] truncate">
              {micLabel || 'Microphone'}
            </span>
            <div className="flex items-center gap-1" aria-label="Microphone audio level">
              {AUDIO_LEVEL_BARS.map((threshold, idx) => (
                <span
                  key={idx}
                  className={`w-1.5 h-3.5 rounded-full transition-colors ${
                    micLevel >= threshold
                      ? 'bg-[#2F6F68] dark:bg-[#5FA399]'
                      : 'bg-[#DDDAD0] dark:bg-[#2B3038]'
                  }`}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {testError && (
        <div
          role="alert"
          className="mt-3 p-2.5 rounded-xl bg-[#F6E6E6] dark:bg-[#342023] border border-[#D46A6A]/40 text-[11px] text-[#C24D4D] dark:text-[#D46A6A] flex items-start gap-2"
        >
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{testError}</span>
        </div>
      )}
    </Card>
  );
};
