import assert from 'node:assert/strict';
import { RoomServiceClient, TokenVerifier } from 'livekit-server-sdk';

const API_BASE = 'http://localhost:5000/api/v1';
const LIVEKIT_HTTP_URL = 'http://127.0.0.1:7880';
const LIVEKIT_API_KEY = 'devkey';
const LIVEKIT_API_SECRET = 'secret';

async function api(method, path, body = null, token = null) {
  const headers = {
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    'X-CSRF-Protection': '1',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    ...(body !== null && method !== 'GET' ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function main() {
  console.log('======================================================================');
  console.log('CONNECTLY Phase 09 — Real LiveKit SFU Server API Integration Suite');
  console.log('======================================================================');

  const roomClient = new RoomServiceClient(LIVEKIT_HTTP_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
  const verifier = new TokenVerifier(LIVEKIT_API_KEY, LIVEKIT_API_SECRET);

  const ts = Date.now();
  const password = 'Password123!';
  const accounts = {};

  for (const role of ['host', 'guest', 'waiting', 'outsider']) {
    const email = `lk_real_${role}_${ts}@connectly.io`;
    const reg = await api('POST', '/auth/register', {
      email,
      firstName: role.toUpperCase(),
      lastName: 'LiveKit',
      password,
    });
    assert.strictEqual(reg.status, 201, `Register failed for ${role}`);
    const login = await api('POST', '/auth/login', { email, password });
    assert.strictEqual(login.status, 200, `Login failed for ${role}`);
    accounts[role] = {
      id: login.data.user.id,
      token: login.data.accessToken,
      email,
    };
  }

  // 1. Host creates meeting (waiting room enabled) & joins CONNECTLY room
  const created = await api(
    'POST',
    '/meetings/instant',
    { title: 'Real LiveKit API Check', maxParticipants: 10, settings: { waitingRoomEnabled: true } },
    accounts.host.token
  );
  assert.strictEqual(created.status, 201);
  const meetingCode = created.data.data.meeting.meetingCode;
  const meetingId = created.data.data.meeting.id;

  const hostJoin = await api('POST', `/meetings/${meetingCode}/join`, {}, accounts.host.token);
  assert.strictEqual(hostJoin.status, 200);
  assert.strictEqual(hostJoin.data.data.joinResult, 'ADMITTED');

  // 2. Host requests LiveKit token -> provisions REAL room on livekit-server v1.13.11
  const hostLk = await api('POST', `/meetings/${meetingCode}/livekit-token`, {}, accounts.host.token);
  assert.strictEqual(hostLk.status, 200);
  const hostBundle = hostLk.data.data;
  assert.strictEqual(hostBundle.roomName, `cly_room_${meetingId}`);
  assert.strictEqual(hostBundle.participantIdentity, `usr_${accounts.host.id}`);
  assert.strictEqual(hostBundle.permissions.roomJoin, true);
  assert.strictEqual(hostBundle.permissions.canPublish, true);
  assert.deepStrictEqual(hostBundle.permissions.canPublishSources, ['camera', 'microphone']);
  assert.strictEqual(hostBundle.permissions.canSubscribe, true);
  assert.strictEqual(hostBundle.permissions.canPublishData, false);

  const verifiedHostClaims = await verifier.verify(hostBundle.token);
  assert.strictEqual(verifiedHostClaims.video?.room, hostBundle.roomName);
  assert.strictEqual(verifiedHostClaims.video?.canPublish, true);
  assert.deepStrictEqual(verifiedHostClaims.video?.canPublishSources, ['camera', 'microphone']);
  assert.strictEqual(verifiedHostClaims.video?.canSubscribe, true);
  assert.strictEqual(verifiedHostClaims.video?.canPublishData, false);
  assert.strictEqual(verifiedHostClaims.video?.roomAdmin, false);

  // Verify room actually exists inside livekit-server v1.13.11!
  const roomsAfterProvision = await roomClient.listRooms([hostBundle.roomName]);
  assert.strictEqual(roomsAfterProvision.length, 1, 'LiveKit room must genuinely exist on SFU server');
  assert.strictEqual(roomsAfterProvision[0].name, hostBundle.roomName);
  console.log(`  [1/6] LiveKit room genuinely provisioned on livekit-server (${hostBundle.roomName}): PASS`);

  // 3. Unauthorized outsider & waiting user are strictly denied tokens
  const outRes = await api('POST', `/meetings/${meetingCode}/livekit-token`, {}, accounts.outsider.token);
  assert.strictEqual(outRes.status, 403);
  assert.strictEqual(outRes.data.code, 'LIVEKIT_ACCESS_DENIED');

  const waitJoin = await api('POST', `/meetings/${meetingCode}/join`, {}, accounts.waiting.token);
  assert.strictEqual(waitJoin.data.data.joinResult, 'WAITING');
  const waitLk = await api('POST', `/meetings/${meetingCode}/livekit-token`, {}, accounts.waiting.token);
  assert.strictEqual(waitLk.status, 403);
  assert.strictEqual(waitLk.data.code, 'LIVEKIT_ACCESS_DENIED');
  console.log('  [2/6] Outsider & waiting participant blocked (403 LIVEKIT_ACCESS_DENIED): PASS');

  // 4. Guest joins -> Host admits -> Guest receives valid token for SAME LiveKit room
  await api('POST', `/meetings/${meetingCode}/join`, {}, accounts.guest.token);
  const admit = await api(
    'POST',
    `/meetings/${meetingCode}/waiting-room/${accounts.guest.id}/admit`,
    {},
    accounts.host.token
  );
  assert.strictEqual(admit.status, 200);

  const guestLk = await api('POST', `/meetings/${meetingCode}/livekit-token`, {}, accounts.guest.token);
  assert.strictEqual(guestLk.status, 200);
  assert.strictEqual(guestLk.data.data.roomName, hostBundle.roomName);
  assert.strictEqual(guestLk.data.data.participantIdentity, `usr_${accounts.guest.id}`);
  console.log('  [3/6] Admitted guest mapped to exact same LiveKit room with opaque identity: PASS');

  // 5. Removing guest blocks subsequent LiveKit token issuance
  const rem = await api(
    'DELETE',
    `/meetings/${meetingCode}/participants/${accounts.guest.id}`,
    { reason: 'Audit test' },
    accounts.host.token
  );
  assert.strictEqual(rem.status, 200);
  const removedLk = await api('POST', `/meetings/${meetingCode}/livekit-token`, {}, accounts.guest.token);
  assert.strictEqual(removedLk.status, 403);
  assert.strictEqual(removedLk.data.code, 'PARTICIPANT_REMOVED');
  console.log('  [4/6] Removed participant blocked from new LiveKit tokens (403 PARTICIPANT_REMOVED): PASS');

  // 6. Ending meeting deletes the REAL LiveKit room on livekit-server & blocks new tokens (410)
  const endRes = await api('POST', `/meetings/${meetingCode}/end`, {}, accounts.host.token);
  assert.strictEqual(endRes.status, 200);

  const roomsAfterEnd = await roomClient.listRooms([hostBundle.roomName]);
  assert.strictEqual(roomsAfterEnd.length, 0, 'LiveKit SFU room must be deleted upon meeting termination');
  console.log('  [5/6] LiveKit SFU room genuinely deleted from livekit-server on meeting end: PASS');

  const endedLk = await api('POST', `/meetings/${meetingCode}/livekit-token`, {}, accounts.host.token);
  assert.strictEqual(endedLk.status, 410);
  assert.strictEqual(endedLk.data.code, 'LIVEKIT_MEETING_ENDED');
  console.log('  [6/6] Ended meeting strictly blocks new LiveKit tokens (410 LIVEKIT_MEETING_ENDED): PASS');

  console.log('\n======================================================================');
  console.log('REAL LIVEKIT SFU API INTEGRATION SUITE: ALL 6 / 6 CHECKS PASSED!');
  console.log('======================================================================');
}

main().catch((err) => {
  console.error('Real LiveKit API integration failed:', err);
  process.exit(1);
});
