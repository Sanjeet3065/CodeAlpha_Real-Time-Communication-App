import { useEffect, useRef, useState, useCallback } from 'react';
import { meetingApi } from '@/services/meetingApi';
import {
  LiveKitRoomController,
  createInitialLiveKitSnapshot,
  createInitialLiveKitMediaSnapshot,
} from '@/services/livekitClient';
import type {
  LiveKitConnectionSnapshot,
  LiveKitMediaSnapshot,
  PreJoinMediaChoice,
} from '@/types/meeting';

interface UseLiveKitConnectionOptions {
  meetingCode: string;
  enabled: boolean;
  initialMedia?: PreJoinMediaChoice;
  onVerifyAuthoritativeState?: () => Promise<boolean>;
}

export function useLiveKitConnection({
  meetingCode,
  enabled,
  initialMedia,
  onVerifyAuthoritativeState,
}: UseLiveKitConnectionOptions) {
  const [snapshot, setSnapshot] = useState<LiveKitConnectionSnapshot>(createInitialLiveKitSnapshot);
  const [media, setMedia] = useState<LiveKitMediaSnapshot>(() =>
    createInitialLiveKitMediaSnapshot(initialMedia)
  );
  const controllerRef = useRef<LiveKitRoomController | null>(null);
  const verifyRef = useRef(onVerifyAuthoritativeState);
  const initialMediaRef = useRef(initialMedia);

  useEffect(() => {
    verifyRef.current = onVerifyAuthoritativeState;
  }, [onVerifyAuthoritativeState]);

  useEffect(() => {
    initialMediaRef.current = initialMedia;
  }, [initialMedia]);

  useEffect(() => {
    if (!enabled || !meetingCode) {
      return;
    }

    // Strictly use only the authoritative livekitUrl returned by CONNECTLY's backend
    const controller = new LiveKitRoomController({
      meetingCode,
      initialMedia: initialMediaRef.current,
      fetchToken: (code) => meetingApi.getLiveKitToken(code),
      verifyAuthoritativeState: () =>
        verifyRef.current ? verifyRef.current() : Promise.resolve(true),
      onStateChange: (next) => setSnapshot(next),
      onMediaChange: (nextMedia) => setMedia(nextMedia),
    });

    controllerRef.current = controller;
    void controller.connect();

    // Ensure beforeunload cleanly stops local tracks and disconnects signaling on tab close
    const handleBeforeUnload = () => {
      void controller.dispose();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
      void controller.dispose();
    };
  }, [meetingCode, enabled]);

  const reconnect = useCallback(async () => {
    if (controllerRef.current) {
      await controllerRef.current.reconnect();
    }
  }, []);

  const disconnect = useCallback(
    async (reason: 'disconnected' | 'meeting_ended' | 'unauthorized' = 'disconnected') => {
      if (controllerRef.current) {
        await controllerRef.current.disconnect(reason);
      }
    },
    []
  );

  const toggleMic = useCallback(async (deviceId?: string): Promise<boolean> => {
    const controller = controllerRef.current;
    if (!controller) return false;
    const nextEnabled = !controller.getMediaSnapshot().localMicEnabled;
    return controller.setMicrophoneEnabled(nextEnabled, deviceId);
  }, []);

  const toggleCamera = useCallback(async (deviceId?: string): Promise<boolean> => {
    const controller = controllerRef.current;
    if (!controller) return false;
    const nextEnabled = !controller.getMediaSnapshot().localCameraEnabled;
    return controller.setCameraEnabled(nextEnabled, deviceId);
  }, []);

  const toggleScreenShare = useCallback(
    async (options?: { audio?: boolean }): Promise<boolean> => {
      const controller = controllerRef.current;
      if (!controller) return false;
      const nextEnabled = !controller.getMediaSnapshot().localScreenShareEnabled;
      return controller.setScreenShareEnabled(nextEnabled, options);
    },
    []
  );

  const switchDevice = useCallback(
    async (
      kind: 'audioinput' | 'videoinput' | 'audiooutput',
      deviceId: string
    ): Promise<boolean> => {
      const controller = controllerRef.current;
      if (!controller) return false;
      return controller.switchDevice(kind, deviceId);
    },
    []
  );

  const handleActiveDeviceDisconnected = useCallback(
    async (kind: 'audioinput' | 'videoinput', fallbackDeviceId?: string): Promise<void> => {
      if (controllerRef.current) {
        await controllerRef.current.handleActiveDeviceDisconnected(kind, fallbackDeviceId);
      }
    },
    []
  );

  const enableAudioPlayback = useCallback(async (): Promise<boolean> => {
    const controller = controllerRef.current;
    if (!controller) return false;
    return controller.startAudioPlayback();
  }, []);

  const clearMediaFeedback = useCallback(() => {
    controllerRef.current?.clearMediaFeedback();
  }, []);

  return {
    livekit: snapshot,
    media,
    toggleMic,
    toggleCamera,
    toggleScreenShare,
    switchDevice,
    handleActiveDeviceDisconnected,
    enableAudioPlayback,
    clearMediaFeedback,
    reconnectLiveKit: reconnect,
    disconnectLiveKit: disconnect,
  };
}
