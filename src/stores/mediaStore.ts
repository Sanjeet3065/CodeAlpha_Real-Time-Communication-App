import { create } from 'zustand';
import { requestMedia, enumerateDevices, type DeviceInfo } from '@/lib/mediaDevices';

interface MediaStoreState {
  stream: MediaStream | null;
  micOn: boolean;
  cameraOn: boolean;
  isInitialized: boolean;
  isRequesting: boolean;
  error: string | null;
  devices: DeviceInfo[];
  initAutoMedia: () => Promise<MediaStream | null>;
  setStream: (stream: MediaStream | null) => void;
  toggleMic: () => Promise<boolean>;
  toggleCamera: () => Promise<boolean>;
  getLiveStream: () => MediaStream | null;
}

declare global {
  interface Window {
    __connectlyGlobalStream?: MediaStream | null;
  }
}

export const useMediaStore = create<MediaStoreState>((set, get) => ({
  stream: null,
  micOn: true,
  cameraOn: true,
  isInitialized: false,
  isRequesting: false,
  error: null,
  devices: [],

  getLiveStream: () => {
    const s = get().stream || window.__connectlyGlobalStream;
    if (s && s.getTracks().some((t) => t.readyState === 'live')) {
      return s;
    }
    return null;
  },

  setStream: (stream) => {
    window.__connectlyGlobalStream = stream;
    set({ stream });
  },

  initAutoMedia: async () => {
    const existing = get().getLiveStream();
    if (existing) {
      set({ stream: existing, isInitialized: true });
      return existing;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      set({ error: 'MediaDevices API not available (requires HTTPS or localhost).' });
      return null;
    }

    set({ isRequesting: true, error: null });

    let newStream: MediaStream | null = null;
    try {
      // 1. Try requesting both Microphone and Camera together
      const res = await requestMedia(true, true);
      newStream = res.stream;
    } catch (err: any) {
      console.warn('Simultaneous mic & camera request failed, trying individually:', err);
      // 2. Fallback: try audio only or video only if one device is missing
      try {
        const audioRes = await navigator.mediaDevices.getUserMedia({ audio: true });
        newStream = audioRes;
      } catch (aErr) {
        console.warn('Audio-only request failed:', aErr);
      }

      try {
        const videoRes = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        });
        if (newStream) {
          videoRes.getVideoTracks().forEach((vt) => newStream!.addTrack(vt));
        } else {
          newStream = videoRes;
        }
      } catch (vErr) {
        console.warn('Video-only request failed:', vErr);
      }
    }

    if (newStream) {
      const { micOn, cameraOn } = get();
      newStream.getAudioTracks().forEach((t) => (t.enabled = micOn));
      newStream.getVideoTracks().forEach((t) => (t.enabled = cameraOn));

      window.__connectlyGlobalStream = newStream;
      let devices: DeviceInfo[] = [];
      try {
        devices = await enumerateDevices();
      } catch (devErr) {
        console.warn('Failed to enumerate devices:', devErr);
      }

      set({
        stream: newStream,
        isInitialized: true,
        isRequesting: false,
        error: null,
        devices,
      });
      return newStream;
    } else {
      set({
        isInitialized: true,
        isRequesting: false,
        error: 'Unable to start camera or microphone automatically.',
      });
      return null;
    }
  },

  toggleMic: async () => {
    const state = get();
    const nextState = !state.micOn;
    let s = state.getLiveStream();

    if (nextState) {
      // If turning ON and audio track is missing or ended, acquire new track
      const hasLiveAudio = s?.getAudioTracks().some((t) => t.readyState === 'live');
      if (!hasLiveAudio) {
        try {
          const micRes = await navigator.mediaDevices.getUserMedia({ audio: true });
          const newAudioTrack = micRes.getAudioTracks()[0];
          if (newAudioTrack) {
            if (!s) {
              s = new MediaStream([newAudioTrack]);
              window.__connectlyGlobalStream = s;
              set({ stream: s });
            } else {
              s.addTrack(newAudioTrack);
            }
          }
        } catch (e) {
          console.error('Failed to acquire audio track:', e);
          return state.micOn;
        }
      }
    }

    if (s) {
      s.getAudioTracks().forEach((t) => (t.enabled = nextState));
    }
    set({ micOn: nextState });
    return nextState;
  },

  toggleCamera: async () => {
    const state = get();
    const nextState = !state.cameraOn;
    let s = state.getLiveStream();

    if (nextState) {
      // If turning ON and video track is missing or ended, acquire new track
      const hasLiveVideo = s?.getVideoTracks().some((t) => t.readyState === 'live');
      if (!hasLiveVideo) {
        try {
          const camRes = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
          });
          const newVideoTrack = camRes.getVideoTracks()[0];
          if (newVideoTrack) {
            if (!s) {
              s = new MediaStream([newVideoTrack]);
              window.__connectlyGlobalStream = s;
              set({ stream: s });
            } else {
              s.addTrack(newVideoTrack);
            }
          }
        } catch (e) {
          console.error('Failed to acquire video track:', e);
          return state.cameraOn;
        }
      }
    }

    if (s) {
      s.getVideoTracks().forEach((t) => (t.enabled = nextState));
    }
    set({ cameraOn: nextState });
    return nextState;
  },
}));
