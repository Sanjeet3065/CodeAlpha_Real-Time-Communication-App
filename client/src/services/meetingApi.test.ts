import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { meetingApi, getMeetingErrorMessage } from './meetingApi.ts';
import { authStorage } from './authApi.ts';

describe('Phase 08 Client MeetingApi & Error Mapping Suite', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    authStorage.setAccessToken('test-access-token');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    authStorage.setAccessToken(null);
  });

  it('1. createMeeting() sends POST /meetings/instant with title, capacity, and waiting-room settings', async () => {
    let capturedUrl = '';
    let capturedBody: Record<string, unknown> = {};

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedBody = JSON.parse(String(init?.body || '{}'));
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            meeting: {
              id: 'm1',
              meetingCode: 'cly-abc-123',
              title: 'Sprint Kickoff',
              joinUrl: 'http://localhost:5173/join/cly-abc-123',
              hostId: 'u1',
              hostName: 'Elena Host',
              status: 'CREATED',
              isLocked: false,
              maxParticipants: 60,
              activeParticipantCount: 0,
              settings: {
                waitingRoomEnabled: true,
                allowCoHostAdmit: true,
                allowCoHostRemove: true,
                allowCoHostLock: false,
              },
            },
          },
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    const res = await meetingApi.createMeeting({
      title: 'Sprint Kickoff',
      maxParticipants: 60,
      settings: { waitingRoomEnabled: true },
    });

    assert.ok(capturedUrl.endsWith('/meetings/instant'));
    assert.strictEqual(capturedBody.title, 'Sprint Kickoff');
    assert.strictEqual(res.meeting.meetingCode, 'cly-abc-123');
    assert.strictEqual(res.meeting.settings.waitingRoomEnabled, true);
  });

  it('2. validateMeetingCode() retrieves room metadata and surfaces structured 404 errors', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          status: 404,
          code: 'MEETING_NOT_FOUND',
          message: 'Meeting not found.',
        }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      )) as typeof fetch;

    await assert.rejects(
      () => meetingApi.validateMeetingCode('cly-999-zzz'),
      (err: unknown) => {
        if (typeof err !== 'object' || err === null) return false;
        const candidate = err as { status?: unknown; code?: unknown };
        return candidate.status === 404 && candidate.code === 'MEETING_NOT_FOUND';
      }
    );
  });

  it('3. joinMeeting() distinguishes WAITING vs ADMITTED responses cleanly', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          success: true,
          data: {
            joinResult: 'WAITING',
            meeting: { id: 'm1', meetingCode: 'cly-abc-123', title: 'Sync' },
            participant: { id: 'p1', userId: 'u2', admissionStatus: 'WAITING', role: 'participant' },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )) as typeof fetch;

    const res = await meetingApi.joinMeeting('cly-abc-123', { displayName: 'Alice' });
    assert.strictEqual(res.joinResult, 'WAITING');
    assert.strictEqual(res.participant.admissionStatus, 'WAITING');
  });

  it('4. Host moderation actions (admit, reject, role update, lock, unlock, settings, remove, end) hit canonical endpoints', async () => {
    const called: Array<{ method: string; url: string }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      called.push({ method: init?.method || 'GET', url: String(input) });
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            meeting: { id: 'm1', meetingCode: 'cly-abc-123', isLocked: true },
            participant: { userId: 'u2', role: 'co-host' },
            waitingList: [],
            activeParticipantCount: 1,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    await meetingApi.admitParticipant('cly-abc-123', 'u2');
    await meetingApi.rejectParticipant('cly-abc-123', 'u3', 'Declined');
    await meetingApi.updateParticipantRole('cly-abc-123', 'u2', 'co-host');
    await meetingApi.lockMeeting('cly-abc-123');
    await meetingApi.unlockMeeting('cly-abc-123');
    await meetingApi.updateSettings('cly-abc-123', { waitingRoomEnabled: true });
    await meetingApi.removeParticipant('cly-abc-123', 'u2');
    await meetingApi.leaveMeeting('cly-abc-123');
    await meetingApi.endMeeting('cly-abc-123');

    assert.strictEqual(called.length, 9);
    assert.ok(called[0].url.endsWith('/meetings/cly-abc-123/waiting-room/u2/admit'));
    assert.ok(called[1].url.endsWith('/meetings/cly-abc-123/waiting-room/u3/reject'));
    assert.ok(called[2].url.endsWith('/meetings/cly-abc-123/participants/u2/role'));
    assert.strictEqual(called[2].method, 'PATCH');
    assert.ok(called[3].url.endsWith('/meetings/cly-abc-123/lock'));
    assert.ok(called[4].url.endsWith('/meetings/cly-abc-123/unlock'));
    assert.ok(called[5].url.endsWith('/meetings/cly-abc-123/settings'));
    assert.strictEqual(called[6].method, 'DELETE');
    assert.ok(called[7].url.endsWith('/meetings/cly-abc-123/leave'));
    assert.ok(called[8].url.endsWith('/meetings/cly-abc-123/end'));
  });

  it('5. getMeetingErrorMessage() returns human-readable messages for all Phase 08 error states without leaking internals', () => {
    const codes = [
      'INVALID_MEETING_CODE',
      'MEETING_NOT_FOUND',
      'MEETING_ENDED',
      'MEETING_EXPIRED',
      'MEETING_LOCKED',
      'MEETING_FULL',
      'PARTICIPANT_REMOVED',
      'FORBIDDEN',
    ];
    for (const code of codes) {
      const msg = getMeetingErrorMessage(code);
      assert.ok(msg.length > 15, `Expected clear user message for ${code}`);
      assert.ok(!/mongo|stack|exception/i.test(msg), `Must not leak internal details for ${code}`);
    }
  });
});
