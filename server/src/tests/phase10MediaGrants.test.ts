import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { TokenVerifier } from 'livekit-server-sdk';
import { User } from '../models/User.model.js';
import { Meeting } from '../models/Meeting.model.js';
import { MeetingParticipant } from '../models/MeetingParticipant.model.js';
import { MeetingRealtimeHub } from '../realtime/meetingSocket.js';
import { authorizeLiveKitSignalHandshake } from '../realtime/livekitSignalGateway.js';
import { MeetingService } from '../services/meeting.service.js';
import {
  LiveKitService,
  type LiveKitRoomClientAdapter,
} from '../services/livekit.service.js';
import { hashPassword } from '../utils/password.js';

const TEST_API_KEY = 'APIphase10GrantsKey01';
const TEST_API_SECRET = 'SuperSecurePhase10LiveKitGrantVerificationSecret123456';

describe('Phase 10 Backend Multi-User Audio/Video Token Grants & Authorization Suite', () => {
  const users: Array<{ id: string; email: string }> = [];
  const createdMeetingIds: mongoose.Types.ObjectId[] = [];
  const realtimeHub = new MeetingRealtimeHub();

  const stubAdapter: LiveKitRoomClientAdapter = {
    createRoom: async () => ({}),
    removeParticipant: async () => ({}),
    deleteRoom: async () => ({}),
  };

  const livekitSvc = new LiveKitService({
    config: {
      url: 'ws://127.0.0.1:7880',
      apiKey: TEST_API_KEY,
      apiSecret: TEST_API_SECRET,
      tokenTtlSeconds: 600,
    },
    nodeEnv: 'development',
    roomClientFactory: () => stubAdapter,
  });

  const service = new MeetingService(realtimeHub, {}, livekitSvc);

  before(async () => {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/connectly_test_phase10_grants';
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(mongoUri);
    }
    const passwordHash = await hashPassword('Phase10Pass!2026');
    const suffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    for (let i = 0; i < 4; i += 1) {
      const u = await User.create({
        firstName: `P10User${i}`,
        lastName: 'Media',
        email: `p10_grants_${i}_${suffix}@example.com`,
        passwordHash,
      });
      users.push({ id: u._id.toString(), email: u.email });
    }
  });

  after(async () => {
    if (createdMeetingIds.length > 0) {
      await MeetingParticipant.deleteMany({ meetingId: { $in: createdMeetingIds } });
      await Meeting.deleteMany({ _id: { $in: createdMeetingIds } });
    }
    if (users.length > 0) {
      await User.deleteMany({ _id: { $in: users.map((u) => u.id) } });
    }
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  });

  it('1. Admitted host, co-host, and participant receive camera, microphone, and screen-share publish & subscribe grants with zero admin or data privileges', async () => {
    const { meeting } = await service.createMeeting(users[0].id, {
      title: 'Phase 10 Media Grants Room',
      maxParticipants: 12,
      settings: { waitingRoomEnabled: false },
    });
    createdMeetingIds.push(new mongoose.Types.ObjectId(meeting.id));

    await service.joinMeeting(meeting.meetingCode, users[0].id);
    await service.joinMeeting(meeting.meetingCode, users[1].id);
    await service.updateParticipantRole(meeting.meetingCode, users[0].id, users[1].id, {
      role: 'co-host',
    });
    await service.joinMeeting(meeting.meetingCode, users[2].id);

    const verifier = new TokenVerifier(TEST_API_KEY, TEST_API_SECRET);
    for (const u of [users[0], users[1], users[2]]) {
      const bundle = await service.issueLiveKitToken(meeting.meetingCode, u.id);
      assert.deepStrictEqual(bundle.permissions, {
        roomJoin: true,
        canPublish: true,
        canPublishSources: ['camera', 'microphone', 'screen_share', 'screen_share_audio'],
        canSubscribe: true,
        canPublishData: false,
      });

      const claims = await verifier.verify(bundle.token);
      assert.strictEqual(claims.video?.roomJoin, true);
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
      assert.strictEqual((claims.exp ?? 0) - (claims.nbf ?? 0), 600);
    }
  });

  it('2. Unauthorized, waiting, rejected, removed, expired, and ended callers cannot obtain media tokens or reuse prior media JWTs through the gateway', async () => {
    const { meeting } = await service.createMeeting(users[0].id, {
      title: 'Phase 10 Restricted Media Room',
      maxParticipants: 10,
      settings: { waitingRoomEnabled: true },
    });
    createdMeetingIds.push(new mongoose.Types.ObjectId(meeting.id));

    await service.joinMeeting(meeting.meetingCode, users[0].id);

    // Non-member blocked
    await assert.rejects(
      () => service.issueLiveKitToken(meeting.meetingCode, users[3].id),
      (err: any) => err.statusCode === 403 && err.code === 'LIVEKIT_ACCESS_DENIED'
    );

    // Waiting user blocked
    await service.joinMeeting(meeting.meetingCode, users[1].id);
    await assert.rejects(
      () => service.issueLiveKitToken(meeting.meetingCode, users[1].id),
      (err: any) => err.statusCode === 403 && err.code === 'LIVEKIT_ACCESS_DENIED'
    );

    // Rejected user blocked
    await service.rejectParticipant(meeting.meetingCode, users[0].id, users[1].id, 'Declined');
    await assert.rejects(
      () => service.issueLiveKitToken(meeting.meetingCode, users[1].id),
      (err: any) => err.statusCode === 403 && err.code === 'LIVEKIT_ACCESS_DENIED'
    );

    // Admitted user receives valid media token, then is removed -> old media JWT rejected by gateway!
    await service.joinMeeting(meeting.meetingCode, users[2].id);
    await service.admitParticipant(meeting.meetingCode, users[0].id, users[2].id);
    const mediaTok = await service.issueLiveKitToken(meeting.meetingCode, users[2].id);

    const beforeRemoveAuth = await authorizeLiveKitSignalHandshake(
      `/livekit-signal/rtc/v1?access_token=${encodeURIComponent(mediaTok.token)}`,
      undefined,
      livekitSvc
    );
    assert.strictEqual(beforeRemoveAuth.allowed, true);

    await service.removeParticipant(meeting.meetingCode, users[0].id, users[2].id, 'Kicked');

    const afterRemoveAuth = await authorizeLiveKitSignalHandshake(
      `/livekit-signal/rtc/v1?access_token=${encodeURIComponent(mediaTok.token)}`,
      undefined,
      livekitSvc
    );
    assert.strictEqual(afterRemoveAuth.allowed, false);
    if (!afterRemoveAuth.allowed) {
      assert.strictEqual(afterRemoveAuth.statusCode, 403);
      assert.strictEqual(afterRemoveAuth.code, 'PARTICIPANT_REMOVED');
    }

    // Ended meeting blocks media token issuance (410)
    await service.endMeeting(meeting.meetingCode, users[0].id);
    await assert.rejects(
      () => service.issueLiveKitToken(meeting.meetingCode, users[0].id),
      (err: any) => err.statusCode === 410 && err.code === 'LIVEKIT_MEETING_ENDED'
    );
  });

  it('3. Expired meeting strictly blocks Phase 10 media token issuance (410 MEETING_EXPIRED)', async () => {
    const { meeting } = await service.createMeeting(users[0].id, {
      title: 'Phase 10 Expired Room',
      maxParticipants: 5,
      settings: { waitingRoomEnabled: false },
    });
    createdMeetingIds.push(new mongoose.Types.ObjectId(meeting.id));
    await service.joinMeeting(meeting.meetingCode, users[0].id);

    await Meeting.updateOne(
      { _id: meeting.id },
      { $set: { expiresAt: new Date(Date.now() - 60_000) } }
    );

    await assert.rejects(
      () => service.issueLiveKitToken(meeting.meetingCode, users[0].id),
      (err: any) => err.statusCode === 410 && err.code === 'MEETING_EXPIRED'
    );
  });
});
