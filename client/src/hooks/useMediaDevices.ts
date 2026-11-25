import { useState, useEffect, useCallback, useRef } from 'react';
import {
  enumerateAvailableDevices,
  isAudioOutputSelectionSupported,
} from '@/utils/mediaDevices';
import type { DeviceInventorySnapshot } from '@/types/meeting';

interface UseMediaDevicesOptions {
  initialAudioInputId?: string;
  initialVideoInputId?: string;
  initialAudioOutputId?: string;
  onActiveDeviceRemoved?: (
    kind: 'audioinput' | 'videoinput',
    fallbackDeviceId?: string
  ) => void;
}

export function useMediaDevices(options: UseMediaDevicesOptions = {}) {
  const canSelectAudioOutput = isAudioOutputSelectionSupported();
  const [devices, setDevices] = useState<DeviceInventorySnapshot>({
    audioInputs: [],
    videoInputs: [],
    audioOutputs: [],
    selectedAudioInputId: options.initialAudioInputId || '',
    selectedVideoInputId: options.initialVideoInputId || '',
    selectedAudioOutputId: options.initialAudioOutputId || '',
    canSelectAudioOutput,
    isEnumerating: true,
    error: null,
  });

  const onRemovedRef = useRef(options.onActiveDeviceRemoved);
  useEffect(() => {
    onRemovedRef.current = options.onActiveDeviceRemoved;
  }, [options.onActiveDeviceRemoved]);

  const refreshDevices = useCallback(async (detectDisconnect = false) => {
    setDevices((prev) => ({ ...prev, isEnumerating: true, error: null }));
    const res = await enumerateAvailableDevices();

    let removedAudioFallback: string | undefined;
    let audioRemoved = false;
    let removedVideoFallback: string | undefined;
    let videoRemoved = false;

    setDevices((prev) => {
      let nextAudioIn = prev.selectedAudioInputId;
      let nextVideoIn = prev.selectedVideoInputId;
      let nextAudioOut = prev.selectedAudioOutputId;

      const audioExists =
        !nextAudioIn || res.audioInputs.some((d) => d.deviceId === nextAudioIn);
      if (!audioExists) {
        nextAudioIn = res.audioInputs[0]?.deviceId || '';
        if (detectDisconnect && prev.selectedAudioInputId) {
          audioRemoved = true;
          removedAudioFallback = nextAudioIn || undefined;
        }
      } else if (!nextAudioIn && res.audioInputs.length > 0) {
        nextAudioIn = res.audioInputs[0].deviceId;
      }

      const videoExists =
        !nextVideoIn || res.videoInputs.some((d) => d.deviceId === nextVideoIn);
      if (!videoExists) {
        nextVideoIn = res.videoInputs[0]?.deviceId || '';
        if (detectDisconnect && prev.selectedVideoInputId) {
          videoRemoved = true;
          removedVideoFallback = nextVideoIn || undefined;
        }
      } else if (!nextVideoIn && res.videoInputs.length > 0) {
        nextVideoIn = res.videoInputs[0].deviceId;
      }

      const outExists =
        !nextAudioOut || res.audioOutputs.some((d) => d.deviceId === nextAudioOut);
      if (!outExists) {
        nextAudioOut = res.audioOutputs[0]?.deviceId || '';
      } else if (!nextAudioOut && res.audioOutputs.length > 0) {
        nextAudioOut = res.audioOutputs[0].deviceId;
      }

      return {
        audioInputs: res.audioInputs,
        videoInputs: res.videoInputs,
        audioOutputs: res.audioOutputs,
        selectedAudioInputId: nextAudioIn,
        selectedVideoInputId: nextVideoIn,
        selectedAudioOutputId: nextAudioOut,
        canSelectAudioOutput,
        isEnumerating: false,
        error: res.error,
      };
    });

    if (audioRemoved) {
      onRemovedRef.current?.('audioinput', removedAudioFallback);
    }
    if (videoRemoved) {
      onRemovedRef.current?.('videoinput', removedVideoFallback);
    }
  }, [canSelectAudioOutput]);

  useEffect(() => {
    void refreshDevices(false);

    const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : null;
    if (!md || typeof md.addEventListener !== 'function') {
      return;
    }

    const handleDeviceChange = () => {
      void refreshDevices(true);
    };
    md.addEventListener('devicechange', handleDeviceChange);
    return () => {
      md.removeEventListener('devicechange', handleDeviceChange);
    };
  }, [refreshDevices]);

  const setSelectedDeviceId = useCallback(
    (kind: 'audioinput' | 'videoinput' | 'audiooutput', deviceId: string) => {
      setDevices((prev) => ({
        ...prev,
        ...(kind === 'audioinput' ? { selectedAudioInputId: deviceId } : {}),
        ...(kind === 'videoinput' ? { selectedVideoInputId: deviceId } : {}),
        ...(kind === 'audiooutput' ? { selectedAudioOutputId: deviceId } : {}),
      }));
    },
    []
  );

  return {
    devices,
    refreshDevices,
    setSelectedDeviceId,
  };
}
