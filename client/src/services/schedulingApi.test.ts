/**
 * CONNECTLY — Phase 16 Client Scheduling & Meeting History API Suite
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { schedulingApi } from './schedulingApi.ts';
import { authStorage, ApiError } from './authApi.ts';

describe('Phase 16 Client SchedulingApi Suite', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    authStorage.setAccessToken('test-phase16-jwt-token');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    authStorage.setAccessToken(null);
  });

  it('1. scheduleMeeting() sends POST /meetings/scheduled with expected payload', async () => {
    let capturedUrl = '';
    let capturedMethod = '';
    let capturedBody: {
      title?: string;
      durationMinutes?: number;
      scheduledTimeZone?: string;
    } = {};
    let capturedAuth: string | null = null;

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedMethod = init?.method || 'GET';
      capturedBody = init?.body ? JSON.parse(String(init.body)) : {};
      const headers = new Headers(init?.headers);
      capturedAuth = headers.get('Authorization');

      return new Response(
        JSON.stringify({
          success: true,
          data: {
            meeting: {
              id: 'm123',
              title: 'Sprint Planning',
              description: 'Bi-weekly sprint planning meeting',
              meetingCode: 'cly-plan-101',
              status: 'SCHEDULED',
              scheduledStartAt: '2026-12-01T10:00:00.000Z',
              scheduledEndAt: '2026-12-01T10:45:00.000Z',
              scheduledTimeZone: 'America/New_York',
              durationEstimateMinutes: 45,
              invitees: [{ email: 'dev@connectly.test', name: 'Dev Lead' }],
              reminderPreferences: [15, 60],
              hostId: 'u1',
              hostName: 'Alice Host',
              scheduleVersion: 1,
              createdAt: '2026-11-21T00:00:00.000Z',
            },
          },
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    const res = await schedulingApi.scheduleMeeting({
      title: 'Sprint Planning',
      description: 'Bi-weekly sprint planning meeting',
      scheduledStartAt: '2026-12-01T10:00:00.000Z',
      durationMinutes: 45,
      scheduledTimeZone: 'America/New_York',
      invitees: [{ email: 'dev@connectly.test', name: 'Dev Lead' }],
      reminderPreferences: [15, 60],
    });

    assert.ok(capturedUrl.includes('/meetings/scheduled'), `Expected url to include /meetings/scheduled, got ${capturedUrl}`);
    assert.equal(capturedMethod, 'POST');
    assert.equal(capturedAuth, 'Bearer test-phase16-jwt-token');
    assert.equal(capturedBody.title, 'Sprint Planning');
    assert.equal(capturedBody.durationMinutes, 45);
    assert.equal(capturedBody.scheduledTimeZone, 'America/New_York');
    assert.equal(res.meeting.id, 'm123');
    assert.equal(res.meeting.status, 'SCHEDULED');
  });

  it('2. getScheduledMeeting() sends GET /meetings/scheduled/:id', async () => {
    let capturedUrl = '';

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            meeting: {
              id: 'm123',
              title: 'Sprint Planning',
              meetingCode: 'cly-plan-101',
              status: 'SCHEDULED',
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    const res = await schedulingApi.getScheduledMeeting('m123');
    assert.ok(capturedUrl.endsWith('/meetings/scheduled/m123'));
    assert.equal(res.meeting.id, 'm123');
  });

  it('3. updateScheduledMeeting() sends PATCH /meetings/scheduled/:id', async () => {
    let capturedUrl = '';
    let capturedMethod = '';
    let capturedBody: { title?: string } = {};

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedMethod = init?.method || 'GET';
      capturedBody = init?.body ? JSON.parse(String(init.body)) : {};

      return new Response(
        JSON.stringify({
          success: true,
          data: {
            meeting: {
              id: 'm123',
              title: 'Updated Sprint Planning',
              status: 'SCHEDULED',
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    const res = await schedulingApi.updateScheduledMeeting('m123', {
      title: 'Updated Sprint Planning',
    });

    assert.ok(capturedUrl.endsWith('/meetings/scheduled/m123'));
    assert.equal(capturedMethod, 'PATCH');
    assert.equal(capturedBody.title, 'Updated Sprint Planning');
    assert.equal(res.meeting.title, 'Updated Sprint Planning');
  });

  it('4. rescheduleMeeting() sends POST /meetings/scheduled/:id/reschedule', async () => {
    let capturedUrl = '';
    let capturedMethod = '';
    let capturedBody: {
      durationMinutes?: number;
      scheduledTimeZone?: string;
    } = {};

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedMethod = init?.method || 'GET';
      capturedBody = init?.body ? JSON.parse(String(init.body)) : {};

      return new Response(
        JSON.stringify({
          success: true,
          data: {
            meeting: {
              id: 'm123',
              scheduledStartAt: '2026-12-02T14:00:00.000Z',
              durationEstimateMinutes: 60,
              scheduleVersion: 2,
              status: 'SCHEDULED',
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    const res = await schedulingApi.rescheduleMeeting('m123', {
      scheduledStartAt: '2026-12-02T14:00:00.000Z',
      durationMinutes: 60,
      scheduledTimeZone: 'Europe/London',
    });

    assert.ok(capturedUrl.endsWith('/meetings/scheduled/m123/reschedule'));
    assert.equal(capturedMethod, 'POST');
    assert.equal(capturedBody.durationMinutes, 60);
    assert.equal(capturedBody.scheduledTimeZone, 'Europe/London');
    assert.equal(res.meeting.scheduleVersion, 2);
  });

  it('5. cancelMeeting() sends POST /meetings/scheduled/:id/cancel', async () => {
    let capturedUrl = '';
    let capturedMethod = '';
    let capturedBody: { reason?: string } = {};

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedMethod = init?.method || 'GET';
      capturedBody = init?.body ? JSON.parse(String(init.body)) : {};

      return new Response(
        JSON.stringify({
          success: true,
          data: {
            meeting: {
              id: 'm123',
              status: 'CANCELLED',
              cancelledAt: '2026-11-21T01:00:00.000Z',
              cancellationReason: 'No longer required',
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    const res = await schedulingApi.cancelMeeting('m123', 'No longer required');

    assert.ok(capturedUrl.endsWith('/meetings/scheduled/m123/cancel'));
    assert.equal(capturedMethod, 'POST');
    assert.equal(capturedBody.reason, 'No longer required');
    assert.equal(res.meeting.status, 'CANCELLED');
  });

  it('6. listUpcomingMeetings() sends GET /meetings/scheduled with pagination', async () => {
    let capturedUrl = '';

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            meetings: [
              { id: 'm1', title: 'Session A', status: 'SCHEDULED' },
              { id: 'm2', title: 'Session B', status: 'SCHEDULED' },
            ],
            pagination: {
              page: 2,
              limit: 5,
              total: 7,
              totalPages: 2,
              hasNext: false,
              hasPrev: true,
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    const res = await schedulingApi.listUpcomingMeetings({ page: 2, limit: 5 });

    assert.ok(capturedUrl.includes('/meetings/scheduled?'));
    assert.ok(capturedUrl.includes('page=2'));
    assert.ok(capturedUrl.includes('limit=5'));
    assert.equal(res.meetings.length, 2);
    assert.equal(res.pagination.total, 7);
  });

  it('7. listMeetingHistory() sends GET /meetings/history with filters', async () => {
    let capturedUrl = '';

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            meetings: [
              {
                id: 'mHist1',
                meetingCode: 'cly-done-111',
                title: 'Sprint Review',
                status: 'ENDED',
                userRole: 'host',
                durationSeconds: 3600,
                formattedDuration: '1h 00m',
                participantCount: 5,
                createdAt: '2026-11-20T10:00:00.000Z',
              },
            ],
            pagination: {
              page: 1,
              limit: 10,
              total: 1,
              totalPages: 1,
              hasNext: false,
              hasPrev: false,
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    const res = await schedulingApi.listMeetingHistory({
      page: 1,
      limit: 10,
      status: 'ENDED',
      role: 'host',
      search: 'Sprint',
      sort: 'desc',
    });

    assert.ok(capturedUrl.includes('/meetings/history?'));
    assert.ok(capturedUrl.includes('status=ENDED'));
    assert.ok(capturedUrl.includes('role=host'));
    assert.ok(capturedUrl.includes('search=Sprint'));
    assert.ok(capturedUrl.includes('sort=desc'));
    assert.equal(res.meetings.length, 1);
    assert.equal(res.meetings[0].formattedDuration, '1h 00m');
  });

  it('8. getMeetingHistoryDetails() sends GET /meetings/history/:id', async () => {
    let capturedUrl = '';

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            meeting: {
              meeting: {
                id: 'mHist1',
                meetingCode: 'cly-done-111',
                title: 'Sprint Review',
                status: 'ENDED',
              },
              participants: [],
              timeline: [
                { action: 'CREATED', timestamp: '2026-11-20T10:00:00.000Z' },
                { action: 'ENDED', timestamp: '2026-11-20T11:00:00.000Z' },
              ],
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    const res = await schedulingApi.getMeetingHistoryDetails('mHist1');
    assert.ok(capturedUrl.endsWith('/meetings/history/mHist1'));
    assert.equal(res.meeting.id, 'mHist1');
    assert.equal(res.timeline.length, 2);
  });

  it('9. getMeetingInvitation() sends GET /meetings/:meetingCode/invitation', async () => {
    let capturedUrl = '';

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            meetingCode: 'cly-inv-456',
            title: 'Design Critique',
            joinUrl: 'http://localhost:5173/lobby/cly-inv-456',
            invitationText: 'Join Connectly Meeting: Design Critique\nLink: http://localhost:5173/lobby/cly-inv-456',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    const res = await schedulingApi.getMeetingInvitation('cly-inv-456');
    assert.ok(capturedUrl.endsWith('/meetings/cly-inv-456/invitation'));
    assert.equal(res.meetingCode, 'cly-inv-456');
    assert.ok(res.invitationText.includes('Design Critique'));
  });

  it('10. listNotifications() sends GET /users/me/notifications', async () => {
    let capturedUrl = '';

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            notifications: [
              {
                id: 'notif-1',
                userId: 'u1',
                type: 'MEETING_REMINDER',
                title: 'Meeting starting in 15 minutes',
                message: 'Sprint Planning begins at 10:00 AM',
                read: false,
                createdAt: '2026-11-21T09:45:00.000Z',
              },
            ],
            unreadCount: 1,
            pagination: { page: 1, limit: 15, total: 1, totalPages: 1 },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    const res = await schedulingApi.listNotifications({ page: 1, limit: 15 });
    assert.ok(capturedUrl.includes('/users/me/notifications?'));
    assert.equal(res.notifications.length, 1);
    assert.equal(res.unreadCount, 1);
  });

  it('11. markNotificationRead() sends PATCH /users/me/notifications/:id/read', async () => {
    let capturedUrl = '';
    let capturedMethod = '';

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedMethod = init?.method || 'GET';
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            success: true,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    const res = await schedulingApi.markNotificationRead('notif-1');
    assert.ok(capturedUrl.endsWith('/users/me/notifications/notif-1/read'));
    assert.equal(capturedMethod, 'PATCH');
    assert.equal(res.success, true);
  });

  it('12. markAllNotificationsRead() sends POST /users/me/notifications/read-all', async () => {
    let capturedUrl = '';
    let capturedMethod = '';

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedMethod = init?.method || 'GET';
      return new Response(
        JSON.stringify({
          success: true,
          data: { modifiedCount: 4 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    const res = await schedulingApi.markAllNotificationsRead();
    assert.ok(capturedUrl.endsWith('/users/me/notifications/read-all'));
    assert.equal(capturedMethod, 'POST');
    assert.equal(res.modifiedCount, 4);
  });

  it('13. schedulingApi handles ApiError when server returns 404/400/410/500', async () => {
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          success: false,
          error: {
            code: 'MEETING_CANCELLED',
            message: 'This scheduled meeting has been cancelled.',
          },
        }),
        { status: 410, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    await assert.rejects(
      async () => {
        await schedulingApi.getScheduledMeeting('cancelled-meet');
      },
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.code, 'MEETING_CANCELLED');
        assert.equal(err.status, 410);
        return true;
      }
    );
  });
});
