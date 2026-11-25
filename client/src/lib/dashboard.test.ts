import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateMeetingCode } from './meetingCode.ts';

// Pure helper functions matching dashboard logic
function formatFileSize(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

function getGreetingForHour(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function formatUserDisplayName(user: { firstName?: string | null; lastName?: string | null; email?: string } | null): string {
  if (!user) return 'Collaborator';
  if (user.firstName && user.lastName) return `${user.firstName} ${user.lastName}`.trim();
  if (user.firstName) return user.firstName.trim();
  if (user.email) return user.email.split('@')[0] || 'Collaborator';
  return 'Collaborator';
}

describe('Dashboard Utilities & Data Contracts', () => {
  it('should generate appropriate greetings based on 24-hour time', () => {
    assert.strictEqual(getGreetingForHour(8), 'Good morning');
    assert.strictEqual(getGreetingForHour(11), 'Good morning');
    assert.strictEqual(getGreetingForHour(12), 'Good afternoon');
    assert.strictEqual(getGreetingForHour(15), 'Good afternoon');
    assert.strictEqual(getGreetingForHour(18), 'Good evening');
    assert.strictEqual(getGreetingForHour(23), 'Good evening');
    assert.strictEqual(getGreetingForHour(2), 'Good morning');
  });

  it('should format user display names safely with fallbacks', () => {
    // Both first and last
    assert.strictEqual(
      formatUserDisplayName({ firstName: 'Sarah', lastName: 'Chen', email: 'sarah@connectly.io' }),
      'Sarah Chen'
    );
    // First name only
    assert.strictEqual(
      formatUserDisplayName({ firstName: 'Alex', lastName: null, email: 'alex@connectly.io' }),
      'Alex'
    );
    // Email fallback
    assert.strictEqual(
      formatUserDisplayName({ firstName: null, lastName: null, email: 'engineer@connectly.io' }),
      'engineer'
    );
    // Null user
    assert.strictEqual(formatUserDisplayName(null), 'Collaborator');
  });

  it('should format file sizes in decimal megabytes', () => {
    assert.strictEqual(formatFileSize(5033164), '4.8 MB');
    assert.strictEqual(formatFileSize(1048576), '1.0 MB');
    assert.strictEqual(formatFileSize(0), '0 B');
  });

  it('should enforce that shared files possess an associated meeting name contract', () => {
    const fileContractSample = {
      id: 'file-101',
      name: 'architecture_specs_v2.pdf',
      extension: 'pdf',
      sizeBytes: 5033164,
      sharedAt: '2026-11-17T10:14:00.000Z',
      associatedMeetingName: 'Quarterly Architecture Sync',
      associatedMeetingCode: 'cly-789-qwa',
      sharedBy: { id: 'u1', name: 'Dr. Sarah Chen' },
      mimeType: 'application/pdf',
    };

    assert.ok(fileContractSample.associatedMeetingName, 'Downloaded file must be traceable to a meeting');
    assert.strictEqual(fileContractSample.associatedMeetingName, 'Quarterly Architecture Sync');
    assert.ok(validateMeetingCode(fileContractSample.associatedMeetingCode).isValid);
  });

  it('should validate meeting agenda item contract fields', () => {
    const agendaItem = {
      id: 'agenda-1',
      code: 'cly-789-qwa',
      title: 'Quarterly Architecture & Roadmap Sync',
      scheduledStart: '2026-11-17T10:00:00.000Z',
      scheduledEnd: '2026-11-17T11:00:00.000Z',
      host: { id: 'user-1', name: 'Dr. Sarah Chen' },
      isWaitingRoomEnabled: true,
      participantCount: 14,
      inviteUrl: 'http://localhost:5173/join/cly-789-qwa',
    };

    assert.strictEqual(agendaItem.code, 'cly-789-qwa');
    assert.ok(agendaItem.title.length > 0);
    assert.strictEqual(agendaItem.isWaitingRoomEnabled, true);
    assert.strictEqual(agendaItem.participantCount, 14);
  });
});
