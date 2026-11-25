import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import type { Server } from 'node:http';
import { createApp } from '../app.js';
import { User } from '../models/User.model.js';
import { AuthSession } from '../models/Session.model.js';
import { Meeting } from '../models/Meeting.model.js';
import { MeetingParticipant } from '../models/MeetingParticipant.model.js';
import { ScheduledReminder } from '../models/ScheduledReminder.model.js';
import { Notification } from '../models/Notification.model.js';
import { hashPassword } from '../utils/password.js';
import { generateAccessToken } from '../utils/tokens.js';
import { schedulingService, escapeRegex } from '../services/scheduling.service.js';
import { reminderWorker, ReminderWorkerService } from '../services/reminderWorker.service.js';
import { notificationService } from '../services/notification.service.js';
import { meetingService } from '../services/meeting.service.js';
import {
  isValidIanaTimeZone,
  normalizeIanaTimeZone,
  formatInTimeZone,
  calculateScheduledEnd,
  zonedDateTimeToUtc,
} from '../utils/timezone.js';

describe('Phase 16 — Scheduling & Meeting History Suite', () => {
  let server: Server;
  let baseUrl: string;
  let hostUser: any;
  let hostToken: string;
  let inviteeUser: any;
  let inviteeToken: string;
  let thirdPartyUser: any;
  let thirdPartyToken: string;

  before(async () => {
    await mongoose.connect('mongodb://127.0.0.1:27017/connectly_phase16_scheduling_test');
    await User.deleteMany({});
    await AuthSession.deleteMany({});
    await Meeting.deleteMany({});
    await MeetingParticipant.deleteMany({});
    await ScheduledReminder.deleteMany({});
    await Notification.deleteMany({});

    const passwordHash = await hashPassword('MasterSchedulePassword2026!');

    hostUser = await User.create({
      email: 'host.scheduler@connectly.io',
      passwordHash,
      firstName: 'Sarah',
      lastName: 'Connor',
      isEmailVerified: true,
    });
    hostToken = generateAccessToken({
      sub: hostUser._id.toString(),
      email: hostUser.email,
      firstName: hostUser.firstName,
      lastName: hostUser.lastName,
    });

    inviteeUser = await User.create({
      email: 'john.invitee@connectly.io',
      passwordHash,
      firstName: 'John',
      lastName: 'Connor',
      isEmailVerified: true,
    });
    inviteeToken = generateAccessToken({
      sub: inviteeUser._id.toString(),
      email: inviteeUser.email,
      firstName: inviteeUser.firstName,
      lastName: inviteeUser.lastName,
    });

    thirdPartyUser = await User.create({
      email: 'outsider.user@connectly.io',
      passwordHash,
      firstName: 'Miles',
      lastName: 'Dyson',
      isEmailVerified: true,
    });
    thirdPartyToken = generateAccessToken({
      sub: thirdPartyUser._id.toString(),
      email: thirdPartyUser.email,
      firstName: thirdPartyUser.firstName,
      lastName: thirdPartyUser.lastName,
    });

    const app = createApp();
    server = app.listen(0);
    const addr = server.address() as any;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    reminderWorker.stop();
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await mongoose.disconnect();
  });

  // =========================================================================
  // SECTION 1: TIME ZONE & CANONICAL UTC VALIDATION (FEATURE E)
  // =========================================================================
  describe('1. Time Zone Reliability & UTC Conversions (Feature E)', () => {
    it('1.1 should validate standard IANA time zones correctly', () => {
      assert.strictEqual(isValidIanaTimeZone('Asia/Kolkata'), true);
      assert.strictEqual(isValidIanaTimeZone('America/New_York'), true);
      assert.strictEqual(isValidIanaTimeZone('UTC'), true);
      assert.strictEqual(isValidIanaTimeZone('Europe/London'), true);
      assert.strictEqual(isValidIanaTimeZone('Pacific/Auckland'), true);
      assert.strictEqual(isValidIanaTimeZone(''), false);
      assert.strictEqual(isValidIanaTimeZone('NotATimeZone'), false);
      assert.strictEqual(isValidIanaTimeZone('GMT+5:30'), false); // Raw offset strings are rejected
    });

    it('1.2 should normalize valid IANA time zones and default empty to UTC', () => {
      assert.strictEqual(normalizeIanaTimeZone('  Asia/Kolkata  '), 'Asia/Kolkata');
      assert.strictEqual(normalizeIanaTimeZone(''), 'UTC');
      assert.strictEqual(normalizeIanaTimeZone(null), 'UTC');
      assert.throws(() => normalizeIanaTimeZone('FakeZone/FakeCity'), /Invalid or unsupported/);
    });

    it('1.3 should correctly calculate end time in UTC from duration', () => {
      const start = new Date('2026-12-01T10:00:00.000Z');
      const end = calculateScheduledEnd(start, 45);
      assert.strictEqual(end.toISOString(), '2026-12-01T10:45:00.000Z');
    });

    it('1.4 should handle daylight saving boundaries correctly (America/New_York)', () => {
      // EDT is UTC-4 in summer; EST is UTC-5 in winter
      const summerUtc = new Date('2026-07-01T16:00:00.000Z');
      const summerFormatted = formatInTimeZone(summerUtc, 'America/New_York', { timeStyle: 'short' });
      assert.match(summerFormatted, /12:00\s*PM/);

      const winterUtc = new Date('2026-12-01T17:00:00.000Z');
      const winterFormatted = formatInTimeZone(winterUtc, 'America/New_York', { timeStyle: 'short' });
      assert.match(winterFormatted, /12:00\s*PM/);
    });
  });

  // =========================================================================
  // SECTION 2: CREATE SCHEDULED MEETING (FEATURE A1)
  // =========================================================================
  describe('2. Create Scheduled Meeting (Feature A1)', () => {
    let createdMeetingId: string;

    it('2.1 should reject unauthenticated request with 401', async () => {
      const res = await fetch(`${baseUrl}/api/v1/meetings/scheduled`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Planning Session',
          scheduledStartAt: new Date(Date.now() + 3600_000).toISOString(),
        }),
      });
      assert.strictEqual(res.status, 401);
    });

    it('2.2 should reject meetings scheduled in the past with 400', async () => {
      const pastTime = new Date(Date.now() - 3600_000).toISOString();
      const res = await fetch(`${baseUrl}/api/v1/meetings/scheduled`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${hostToken}`,
        },
        body: JSON.stringify({
          title: 'Past Meeting',
          scheduledStartAt: pastTime,
        }),
      });
      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.strictEqual(body.code, 'VALIDATION_ERROR');
    });

    it('2.3 should reject invalid IANA time zone with 400', async () => {
      const futureTime = new Date(Date.now() + 86400_000).toISOString();
      const res = await fetch(`${baseUrl}/api/v1/meetings/scheduled`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${hostToken}`,
        },
        body: JSON.stringify({
          title: 'Zone Test',
          scheduledStartAt: futureTime,
          scheduledTimeZone: 'Mars/Curiosity',
        }),
      });
      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.strictEqual(body.code, 'VALIDATION_ERROR');
    });

    it('2.4 should reject duration out of bounds (< 15 or > 1440 mins) with 400', async () => {
      const futureTime = new Date(Date.now() + 86400_000).toISOString();
      const resTooShort = await fetch(`${baseUrl}/api/v1/meetings/scheduled`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${hostToken}`,
        },
        body: JSON.stringify({
          title: 'Short Meeting',
          scheduledStartAt: futureTime,
          durationMinutes: 10,
        }),
      });
      assert.strictEqual(resTooShort.status, 400);

      const resTooLong = await fetch(`${baseUrl}/api/v1/meetings/scheduled`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${hostToken}`,
        },
        body: JSON.stringify({
          title: 'Long Meeting',
          scheduledStartAt: futureTime,
          durationMinutes: 1500,
        }),
      });
      assert.strictEqual(resTooLong.status, 400);
    });

    it('2.5 should successfully schedule a meeting with canonical UTC storage, invitees & reminders', async () => {
      const futureStart = new Date(Date.now() + 2 * 3600_000); // 2 hours from now
      const res = await fetch(`${baseUrl}/api/v1/meetings/scheduled`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${hostToken}`,
        },
        body: JSON.stringify({
          title: 'Q4 Product Roadmap Sync',
          description: 'Quarterly strategic alignment session with core engineering',
          scheduledStartAt: futureStart.toISOString(),
          durationMinutes: 90,
          scheduledTimeZone: 'Asia/Kolkata',
          invitees: [
            { email: 'john.invitee@connectly.io', name: 'John Connor' },
            { email: 'external.partner@acme.com', name: 'External Partner' },
          ],
          reminderPreferences: [15, 60],
          settings: {
            waitingRoomEnabled: true,
            allowCoHostAdmit: true,
          },
        }),
      });

      assert.strictEqual(res.status, 201);
      const body = await res.json();
      assert.strictEqual(body.status, 201);
      assert.ok(body.data.meeting);

      const m = body.data.meeting;
      createdMeetingId = m.id;

      assert.match(m.meetingCode, /^cly-[a-z0-9]{3}-[a-z0-9]{3}$/);
      assert.strictEqual(m.title, 'Q4 Product Roadmap Sync');
      assert.strictEqual(m.description, 'Quarterly strategic alignment session with core engineering');
      assert.strictEqual(m.status, 'SCHEDULED');
      assert.strictEqual(m.scheduledTimeZone, 'Asia/Kolkata');
      assert.strictEqual(m.durationMinutes, 90);
      assert.strictEqual(m.settings.waitingRoomEnabled, true);

      // Verify raw database record
      const rawDoc = await Meeting.findById(createdMeetingId);
      assert.ok(rawDoc);
      assert.strictEqual(rawDoc.status, 'SCHEDULED');
      assert.strictEqual(rawDoc.scheduledTimeZone, 'Asia/Kolkata');
      assert.strictEqual(rawDoc.auditLog[0].action, 'SCHEDULED');

      // Verify invitee resolution (john.invitee attached userId)
      assert.strictEqual(rawDoc.invitees.length, 2);
      const johnInv = rawDoc.invitees.find((i) => i.email === 'john.invitee@connectly.io');
      assert.ok(johnInv?.userId);
      assert.strictEqual(johnInv.userId.toString(), inviteeUser._id.toString());

      // Verify in-app invitation notification was created for John
      const notifs = await Notification.find({ userId: inviteeUser._id });
      assert.strictEqual(notifs.length, 1);
      assert.strictEqual(notifs[0].type, 'MEETING_INVITATION');
      assert.match(notifs[0].message, /Q4 Product Roadmap Sync/);

      // Verify reminders generated in ScheduledReminder collection
      const reminders = await ScheduledReminder.find({ meetingId: rawDoc._id });
      assert.strictEqual(reminders.length >= 2, true);
    });
  });

  // =========================================================================
  // SECTION 3: EDIT & RESCHEDULE SCHEDULED MEETING (FEATURES A2 & A3)
  // =========================================================================
  describe('3. Edit & Reschedule Scheduled Meeting (Features A2 & A3)', () => {
    let testMeeting: any;

    beforeEach(async () => {
      testMeeting = await schedulingService.scheduleMeeting(hostUser._id.toString(), {
        title: 'Sprint Planning',
        description: 'Initial sprint planning draft',
        scheduledStartAt: new Date(Date.now() + 5 * 3600_000).toISOString(),
        durationMinutes: 60,
        scheduledTimeZone: 'UTC',
        invitees: [{ email: 'john.invitee@connectly.io' }],
        reminderPreferences: [15, 60],
      });
    });

    it('3.1 should reject unauthorized user edit attempt with 403', async () => {
      const res = await fetch(`${baseUrl}/api/v1/meetings/scheduled/${testMeeting.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${inviteeToken}`,
        },
        body: JSON.stringify({
          title: 'Hacked Title',
        }),
      });
      assert.strictEqual(res.status, 403);
    });

    it('3.2 should allow host to update title, description, and settings', async () => {
      const res = await fetch(`${baseUrl}/api/v1/meetings/scheduled/${testMeeting.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${hostToken}`,
        },
        body: JSON.stringify({
          title: 'Sprint Planning — Refined',
          description: 'Updated sprint agenda and backlog items',
          settings: {
            waitingRoomEnabled: true,
          },
        }),
      });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.data.meeting.title, 'Sprint Planning — Refined');
      assert.strictEqual(body.data.meeting.settings.waitingRoomEnabled, true);

      // Verify audit log has SETTINGS_UPDATED
      const doc = await Meeting.findById(testMeeting.id);
      assert.ok(doc?.auditLog.some((e) => e.action === 'SETTINGS_UPDATED'));
    });

    it('3.3 should reschedule meeting to a new time and update reminders', async () => {
      const newStart = new Date(Date.now() + 10 * 3600_000);
      const res = await fetch(`${baseUrl}/api/v1/meetings/scheduled/${testMeeting.id}/reschedule`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${hostToken}`,
        },
        body: JSON.stringify({
          scheduledStartAt: newStart.toISOString(),
          durationMinutes: 90,
          scheduledTimeZone: 'Asia/Kolkata',
        }),
      });

      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.data.meeting.scheduledTimeZone, 'Asia/Kolkata');
      assert.strictEqual(body.data.meeting.durationMinutes, 90);
      assert.strictEqual(body.data.meeting.scheduleVersion, 2);

      // Check that John received a MEETING_RESCHEDULED notification
      const notif = await Notification.findOne({
        userId: inviteeUser._id,
        type: 'MEETING_RESCHEDULED',
      });
      assert.ok(notif);
      assert.match(notif.message, /rescheduled/i);
    });

    it('3.4 should reject rescheduling to a past time with 400', async () => {
      const pastTime = new Date(Date.now() - 3600_000).toISOString();
      const res = await fetch(`${baseUrl}/api/v1/meetings/scheduled/${testMeeting.id}/reschedule`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${hostToken}`,
        },
        body: JSON.stringify({
          scheduledStartAt: pastTime,
        }),
      });
      assert.strictEqual(res.status, 400);
    });
  });

  // =========================================================================
  // SECTION 4: CANCEL SCHEDULED MEETING & JOIN DEFENSE (FEATURE A4 & B)
  // =========================================================================
  describe('4. Cancel Scheduled Meeting & Join Defense (Features A4 & B)', () => {
    let cancelTestMeeting: any;

    beforeEach(async () => {
      cancelTestMeeting = await schedulingService.scheduleMeeting(hostUser._id.toString(), {
        title: 'Executive Sync',
        scheduledStartAt: new Date(Date.now() + 4 * 3600_000).toISOString(),
        durationMinutes: 30,
        invitees: [{ email: 'john.invitee@connectly.io' }],
      });
    });

    it('4.1 should reject cancellation by unauthorized user with 403', async () => {
      const res = await fetch(`${baseUrl}/api/v1/meetings/scheduled/${cancelTestMeeting.id}/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${thirdPartyToken}`,
        },
        body: JSON.stringify({ reason: 'Malicious cancellation' }),
      });
      assert.strictEqual(res.status, 403);
    });

    it('4.2 should allow host to cancel meeting with reason, cancel reminders, and notify invitees', async () => {
      const res = await fetch(`${baseUrl}/api/v1/meetings/scheduled/${cancelTestMeeting.id}/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${hostToken}`,
        },
        body: JSON.stringify({ reason: 'Project milestone reached early' }),
      });

      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.data.meeting.status, 'CANCELLED');
      assert.strictEqual(body.data.meeting.cancellationReason, 'Project milestone reached early');

      // Verify reminders were marked CANCELLED
      const reminders = await ScheduledReminder.find({ meetingId: cancelTestMeeting.id });
      assert.ok(reminders.length > 0);
      assert.strictEqual(reminders.every((r) => r.status === 'CANCELLED'), true);

      // Verify cancellation notification for John
      const cancelNotif = await Notification.findOne({
        userId: inviteeUser._id,
        type: 'MEETING_CANCELLED',
      });
      assert.ok(cancelNotif);
      assert.match(cancelNotif.message, /Project milestone reached early/);
    });

    it('4.3 should be idempotent: second cancellation succeeds without error', async () => {
      // First cancel
      await schedulingService.cancelScheduledMeeting(hostUser._id.toString(), cancelTestMeeting.id);

      // Second cancel via HTTP API
      const res = await fetch(`${baseUrl}/api/v1/meetings/scheduled/${cancelTestMeeting.id}/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${hostToken}`,
        },
        body: JSON.stringify({ reason: 'Repeated cancel' }),
      });

      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.data.meeting.status, 'CANCELLED');
    });

    it('4.4 should preserve cancelled meeting in database (does NOT physically delete record)', async () => {
      await schedulingService.cancelScheduledMeeting(hostUser._id.toString(), cancelTestMeeting.id);
      const doc = await Meeting.findById(cancelTestMeeting.id);
      assert.ok(doc, 'Cancelled meeting record must persist in MongoDB');
      assert.strictEqual(doc.status, 'CANCELLED');
    });

    it('4.5 should strictly REJECT joining a cancelled meeting with HTTP 410 MEETING_CANCELLED', async () => {
      await schedulingService.cancelScheduledMeeting(hostUser._id.toString(), cancelTestMeeting.id);

      const res = await fetch(`${baseUrl}/api/v1/meetings/${cancelTestMeeting.meetingCode}/join`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${inviteeToken}`,
        },
        body: JSON.stringify({ displayName: 'John' }),
      });

      assert.strictEqual(res.status, 410);
      const body = await res.json();
      assert.strictEqual(body.code, 'MEETING_CANCELLED');
    });

    it('4.6 should reject editing or rescheduling a cancelled meeting with 400', async () => {
      await schedulingService.cancelScheduledMeeting(hostUser._id.toString(), cancelTestMeeting.id);

      const editRes = await fetch(`${baseUrl}/api/v1/meetings/scheduled/${cancelTestMeeting.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${hostToken}`,
        },
        body: JSON.stringify({ title: 'New Title' }),
      });
      assert.strictEqual(editRes.status, 400);

      const reschedRes = await fetch(
        `${baseUrl}/api/v1/meetings/scheduled/${cancelTestMeeting.id}/reschedule`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${hostToken}`,
          },
          body: JSON.stringify({
            scheduledStartAt: new Date(Date.now() + 86400_000).toISOString(),
          }),
        }
      );
      assert.strictEqual(reschedRes.status, 400);
    });
  });

  // =========================================================================
  // SECTION 5: UPCOMING MEETINGS DASHBOARD (FEATURE C)
  // =========================================================================
  describe('5. Upcoming Meetings Dashboard (Feature C)', () => {
    beforeEach(async () => {
      await Meeting.deleteMany({});
      // Meeting 1: in 2 hours (Host = Sarah, Invitee = John)
      await schedulingService.scheduleMeeting(hostUser._id.toString(), {
        title: 'Upcoming Meeting 1',
        scheduledStartAt: new Date(Date.now() + 2 * 3600_000).toISOString(),
        invitees: [{ email: 'john.invitee@connectly.io' }],
      });

      // Meeting 2: in 5 hours (Host = Sarah, Invitee = John)
      await schedulingService.scheduleMeeting(hostUser._id.toString(), {
        title: 'Upcoming Meeting 2',
        scheduledStartAt: new Date(Date.now() + 5 * 3600_000).toISOString(),
        invitees: [{ email: 'john.invitee@connectly.io' }],
      });

      // Meeting 3: Cancelled (should NOT appear in upcoming)
      const m3 = await schedulingService.scheduleMeeting(hostUser._id.toString(), {
        title: 'Cancelled Meeting',
        scheduledStartAt: new Date(Date.now() + 3 * 3600_000).toISOString(),
      });
      await schedulingService.cancelScheduledMeeting(hostUser._id.toString(), m3.id);
    });

    it('5.1 should list upcoming meetings chronologically ascending for host', async () => {
      const res = await fetch(`${baseUrl}/api/v1/meetings/scheduled`, {
        headers: { Authorization: `Bearer ${hostToken}` },
      });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.data.meetings.length, 2);
      assert.strictEqual(body.data.meetings[0].title, 'Upcoming Meeting 1');
      assert.strictEqual(body.data.meetings[1].title, 'Upcoming Meeting 2');
    });

    it('5.2 should list upcoming meetings for invited participants', async () => {
      const res = await fetch(`${baseUrl}/api/v1/meetings/scheduled`, {
        headers: { Authorization: `Bearer ${inviteeToken}` },
      });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.data.meetings.length, 2);
    });

    it('5.3 should return empty list for non-invited third party user', async () => {
      const res = await fetch(`${baseUrl}/api/v1/meetings/scheduled`, {
        headers: { Authorization: `Bearer ${thirdPartyToken}` },
      });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.data.meetings.length, 0);
    });

    it('5.4 should support server-side pagination (limit=1)', async () => {
      const res = await fetch(`${baseUrl}/api/v1/meetings/scheduled?page=1&limit=1`, {
        headers: { Authorization: `Bearer ${hostToken}` },
      });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.data.meetings.length, 1);
      assert.strictEqual(body.data.pagination.total, 2);
      assert.strictEqual(body.data.pagination.totalPages, 2);
    });
  });

  // =========================================================================
  // SECTION 6: MEETING HISTORY & OBJECT-LEVEL AUTHORIZATION (FEATURE D)
  // =========================================================================
  describe('6. Meeting History & Object-Level Authorization (Feature D)', () => {
    let completedMeetingId: string;

    before(async () => {
      await Meeting.deleteMany({});
      await MeetingParticipant.deleteMany({});

      // 1. Create and complete a meeting attended by John
      const m1 = await meetingService.createMeeting(hostUser._id.toString(), {
        title: 'Completed Strategy Review',
      });
      completedMeetingId = m1.meeting.id;

      // Host joins
      await meetingService.joinMeeting(m1.meeting.meetingCode, hostUser._id.toString());
      // John joins
      await meetingService.joinMeeting(m1.meeting.meetingCode, inviteeUser._id.toString(), {
        displayName: 'John Attendant',
      });
      // Host ends meeting
      await meetingService.endMeeting(m1.meeting.meetingCode, hostUser._id.toString());

      // 2. Create and cancel a meeting
      const m2 = await schedulingService.scheduleMeeting(hostUser._id.toString(), {
        title: 'Cancelled Operations Sync',
        scheduledStartAt: new Date(Date.now() + 3600_000).toISOString(),
      });
      await schedulingService.cancelScheduledMeeting(hostUser._id.toString(), m2.id, {
        reason: 'Budget postponed',
      });
    });

    it('6.1 should return completed and cancelled meetings in host history', async () => {
      const res = await fetch(`${baseUrl}/api/v1/meetings/history`, {
        headers: { Authorization: `Bearer ${hostToken}` },
      });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.data.meetings.length >= 2, true);
    });

    it('6.2 should return attended meeting in John\'s history with userRole="participant"', async () => {
      const res = await fetch(`${baseUrl}/api/v1/meetings/history`, {
        headers: { Authorization: `Bearer ${inviteeToken}` },
      });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      const attended = body.data.meetings.find((m: any) => m.id === completedMeetingId);
      assert.ok(attended, 'John must see the meeting he attended in his history');
      assert.strictEqual(attended.userRole, 'participant');
      assert.strictEqual(attended.status, 'ENDED');
      assert.ok(typeof attended.actualDurationSeconds === 'number');
    });

    it('6.3 should support filtering history by status (CANCELLED vs ENDED)', async () => {
      const resCancelled = await fetch(`${baseUrl}/api/v1/meetings/history?status=CANCELLED`, {
        headers: { Authorization: `Bearer ${hostToken}` },
      });
      const bodyCancelled = await resCancelled.json();
      assert.strictEqual(bodyCancelled.data.meetings.every((m: any) => m.status === 'CANCELLED'), true);

      const resEnded = await fetch(`${baseUrl}/api/v1/meetings/history?status=ENDED`, {
        headers: { Authorization: `Bearer ${hostToken}` },
      });
      const bodyEnded = await resEnded.json();
      assert.strictEqual(bodyEnded.data.meetings.every((m: any) => m.status === 'ENDED' || m.status === 'EXPIRED'), true);
    });

    it('6.4 should support search filter by title or meeting code', async () => {
      const res = await fetch(`${baseUrl}/api/v1/meetings/history?search=Strategy`, {
        headers: { Authorization: `Bearer ${hostToken}` },
      });
      const body = await res.json();
      assert.strictEqual(body.data.meetings.length, 1);
      assert.strictEqual(body.data.meetings[0].title, 'Completed Strategy Review');
    });

    it('6.5 should allow host and participant to view meeting history details and timeline', async () => {
      const resHost = await fetch(`${baseUrl}/api/v1/meetings/history/${completedMeetingId}`, {
        headers: { Authorization: `Bearer ${hostToken}` },
      });
      assert.strictEqual(resHost.status, 200);
      const bodyHost = await resHost.json();
      assert.ok(bodyHost.data.meeting);
      assert.ok(Array.isArray(bodyHost.data.participants));
      assert.ok(bodyHost.data.participants.length >= 2);
      assert.ok(Array.isArray(bodyHost.data.timeline));

      const resParticipant = await fetch(`${baseUrl}/api/v1/meetings/history/${completedMeetingId}`, {
        headers: { Authorization: `Bearer ${inviteeToken}` },
      });
      assert.strictEqual(resParticipant.status, 200);
    });

    it('6.6 should strictly REJECT third-party user from inspecting private history details with 403', async () => {
      const res = await fetch(`${baseUrl}/api/v1/meetings/history/${completedMeetingId}`, {
        headers: { Authorization: `Bearer ${thirdPartyToken}` },
      });
      assert.strictEqual(res.status, 403);
      const body = await res.json();
      assert.strictEqual(body.code, 'FORBIDDEN');
    });
  });

  // =========================================================================
  // SECTION 7: MEETING INVITATIONS (FEATURE F)
  // =========================================================================
  describe('7. Meeting Invitations (Feature F)', () => {
    it('7.1 should generate clean invitation text without exposing tokens or credentials', async () => {
      const meeting = await schedulingService.scheduleMeeting(hostUser._id.toString(), {
        title: 'Design Review',
        scheduledStartAt: new Date(Date.now() + 7200_000).toISOString(),
        scheduledTimeZone: 'Asia/Kolkata',
      });

      const res = await fetch(`${baseUrl}/api/v1/meetings/${meeting.meetingCode}/invitation`, {
        headers: { Authorization: `Bearer ${hostToken}` },
      });
      assert.strictEqual(res.status, 200);
      const body = await res.json();

      const inv = body.data;
      assert.strictEqual(inv.meetingCode, meeting.meetingCode);
      assert.strictEqual(inv.title, 'Design Review');
      assert.match(inv.joinUrl, new RegExp(`/join/${meeting.meetingCode}`));
      assert.match(inv.invitationText, /Design Review/);
      assert.match(inv.invitationText, /Sarah Connor/);

      // Verify zero security credential leakages
      assert.doesNotMatch(inv.joinUrl, /token|jwt|bearer|secret|password|access/i);
      assert.doesNotMatch(inv.invitationText, /token|jwt|bearer|secret|password/i);
    });
  });

  // =========================================================================
  // SECTION 8: DURABLE REMINDERS & IN-APP NOTIFICATIONS (FEATURE G)
  // =========================================================================
  describe('8. Durable Reminders & Multi-Worker Atomic Leases (Feature G)', () => {
    it('8.1 should generate database-backed reminders with unique constraint preventing duplicates', async () => {
      const meeting = await schedulingService.scheduleMeeting(hostUser._id.toString(), {
        title: 'Reminder Test Session',
        scheduledStartAt: new Date(Date.now() + 3 * 3600_000).toISOString(),
        reminderPreferences: [15, 60],
      });

      const rawMeeting = await Meeting.findById(meeting.id);
      assert.ok(rawMeeting);

      // Call generateRemindersForMeeting twice
      await reminderWorker.generateRemindersForMeeting(rawMeeting);
      await reminderWorker.generateRemindersForMeeting(rawMeeting);

      const count = await ScheduledReminder.countDocuments({
        meetingId: rawMeeting._id,
        userId: hostUser._id,
      });
      assert.strictEqual(count, 2, 'Must not duplicate reminders under repeated calls');
    });

    it('8.2 should atomically claim and deliver due reminders with worker lease', async () => {
      // Create a due reminder artificially
      const meeting = await schedulingService.scheduleMeeting(hostUser._id.toString(), {
        title: 'Immediate Due Session',
        scheduledStartAt: new Date(Date.now() + 3 * 3600_000).toISOString(),
        reminderPreferences: [15],
      });

      // Update remindAt to the past so worker picks it up
      await ScheduledReminder.updateMany(
        { meetingId: meeting.id },
        { $set: { remindAt: new Date(Date.now() - 10_000) } }
      );

      const workerA = new ReminderWorkerService('worker-A');
      const workerB = new ReminderWorkerService('worker-B');

      // Both workers attempt to process due reminders simultaneously
      const [processedA, processedB] = await Promise.all([
        workerA.processDueReminders(10),
        workerB.processDueReminders(10),
      ]);

      const totalDelivered = processedA + processedB;
      assert.strictEqual(totalDelivered, 1, 'Exactly one worker must claim and deliver the reminder');

      const reminder = await ScheduledReminder.findOne({ meetingId: meeting.id });
      assert.strictEqual(reminder?.status, 'SENT');
      assert.ok(reminder?.sentAt);
      assert.ok(reminder?.claimedBy === 'worker-A' || reminder?.claimedBy === 'worker-B');
    });

    it('8.3 should list user notifications, mark read, and mark all read', async () => {
      // Notification list
      const listRes = await fetch(`${baseUrl}/api/v1/users/me/notifications`, {
        headers: { Authorization: `Bearer ${inviteeToken}` },
      });
      assert.strictEqual(listRes.status, 200);
      const listBody = await listRes.json();
      assert.ok(listBody.data.notifications.length > 0);
      assert.ok(typeof listBody.data.unreadCount === 'number');

      const notifId = listBody.data.notifications[0].id;

      // Mark single read
      const markRes = await fetch(`${baseUrl}/api/v1/users/me/notifications/${notifId}/read`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${inviteeToken}` },
      });
      assert.strictEqual(markRes.status, 200);

      // Mark all read
      const markAllRes = await fetch(`${baseUrl}/api/v1/users/me/notifications/read-all`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${inviteeToken}` },
      });
      assert.strictEqual(markAllRes.status, 200);

      const checkRes = await fetch(`${baseUrl}/api/v1/users/me/notifications?unreadOnly=true`, {
        headers: { Authorization: `Bearer ${inviteeToken}` },
      });
      const checkBody = await checkRes.json();
      assert.strictEqual(checkBody.data.notifications.length, 0);
      assert.strictEqual(checkBody.data.unreadCount, 0);
    });
  });

  // =========================================================================
  // SECTION 9: LIFECYCLE TRANSITION: SCHEDULED -> ACTIVE -> ENDED (FEATURE B)
  // =========================================================================
  describe('9. Meeting Lifecycle Transition (Feature B)', () => {
    it('9.1 should transition SCHEDULED meeting to ACTIVE when host joins, and ENDED when host ends', async () => {
      const scheduled = await schedulingService.scheduleMeeting(hostUser._id.toString(), {
        title: 'Full Lifecycle Live Test',
        scheduledStartAt: new Date(Date.now() + 3600_000).toISOString(),
      });
      assert.strictEqual(scheduled.status, 'SCHEDULED');

      // 1. Host joins: transitions to ACTIVE and sets activatedAt
      const joinResult = await meetingService.joinMeeting(
        scheduled.meetingCode,
        hostUser._id.toString()
      );
      assert.strictEqual(joinResult.meeting.status, 'ACTIVE');
      assert.ok(joinResult.meeting.activatedAt);

      const activeDoc = await Meeting.findById(scheduled.id);
      assert.strictEqual(activeDoc?.status, 'ACTIVE');
      assert.ok(activeDoc?.activatedAt);

      // 2. Host ends meeting
      const endResult = await meetingService.endMeeting(
        scheduled.meetingCode,
        hostUser._id.toString()
      );
      assert.strictEqual(endResult.meeting.status, 'ENDED');
      assert.ok(endResult.meeting.endedAt);

      const endedDoc = await Meeting.findById(scheduled.id);
      assert.strictEqual(endedDoc?.status, 'ENDED');
      assert.ok(endedDoc?.endedAt);
    });
  });

  // =========================================================================
  // SECTION 10: DEF-16-01 THROUGH DEF-16-07 TARGETED REMEDIATION & REGRESSION
  // =========================================================================
  describe('10. DEF-16-01 through DEF-16-07 Targeted Remediation & Regression Suite', () => {
    it('10.1 DEF-16-01: escapeRegex sanitizes user search and prevents ReDoS/regex crashes', async () => {
      // 1. Verify escapeRegex escapes all metacharacters
      const dirty = '.*+?^${}()|[]\\';
      const clean = escapeRegex(dirty);
      assert.strictEqual(clean, '\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\');

      // 2. Seed meeting with metacharacters in title
      await Meeting.create({
        meetingCode: 'cly-sec-001',
        title: '[Security] Architecture Review (Q4) + Audit',
        hostId: hostUser._id,
        originalHostId: hostUser._id,
        status: 'ENDED',
        endedAt: new Date(),
        maxParticipants: 60,
        activeParticipantCount: 0,
        expiresAt: new Date(Date.now() + 86400_000),
      });

      // 3. Search with dangerous/special characters that would crash raw $regex
      const dangerousInputs = ['[Security]', '(', '+', '.*', 'a+)+', '\\', '/', '[', '*'];
      for (const dangerous of dangerousInputs) {
        const historyRes = await schedulingService.listMeetingHistory(hostUser._id.toString(), {
          search: dangerous,
          role: 'all',
          status: 'all',
        });
        assert.ok(Array.isArray(historyRes.meetings), `Search for "${dangerous}" must return cleanly`);
      }

      // 4. Verify literal match works
      const found = await schedulingService.listMeetingHistory(hostUser._id.toString(), {
        search: '[Security]',
        role: 'all',
        status: 'all',
      });
      assert.ok(found.meetings.some((m) => m.title.includes('[Security]')));

      // 5. Verify search input exceeding length limits is rejected at API layer and safe in service
      const longSearch = 'A'.repeat(150);
      const httpRes = await fetch(`${baseUrl}/api/v1/meetings/history?search=${longSearch}`, {
        headers: { Authorization: `Bearer ${hostToken}` },
      });
      assert.strictEqual(httpRes.status, 400, 'HTTP API must reject search query exceeding 100 characters');

      const serviceRes = await schedulingService.listMeetingHistory(hostUser._id.toString(), {
        search: longSearch,
        role: 'all',
        status: 'all',
      });
      assert.ok(Array.isArray(serviceRes.meetings), 'Direct service call handles long search string safely');
    });

    it('10.2 DEF-16-02: Reminder worker claim fencing token prevents stale worker writes & deliveryKey deduplicates', async () => {
      const now = new Date();
      const testMeeting = await Meeting.create({
        meetingCode: 'cly-fnc-001',
        title: 'Fencing Token Verification Meeting',
        hostId: hostUser._id,
        originalHostId: hostUser._id,
        status: 'SCHEDULED',
        scheduledStartAt: new Date(now.getTime() + 15 * 60 * 1000),
        scheduledEndAt: new Date(now.getTime() + 75 * 60 * 1000),
        scheduledTimeZone: 'UTC',
        maxParticipants: 60,
        activeParticipantCount: 0,
        expiresAt: new Date(now.getTime() + 86400_000),
      });

      const reminder = await ScheduledReminder.create({
        meetingId: testMeeting._id,
        userId: inviteeUser._id,
        triggerMinutesBefore: 15,
        remindAt: new Date(now.getTime() - 1000), // Due now
        status: 'PENDING',
        claimFenceVersion: 0,
        retryCount: 0,
      });

      // Simulate Worker A claiming the reminder
      const claimedA = await ScheduledReminder.findOneAndUpdate(
        { _id: reminder._id, status: 'PENDING' },
        {
          $set: {
            status: 'CLAIMED',
            claimedAt: new Date(),
            claimedBy: 'worker-A',
          },
          $inc: { claimFenceVersion: 1 },
        },
        { new: true }
      );
      assert.ok(claimedA);
      assert.strictEqual(claimedA.claimFenceVersion, 1);

      // Simulate Worker B or stale Worker A attempting to update with obsolete claimFenceVersion 0
      const staleUpdate = await ScheduledReminder.updateOne(
        {
          _id: reminder._id,
          status: 'CLAIMED',
          claimedBy: 'worker-A',
          claimFenceVersion: 0, // stale fence token
        },
        { $set: { status: 'SENT', sentAt: new Date() } }
      );
      assert.strictEqual(staleUpdate.modifiedCount, 0, 'Stale fence token must be rejected');

      // Legitimate update with current claimFenceVersion 1 succeeds
      const validUpdate = await ScheduledReminder.updateOne(
        {
          _id: reminder._id,
          status: 'CLAIMED',
          claimedBy: 'worker-A',
          claimFenceVersion: 1, // current fence token
        },
        { $set: { status: 'SENT', sentAt: new Date() } }
      );
      assert.strictEqual(validUpdate.modifiedCount, 1, 'Valid fence token must succeed');

      // Test deliveryKey idempotent deduplication
      const testKey = `test-dedup-${Date.now()}`;
      const notif1 = await notificationService.createNotification({
        userId: inviteeUser._id,
        type: 'MEETING_REMINDER',
        title: 'Dedup Title',
        message: 'Dedup Message',
        deliveryKey: testKey,
      });
      const notif2 = await notificationService.createNotification({
        userId: inviteeUser._id,
        type: 'MEETING_REMINDER',
        title: 'Dedup Title',
        message: 'Dedup Message',
        deliveryKey: testKey,
      });
      assert.strictEqual(notif1.id, notif2.id, 'Duplicate deliveryKey must return existing notification');

      // Live multi-instance worker test with lease expiration and fencing verification
      const workerAlpha = new ReminderWorkerService('worker-alpha');
      const workerBeta = new ReminderWorkerService('worker-beta');

      const leaseMeeting = await Meeting.create({
        meetingCode: 'cly-lse-001',
        title: 'Live Worker Lease Meeting',
        hostId: hostUser._id,
        originalHostId: hostUser._id,
        status: 'SCHEDULED',
        scheduledStartAt: new Date(Date.now() + 15 * 60 * 1000),
        scheduledEndAt: new Date(Date.now() + 75 * 60 * 1000),
        scheduledTimeZone: 'UTC',
        maxParticipants: 60,
        activeParticipantCount: 0,
        expiresAt: new Date(Date.now() + 86400_000),
      });

      const leaseReminder = await ScheduledReminder.create({
        meetingId: leaseMeeting._id,
        userId: inviteeUser._id,
        triggerMinutesBefore: 15,
        remindAt: new Date(Date.now() - 5000),
        status: 'PENDING',
        claimFenceVersion: 0,
        retryCount: 0,
      });

      // Worker Alpha claims the reminder and then hangs (simulating >60s lease timeout)
      const claimedByAlpha = await ScheduledReminder.findOneAndUpdate(
        { _id: leaseReminder._id, status: 'PENDING' },
        {
          $set: {
            status: 'CLAIMED',
            claimedAt: new Date(Date.now() - 70_000), // Hung 70s ago (> 60s lease expiry)
            claimedBy: workerAlpha.getWorkerId(),
          },
          $inc: { claimFenceVersion: 1 },
        },
        { new: true }
      );
      assert.ok(claimedByAlpha);
      assert.strictEqual(claimedByAlpha.claimFenceVersion, 1);
      assert.strictEqual(claimedByAlpha.claimedBy, workerAlpha.getWorkerId());

      // Worker Beta detects expired lease, reclaims reminder with fence token 2, and delivers notification
      const countBeta = await workerBeta.processDueReminders(5);
      assert.strictEqual(countBeta >= 1, true, 'Worker Beta must reclaim and process the expired reminder');

      const updatedReminder = await ScheduledReminder.findById(leaseReminder._id);
      assert.strictEqual(updatedReminder?.status, 'SENT');
      assert.strictEqual(updatedReminder?.claimedBy, workerBeta.getWorkerId());
      assert.strictEqual(updatedReminder?.claimFenceVersion, 2, 'Fence token must have incremented to 2');

      // Stale Worker Alpha unpauses and attempts to update using obsolete claimFenceVersion 1
      const staleAlphaUpdate = await ScheduledReminder.updateOne(
        {
          _id: leaseReminder._id,
          status: 'CLAIMED',
          claimedBy: workerAlpha.getWorkerId(),
          claimFenceVersion: 1,
        },
        { $set: { status: 'SENT', sentAt: new Date() } }
      );
      assert.strictEqual(staleAlphaUpdate.modifiedCount, 0, 'Stale Worker Alpha write must be rejected with 0 modified');
    });

    it('10.3 DEF-16-03: zonedDateTimeToUtc computes exact UTC timestamps across DST transitions and detects gaps', () => {
      // 1. New York Winter (Standard, EST UTC-5)
      const nyWinter = zonedDateTimeToUtc('2026-12-01', '14:00', 'America/New_York');
      assert.strictEqual(nyWinter.isExact, true);
      assert.strictEqual(nyWinter.isoString, '2026-12-01T19:00:00.000Z');

      // 2. New York Summer (Daylight, EDT UTC-4)
      const nySummer = zonedDateTimeToUtc('2026-07-01', '14:00', 'America/New_York');
      assert.strictEqual(nySummer.isExact, true);
      assert.strictEqual(nySummer.isoString, '2026-07-01T18:00:00.000Z');

      // 3. Asia/Kolkata (IST UTC+5:30)
      const kolkata = zonedDateTimeToUtc('2026-12-01', '14:00', 'Asia/Kolkata');
      assert.strictEqual(kolkata.isExact, true);
      assert.strictEqual(kolkata.isoString, '2026-12-01T08:30:00.000Z');

      // 4. London GMT (UTC+0) vs BST (UTC+1)
      const lonWinter = zonedDateTimeToUtc('2026-12-01', '14:00', 'Europe/London');
      assert.strictEqual(lonWinter.isoString, '2026-12-01T14:00:00.000Z');
      const lonSummer = zonedDateTimeToUtc('2026-07-01', '14:00', 'Europe/London');
      assert.strictEqual(lonSummer.isoString, '2026-07-01T13:00:00.000Z');

      // 5. Spring forward gap detection (2:30 AM does not exist in New York on 2026-03-08)
      const nyGap = zonedDateTimeToUtc('2026-03-08', '02:30', 'America/New_York');
      assert.strictEqual(nyGap.isExact, false, 'Non-existent spring-forward wall clock time must have isExact: false');

      // 6. Fall-back DST ambiguity detection on 2026-11-01 01:30 America/New_York (DEF-16-03)
      // Default policy ('earlier')
      const nyAmbiguous = zonedDateTimeToUtc('2026-11-01', '01:30', 'America/New_York');
      assert.strictEqual(nyAmbiguous.isExact, true);
      assert.strictEqual(nyAmbiguous.isAmbiguous, true);
      assert.strictEqual(nyAmbiguous.ambiguousInstants?.length, 2);
      assert.strictEqual(nyAmbiguous.ambiguousInstants?.[0], '2026-11-01T05:30:00.000Z');
      assert.strictEqual(nyAmbiguous.ambiguousInstants?.[1], '2026-11-01T06:30:00.000Z');
      assert.strictEqual(nyAmbiguous.isoString, '2026-11-01T05:30:00.000Z');

      // Explicit 'earlier' policy
      const nyEarlier = zonedDateTimeToUtc('2026-11-01', '01:30', 'America/New_York', 'earlier');
      assert.strictEqual(nyEarlier.isExact, true);
      assert.strictEqual(nyEarlier.isAmbiguous, true);
      assert.strictEqual(nyEarlier.isoString, '2026-11-01T05:30:00.000Z');

      // Explicit 'later' policy
      const nyLater = zonedDateTimeToUtc('2026-11-01', '01:30', 'America/New_York', 'later');
      assert.strictEqual(nyLater.isExact, true);
      assert.strictEqual(nyLater.isAmbiguous, true);
      assert.strictEqual(nyLater.isoString, '2026-11-01T06:30:00.000Z');

      // Explicit 'reject' policy
      const nyReject = zonedDateTimeToUtc('2026-11-01', '01:30', 'America/New_York', 'reject');
      assert.strictEqual(nyReject.isExact, false);
      assert.strictEqual(nyReject.isAmbiguous, true);
    });

    it('10.4 DEF-16-04: rescheduleMeeting and cancelScheduledMeeting reject ACTIVE status with HTTP 400', async () => {
      // 1. Create a scheduled meeting and manually set status to ACTIVE
      const meeting = await Meeting.create({
        meetingCode: 'cly-act-001',
        title: 'Active Invariant Test Meeting',
        hostId: hostUser._id,
        originalHostId: hostUser._id,
        status: 'ACTIVE',
        activatedAt: new Date(),
        scheduledStartAt: new Date(Date.now() + 3600_000),
        scheduledEndAt: new Date(Date.now() + 7200_000),
        scheduledTimeZone: 'UTC',
        maxParticipants: 60,
        activeParticipantCount: 1,
        expiresAt: new Date(Date.now() + 86400_000),
      });

      // 2. HTTP POST reschedule -> 400
      const reschRes = await fetch(`${baseUrl}/api/v1/meetings/scheduled/${meeting._id}/reschedule`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${hostToken}`,
        },
        body: JSON.stringify({
          scheduledStartAt: new Date(Date.now() + 86400_000).toISOString(),
        }),
      });
      assert.strictEqual(reschRes.status, 400);
      const reschBody = await reschRes.json();
      assert.strictEqual(reschBody.code, 'INVALID_MEETING_STATE');

      // 3. HTTP POST cancel -> 400
      const cancelRes = await fetch(`${baseUrl}/api/v1/meetings/scheduled/${meeting._id}/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${hostToken}`,
        },
        body: JSON.stringify({ reason: 'Attempt cancel active' }),
      });
      assert.strictEqual(cancelRes.status, 400);
      const cancelBody = await cancelRes.json();
      assert.strictEqual(cancelBody.code, 'INVALID_MEETING_STATE');

      // 4. Verify direct service calls reject as well
      await assert.rejects(
        async () => {
          await schedulingService.rescheduleMeeting(hostUser._id.toString(), meeting._id.toString(), {
            scheduledStartAt: new Date(Date.now() + 86400_000).toISOString(),
          });
        },
        { code: 'INVALID_MEETING_STATE' }
      );

      await assert.rejects(
        async () => {
          await schedulingService.cancelScheduledMeeting(hostUser._id.toString(), meeting._id.toString(), {
            reason: 'Direct call cancel active',
          });
        },
        { code: 'INVALID_MEETING_STATE' }
      );
    });

    it('10.5 DEF-16-05: Meeting history accurately derives attended participant count for completed meetings', async () => {
      const now = new Date();
      const endedMeeting = await Meeting.create({
        meetingCode: 'cly-cnt-001',
        title: 'Attended Count Derived Test',
        hostId: hostUser._id,
        originalHostId: hostUser._id,
        status: 'ENDED',
        activatedAt: new Date(now.getTime() - 3600_000),
        endedAt: now,
        maxParticipants: 60,
        activeParticipantCount: 0, // Reset to 0 on termination
        expiresAt: new Date(now.getTime() + 86400_000),
      });

      // Add 2 participants who joined the meeting
      await MeetingParticipant.create([
        {
          meetingId: endedMeeting._id,
          userId: hostUser._id,
          displayName: 'Sarah Connor',
          email: hostUser.email,
          role: 'host',
          admissionStatus: 'ADMITTED',
          joinedAt: new Date(now.getTime() - 3500_000),
          leftAt: now,
        },
        {
          meetingId: endedMeeting._id,
          userId: inviteeUser._id,
          displayName: 'John Connor',
          email: inviteeUser.email,
          role: 'participant',
          admissionStatus: 'ADMITTED',
          joinedAt: new Date(now.getTime() - 3400_000),
          leftAt: now,
        },
      ]);

      // 1. Verify listMeetingHistory returns participantCount = 2 (not 0)
      const historyList = await schedulingService.listMeetingHistory(hostUser._id.toString(), {
        role: 'all',
        status: 'ENDED',
      });
      const match = historyList.meetings.find((m) => m.id === endedMeeting._id.toString());
      assert.ok(match, 'Ended meeting must be in history');
      assert.strictEqual(match.participantCount, 2, 'Attended participant count must be 2, not activeParticipantCount 0');

      // 2. Verify getMeetingHistoryDetails returns participantCount = 2
      const details = await schedulingService.getMeetingHistoryDetails(
        hostUser._id.toString(),
        endedMeeting._id.toString()
      );
      assert.strictEqual(details.meeting.participantCount, 2);
      assert.strictEqual(details.participants.length, 2);
    });

    it('10.6 DEF-16-06: listUpcomingScheduledMeetings includes ACTIVE meetings started >30 minutes ago', async () => {
      // Create an active meeting started 45 minutes ago
      const activeOld = await Meeting.create({
        meetingCode: 'cly-old-001',
        title: 'Long Running Active Meeting (>30m ago)',
        hostId: hostUser._id,
        originalHostId: hostUser._id,
        status: 'ACTIVE',
        activatedAt: new Date(Date.now() - 45 * 60 * 1000),
        scheduledStartAt: new Date(Date.now() - 45 * 60 * 1000),
        maxParticipants: 60,
        activeParticipantCount: 2,
        expiresAt: new Date(Date.now() + 86400_000),
      });

      const upcoming = await schedulingService.listUpcomingScheduledMeetings(hostUser._id.toString());
      const found = upcoming.meetings.some((m) => m.id === activeOld._id.toString());
      assert.ok(found, 'ACTIVE meeting started >30m ago must remain visible in upcoming/active dashboard list');
    });

    it('10.7 DEF-16-07: listMeetingHistory date range filters against meeting occurrence date (endedAt)', async () => {
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 3600 * 1000);
      const today = new Date();

      // Meeting created 10 days ago but ended today
      const meetingOldCreated = await Meeting.create({
        meetingCode: 'cly-occ-001',
        title: 'Created Ten Days Ago But Occurred Today',
        hostId: hostUser._id,
        originalHostId: hostUser._id,
        status: 'ENDED',
        createdAt: tenDaysAgo,
        activatedAt: new Date(today.getTime() - 1800_000),
        endedAt: today,
        maxParticipants: 60,
        activeParticipantCount: 0,
        expiresAt: new Date(today.getTime() + 86400_000),
      });

      // Filter for today only
      const todayStart = new Date(today);
      todayStart.setUTCHours(0, 0, 0, 0);
      const todayEnd = new Date(today);
      todayEnd.setUTCHours(23, 59, 59, 999);

      const historyToday = await schedulingService.listMeetingHistory(hostUser._id.toString(), {
        from: todayStart.toISOString(),
        to: todayEnd.toISOString(),
        role: 'all',
        status: 'ENDED',
      });

      const matched = historyToday.meetings.some((m) => m.id === meetingOldCreated._id.toString());
      assert.ok(matched, 'Meeting that ended today must match today date filter even though createdAt was 10 days ago');
    });

    it('10.8 Section 9: Invitee deduplication & notification on newly added invitees', async () => {
      // 1. Schedule meeting with duplicate emails
      const scheduled = await schedulingService.scheduleMeeting(hostUser._id.toString(), {
        title: 'Invitee Deduplication Verification',
        scheduledStartAt: new Date(Date.now() + 7200_000).toISOString(),
        invitees: [
          { email: 'duplicate.user@connectly.io', name: 'Dup 1' },
          { email: 'DUPLICATE.USER@CONNECTLY.IO', name: 'Dup 2' },
        ],
      });

      const meetingDoc = await Meeting.findById(scheduled.id);
      assert.strictEqual(meetingDoc?.invitees.length, 1, 'Duplicate invitees must be deduplicated to 1 record');

      // 2. Update scheduled meeting with newly added registered invitee (inviteeUser)
      await Notification.deleteMany({ userId: inviteeUser._id });
      await schedulingService.updateScheduledMeeting(hostUser._id.toString(), scheduled.id, {
        invitees: [
          { email: 'duplicate.user@connectly.io' },
          { email: inviteeUser.email }, // newly added
        ],
      });

      const notif = await Notification.findOne({
        userId: inviteeUser._id,
        type: 'MEETING_INVITATION',
      });
      assert.ok(notif, 'Newly added invitee must receive MEETING_INVITATION notification');
      assert.ok(notif.deliveryKey?.startsWith(`invitation:${scheduled.id}:${inviteeUser._id}`));
    });

    it('10.9 Notification crash recovery: Missed WebSocket push is durably recovered via GET /api/v1/users/me/notifications', async () => {
      // 1. Durably persist notification in database with unique deliveryKey
      const recoveryDeliveryKey = `crash-recovery:${Date.now()}:${inviteeUser._id}`;
      const created = await notificationService.createNotification({
        userId: inviteeUser._id,
        type: 'MEETING_REMINDER',
        title: 'Crash Recovery Reminder',
        message: 'This notification survived an ephemeral socket crash and was recovered.',
        deliveryKey: recoveryDeliveryKey,
        metadata: {
          test: 'crash-recovery',
        },
      });
      assert.ok(created);
      assert.strictEqual(created.read, false);

      // 2. Client queries REST API endpoint to recover missed real-time events
      const res = await fetch(`${baseUrl}/api/v1/users/me/notifications`, {
        headers: { Authorization: `Bearer ${inviteeToken}` },
      });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.status, 200);
      assert.ok(body.data.notifications.length >= 1);
      assert.ok(typeof body.data.unreadCount === 'number');

      const found = body.data.notifications.find((n: any) => n.id === created.id);
      assert.ok(found, 'Persisted notification must be retrieved by authenticated client after simulated socket miss');
      assert.strictEqual(found.title, 'Crash Recovery Reminder');
      assert.strictEqual(found.read, false);

      // 3. Mark notification as read
      const readRes = await fetch(`${baseUrl}/api/v1/users/me/notifications/${created.id}/read`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${inviteeToken}` },
      });
      assert.strictEqual(readRes.status, 200);
      const readBody = await readRes.json();
      assert.strictEqual(readBody.data.success, true);

      // 4. Verify unread query excludes it
      const unreadRes = await fetch(`${baseUrl}/api/v1/users/me/notifications?unreadOnly=true`, {
        headers: { Authorization: `Bearer ${inviteeToken}` },
      });
      const unreadBody = await unreadRes.json();
      const unreadFound = unreadBody.data.notifications.find((n: any) => n.id === created.id);
      assert.strictEqual(unreadFound, undefined, 'Marked notification must no longer appear in unread list');
    });
  });
});
