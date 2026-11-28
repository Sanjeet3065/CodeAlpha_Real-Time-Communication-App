import { useState, useEffect, useRef, useCallback } from 'react';
import {
  createLocalAudioTrack,
  createLocalVideoTrack,
  VideoPresets,
  type LocalAudioTrack,
  type LocalVideoTrack,
} from 'livekit-client';
import { preferencesApi } from '@/services/preferencesApi';
import { classifyMediaDeviceError } from '@/utils/mediaDevices';
import { useMediaDevices } from './useMediaDevices';
import type { MediaPermissionState, PreJoinMediaChoice } from '@/types/meeting';

/**
 * Pure helper: converts a Web Audio analyser byte-frequency buffer (Uint8Array,
 * where 128 = silence) into a 0–100 mic-level percentage.
 * Safe to call in Node tests — no browser globals required.
 */
export function computeMicLevelPercent(dataArray: Uint8Array): number {
  if (dataArray.length === 0) return 0;
  let sumSquares = 0;
  for (let i = 0; i < dataArray.length; i++) {
    const deviation = (dataArray[i] - 128) / 128; // normalize ±1 around silence
    sumSquares += deviation * deviation;
  }
  const rms = Math.sqrt(sumSquares / dataArray.length);
  return Math.min(100, Math.round(rms * 100 * 3)); // scale and clamp to 0–100
}

/**
 * Local-only media preview controller for PreJoinLobbyPage.
 *
 * Guarantees:
 * - Acquires real local camera/microphone tracks via livekit-client ONLY for local preview.
 * - NEVER publishes media to any LiveKit room before the user enters the meeting.
 * - Initializes default mute/camera state from CONNECTLY cloud user preferences.
 * - Releases and stops all preview tracks cleanly on unmount, navigation, or `beforeunload`.
 */
export function usePreJoinMediaPreview() {
  const [micEnabled, setMicEnabled] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [micPermission, setMicPermission] = useState<MediaPermissionState>('prompt');
  const [cameraPermission, setCameraPermission] = useState<MediaPermissionState>('prompt');
  const [micError, setMicError] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [isBusyMic, setIsBusyMic] = useState(false);
  const [isBusyCamera, setIsBusyCamera] = useState(false);
  const [videoTrack, setVideoTrack] = useState<LocalVideoTrack | null>(null);
  const [audioAvailable, setAudioAvailable] = useState(false);

  const videoTrackRef = useRef<LocalVideoTrack | null>(null);
  const audioTrackRef = useRef<LocalAudioTrack | null>(null);
  const mountedRef = useRef(true);
  const videoOpCounterRef = useRef(0);
  const audioOpCounterRef = useRef(0);

  const stopVideoPreview = useCallback(() => {
    const existing = videoTrackRef.current;
    videoTrackRef.current = null;
    if (existing) {
      try {
        existing.stop();
      } catch {
        // ignore stop error
      }
    }
    if (mountedRef.current) {
      setVideoTrack(null);
    }
  }, []);

  const stopAudioPreview = useCallback(() => {
    const existing = audioTrackRef.current;
    audioTrackRef.current = null;
    if (existing) {
      try {
        existing.stop();
      } catch {
        // ignore stop error
      }
    }
  }, []);

  const releaseAllPreviewTracks = useCallback(() => {
    videoOpCounterRef.current += 1;
    audioOpCounterRef.current += 1;
    stopVideoPreview();
    stopAudioPreview();
  }, [stopVideoPreview, stopAudioPreview]);

  const { devices, refreshDevices, setSelectedDeviceId } = useMediaDevices({
    onActiveDeviceRemoved: (kind, fallbackId) => {
      if (kind === 'videoinput' && videoTrackRef.current) {
        if (fallbackId) {
          void startCameraPreview(fallbackId);
        } else {
          stopVideoPreview();
          setCameraEnabled(false);
          setCameraPermission('unavailable');
          setCameraError('Active camera was disconnected.');
        }
      }
      if (kind === 'audioinput' && audioTrackRef.current) {
        if (fallbackId) {
          void startMicPreview(fallbackId);
        } else {
          stopAudioPreview();
          setMicEnabled(false);
          setAudioAvailable(false);
          setMicPermission('unavailable');
          setMicError('Active microphone was disconnected.');
        }
      }
    },
  });

  const startCameraPreview = useCallback(
    async (deviceId?: string): Promise<boolean> => {
      const opId = ++videoOpCounterRef.current;
      setIsBusyCamera(true);
      setCameraError(null);
      stopVideoPreview();

      try {
        const track = await createLocalVideoTrack({
          ...(deviceId ? { deviceId } : {}),
          resolution: VideoPresets.h720.resolution,
        });
        if (!mountedRef.current || opId !== videoOpCounterRef.current) {
          track.stop();
          return false;
        }
        videoTrackRef.current = track;
        setVideoTrack(track);
        setCameraEnabled(true);
        setCameraPermission('granted');
        if (deviceId) {
          setSelectedDeviceId('videoinput', deviceId);
        }
        void refreshDevices(false);
        return true;
      } catch (err) {
        if (!mountedRef.current || opId !== videoOpCounterRef.current) return false;
        const classified = classifyMediaDeviceError(err, 'camera');
        setCameraEnabled(false);
        setCameraPermission(classified.permission);
        setCameraError(classified.message);
        return false;
      } finally {
        if (mountedRef.current && opId === videoOpCounterRef.current) {
          setIsBusyCamera(false);
        }
      }
    },
    [stopVideoPreview, setSelectedDeviceId, refreshDevices]
  );

  const startMicPreview = useCallback(
    async (deviceId?: string): Promise<boolean> => {
      const opId = ++audioOpCounterRef.current;
      setIsBusyMic(true);
      setMicError(null);
      stopAudioPreview();

      try {
        const track = await createLocalAudioTrack({
          ...(deviceId ? { deviceId } : {}),
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        });
        if (!mountedRef.current || opId !== audioOpCounterRef.current) {
          track.stop();
          return false;
        }
        audioTrackRef.current = track;
        setMicEnabled(true);
        setAudioAvailable(true);
        setMicPermission('granted');
        if (deviceId) {
          setSelectedDeviceId('audioinput', deviceId);
        }
        void refreshDevices(false);
        return true;
      } catch (err) {
        if (!mountedRef.current || opId !== audioOpCounterRef.current) return false;
        const classified = classifyMediaDeviceError(err, 'microphone');
        setMicEnabled(false);
        setAudioAvailable(false);
        setMicPermission(classified.permission);
        setMicError(classified.message);
        return false;
      } finally {
        if (mountedRef.current && opId === audioOpCounterRef.current) {
          setIsBusyMic(false);
        }
      }
    },
    [stopAudioPreview, setSelectedDeviceId, refreshDevices]
  );

  // Initialize defaults from CONNECTLY persisted cloud preferences
  useEffect(() => {
    mountedRef.current = true;
    let active = true;

    const init = async () => {
      setIsInitializing(true);
      const prefs = await preferencesApi.getPreferences().catch(() => null);
      if (!active || !mountedRef.current) return;

      const wantMic = prefs ? !prefs.defaultAudioMuted : false;
      const wantCam = prefs ? !prefs.defaultVideoOff : true;

      if (wantCam) {
        await startCameraPreview();
      } else {
        setCameraEnabled(false);
      }

      if (!active || !mountedRef.current) return;

      if (wantMic) {
        await startMicPreview();
      } else {
        setMicEnabled(false);
      }

      if (active && mountedRef.current) {
        setIsInitializing(false);
      }
    };

    void init();

    const handleBeforeUnload = () => {
      releaseAllPreviewTracks();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      active = false;
      mountedRef.current = false;
      window.removeEventListener('beforeunload', handleBeforeUnload);
      releaseAllPreviewTracks();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleCamera = useCallback(async () => {
    if (isBusyCamera) return;
    if (cameraEnabled) {
      videoOpCounterRef.current += 1;
      stopVideoPreview();
      setCameraEnabled(false);
      setCameraError(null);
    } else {
      await startCameraPreview(devices.selectedVideoInputId || undefined);
    }
  }, [isBusyCamera, cameraEnabled, stopVideoPreview, startCameraPreview, devices.selectedVideoInputId]);

  const toggleMic = useCallback(async () => {
    if (isBusyMic) return;
    if (micEnabled) {
      audioOpCounterRef.current += 1;
      stopAudioPreview();
      setMicEnabled(false);
      setMicError(null);
    } else {
      await startMicPreview(devices.selectedAudioInputId || undefined);
    }
  }, [isBusyMic, micEnabled, stopAudioPreview, startMicPreview, devices.selectedAudioInputId]);

  const selectCameraDevice = useCallback(
    async (deviceId: string) => {
      setSelectedDeviceId('videoinput', deviceId);
      if (cameraEnabled) {
        await startCameraPreview(deviceId);
      }
    },
    [setSelectedDeviceId, cameraEnabled, startCameraPreview]
  );

  const selectMicDevice = useCallback(
    async (deviceId: string) => {
      setSelectedDeviceId('audioinput', deviceId);
      if (micEnabled) {
        await startMicPreview(deviceId);
      }
    },
    [setSelectedDeviceId, micEnabled, startMicPreview]
  );

  const retryPermissions = useCallback(async () => {
    setCameraError(null);
    setMicError(null);
    await startCameraPreview(devices.selectedVideoInputId || undefined);
    await startMicPreview(devices.selectedAudioInputId || undefined);
  }, [startCameraPreview, startMicPreview, devices.selectedVideoInputId, devices.selectedAudioInputId]);

  const getMediaChoice = useCallback((): PreJoinMediaChoice => {
    return {
      micEnabled,
      cameraEnabled,
      ...(devices.selectedAudioInputId ? { audioInputDeviceId: devices.selectedAudioInputId } : {}),
      ...(devices.selectedVideoInputId ? { videoInputDeviceId: devices.selectedVideoInputId } : {}),
      ...(devices.selectedAudioOutputId ? { audioOutputDeviceId: devices.selectedAudioOutputId } : {}),
    };
  }, [
    micEnabled,
    cameraEnabled,
    devices.selectedAudioInputId,
    devices.selectedVideoInputId,
    devices.selectedAudioOutputId,
  ]);

  // ── Live mic level meter via AudioContext + AnalyserNode ──────────────────
  const [micLevel, setMicLevel] = useState(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!micEnabled || !audioTrackRef.current) {
      setMicLevel(0);
      return;
    }

    let active = true;

    const startAnalyser = async () => {
      try {
        const mediaStream = new MediaStream([audioTrackRef.current!.mediaStreamTrack]);
        const AudioCtx = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
        const ctx = new AudioCtx();
        audioCtxRef.current = ctx;
        const source = ctx.createMediaStreamSource(mediaStream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(analyser);
        analyserRef.current = analyser;

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          if (!active) return;
          analyser.getByteTimeDomainData(dataArray);
          setMicLevel(computeMicLevelPercent(dataArray));
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      } catch {
        // AudioContext unsupported or permission denied — degrade gracefully
        setMicLevel(0);
      }
    };

    void startAnalyser();

    return () => {
      active = false;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (audioCtxRef.current) {
        try { void audioCtxRef.current.close(); } catch { /* ignore */ }
        audioCtxRef.current = null;
      }
      analyserRef.current = null;
      setMicLevel(0);
    };
  }, [micEnabled]);

  /** Select the speaker (audio output) device by deviceId. */
  const selectSpeakerDevice = useCallback(
    (deviceId: string) => {
      setSelectedDeviceId('audiooutput', deviceId);
    },
    [setSelectedDeviceId]
  );

  return {
    videoTrack,
    micEnabled,
    cameraEnabled,
    audioAvailable,
    micPermission,
    cameraPermission,
    micError,
    cameraError,
    isInitializing,
    isBusyMic,
    isBusyCamera,
    micLevel,
    devices,
    toggleMic,
    toggleCamera,
    selectMicDevice,
    selectCameraDevice,
    selectSpeakerDevice,
    retryPermissions,
    refreshDevices,
    releaseAllPreviewTracks,
    getMediaChoice,
  };
}
