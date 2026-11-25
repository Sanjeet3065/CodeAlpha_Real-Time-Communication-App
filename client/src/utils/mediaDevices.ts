import type { MediaDeviceOption, MediaPermissionState } from '../types/meeting.ts';

export interface ClassifiedMediaError {
  permission: MediaPermissionState;
  code:
    | 'PERMISSION_DENIED'
    | 'DEVICE_NOT_FOUND'
    | 'DEVICE_IN_USE'
    | 'OVERCONSTRAINED'
    | 'MEDIA_UNAVAILABLE'
    | 'MEDIA_ERROR';
  message: string;
}

/**
 * Feature-detects navigator.mediaDevices.getDisplayMedia() for screen sharing support.
 */
export function isScreenShareSupported(): boolean {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices) return false;
  return typeof navigator.mediaDevices.getDisplayMedia === 'function';
}

/**
 * Feature-detects HTMLMediaElement.prototype.setSinkId() for audio output device selection.
 * Never promises speaker selection on unsupported browsers (e.g., Safari / iOS / older Firefox).
 */
export function isAudioOutputSelectionSupported(): boolean {
  if (typeof HTMLMediaElement === 'undefined') return false;
  return typeof (HTMLMediaElement.prototype as HTMLMediaElement & { setSinkId?: unknown }).setSinkId === 'function';
}

/**
 * Deterministically maps an opaque CONNECTLY LiveKit identity (`usr_<24-hex>`)
 * back to the CONNECTLY user ID so LiveKit media state joins cleanly onto
 * CONNECTLY's authoritative participant roster.
 * Note: Matches alphanumeric session IDs `[a-z0-9]+` (e.g. 12-hex). Hyphenated UUIDs return null.
 */
export function parseLiveKitUserId(identity: string | undefined | null): string | null {
  if (!identity || typeof identity !== 'string') return null;
  const match = /^usr_([a-f0-9]{24})(?:_([a-z0-9]+))?$/i.exec(identity.trim());
  return match ? match[1].toLowerCase() : null;
}

/**
 * Classifies browser getUserMedia / LiveKit device acquisition errors into
 * honest, actionable user-facing messages and accurate permission states.
 */
export function classifyMediaDeviceError(
  err: unknown,
  deviceLabel: 'microphone' | 'camera' | 'audio output' | 'screen'
): ClassifiedMediaError {
  const errObj = err as { name?: string; message?: string } | null;
  const name = String(errObj?.name || '').toLowerCase();
  const msg = String(errObj?.message || (err instanceof Error ? err.message : '')).toLowerCase();
  const cap =
    deviceLabel === 'microphone'
      ? 'Microphone'
      : deviceLabel === 'camera'
        ? 'Camera'
        : deviceLabel === 'screen'
          ? 'Screen sharing'
          : 'Audio output';

  if (
    name === 'aborterror' ||
    msg.includes('cancelled') ||
    msg.includes('canceled') ||
    msg.includes('dismissed')
  ) {
    return {
      permission: 'prompt',
      code: 'PERMISSION_DENIED',
      message: 'Screen sharing selection was cancelled.',
    };
  }

  if (
    name === 'notallowederror' ||
    name === 'permissiondeniederror' ||
    name === 'securityerror' ||
    msg.includes('permission denied') ||
    msg.includes('not allowed') ||
    msg.includes('denied permission')
  ) {
    return {
      permission: 'denied',
      code: 'PERMISSION_DENIED',
      message:
        deviceLabel === 'screen'
          ? 'Screen sharing permission was denied. Allow screen capture in your browser settings to share your screen.'
          : `${cap} permission was denied. Allow ${deviceLabel} access in your browser site settings, then try again.`,
    };
  }

  if (
    name === 'notfounderror' ||
    name === 'devicesnotfounderror' ||
    msg.includes('requested device not found') ||
    msg.includes('no device') ||
    msg.includes('device not found')
  ) {
    return {
      permission: 'unavailable',
      code: 'DEVICE_NOT_FOUND',
      message: `No ${deviceLabel} device was found. Connect a ${deviceLabel} and retry.`,
    };
  }

  if (
    name === 'notreadableerror' ||
    name === 'trackstarterror' ||
    msg.includes('could not start') ||
    msg.includes('device in use') ||
    msg.includes('already in use') ||
    msg.includes('hardware error')
  ) {
    return {
      permission: 'unavailable',
      code: 'DEVICE_IN_USE',
      message: `${cap} is currently in use by another application or could not be started.`,
    };
  }

  if (name === 'overconstrainederror' || name === 'constraintnotsatisfiederror') {
    return {
      permission: 'prompt',
      code: 'OVERCONSTRAINED',
      message: `Selected ${deviceLabel} does not support the requested configuration. Try another device.`,
    };
  }

  if (msg.includes('mediadevices') && (msg.includes('undefined') || msg.includes('not supported'))) {
    return {
      permission: 'unavailable',
      code: 'MEDIA_UNAVAILABLE',
      message: `Browser media device APIs are unavailable in this context (HTTPS or localhost is required).`,
    };
  }

  return {
    permission: 'prompt',
    code: 'MEDIA_ERROR',
    message: `Unable to access ${deviceLabel}. Please check your device connection and browser permissions.`,
  };
}

export interface EnumeratedDeviceGroups {
  audioInputs: MediaDeviceOption[];
  videoInputs: MediaDeviceOption[];
  audioOutputs: MediaDeviceOption[];
  error: string | null;
}

/**
 * Safely enumerates available microphones, cameras, and speakers with readable
 * fallback labels when the browser masks hardware names prior to permission grant.
 */
export async function enumerateAvailableDevices(
  mediaDevicesObj?: Pick<MediaDevices, 'enumerateDevices'> | null
): Promise<EnumeratedDeviceGroups> {
  const md =
    mediaDevicesObj !== undefined
      ? mediaDevicesObj
      : typeof navigator !== 'undefined'
        ? navigator.mediaDevices
        : null;

  if (!md || typeof md.enumerateDevices !== 'function') {
    return {
      audioInputs: [],
      videoInputs: [],
      audioOutputs: [],
      error: 'Media device enumeration is unavailable in this browser context.',
    };
  }

  try {
    const raw = await md.enumerateDevices();
    const audioInputs: MediaDeviceOption[] = [];
    const videoInputs: MediaDeviceOption[] = [];
    const audioOutputs: MediaDeviceOption[] = [];

    for (const d of raw) {
      if (d.kind === 'audioinput') {
        const idx = audioInputs.length + 1;
        audioInputs.push({
          deviceId: d.deviceId || `audioinput-${idx}`,
          label: d.label?.trim() || `Microphone ${idx}`,
          kind: 'audioinput',
        });
      } else if (d.kind === 'videoinput') {
        const idx = videoInputs.length + 1;
        videoInputs.push({
          deviceId: d.deviceId || `videoinput-${idx}`,
          label: d.label?.trim() || `Camera ${idx}`,
          kind: 'videoinput',
        });
      } else if (d.kind === 'audiooutput') {
        const idx = audioOutputs.length + 1;
        audioOutputs.push({
          deviceId: d.deviceId || `audiooutput-${idx}`,
          label: d.label?.trim() || `Speaker ${idx}`,
          kind: 'audiooutput',
        });
      }
    }

    return { audioInputs, videoInputs, audioOutputs, error: null };
  } catch (err) {
    return {
      audioInputs: [],
      videoInputs: [],
      audioOutputs: [],
      error: err instanceof Error ? err.message : 'Unable to list media devices.',
    };
  }
}

export interface VideoGridLayoutSpec {
  gridClassName: string;
  tileAspectClassName: string;
  maxContainerClassName: string;
  tier: '1' | '2' | '3-4' | '5-6' | '7-9' | '10-12+';
}

/**
 * Computes responsive grid column and aspect-ratio classes adapted cleanly
 * across 1, 2, 3, 4, 5-6, 7-9, and 10-12+ participants on mobile, tablet, and desktop.
 */
export function computeVideoGridLayout(participantCount: number): VideoGridLayoutSpec {
  const count = Math.max(1, participantCount);

  if (count === 1) {
    return {
      tier: '1',
      gridClassName: 'grid-cols-1',
      tileAspectClassName: 'aspect-video max-h-[62vh]',
      maxContainerClassName: 'max-w-3xl mx-auto w-full',
    };
  }

  if (count === 2) {
    return {
      tier: '2',
      gridClassName: 'grid-cols-1 md:grid-cols-2',
      tileAspectClassName: 'aspect-video',
      maxContainerClassName: 'max-w-5xl mx-auto w-full',
    };
  }

  if (count <= 4) {
    return {
      tier: '3-4',
      gridClassName: 'grid-cols-1 sm:grid-cols-2',
      tileAspectClassName: 'aspect-video',
      maxContainerClassName: 'max-w-5xl mx-auto w-full',
    };
  }

  if (count <= 6) {
    return {
      tier: '5-6',
      gridClassName: 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-3',
      tileAspectClassName: 'aspect-video',
      maxContainerClassName: 'w-full',
    };
  }

  if (count <= 9) {
    return {
      tier: '7-9',
      gridClassName: 'grid-cols-2 md:grid-cols-3',
      tileAspectClassName: 'aspect-[4/3] sm:aspect-video',
      maxContainerClassName: 'w-full',
    };
  }

  return {
    tier: '10-12+',
    gridClassName: 'grid-cols-2 md:grid-cols-3 xl:grid-cols-4',
    tileAspectClassName: 'aspect-[4/3] sm:aspect-video',
    maxContainerClassName: 'w-full',
  };
}
