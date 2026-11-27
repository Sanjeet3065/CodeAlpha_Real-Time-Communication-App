import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { User } from '../models/User.model.js';
import { Meeting } from '../models/Meeting.model.js';
import { MeetingParticipant } from '../models/MeetingParticipant.model.js';
import { ChatMessage } from '../models/ChatMessage.model.js';
import { SharedFile } from '../models/SharedFile.model.js';
import { Whiteboard } from '../models/Whiteboard.model.js';
import { WhiteboardOperation } from '../models/WhiteboardOperation.model.js';
import { ScheduledReminder } from '../models/ScheduledReminder.model.js';
import { MeetingRealtimeEvent } from '../models/MeetingRealtimeEvent.model.js';
import { Notification } from '../models/Notification.model.js';
import { hashPassword } from '../utils/password.js';
import { schedulingService } from '../services/scheduling.service.js';
import {
  MEETING_HISTORY_RETENTION_MS,
  MeetingHistoryRetentionWorker,
  resolveMeetingRetentionTimestamp,
} from '../services/meetingHistoryRetentionWorker.service.js';

describe('Meeting History 2-Day (48h) Auto-Retention Suite', () => {
  let hostUser: any;
  const deletedStorageKeys: Array<{ key: string; versionId?: string }> = [];

  const mockStorage = {
    name: 'mock',
    async uploadStream() {
      return { sizeBytes: 0 };
    },
    async downloadStream() {
      throw new Error('unused');
    },
    async generatePresignedUploadUrl() {
      throw new Error('unused');
    },
    async generatePresignedDownloadUrl() {
      return '';
    },
    async deleteObject(key: string, versionId?: string) {
      deletedStorageKeys.push({ key, versionId });
      return true;
    },
    async headObject() {
      return null;
    },
    async readByteRange() {
      return Buffer.alloc(0);
    },
  };

  async function clearAll() {
    await Promise.all([
      Meeting.deleteMany({}),
      MeetingParticipant.deleteMany({}),
      ChatMessage.deleteMany({}),
      SharedFile.deleteMany({}),
      Whiteboard.deleteMany({}),
      WhiteboardOperation.deleteMany({}),
      ScheduledReminder.deleteMany({}),
      MeetingRealtimeEvent.deleteMany({}),
      Notification.deleteMany({}),
    ]);
    deletedStorageKeys.length = 0;
  }

  before(async () => {
    await mongoose.connect('mongodb://127.0.0.1:27017/connectly_history_retention_test');
    await User.deleteMany({});
    await clearAll();

    const passwordHash = await hashPassword('RetentionSuitePass2026!');
    hostUser = await User.create({
      email: 'retention.host@connectly.io',
      passwordHash,
      firstName: 'Retention',
      lastName: 'Host',
      isEmailVerified: true,
    });
  });

  beforeEach(async () => {
    await clearAll();
  });

  after(async () => {
    await clearAll();
    await User.deleteMany({});
    await mongoose.disconnect();
  });

  it('1. resolves retention timestamp accurately in completion fallback priority', () => {
    const tEnded = new Date('2026-11-25T10:00:00.000Z');
    const tCancelled = new Date('2026-11-25T09:00:00.000Z');
    const tExpires = new Date('2026-11-24T08:00:00.000Z');

    assert.strictEqual(
      resolveMeetingRetentionTimestamp({
        status: 'ENDED',
        endedAt: tEnded,
        createdAt: tExpires,
      }).getTime(),
      tEnded.getTime()
    );
    assert.strictEqual(
      resolveMeetingRetentionTimestamp({
        status: 'CANCELLED',
        cancelledAt: tCancelled,
        createdAt: tExpires,
      }).getTime(),
      tCancelled.getTime()
    );
    assert.strictEqual(
      resolveMeetingRetentionTimestamp({
        status: 'EXPIRED',
        expiresAt: tExpires,
        createdAt: new Date('2026-11-20T00:00:00.000Z'),
      }).getTime(),
      tExpires.getTime()
    );
  });

  it('2. deletes ENDED/CANCELLED/EXPIRED meetings >=48h old + child rows + storage blobs while keeping <48h, active, and scheduled rooms', async () => {
    const now = new Date('2026-11-27T12:00:00.000Z');
    const hoursAgo = (h: number) => new Date(now.getTime() - h * 60 * 60 * 1000);
    const hoursAhead = (h: number) => new Date(now.getTime() + h * 60 * 60 * 1000);

    // Day 3 (50h old) ENDED meeting — MUST purge + child data + storage object
    const expiredEnded = await Meeting.create({
      meetingCode: 'cly-old-end',
      title: 'Old Ended Meeting',
      hostId: hostUser._id,
      originalHostId: hostUser._id,
      status: 'ENDED',
      activatedAt: hoursAgo(51),
      endedAt: hoursAgo(50),
      expiresAt: hoursAgo(26),
      createdAt: hoursAgo(52),
    });

    // Day 3 (49h old) CANCELLED meeting — MUST purge
    const expiredCancelled = await Meeting.create({
      meetingCode: 'cly-old-can',
      title: 'Old Cancelled Meeting',
      hostId: hostUser._id,
      originalHostId: hostUser._id,
      status: 'CANCELLED',
      cancelledAt: hoursAgo(49),
      expiresAt: hoursAgo(25),
      createdAt: hoursAgo(50),
    });

    // Day 3 abandoned SCHEDULED room whose expiresAt passed 49h ago — MUST purge
    const abandonedScheduled = await Meeting.create({
      meetingCode: 'cly-old-sch',
      title: 'Missed Scheduled Meeting',
      hostId: hostUser._id,
      originalHostId: hostUser._id,
      status: 'SCHEDULED',
      scheduledStartAt: hoursAgo(75),
      scheduledEndAt: hoursAgo(74),
      expiresAt: hoursAgo(49),
      createdAt: hoursAgo(80),
    });

    // Recent ENDED (<48h: 47h ago) — MUST KEEP
    const recentEnded = await Meeting.create({
      meetingCode: 'cly-rec-end',
      title: 'Recent Day-2 Meeting',
      hostId: hostUser._id,
      originalHostId: hostUser._id,
      status: 'ENDED',
      activatedAt: hoursAgo(48),
      endedAt: hoursAgo(47),
      expiresAt: hoursAgo(23),
      createdAt: hoursAgo(49),
    });

    // Created 10 days ago, ended 1h ago (DEF-16-07 scenario) — MUST KEEP
    const createdOldEndedToday = await Meeting.create({
      meetingCode: 'cly-rec-tod',
      title: 'Created 10d Ago Ended Today',
      hostId: hostUser._id,
      originalHostId: hostUser._id,
      status: 'ENDED',
      createdAt: hoursAgo(240),
      activatedAt: hoursAgo(2),
      endedAt: hoursAgo(1),
      expiresAt: hoursAhead(22),
    });

    // Future SCHEDULED meeting — MUST KEEP
    const futureScheduled = await Meeting.create({
      meetingCode: 'cly-fut-sch',
      title: 'Future Scheduled Sync',
      hostId: hostUser._id,
      originalHostId: hostUser._id,
      status: 'SCHEDULED',
      scheduledStartAt: hoursAhead(4),
      scheduledEndAt: hoursAhead(5),
      expiresAt: hoursAhead(29),
    });

    // Active ongoing meeting — MUST KEEP
    const activeMeeting = await Meeting.create({
      meetingCode: 'cly-act-now',
      title: 'Active Live Call',
      hostId: hostUser._id,
      originalHostId: hostUser._id,
      status: 'ACTIVE',
      activatedAt: hoursAgo(1),
      expiresAt: hoursAhead(23),
    });

    // Attach child records + storage file to expiredEnded and verify they get cleaned up
    await MeetingParticipant.create({
      meetingId: expiredEnded._id,
      userId: hostUser._id,
      displayName: 'Retention Host',
      email: hostUser.email,
      role: 'host',
      admissionStatus: 'ADMITTED',
      joinedAt: hoursAgo(51),
    });
    await ChatMessage.create({
      meetingId: expiredEnded._id,
      senderId: hostUser._id,
      senderName: 'Retention Host',
      senderRole: 'host',
      content: 'Old chat message',
    });
    await SharedFile.create({
      meetingId: expiredEnded._id,
      uploaderId: hostUser._id,
      uploaderName: 'Retention Host',
      uploaderRole: 'host',
      originalFilename: 'notes.pdf',
      sanitizedFilename: 'notes.pdf',
      storageKey: 'meetings/old/notes.pdf',
      storageProvider: 'memory',
      mimeType: 'application/pdf',
      extension: 'pdf',
      sizeBytes: 128,
      status: 'AVAILABLE',
      versionId: 'v1',
    });
    const wb = await Whiteboard.create({
      meetingId: expiredEnded._id,
      version: 1,
    });
    await WhiteboardOperation.create({
      meetingId: expiredEnded._id,
      whiteboardId: wb._id,
      operationId: 'op-old-1',
      userId: hostUser._id,
      userName: 'Retention Host',
      type: 'clear',
      sequence: 1,
    });
    await ScheduledReminder.create({
      meetingId: expiredEnded._id,
      userId: hostUser._id,
      remindAt: hoursAgo(52),
      triggerMinutesBefore: 15,
      status: 'SENT',
    });
    await MeetingRealtimeEvent.create({
      eventId: 'evt-old-1',
      meetingId: expiredEnded._id,
      meetingVersion: 1,
      type: 'MEETING_ENDED',
      status: 'DISPATCHED',
    });
    await Notification.create({
      userId: hostUser._id,
      type: 'MEETING_INVITATION',
      title: 'Old Invite',
      message: 'Old invite body',
      meetingId: expiredEnded._id,
      meetingCode: expiredEnded.meetingCode,
    });

    // Also attach a participant & file to recentEnded to ensure untouched
    await SharedFile.create({
      meetingId: recentEnded._id,
      uploaderId: hostUser._id,
      uploaderName: 'Retention Host',
      uploaderRole: 'host',
      originalFilename: 'recent.pdf',
      sanitizedFilename: 'recent.pdf',
      storageKey: 'meetings/recent/recent.pdf',
      storageProvider: 'memory',
      mimeType: 'application/pdf',
      extension: 'pdf',
      sizeBytes: 64,
      status: 'AVAILABLE',
    });

    const worker = new MeetingHistoryRetentionWorker(mockStorage);
    const report = await worker.purgeExpiredMeetingHistory(now);

    assert.strictEqual(report.purgedMeetingsCount, 3);
    assert.strictEqual(await Meeting.findById(expiredEnded._id), null);
    assert.strictEqual(await Meeting.findById(expiredCancelled._id), null);
    assert.strictEqual(await Meeting.findById(abandonedScheduled._id), null);

    assert.ok(await Meeting.findById(recentEnded._id));
    assert.ok(await Meeting.findById(createdOldEndedToday._id));
    assert.ok(await Meeting.findById(futureScheduled._id));
    assert.ok(await Meeting.findById(activeMeeting._id));

    assert.strictEqual(await MeetingParticipant.countDocuments({ meetingId: expiredEnded._id }), 0);
    assert.strictEqual(await ChatMessage.countDocuments({ meetingId: expiredEnded._id }), 0);
    assert.strictEqual(await SharedFile.countDocuments({ meetingId: expiredEnded._id }), 0);
    assert.strictEqual(await Whiteboard.countDocuments({ meetingId: expiredEnded._id }), 0);
    assert.strictEqual(await WhiteboardOperation.countDocuments({ meetingId: expiredEnded._id }), 0);
    assert.strictEqual(await ScheduledReminder.countDocuments({ meetingId: expiredEnded._id }), 0);
    assert.strictEqual(await MeetingRealtimeEvent.countDocuments({ meetingId: expiredEnded._id }), 0);
    assert.strictEqual(await Notification.countDocuments({ meetingId: expiredEnded._id }), 0);

    assert.strictEqual(await SharedFile.countDocuments({ meetingId: recentEnded._id }), 1);
    assert.deepStrictEqual(deletedStorageKeys, [{ key: 'meetings/old/notes.pdf', versionId: 'v1' }]);
  });

  it('3. listMeetingHistory & getMeetingHistoryDetails enforce 48h window even prior to sweep', async () => {
    const expiredMs = Date.now() - MEETING_HISTORY_RETENTION_MS - 60_000;
    const recentMs = Date.now() - 2 * 60 * 60 * 1000;

    const expiredDoc = await Meeting.create({
      meetingCode: 'cly-exp-qry',
      title: 'Expired History Item',
      hostId: hostUser._id,
      originalHostId: hostUser._id,
      status: 'ENDED',
      activatedAt: new Date(expiredMs - 600_000),
      endedAt: new Date(expiredMs),
      expiresAt: new Date(expiredMs + 86_400_000),
      createdAt: new Date(expiredMs - 1_200_000),
    });

    const recentDoc = await Meeting.create({
      meetingCode: 'cly-rec-qry',
      title: 'Recent History Item',
      hostId: hostUser._id,
      originalHostId: hostUser._id,
      status: 'ENDED',
      activatedAt: new Date(recentMs - 600_000),
      endedAt: new Date(recentMs),
      expiresAt: new Date(recentMs + 86_400_000),
      createdAt: new Date(recentMs - 1_200_000),
    });

    const history = await schedulingService.listMeetingHistory(hostUser._id.toString(), {
      page: 1,
      limit: 10,
      role: 'all',
      status: 'all',
      sort: 'desc',
    });

    assert.strictEqual(history.pagination.total, 1);
    assert.strictEqual(history.meetings.length, 1);
    assert.strictEqual(history.meetings[0].id, recentDoc._id.toString());

    await assert.rejects(
      () => schedulingService.getMeetingHistoryDetails(hostUser._id.toString(), expiredDoc._id.toString()),
      (err: any) => err?.statusCode === 404 && err?.code === 'HISTORY_EXPIRED'
    );

    const thirdPartyUser = await User.create({
      email: 'stranger.retention@connectly.io',
      passwordHash: await hashPassword('StrangerPass2026!'),
      firstName: 'Stranger',
      lastName: 'User',
      isEmailVerified: true,
    });
    await assert.rejects(
      () => schedulingService.getMeetingHistoryDetails(thirdPartyUser._id.toString(), expiredDoc._id.toString()),
      (err: any) => err?.statusCode === 403 && err?.code === 'FORBIDDEN'
    );

    const recentDetails = await schedulingService.getMeetingHistoryDetails(
      hostUser._id.toString(),
      recentDoc._id.toString()
    );
    assert.strictEqual(recentDetails.meeting.id, recentDoc._id.toString());
  });
});
