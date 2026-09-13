export type DeviceKind = 'audioinput' | 'videoinput' | 'audiooutput';
export type PermissionState = 'granted' | 'denied' | 'prompt';

export interface DeviceInfo {
  deviceId: string;
  label: string;
  kind: DeviceKind;
}

export interface MediaResult {
  stream: MediaStream;
  devices: DeviceInfo[];
}

export type MediaErrorType = 'NotAllowedError' | 'NotFoundError' | 'NotReadableError' | 'OverconstrainedError' | 'SecurityError' | 'AbortError' | 'TypeError' | 'Unknown';

export interface MediaError {
  type: MediaErrorType;
  message: string;
  originalError: Error;
}

export function classifyMediaError(err: unknown): MediaError {
  const error = err as Error;
  if (!error || !error.name) {
    return {
      type: 'Unknown',
      message: 'An unknown media error occurred.',
      originalError: error instanceof Error ? error : new Error(String(error)),
    };
  }

  switch (error.name) {
    case 'NotAllowedError':
      return {
        type: 'NotAllowedError',
        message: 'Permission was denied. Allow microphone or camera access in your browser settings and try again.',
        originalError: error,
      };
    case 'PermissionDeniedError':
      return {
        type: 'NotAllowedError',
        message: 'Permission was denied. Allow microphone or camera access in your browser settings and try again.',
        originalError: error,
      };
    case 'NotFoundError':
      return {
        type: 'NotFoundError',
        message: 'No microphone or camera was detected. Connect a device and try again.',
        originalError: error,
      };
    case 'NotReadableError':
      return {
        type: 'NotReadableError',
        message: 'Your microphone or camera is being used by another application.',
        originalError: error,
      };
    case 'OverconstrainedError':
      return {
        type: 'OverconstrainedError',
        message: 'The requested device settings are not supported by your hardware.',
        originalError: error,
      };
    case 'SecurityError':
      return {
        type: 'SecurityError',
        message: 'Camera and microphone access requires HTTPS or localhost.',
        originalError: error,
      };
    case 'AbortError':
      return {
        type: 'AbortError',
        message: 'The media request was aborted.',
        originalError: error,
      };
    case 'TypeError':
      return {
        type: 'TypeError',
        message: 'Camera and microphone access requires HTTPS or localhost.',
        originalError: error,
      };
    default:
      return {
        type: 'Unknown',
        message: error.message || 'Failed to access media device.',
        originalError: error,
      };
  }
}

export async function checkMicrophonePermission(): Promise<PermissionState> {
  if (!navigator.permissions || !(navigator.permissions as any).query) {
    return 'prompt';
  }
  try {
    const result = await (navigator.permissions as any).query({ name: 'microphone' });
    return result.state as PermissionState;
  } catch {
    return 'prompt';
  }
}

export async function checkCameraPermission(): Promise<PermissionState> {
  if (!navigator.permissions || !(navigator.permissions as any).query) {
    return 'prompt';
  }
  try {
    const result = await (navigator.permissions as any).query({ name: 'camera' });
    return result.state as PermissionState;
  } catch {
    return 'prompt';
  }
}

export async function requestMicrophone(): Promise<MediaResult> {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('Camera and microphone access requires HTTPS or localhost.');
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const devices = await enumerateDevices();
  return { stream, devices };
}

export async function requestCamera(): Promise<MediaResult> {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('Camera and microphone access requires HTTPS or localhost.');
  }
  const stream = await navigator.mediaDevices.getUserMedia({ video: true });
  const devices = await enumerateDevices();
  return { stream, devices };
}

export async function requestMedia(audio: boolean, video: boolean): Promise<MediaResult> {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('Camera and microphone access requires HTTPS or localhost.');
  }
  const constraints: MediaStreamConstraints = {};
  if (audio) {
    (constraints as any).audio = true;
  }
  if (video) {
    (constraints as any).video = { width: { ideal: 1280 }, height: { ideal: 720 } };
  }
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  const devices = await enumerateDevices();
  return { stream, devices };
}

export function stopStream(stream: MediaStream | null): void {
  if (!stream) return;
  stream.getTracks().forEach((track) => track.stop());
}

export async function enumerateDevices(): Promise<DeviceInfo[]> {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
    return [];
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === 'audioinput' || d.kind === 'videoinput' || d.kind === 'audiooutput')
    .map((d) => ({
      deviceId: d.deviceId,
      label: d.label || `${d.kind === 'audioinput' ? 'Microphone' : d.kind === 'videoinput' ? 'Camera' : 'Speaker'}`,
      kind: d.kind as DeviceKind,
    }));
}

export function onDeviceChange(handler: () => void): () => void {
  if (!navigator.mediaDevices || !navigator.mediaDevices.addEventListener) {
    return () => {};
  }
  navigator.mediaDevices.addEventListener('devicechange', handler);
  return () => {
    navigator.mediaDevices?.removeEventListener('devicechange', handler);
  };
}

export function createMicAnalyser(stream: MediaStream) {
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  const audioCtx = new AudioContextClass();
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 128;
  analyser.smoothingTimeConstant = 0.4;
  const source = audioCtx.createMediaStreamSource(stream);
  source.connect(analyser);
  return { audioCtx, analyser };
}

export function getMicLevel(analyser: AnalyserNode): number {
  const timeData = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(timeData);
  let rmsSum = 0;
  for (let i = 0; i < timeData.length; i++) {
    const deviation = (timeData[i] - 128) / 128;
    rmsSum += deviation * deviation;
  }
  const rms = Math.sqrt(rmsSum / timeData.length);
  return Math.min(100, Math.round(rms * 300));
}

export function getAudioBars(analyser: AnalyserNode, count = 10): number[] {
  const freqData = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(freqData);
  const bars: number[] = [];
  const step = Math.max(1, Math.floor(freqData.length / count));
  for (let i = 0; i < count; i++) {
    const val = freqData[i * step] || 0;
    bars.push(Math.max(14, Math.min(100, Math.round((val / 255) * 100))));
  }
  return bars;
}
