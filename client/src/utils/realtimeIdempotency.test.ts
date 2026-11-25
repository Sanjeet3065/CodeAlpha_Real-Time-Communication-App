import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRealtimeEventGuard,
  applyParticipantJoinedIdempotent,
} from './realtimeIdempotency.ts';
import type { MeetingParticipantInfo } from '../types/meeting.ts';

function makeParticipant(userId: string, displayName: string): MeetingParticipantInfo {
  return {
    id: `p_${userId}`,
    userId,
    displayName,
    avatarUrl: null,
    role: 'participant',
    admissionStatus: 'ADMITTED',
    presenceStatus: 'ONLINE',
    requestedAt: '2026-11-18T00:00:00.000Z',
    admittedAt: '2026-11-18T00:00:01.000Z',
    joinedAt: '2026-11-18T00:00:01.000Z',
  };
}

describe('Phase 09 Frontend Realtime Outbox Idempotency Guard', () => {
  it('1. Deduplicates repeated at-least-once deliveries carrying the same stable eventId', () => {
    const guard = createRealtimeEventGuard(100);
    let admissionNavigations = 0;

    const handleAdmissionApproved = (eventId?: string) => {
      if (!guard.shouldProcess(eventId)) return;
      admissionNavigations += 1;
    };

    handleAdmissionApproved('evt-001');
    handleAdmissionApproved('evt-001'); // Duplicate redelivery after Crash D
    handleAdmissionApproved('evt-001');

    assert.strictEqual(admissionNavigations, 1);
    assert.strictEqual(guard.size(), 1);

    // Distinct logical eventId IS processed
    handleAdmissionApproved('evt-002');
    assert.strictEqual(admissionNavigations, 2);
  });

  it('2. Blocks stale admission/join events once terminal meeting state (ended/removed/rejected) is reached', () => {
    const guard = createRealtimeEventGuard(100);
    assert.strictEqual(guard.shouldProcess('evt-before-end'), true);

    guard.markTerminal();
    assert.strictEqual(guard.isTerminal(), true);
    assert.strictEqual(guard.shouldProcess('evt-after-end'), false);
    assert.strictEqual(guard.shouldProcess(undefined), false);
  });

  it('3. Idempotently merges participant-joined updates without duplicating roster entries', () => {
    const host = makeParticipant('u_host', 'Host User');
    const guestV1 = makeParticipant('u_guest', 'Guest User');
    const guestV2 = { ...guestV1, displayName: 'Guest Updated' };

    const afterFirst = applyParticipantJoinedIdempotent([host], guestV1);
    assert.strictEqual(afterFirst.length, 2);

    const afterDuplicate = applyParticipantJoinedIdempotent(afterFirst, guestV1);
    assert.strictEqual(afterDuplicate.length, 2);

    const afterUpdate = applyParticipantJoinedIdempotent(afterDuplicate, guestV2);
    assert.strictEqual(afterUpdate.length, 2);
    assert.strictEqual(afterUpdate[1].displayName, 'Guest Updated');
  });

  it('4. Evicts oldest seen eventIds cleanly when bounded cache limit is exceeded', () => {
    const guard = createRealtimeEventGuard(3);
    assert.strictEqual(guard.shouldProcess('e1'), true);
    assert.strictEqual(guard.shouldProcess('e2'), true);
    assert.strictEqual(guard.shouldProcess('e3'), true);
    assert.strictEqual(guard.size(), 3);

    assert.strictEqual(guard.shouldProcess('e4'), true);
    assert.strictEqual(guard.size(), 3);
    // e2, e3, e4 remain deduplicated
    assert.strictEqual(guard.shouldProcess('e2'), false);
    assert.strictEqual(guard.shouldProcess('e3'), false);
    assert.strictEqual(guard.shouldProcess('e4'), false);
  });
});
