import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyMediaDeviceError,
  computeVideoGridLayout,
  enumerateAvailableDevices,
  isAudioOutputSelectionSupported,
  isScreenShareSupported,
  parseLiveKitUserId,
} from './mediaDevices.ts';

describe('Phase 10 Media Devices, Error Classification & Grid Layout Utilities', () => {
  it('1. parseLiveKitUserId maps opaque usr_<24-hex> identities cleanly and rejects invalid formats', () => {
    assert.strictEqual(
      parseLiveKitUserId('usr_65f0a1b2c3d4e5f6a7b8c9e2'),
      '65f0a1b2c3d4e5f6a7b8c9e2'
    );
    assert.strictEqual(
      parseLiveKitUserId('usr_65F0A1B2C3D4E5F6A7B8C9E2'),
      '65f0a1b2c3d4e5f6a7b8c9e2'
    );
    assert.strictEqual(
      parseLiveKitUserId('usr_65f0a1b2c3d4e5f6a7b8c9e2_a1b2c3d4e5f6'),
      '65f0a1b2c3d4e5f6a7b8c9e2',
      'Should parse 24-hex userId from session-scoped identity'
    );
    assert.strictEqual(parseLiveKitUserId('user@example.com'), null);
    assert.strictEqual(parseLiveKitUserId('usr_short'), null);
    assert.strictEqual(parseLiveKitUserId(''), null);
    assert.strictEqual(parseLiveKitUserId(null), null);
  });

  it('2. classifyMediaDeviceError maps permission denied, missing device, in-use, and overconstrained errors honestly', () => {
    const denied = classifyMediaDeviceError(
      Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }),
      'camera'
    );
    assert.strictEqual(denied.permission, 'denied');
    assert.strictEqual(denied.code, 'PERMISSION_DENIED');
    assert.match(denied.message, /Camera permission was denied/i);

    const notFound = classifyMediaDeviceError(
      Object.assign(new Error('Requested device not found'), { name: 'NotFoundError' }),
      'microphone'
    );
    assert.strictEqual(notFound.permission, 'unavailable');
    assert.strictEqual(notFound.code, 'DEVICE_NOT_FOUND');
    assert.match(notFound.message, /No microphone device was found/i);

    const inUse = classifyMediaDeviceError(
      Object.assign(new Error('Could not start video source'), { name: 'NotReadableError' }),
      'camera'
    );
    assert.strictEqual(inUse.permission, 'unavailable');
    assert.strictEqual(inUse.code, 'DEVICE_IN_USE');
    assert.match(inUse.message, /currently in use/i);

    const overconstrained = classifyMediaDeviceError(
      Object.assign(new Error('Constraints not satisfied'), { name: 'OverconstrainedError' }),
      'camera'
    );
    assert.strictEqual(overconstrained.code, 'OVERCONSTRAINED');
  });

  it('3. enumerateAvailableDevices groups audioinput, videoinput, and audiooutput with fallback labels and handles errors', async () => {
    const grouped = await enumerateAvailableDevices({
      enumerateDevices: async () =>
        [
          { deviceId: 'mic-1', kind: 'audioinput', label: 'USB Studio Mic', groupId: 'g1', toJSON: () => ({}) },
          { deviceId: 'mic-2', kind: 'audioinput', label: '', groupId: 'g2', toJSON: () => ({}) },
          { deviceId: 'cam-1', kind: 'videoinput', label: 'HD Webcam', groupId: 'g3', toJSON: () => ({}) },
          { deviceId: 'spk-1', kind: 'audiooutput', label: '', groupId: 'g4', toJSON: () => ({}) },
        ] as MediaDeviceInfo[],
    });

    assert.strictEqual(grouped.error, null);
    assert.strictEqual(grouped.audioInputs.length, 2);
    assert.strictEqual(grouped.audioInputs[0].label, 'USB Studio Mic');
    assert.strictEqual(grouped.audioInputs[1].label, 'Microphone 2');
    assert.strictEqual(grouped.videoInputs.length, 1);
    assert.strictEqual(grouped.videoInputs[0].label, 'HD Webcam');
    assert.strictEqual(grouped.audioOutputs.length, 1);
    assert.strictEqual(grouped.audioOutputs[0].label, 'Speaker 1');

    // Unavailable mediaDevices context handled gracefully
    const noApi = await enumerateAvailableDevices(null);
    assert.strictEqual(noApi.audioInputs.length, 0);
    assert.ok(noApi.error);

    // Enumeration rejection handled gracefully
    const failed = await enumerateAvailableDevices({
      enumerateDevices: async () => {
        throw new Error('Hardware enumeration failed');
      },
    });
    assert.strictEqual(failed.audioInputs.length, 0);
    assert.match(failed.error || '', /Hardware enumeration failed/);
  });

  it('4. computeVideoGridLayout scales cleanly across 1, 2, 3, 4, 5-6, 7-9, and 10-12 participants', () => {
    assert.strictEqual(computeVideoGridLayout(1).tier, '1');
    assert.strictEqual(computeVideoGridLayout(2).tier, '2');
    assert.strictEqual(computeVideoGridLayout(3).tier, '3-4');
    assert.strictEqual(computeVideoGridLayout(4).tier, '3-4');
    assert.strictEqual(computeVideoGridLayout(5).tier, '5-6');
    assert.strictEqual(computeVideoGridLayout(6).tier, '5-6');
    assert.strictEqual(computeVideoGridLayout(7).tier, '7-9');
    assert.strictEqual(computeVideoGridLayout(9).tier, '7-9');
    assert.strictEqual(computeVideoGridLayout(10).tier, '10-12+');
    assert.strictEqual(computeVideoGridLayout(12).tier, '10-12+');
  });

  it('5. isAudioOutputSelectionSupported safely returns false in non-DOM/unsupported environments', () => {
    assert.strictEqual(typeof isAudioOutputSelectionSupported(), 'boolean');
    assert.strictEqual(isAudioOutputSelectionSupported(), false);
  });

  it('6. isScreenShareSupported safely returns false in non-DOM/unsupported environments', () => {
    assert.strictEqual(typeof isScreenShareSupported(), 'boolean');
    assert.strictEqual(isScreenShareSupported(), false);
  });

  it('7. classifyMediaDeviceError handles screen sharing cancellation and permission denied cleanly', () => {
    const cancelled = classifyMediaDeviceError(
      Object.assign(new Error('User cancelled screen selection'), { name: 'AbortError' }),
      'screen'
    );
    assert.strictEqual(cancelled.permission, 'prompt');
    assert.strictEqual(cancelled.code, 'PERMISSION_DENIED');
    assert.match(cancelled.message, /cancelled/i);

    const denied = classifyMediaDeviceError(
      Object.assign(new Error('Permission denied by user'), { name: 'NotAllowedError' }),
      'screen'
    );
    assert.strictEqual(denied.permission, 'denied');
    assert.strictEqual(denied.code, 'PERMISSION_DENIED');
    assert.match(denied.message, /Screen sharing permission was denied/i);
  });
});
