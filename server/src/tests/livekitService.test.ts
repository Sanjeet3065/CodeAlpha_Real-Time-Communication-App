import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TokenVerifier } from 'livekit-server-sdk';
import {
  LiveKitService,
  getLiveKitRoomName,
  getLiveKitParticipantIdentity,
  parseLiveKitRoomMeetingId,
  parseLiveKitParticipantUserId,
  shouldUseLiveKitSignalGateway,
  toLiveKitHttpUrl,
  toLiveKitWsUrl,
  validateLiveKitConfig,
  type LiveKitRoomClientAdapter,
} from '../services/livekit.service.js';

const TEST_MEETING_ID = '65f0a1b2c3d4e5f6a7b8c9d0';
const TEST_MEETING_ID_2 = '65f0a1b2c3d4e5f6a7b8c9d1';
const TEST_USER_ID = '65f0a1b2c3d4e5f6a7b8c9e2';
const TEST_API_KEY = 'APIconnectlyTestKey01';
const TEST_API_SECRET = 'SuperSecureLiveKitTestSecretKeyForPhase09UnitTests123456';

function createStubRoomClient(overrides?: Partial<LiveKitRoomClientAdapter>): {
  adapter: LiveKitRoomClientAdapter;
  calls: { createRoom: any[]; removeParticipant: any[]; deleteRoom: any[] };
} {
  const calls = { createRoom: [] as any[], removeParticipant: [] as any[], deleteRoom: [] as any[] };
  const adapter: LiveKitRoomClientAdapter = {
    createRoom:
      overrides?.createRoom ??
      (async (opts) => {
        calls.createRoom.push(opts);
        return { name: opts.name };
      }),
    removeParticipant:
      overrides?.removeParticipant ??
      (async (room, identity, options) => {
        calls.removeParticipant.push({ room, identity, options });
      }),
    deleteRoom:
      overrides?.deleteRoom ??
      (async (room) => {
        calls.deleteRoom.push(room);
      }),
  };
  return { adapter, calls };
}

describe('Phase 09 Backend LiveKit Service Unit Suite', () => {
  it('1. validateLiveKitConfig enforces required fields, URL schemes, production wss://, and rejects placeholders', () => {
    assert.strictEqual(validateLiveKitConfig({}, 'development').valid, false);
    assert.strictEqual(
      validateLiveKitConfig(
        { url: 'not-a-url', apiKey: TEST_API_KEY, apiSecret: TEST_API_SECRET },
        'development'
      ).valid,
      false
    );

    // Production MUST reject insecure ws:// and placeholder/dev credentials
    assert.strictEqual(
      validateLiveKitConfig(
        { url: 'ws://127.0.0.1:7880', apiKey: TEST_API_KEY, apiSecret: TEST_API_SECRET },
        'production'
      ).valid,
      false
    );
    assert.strictEqual(
      validateLiveKitConfig(
        { url: 'wss://livekit.connectly.io', apiKey: 'devkey', apiSecret: 'secret' },
        'production'
      ).valid,
      false
    );
    assert.strictEqual(
      validateLiveKitConfig(
        {
          url: 'wss://livekit.connectly.io',
          apiKey: 'replace_with_key',
          apiSecret: TEST_API_SECRET,
        },
        'production'
      ).valid,
      false
    );

    // Valid production config passes
    const prodOk = validateLiveKitConfig(
      {
        url: 'wss://livekit.connectly.io',
        apiKey: TEST_API_KEY,
        apiSecret: TEST_API_SECRET,
        tokenTtlSeconds: 600,
      },
      'production'
    );
    assert.strictEqual(prodOk.valid, true);
    if (prodOk.valid) {
      assert.strictEqual(prodOk.resolved.url, 'wss://livekit.connectly.io');
      assert.strictEqual(prodOk.resolved.tokenTtlSeconds, 600);
    }

    // URL scheme conversions
    assert.strictEqual(toLiveKitHttpUrl('ws://127.0.0.1:7880/'), 'http://127.0.0.1:7880');
    assert.strictEqual(toLiveKitHttpUrl('wss://example.livekit.cloud/'), 'https://example.livekit.cloud');
    assert.strictEqual(toLiveKitWsUrl('https://example.livekit.cloud/'), 'wss://example.livekit.cloud');
  });

  it('2. getLiveKitRoomName & getLiveKitParticipantIdentity produce deterministic opaque non-PII identifiers', () => {
    const r1 = getLiveKitRoomName(TEST_MEETING_ID);
    const r1Again = getLiveKitRoomName(TEST_MEETING_ID);
    const r2 = getLiveKitRoomName(TEST_MEETING_ID_2);

    assert.strictEqual(r1, `cly_room_${TEST_MEETING_ID}`);
    assert.strictEqual(r1, r1Again);
    assert.notStrictEqual(r1, r2);

    const id = getLiveKitParticipantIdentity(TEST_USER_ID);
    assert.strictEqual(id, `usr_${TEST_USER_ID}`);
    assert.ok(!id.includes('@'), 'Identity must never contain email addresses');

    assert.throws(() => getLiveKitRoomName('not-an-objectid'));
    assert.throws(() => getLiveKitParticipantIdentity('user@example.com'));
  });

  it('3. generateParticipantToken signs a short-lived JWT with strict Phase 10 least-privilege camera/mic grants', async () => {
    const { adapter, calls } = createStubRoomClient();
    const svc = new LiveKitService({
      config: {
        url: 'ws://127.0.0.1:7880',
        apiKey: TEST_API_KEY,
        apiSecret: TEST_API_SECRET,
        tokenTtlSeconds: 600,
      },
      nodeEnv: 'development',
      roomClientFactory: () => adapter,
    });

    const bundle = await svc.generateParticipantToken({
      meetingId: TEST_MEETING_ID,
      userId: TEST_USER_ID,
      displayName: 'Elena Host',
      role: 'host',
      maxParticipants: 60,
    });

    assert.strictEqual(calls.createRoom.length, 1);
    assert.strictEqual(bundle.livekitUrl, 'ws://127.0.0.1:7880');
    assert.strictEqual(bundle.roomName, `cly_room_${TEST_MEETING_ID}`);
    assert.strictEqual(bundle.participantIdentity, `usr_${TEST_USER_ID}`);
    assert.strictEqual(bundle.ttlSeconds, 600);
    assert.deepStrictEqual(bundle.permissions, {
      roomJoin: true,
      canPublish: true,
      canPublishSources: ['camera', 'microphone', 'screen_share', 'screen_share_audio'],
      canSubscribe: true,
      canPublishData: false,
    });

    // Cryptographically verify the issued JWT using LiveKit's official TokenVerifier
    const verifier = new TokenVerifier(TEST_API_KEY, TEST_API_SECRET);
    const claims = await verifier.verify(bundle.token);

    assert.strictEqual(claims.sub, `usr_${TEST_USER_ID}`);
    assert.strictEqual(claims.name, 'Elena Host');
    assert.strictEqual(claims.video?.roomJoin, true);
    assert.strictEqual(claims.video?.room, `cly_room_${TEST_MEETING_ID}`);
    assert.strictEqual(claims.video?.canPublish, true);
    assert.deepStrictEqual(claims.video?.canPublishSources, [
      'camera',
      'microphone',
      'screen_share',
      'screen_share_audio',
    ]);
    assert.strictEqual(claims.video?.canSubscribe, true);
    assert.strictEqual(claims.video?.canPublishData, false);
    assert.strictEqual(claims.video?.roomAdmin, false);
    assert.strictEqual(claims.video?.roomCreate, false);
    assert.strictEqual(claims.video?.roomList, false);
    assert.strictEqual(claims.video?.roomRecord, false);
    assert.ok(claims.exp && claims.nbf, 'LiveKit JWT must include exp and nbf claims');
    assert.strictEqual(claims.exp - claims.nbf, 600);
  });

  it('4. Missing configuration throws 503 LIVEKIT_NOT_CONFIGURED and never switches to mock mode', async () => {
    const svc = new LiveKitService({
      config: { url: '', apiKey: '', apiSecret: '', tokenTtlSeconds: 600 },
      nodeEnv: 'development',
    });

    assert.strictEqual(svc.isConfigured(), false);
    await assert.rejects(
      () =>
        svc.generateParticipantToken({
          meetingId: TEST_MEETING_ID,
          userId: TEST_USER_ID,
          displayName: 'Test User',
          role: 'participant',
          maxParticipants: 10,
        }),
      (err: any) => err.statusCode === 503 && err.code === 'LIVEKIT_NOT_CONFIGURED'
    );
  });

  it('5. LiveKit API unreachable throws 503 LIVEKIT_UNAVAILABLE; already-exists room is idempotent', async () => {
    const failingSvc = new LiveKitService({
      config: {
        url: 'ws://127.0.0.1:7880',
        apiKey: TEST_API_KEY,
        apiSecret: TEST_API_SECRET,
        tokenTtlSeconds: 600,
      },
      nodeEnv: 'development',
      roomClientFactory: () =>
        createStubRoomClient({
          createRoom: async () => {
            throw new Error('ECONNREFUSED 127.0.0.1:7880');
          },
        }).adapter,
    });

    await assert.rejects(
      () => failingSvc.ensureRoomExists(TEST_MEETING_ID, 20),
      (err: any) => err.statusCode === 503 && err.code === 'LIVEKIT_UNAVAILABLE'
    );

    const existingSvc = new LiveKitService({
      config: {
        url: 'ws://127.0.0.1:7880',
        apiKey: TEST_API_KEY,
        apiSecret: TEST_API_SECRET,
        tokenTtlSeconds: 600,
      },
      nodeEnv: 'development',
      roomClientFactory: () =>
        createStubRoomClient({
          createRoom: async () => {
            const e: any = new Error('room already exists');
            e.code = 'already_exists';
            throw e;
          },
        }).adapter,
    });

    const roomName = await existingSvc.ensureRoomExists(TEST_MEETING_ID, 20);
    assert.strictEqual(roomName, `cly_room_${TEST_MEETING_ID}`);
  });

  it('6. deleteRoom retries once on transient error and ignores 404; removeParticipant ignores 404 safely', async () => {
    let deleteAttempts = 0;
    const svc = new LiveKitService({
      config: {
        url: 'ws://127.0.0.1:7880',
        apiKey: TEST_API_KEY,
        apiSecret: TEST_API_SECRET,
        tokenTtlSeconds: 600,
      },
      nodeEnv: 'development',
      roomClientFactory: () =>
        createStubRoomClient({
          deleteRoom: async () => {
            deleteAttempts += 1;
            if (deleteAttempts === 1) {
              throw new Error('transient timeout');
            }
          },
          removeParticipant: async () => {
            const e: any = new Error('participant not found');
            e.status = 404;
            throw e;
          },
        }).adapter,
    });

    const deleted = await svc.deleteRoom(TEST_MEETING_ID);
    assert.strictEqual(deleted, true);
    assert.strictEqual(deleteAttempts, 2);

    const removed = await svc.removeParticipant(TEST_MEETING_ID, TEST_USER_ID);
    assert.strictEqual(removed, true);
  });

  it('7. Signal gateway policy, opaque ID parsers, signed tokenEpoch metadata, and revokeTokenTs forwarding', async () => {
    assert.strictEqual(parseLiveKitRoomMeetingId(`cly_room_${TEST_MEETING_ID}`), TEST_MEETING_ID);
    assert.strictEqual(parseLiveKitRoomMeetingId('forged_room'), null);
    assert.strictEqual(parseLiveKitParticipantUserId(`usr_${TEST_USER_ID}`), TEST_USER_ID);
    assert.strictEqual(parseLiveKitParticipantUserId('spoofed@example.com'), null);

    // Self-hosted defaults to Signaling Admission Gateway; LiveKit Cloud defaults to direct
    assert.strictEqual(shouldUseLiveKitSignalGateway('ws://127.0.0.1:7880', 'auto'), true);
    assert.strictEqual(shouldUseLiveKitSignalGateway('wss://sfu.connectly.app', 'auto'), true);
    assert.strictEqual(shouldUseLiveKitSignalGateway('wss://demo.livekit.cloud', 'auto'), false);
    assert.strictEqual(shouldUseLiveKitSignalGateway('wss://demo.livekit.cloud', 'true'), true);
    assert.strictEqual(shouldUseLiveKitSignalGateway('ws://127.0.0.1:7880', 'false'), false);

    const { adapter, calls } = createStubRoomClient();
    const svc = new LiveKitService({
      config: {
        url: 'ws://127.0.0.1:7880',
        apiKey: TEST_API_KEY,
        apiSecret: TEST_API_SECRET,
        tokenTtlSeconds: 600,
      },
      nodeEnv: 'development',
      roomClientFactory: () => adapter,
    });

    const bundle = await svc.generateParticipantToken({
      meetingId: TEST_MEETING_ID,
      userId: TEST_USER_ID,
      displayName: 'Epoch User',
      role: 'participant',
      maxParticipants: 10,
      tokenEpoch: 3,
      gatewayUrl: 'ws://localhost:5000/livekit-signal',
    });

    assert.strictEqual(bundle.livekitUrl, 'ws://localhost:5000/livekit-signal');
    const verifier = new TokenVerifier(TEST_API_KEY, TEST_API_SECRET);
    const claims = await verifier.verify(bundle.token);
    const meta = JSON.parse(claims.metadata || '{}');
    assert.strictEqual(meta.epoch, 3);
    assert.strictEqual(meta.meetingId, TEST_MEETING_ID);

    const nowSec = BigInt(Math.floor(Date.now() / 1000));
    await svc.removeParticipant(TEST_MEETING_ID, TEST_USER_ID);
    assert.strictEqual(calls.removeParticipant.length, 1);
    assert.ok(
      typeof calls.removeParticipant[0].options?.revokeTokenTs === 'bigint' &&
        calls.removeParticipant[0].options.revokeTokenTs >= nowSec,
      'removeParticipant must forward revokeTokenTs for LiveKit Cloud compatibility'
    );
  });
});
