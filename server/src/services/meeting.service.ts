import mongoose, { Types } from 'mongoose';
import { env } from '../config/env.js';
import { User } from '../models/User.model.js';
import {
  Meeting,
  type IMeeting,
  type IMeetingSettings,
  type MeetingLifecycleStatus,
} from '../models/Meeting.model.js';
import {
  MeetingParticipant,
  generateAdmissionSessionId,
  type IMeetingParticipant,
  type ParticipantRole,
  type AdmissionStatus,
} from '../models/MeetingParticipant.model.js';
import {
  ensureRevocationCollectionsReady,
  isReplicaSetTransactionsSupported,
} from '../models/LiveKitRevocationEvent.model.js';
import {
  MeetingRealtimeEvent,
} from '../models/MeetingRealtimeEvent.model.js';
import {
  LiveKitEvictionJob,
  generateEvictionJobId,
} from '../models/LiveKitEvictionJob.model.js';
import {
  MeetingRealtimeOutboxDispatcher,
  meetingOutboxDispatcher,
} from '../realtime/meetingOutboxDispatcher.js';
import {
  livekitEvictionWorker,
  LiveKitEvictionWorker,
} from '../workers/livekitEvictionWorker.js';
import {
  generateSecureMeetingCode,
  normalizeMeetingCode,
} from '../utils/meetingCode.js';
import {
  AppError,
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ServiceUnavailableError,
} from '../utils/errors.js';
import type {
  CreateMeetingInput,
  JoinMeetingInput,
  UpdateMeetingSettingsInput,
  UpdateRoleInput,
} from '../schemas/meeting.schema.js';
import { meetingRealtime, type MeetingRealtimeHub } from '../realtime/meetingSocket.js';
import {
  livekitSignalGateway,
  type LiveKitSignalGateway,
} from '../realtime/livekitSignalGateway.js';
import {
  livekitRevocationCoordinator,
  publishLiveKitRevocation,
  type DistributedRevocationPayload,
  type LiveKitRevocationCoordinator,
  type PublishLiveKitRevocationParams,
} from '../realtime/livekitRevocationCoordinator.js';
import {
  livekitService,
  getLiveKitParticipantIdentity,
  type LiveKitService,
  type LiveKitTokenBundle,
} from './livekit.service.js';
import { logger } from '../utils/logger.js';

const DEFAULT_MEETING_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_CODE_GENERATION_RETRIES = 6;
const MAX_AUDIT_ENTRIES = 50;

export interface SerializedParticipant {
  id: string;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  role: ParticipantRole;
  admissionStatus: AdmissionStatus;
  presenceStatus: 'ONLINE' | 'OFFLINE';
  requestedAt: Date;
  admittedAt: Date | null;
  joinedAt: Date | null;
}

export interface SerializedMeeting {
  id: string;
  meetingCode: string;
  title: string;
  description?: string | null;
  joinUrl: string;
  hostId: string;
  hostName: string;
  status: MeetingLifecycleStatus;
  isLocked: boolean;
  maxParticipants: number;
  activeParticipantCount: number;
  settings: IMeetingSettings;
  scheduledStartAt?: Date | null;
  scheduledEndAt?: Date | null;
  scheduledTimeZone?: string | null;
  cancelledAt?: Date | null;
  cancellationReason?: string | null;
  invitees?: Array<{ email: string; name?: string | null }>;
  reminderPreferences?: number[];
  scheduleVersion?: number;
  activatedAt: Date | null;
  endedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
}

export interface JoinMeetingResult {
  joinResult: 'ADMITTED' | 'ALREADY_ADMITTED' | 'WAITING';
  meeting: SerializedMeeting;
  participant: SerializedParticipant;
  participants?: SerializedParticipant[];
  waitingList?: SerializedParticipant[];
}

export interface MeetingStateResult {
  meeting: SerializedMeeting;
  self: SerializedParticipant;
  participants: SerializedParticipant[];
  waitingList?: SerializedParticipant[];
}

export interface RemovalCleanupReport {
  localSocketsDisconnected: boolean;
  realtimeEmitted: boolean;
  livekitEvicted: boolean;
  failures: Array<{ operation: string; message: string }>;
}

export interface MeetingServiceHooks {
  beforeWaitingJoinWrite?: () => Promise<void>;
  beforeDirectJoinReserve?: () => Promise<void>;
  beforeDirectJoinParticipantWrite?: () => Promise<void>;
  beforeJoinOutboxClaim?: () => Promise<void>;
  afterJoinOutboxClaim?: () => Promise<void>;
  beforeJoinEmit?: () => Promise<void>;
  afterJoinEmitBeforeMarkDispatched?: () => Promise<void>;
  beforeAdmitReserve?: () => Promise<void>;
  beforeAdmitParticipantWrite?: () => Promise<void>;
  beforeAdmitOutboxClaim?: () => Promise<void>;
  afterAdmitOutboxClaim?: () => Promise<void>;
  beforeAdmitEmit?: () => Promise<void>;
  afterAdmitEmitBeforeMarkDispatched?: () => Promise<void>;
  beforeRejectWrite?: () => Promise<void>;
  beforeLockWrite?: () => Promise<void>;
  beforeLockEmit?: () => Promise<void>;
  beforeEndWrite?: () => Promise<void>;
  beforeLeaveMeetingUpdate?: () => Promise<void>;
  beforeExpirationRevocationPublish?: () => Promise<void>;
  beforeLiveKitTokenIssue?: () => Promise<void>;
}

export type PublishRevocationFn = (
  params: PublishLiveKitRevocationParams
) => Promise<DistributedRevocationPayload>;

export interface MeetingServiceOptions {
  /** Override production transaction requirement (defaults to `env.NODE_ENV === 'production'`). */
  requireTransactions?: boolean;
  /** Optional custom recoverable outbox dispatcher (defaults to singleton or hub-bound instance). */
  outboxDispatcher?: MeetingRealtimeOutboxDispatcher;
  /** Optional custom durable LiveKit eviction worker. */
  evictionWorker?: LiveKitEvictionWorker;
}

export class MeetingService {
  private readonly realtime: MeetingRealtimeHub;
  private readonly hooks: MeetingServiceHooks;
  private readonly livekit: LiveKitService;
  private readonly signalGateway: LiveKitSignalGateway;
  private readonly publishRevocation: PublishRevocationFn;
  private readonly revocationCoordinator: LiveKitRevocationCoordinator;
  private readonly requireTransactions: boolean;
  private readonly outboxDispatcher: MeetingRealtimeOutboxDispatcher;
  private readonly evictionWorker: LiveKitEvictionWorker;
  // Deduplicates simultaneous same-user join attempts within a process so rapid
  // double-clicks never transiently double-reserve capacity slots.
  private readonly inflightJoins = new Map<string, Promise<JoinMeetingResult>>();

  constructor(
    realtimeHub: MeetingRealtimeHub = meetingRealtime,
    hooks: MeetingServiceHooks = {},
    livekit: LiveKitService = livekitService,
    signalGateway: LiveKitSignalGateway = livekitSignalGateway,
    publishRevocation: PublishRevocationFn = publishLiveKitRevocation,
    revocationCoordinator: LiveKitRevocationCoordinator = livekitRevocationCoordinator,
    options: MeetingServiceOptions = {}
  ) {
    this.realtime = realtimeHub;
    this.hooks = hooks;
    this.livekit = livekit;
    this.signalGateway = signalGateway;
    this.publishRevocation = publishRevocation;
    this.revocationCoordinator = revocationCoordinator;
    const isProd = process.env.NODE_ENV === 'production' || env.NODE_ENV === 'production';
    this.requireTransactions =
      isProd
        ? true
        : (options.requireTransactions ?? (process.env.REQUIRE_TRANSACTIONS === 'true' || env.REQUIRE_TRANSACTIONS === 'true'));
    this.outboxDispatcher =
      options.outboxDispatcher ??
      (realtimeHub === meetingRealtime
        ? meetingOutboxDispatcher
        : new MeetingRealtimeOutboxDispatcher({
            pollIntervalMs: 0,
            realtime: realtimeHub,
          }));
    this.evictionWorker =
      options.evictionWorker ??
      (livekit === livekitService
        ? livekitEvictionWorker
        : new LiveKitEvictionWorker({
            pollIntervalMs: 0,
            livekit,
          }));
  }

  private serializeParticipant(doc: IMeetingParticipant): SerializedParticipant {
    return {
      id: doc._id.toString(),
      userId: doc.userId.toString(),
      displayName: doc.displayName,
      avatarUrl: doc.avatarUrl || null,
      role: doc.role,
      admissionStatus: doc.admissionStatus,
      presenceStatus: doc.presenceStatus,
      requestedAt: doc.requestedAt,
      admittedAt: doc.admittedAt || null,
      joinedAt: doc.joinedAt || null,
    };
  }

  private async serializeMeeting(meeting: IMeeting, hostNameOverride?: string): Promise<SerializedMeeting> {
    let hostName = hostNameOverride;
    if (!hostName) {
      const hostUser = await User.findById(meeting.hostId).select('firstName lastName');
      hostName = hostUser
        ? `${hostUser.firstName} ${hostUser.lastName}`.trim()
        : 'Meeting Host';
    }

    const baseOrigin = env.CLIENT_ORIGIN.replace(/\/+$/, '');
    return {
      id: meeting._id.toString(),
      meetingCode: meeting.meetingCode,
      title: meeting.title,
      description: meeting.description || null,
      joinUrl: `${baseOrigin}/join/${meeting.meetingCode}`,
      hostId: meeting.hostId.toString(),
      hostName,
      status: meeting.status,
      isLocked: meeting.isLocked,
      maxParticipants: meeting.maxParticipants,
      activeParticipantCount: meeting.activeParticipantCount,
      settings: {
        waitingRoomEnabled: meeting.settings.waitingRoomEnabled,
        allowCoHostAdmit: meeting.settings.allowCoHostAdmit,
        allowCoHostRemove: meeting.settings.allowCoHostRemove,
        allowCoHostLock: meeting.settings.allowCoHostLock,
      },
      scheduledStartAt: meeting.scheduledStartAt || null,
      scheduledEndAt: meeting.scheduledEndAt || null,
      scheduledTimeZone: meeting.scheduledTimeZone || null,
      cancelledAt: meeting.cancelledAt || null,
      cancellationReason: meeting.cancellationReason || null,
      invitees: (meeting.invitees || []).map((inv) => ({
        email: inv.email,
        name: inv.name || null,
      })),
      reminderPreferences: meeting.reminderPreferences || [],
      scheduleVersion: meeting.scheduleVersion || 1,
      activatedAt: meeting.activatedAt || null,
      endedAt: meeting.endedAt || null,
      expiresAt: meeting.expiresAt,
      createdAt: meeting.createdAt,
    };
  }

  private requireValidMeetingCode(rawCode: string): string {
    const normalized = normalizeMeetingCode(rawCode);
    if (!normalized) {
      throw new BadRequestError(
        'Invalid meeting code. Format must be cly-xxx-xxx.',
        'INVALID_MEETING_CODE'
      );
    }
    return normalized;
  }

  public async findMeetingAndEnforceExpiration(rawCode: string): Promise<IMeeting> {
    const normalized = this.requireValidMeetingCode(rawCode);
    const meeting = await Meeting.findOne({ meetingCode: normalized });
    if (!meeting) {
      throw new NotFoundError('Meeting not found. Please check the code and try again.', 'MEETING_NOT_FOUND');
    }

    const now = new Date();
    if (
      (meeting.status === 'CREATED' || meeting.status === 'ACTIVE') &&
      now >= meeting.expiresAt
    ) {
      const txSupported = await isReplicaSetTransactionsSupported();
      if (!txSupported && this.requireTransactions) {
        throw new ServiceUnavailableError(
          'Atomic meeting expiration requires a MongoDB Replica Set supporting multi-document transactions.',
          'TRANSACTION_REQUIRED'
        );
      }

      const meetingIdStr = meeting._id.toString();
      let expired: IMeeting | null = null;
      let waitingUserIds: string[] = [];

      if (txSupported) {
        await ensureRevocationCollectionsReady();
        const session = await mongoose.startSession();
        try {
          await session.withTransaction(
            async () => {
              const txNow = new Date();
              const transitioned = await Meeting.findOneAndUpdate(
                {
                  _id: meeting._id,
                  status: { $in: ['CREATED', 'ACTIVE'] },
                  expiresAt: { $lte: txNow },
                },
                {
                  $set: { status: 'EXPIRED', endedAt: txNow, activeParticipantCount: 0 },
                  $inc: { version: 1 },
                },
                { new: true, session }
              );
              if (!transitioned) {
                expired = null;
                waitingUserIds = [];
                return;
              }

              const waitingDocs = await MeetingParticipant.find(
                { meetingId: meeting._id, admissionStatus: { $in: ['WAITING', 'ADMITTED'] } },
                null,
                { session }
              )
                .select('userId')
                .lean();
              waitingUserIds = waitingDocs.map((w) => w.userId.toString());

              await MeetingParticipant.updateMany(
                { meetingId: meeting._id, admissionStatus: 'WAITING' },
                { $set: { admissionStatus: 'CANCELLED', presenceStatus: 'OFFLINE', decidedAt: txNow } },
                { session }
              );
              await MeetingParticipant.updateMany(
                { meetingId: meeting._id, admissionStatus: 'ADMITTED' },
                {
                  $set: {
                    admissionStatus: 'LEFT',
                    presenceStatus: 'OFFLINE',
                    leftAt: txNow,
                    tokenRevokedBefore: txNow,
                  },
                  $inc: {
                    tokenEpoch: 1,
                    signalFenceVersion: 1,
                  },
                },
                { session }
              );

              // Atomically suppress all PENDING and CLAIMED outbox entries and record MEETING_ENDED
              await MeetingRealtimeEvent.updateMany(
                {
                  meetingId: meeting._id,
                  status: { $in: ['PENDING', 'CLAIMED'] },
                  type: { $ne: 'MEETING_ENDED' },
                },
                {
                  $set: {
                    status: 'SUPPRESSED',
                    suppressedAt: txNow,
                    terminalAt: txNow,
                    leaseOwner: null,
                    leaseToken: null,
                    leaseExpiresAt: null,
                  },
                },
                { session }
              );
              await MeetingRealtimeEvent.create(
                [
                  {
                    meetingId: meeting._id,
                    meetingVersion: transitioned.version,
                    type: 'MEETING_ENDED',
                    status: 'DISPATCHED',
                    dispatchedAt: txNow,
                    terminalAt: txNow,
                  },
                ],
                { session }
              );

              if (this.hooks.beforeExpirationRevocationPublish) {
                await this.hooks.beforeExpirationRevocationPublish();
              }

              await this.publishRevocation({
                meetingId: meetingIdStr,
                kind: 'MEETING_ENDED',
                reason: 'Meeting expired.',
                session,
              });

              expired = transitioned;
            },
            {
              readConcern: { level: 'majority' },
              writeConcern: { w: 'majority' },
            }
          );
        } catch (err) {
          if (err instanceof AppError) {
            throw err;
          }
          logger.error('[MeetingService] Atomic meeting expiration transaction failed', {
            metadata: {
              meetingId: meetingIdStr,
              operation: 'findMeetingAndEnforceExpiration.transaction',
              message: err instanceof Error ? err.message : String(err),
            },
          });
          throw new ServiceUnavailableError(
            'Meeting expiration transaction failed; no partial state was committed.',
            'MEETING_EXPIRATION_TRANSACTION_FAILED'
          );
        } finally {
          await session.endSession().catch(() => {});
        }
      } else {
        // Isolated standalone MongoDB development/test path (multi-document transactions unavailable)
        expired = await Meeting.findOneAndUpdate(
          {
            _id: meeting._id,
            status: { $in: ['CREATED', 'ACTIVE'] },
            expiresAt: { $lte: now },
          },
          {
            $set: { status: 'EXPIRED', endedAt: now, activeParticipantCount: 0 },
            $inc: { version: 1 },
          },
          { new: true }
        );
        if (expired) {
          const waitingDocs = await MeetingParticipant.find({
            meetingId: meeting._id,
            admissionStatus: { $in: ['WAITING', 'ADMITTED'] },
          })
            .select('userId')
            .lean();
          waitingUserIds = waitingDocs.map((w) => w.userId.toString());

          await MeetingParticipant.updateMany(
            { meetingId: meeting._id, admissionStatus: 'WAITING' },
            { $set: { admissionStatus: 'CANCELLED', presenceStatus: 'OFFLINE', decidedAt: now } }
          );
          await MeetingParticipant.updateMany(
            { meetingId: meeting._id, admissionStatus: 'ADMITTED' },
            {
              $set: {
                admissionStatus: 'LEFT',
                presenceStatus: 'OFFLINE',
                leftAt: now,
                tokenRevokedBefore: now,
              },
              $inc: {
                tokenEpoch: 1,
                signalFenceVersion: 1,
              },
            }
          );
          await MeetingRealtimeEvent.updateMany(
            {
              meetingId: meeting._id,
              status: { $in: ['PENDING', 'CLAIMED'] },
              type: { $ne: 'MEETING_ENDED' },
            },
            {
              $set: {
                status: 'SUPPRESSED',
                suppressedAt: now,
                terminalAt: now,
                leaseOwner: null,
                leaseToken: null,
                leaseExpiresAt: null,
              },
            }
          );
          await MeetingRealtimeEvent.create({
            meetingId: meeting._id,
            meetingVersion: expired.version,
            type: 'MEETING_ENDED',
            status: 'DISPATCHED',
            dispatchedAt: now,
            terminalAt: now,
          });
          try {
            await this.publishRevocation({
              meetingId: meetingIdStr,
              kind: 'MEETING_ENDED',
              reason: 'Meeting expired.',
            });
          } catch (err) {
            logger.error('[MeetingService] Failed to publish expiration revocation event', {
              metadata: {
                meetingId: meetingIdStr,
                operation: 'publishRevocation.MEETING_ENDED',
                message: err instanceof Error ? err.message : 'Revocation publish error',
              },
            });
            this.revocationCoordinator.markUnavailable(
              'Durable revocation event publish failed during meeting expiration; failing closed.'
            );
          }
        }
      }

      if (expired) {
        // Independent post-commit cleanup: cleanup failures MUST NOT undo authoritative EXPIRED state
        this.realtime.markMeetingEnded(meetingIdStr);
        try {
          await this.realtime.runMeetingLifecycleOrdered(meetingIdStr, async () => {
            await this.realtime.emitMeetingEnded(
              meetingIdStr,
              'system',
              waitingUserIds,
              'This meeting has expired.'
            );
          });
        } catch (err) {
          logger.error('[MeetingService] Expiration cleanup failed: realtime emitMeetingEnded', {
            metadata: {
              meetingId: meetingIdStr,
              operation: 'realtime.emitMeetingEnded',
              message: err instanceof Error ? err.message : 'Realtime emit error',
            },
          });
        }
        try {
          this.signalGateway.disconnectMeetingSockets(meetingIdStr);
        } catch (err) {
          logger.error('[MeetingService] Failed to disconnect gateway sockets on expiration', {
            metadata: {
              meetingId: meetingIdStr,
              operation: 'signalGateway.disconnectMeetingSockets',
              message: err instanceof Error ? err.message : 'Gateway socket disconnect error',
            },
          });
        }
        try {
          await this.livekit.deleteRoom(meetingIdStr);
        } catch (err) {
          logger.error('[MeetingService] Failed to delete LiveKit room on expiration', {
            metadata: {
              meetingId: meetingIdStr,
              operation: 'livekit.deleteRoom',
              message: err instanceof Error ? err.message : 'LiveKit deleteRoom error',
            },
          });
        }
        return expired;
      }

      const reloaded = await Meeting.findById(meeting._id);
      if (reloaded) return reloaded;
    }

    return meeting;
  }

  private throwMeetingUnavailableError(meeting: IMeeting): never {
    if (meeting.status === 'ENDED') {
      throw new AppError('This meeting has already ended.', 410, 'MEETING_ENDED');
    }
    if (meeting.status === 'CANCELLED') {
      throw new AppError('This meeting has been cancelled by the host.', 410, 'MEETING_CANCELLED');
    }
    if (meeting.status === 'EXPIRED' || new Date() >= meeting.expiresAt) {
      throw new AppError('This meeting has expired and can no longer be joined.', 410, 'MEETING_EXPIRED');
    }
    if (meeting.isLocked) {
      throw new ForbiddenError('This meeting is currently locked by the host.', 'MEETING_LOCKED');
    }
    if (meeting.activeParticipantCount >= meeting.maxParticipants) {
      throw new ForbiddenError(
        `This meeting has reached its maximum capacity of ${meeting.maxParticipants} participants.`,
        'MEETING_FULL'
      );
    }
    throw new ConflictError('Meeting state changed concurrently. Please try again.', 'MEETING_STATE_CONFLICT');
  }

  /**
   * Executes independent post-commit cleanup steps after an authoritative
   * participant removal. One external cleanup failure NEVER blocks local
   * signaling socket termination or other independent cleanup steps, and
   * failed external cleanup is explicitly logged and reported (never masked).
   */
  private async executeRemovalPostCommitCleanup(params: {
    meetingId: string;
    targetUserId: string;
    activeCount: number;
    revokedEpoch: number;
    sessionId?: string | null;
    reason?: string;
  }): Promise<RemovalCleanupReport> {
    const failures: Array<{ operation: string; message: string }> = [];
    let localSocketsDisconnected = false;
    let realtimeEmitted = false;
    let livekitEvicted = false;

    // 1. Local signaling gateway sockets (always executes independently)
    try {
      this.signalGateway.disconnectParticipantSockets(
        params.meetingId,
        params.targetUserId,
        params.revokedEpoch
      );
      localSocketsDisconnected = true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Local gateway disconnect error';
      failures.push({ operation: 'signalGateway.disconnectParticipantSockets', message });
      logger.error('[MeetingService] Removal cleanup failed: local signaling sockets', {
        metadata: {
          meetingId: params.meetingId,
          participantId: params.targetUserId,
          operation: 'signalGateway.disconnectParticipantSockets',
          message,
        },
      });
    }

    // 2. Socket.IO realtime removal notification & channel eviction
    try {
      await this.realtime.emitParticipantRemoved(
        params.meetingId,
        params.targetUserId,
        params.activeCount,
        params.reason
      );
      realtimeEmitted = true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Realtime emitParticipantRemoved error';
      failures.push({ operation: 'realtime.emitParticipantRemoved', message });
      logger.error('[MeetingService] Removal cleanup failed: realtime notification', {
        metadata: {
          meetingId: params.meetingId,
          participantId: params.targetUserId,
          operation: 'realtime.emitParticipantRemoved',
          message,
        },
      });
    }

    // 3. LiveKit SFU participant eviction via durable eviction worker
    try {
      const configured = this.livekit.isConfigured();
      const evictionJobId = generateEvictionJobId(
        params.meetingId,
        params.targetUserId,
        params.revokedEpoch,
        params.sessionId
      );
      const outcome = await this.evictionWorker.processJobById(evictionJobId);
      if (outcome.status === 'COMPLETED' || outcome.status === 'ALREADY_COMPLETED') {
        livekitEvicted = configured;
      } else {
        // Trigger adaptive worker wakeup to schedule retry sweep
        this.evictionWorker.wakeUp();
        const message = outcome.error || 'LiveKit SFU removeParticipant failed (durable eviction queued for retry).';
        failures.push({ operation: 'livekit.removeParticipant', message });
        logger.error('[MeetingService] Removal cleanup failed: LiveKit SFU eviction', {
          metadata: {
            meetingId: params.meetingId,
            participantId: params.targetUserId,
            operation: 'livekit.removeParticipant',
            status: outcome.status,
            message,
          },
        });
        livekitEvicted = false;
      }
    } catch (err) {
      this.evictionWorker.wakeUp();
      const message = err instanceof Error ? err.message : 'LiveKit SFU eviction exception';
      failures.push({ operation: 'livekit.removeParticipant', message });
      logger.error('[MeetingService] Removal cleanup failed: LiveKit SFU eviction exception', {
        metadata: {
          meetingId: params.meetingId,
          participantId: params.targetUserId,
          operation: 'livekit.removeParticipant',
          message,
        },
      });
      livekitEvicted = false;
    }

    return {
      localSocketsDisconnected,
      realtimeEmitted,
      livekitEvicted,
      failures,
    };
  }

  private async getAdmittedParticipants(meetingId: Types.ObjectId): Promise<SerializedParticipant[]> {
    const docs = await MeetingParticipant.find({
      meetingId,
      admissionStatus: 'ADMITTED',
    }).sort({ joinedAt: 1, createdAt: 1 });
    return docs.map((d) => this.serializeParticipant(d));
  }

  private async getWaitingParticipants(meetingId: Types.ObjectId): Promise<SerializedParticipant[]> {
    const docs = await MeetingParticipant.find({
      meetingId,
      admissionStatus: 'WAITING',
    }).sort({ requestedAt: 1, createdAt: 1 });
    return docs.map((d) => this.serializeParticipant(d));
  }

  private canManageWaitingRoom(actor: IMeetingParticipant, meeting: IMeeting): boolean {
    if (actor.admissionStatus !== 'ADMITTED') return false;
    if (actor.role === 'host') return true;
    return actor.role === 'co-host' && meeting.settings.allowCoHostAdmit;
  }

  private canRemoveParticipant(
    actor: IMeetingParticipant,
    target: IMeetingParticipant,
    meeting: IMeeting
  ): boolean {
    if (actor.admissionStatus !== 'ADMITTED') return false;
    if (actor.userId.equals(target.userId)) return false;
    if (target.role === 'host') return false;
    if (actor.role === 'host') return true;
    if (actor.role === 'co-host' && meeting.settings.allowCoHostRemove) {
      // Co-hosts can only remove regular participants, never the host or other co-hosts
      return target.role === 'participant';
    }
    return false;
  }

  private canToggleLock(actor: IMeetingParticipant, meeting: IMeeting): boolean {
    if (actor.admissionStatus !== 'ADMITTED') return false;
    if (actor.role === 'host') return true;
    return actor.role === 'co-host' && meeting.settings.allowCoHostLock;
  }

  /**
   * 1. CREATE MEETING (Persisted in MongoDB with CSPRNG meeting code)
   */
  async createMeeting(
    userId: string,
    input: CreateMeetingInput = {},
    ttlMs: number = DEFAULT_MEETING_TTL_MS
  ): Promise<{ meeting: SerializedMeeting }> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestError('Invalid user identifier.', 'INVALID_IDENTIFIER');
    }

    const user = await User.findById(userId).select('firstName lastName email avatarUrl');
    if (!user) {
      throw new NotFoundError('Authenticated user account not found.', 'USER_NOT_FOUND');
    }

    const hostName = `${user.firstName} ${user.lastName}`.trim();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs);

    const settings: IMeetingSettings = {
      waitingRoomEnabled: input.settings?.waitingRoomEnabled ?? false,
      allowCoHostAdmit: input.settings?.allowCoHostAdmit ?? true,
      allowCoHostRemove: input.settings?.allowCoHostRemove ?? true,
      allowCoHostLock: input.settings?.allowCoHostLock ?? false,
    };

    const title = input.title?.trim() || `${user.firstName}'s Instant Meeting`;
    const maxParticipants = input.maxParticipants ?? 60;

    let createdMeeting: IMeeting | null = null;
    for (let attempt = 0; attempt < MAX_CODE_GENERATION_RETRIES; attempt += 1) {
      const code = generateSecureMeetingCode();
      try {
        createdMeeting = await Meeting.create({
          meetingCode: code,
          title,
          hostId: user._id,
          originalHostId: user._id,
          status: 'CREATED',
          isLocked: false,
          maxParticipants,
          activeParticipantCount: 0,
          settings,
          version: 1,
          expiresAt,
          auditLog: [
            {
              action: 'CREATED',
              actorId: user._id,
              details: `Created meeting "${title}"`,
              timestamp: now,
            },
          ],
        });
        break;
      } catch (err: any) {
        if (err?.code === 11000 && attempt < MAX_CODE_GENERATION_RETRIES - 1) {
          continue;
        }
        throw err;
      }
    }

    if (!createdMeeting) {
      throw new AppError('Failed to allocate unique meeting code.', 500, 'CODE_GENERATION_FAILED');
    }

    return {
      meeting: await this.serializeMeeting(createdMeeting, hostName),
    };
  }

  /**
   * 2. VALIDATE MEETING CODE & RETRIEVE PRE-JOIN METADATA
   * Never leaks private participant roster to un-admitted callers.
   */
  async getMeetingMetadata(
    rawCode: string,
    callerUserId: string
  ): Promise<{
    meeting: SerializedMeeting;
    isHost: boolean;
    joinable: boolean;
    joinBlockReason: string | null;
    callerStatus: AdmissionStatus | null;
    callerRole: ParticipantRole | null;
  }> {
    const meeting = await this.findMeetingAndEnforceExpiration(rawCode);
    const serialized = await this.serializeMeeting(meeting);
    const callerObjId = new Types.ObjectId(callerUserId);
    const isHost = meeting.hostId.equals(callerObjId);

    const existingParticipant = await MeetingParticipant.findOne({
      meetingId: meeting._id,
      userId: callerObjId,
    });

    let joinable = true;
    let joinBlockReason: string | null = null;

    if (meeting.status === 'ENDED') {
      joinable = false;
      joinBlockReason = 'MEETING_ENDED';
    } else if (meeting.status === 'EXPIRED') {
      joinable = false;
      joinBlockReason = 'MEETING_EXPIRED';
    } else if (existingParticipant?.admissionStatus === 'REMOVED') {
      joinable = false;
      joinBlockReason = 'PARTICIPANT_REMOVED';
    } else if (
      !isHost &&
      existingParticipant?.admissionStatus !== 'ADMITTED' &&
      meeting.isLocked
    ) {
      joinable = false;
      joinBlockReason = 'MEETING_LOCKED';
    } else if (
      existingParticipant?.admissionStatus !== 'ADMITTED' &&
      meeting.activeParticipantCount >= meeting.maxParticipants
    ) {
      joinable = false;
      joinBlockReason = 'MEETING_FULL';
    }

    return {
      meeting: serialized,
      isHost,
      joinable,
      joinBlockReason,
      callerStatus: existingParticipant?.admissionStatus ?? null,
      callerRole: existingParticipant?.role ?? null,
    };
  }

  /**
   * 3. JOIN MEETING / REQUEST ADMISSION (Concurrency-Safe Atomic MongoDB Guards)
   */
  async joinMeeting(
    rawCode: string,
    userId: string,
    input: JoinMeetingInput = {}
  ): Promise<JoinMeetingResult> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestError('Invalid user identifier.', 'INVALID_IDENTIFIER');
    }

    const normalized = this.requireValidMeetingCode(rawCode);
    const dedupKey = `${normalized}:${userId}`;
    const existingFlight = this.inflightJoins.get(dedupKey);
    if (existingFlight) {
      return existingFlight;
    }

    const execution = this.executeJoinMeeting(normalized, userId, input).finally(() => {
      if (this.inflightJoins.get(dedupKey) === execution) {
        this.inflightJoins.delete(dedupKey);
      }
    });
    this.inflightJoins.set(dedupKey, execution);
    return execution;
  }

  private async executeJoinMeeting(
    rawCode: string,
    userId: string,
    input: JoinMeetingInput = {}
  ): Promise<JoinMeetingResult> {

    const meeting = await this.findMeetingAndEnforceExpiration(rawCode);
    if (meeting.status === 'ENDED' || meeting.status === 'EXPIRED' || meeting.status === 'CANCELLED') {
      this.throwMeetingUnavailableError(meeting);
    }

    const user = await User.findById(userId).select('firstName lastName email avatarUrl');
    if (!user) {
      throw new NotFoundError('User account not found.', 'USER_NOT_FOUND');
    }

    const displayName = input.displayName?.trim() || `${user.firstName} ${user.lastName}`.trim();
    const now = new Date();
    const isHost = meeting.hostId.equals(user._id);

    // Inspect existing participant record for idempotent rejoin / removal enforcement
    const existing = await MeetingParticipant.findOne({
      meetingId: meeting._id,
      userId: user._id,
    });

    if (existing) {
      if (existing.admissionStatus === 'REMOVED') {
        throw new ForbiddenError(
          'You were removed from this meeting and cannot rejoin.',
          'PARTICIPANT_REMOVED'
        );
      }
      if (existing.admissionStatus === 'ADMITTED') {
        // Safe idempotent rejoin: never double-count activeParticipantCount or duplicate records
        const serializedMeeting = await this.serializeMeeting(meeting);
        const participants = await this.getAdmittedParticipants(meeting._id);
        const waitingList = this.canManageWaitingRoom(existing, meeting)
          ? await this.getWaitingParticipants(meeting._id)
          : undefined;
        return {
          joinResult: 'ALREADY_ADMITTED',
          meeting: serializedMeeting,
          participant: this.serializeParticipant(existing),
          participants,
          ...(waitingList !== undefined ? { waitingList } : {}),
        };
      }
      if (existing.admissionStatus === 'WAITING') {
        if (meeting.isLocked && !isHost) {
          throw new ForbiddenError('This meeting is currently locked by the host.', 'MEETING_LOCKED');
        }
        return {
          joinResult: 'WAITING',
          meeting: await this.serializeMeeting(meeting),
          participant: this.serializeParticipant(existing),
        };
      }
    }

    // Non-host lock check
    if (!isHost && meeting.isLocked) {
      throw new ForbiddenError('This meeting is currently locked by the host.', 'MEETING_LOCKED');
    }

    // Waiting-room path for non-hosts when waitingRoomEnabled is active
    if (!isHost && meeting.settings.waitingRoomEnabled) {
      // Atomic check that meeting is still active, unlocked, unexpired, and below capacity
      const eligible = await Meeting.findOne({
        _id: meeting._id,
        status: { $in: ['CREATED', 'SCHEDULED', 'ACTIVE'] },
        isLocked: false,
        expiresAt: { $gt: now },
        $expr: { $lt: ['$activeParticipantCount', '$maxParticipants'] },
      });

      if (!eligible) {
        const latest = await Meeting.findById(meeting._id);
        if (latest) this.throwMeetingUnavailableError(latest);
        throw new NotFoundError('Meeting not found.', 'MEETING_NOT_FOUND');
      }

      if (this.hooks.beforeWaitingJoinWrite) {
        await this.hooks.beforeWaitingJoinWrite();
      }

      let waitingDoc: IMeetingParticipant | null = null;
      try {
        waitingDoc = await MeetingParticipant.findOneAndUpdate(
          {
            meetingId: meeting._id,
            userId: user._id,
            admissionStatus: { $nin: ['ADMITTED', 'REMOVED'] },
          },
          {
            $set: {
              displayName,
              email: user.email,
              avatarUrl: user.avatarUrl || null,
              role: 'participant',
              admissionStatus: 'WAITING',
              presenceStatus: 'ONLINE',
              requestedAt: now,
              rejectionReason: null,
              decidedBy: null,
              decidedAt: null,
            },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
      } catch (err: any) {
        if (err?.code === 11000) {
          waitingDoc = await MeetingParticipant.findOne({ meetingId: meeting._id, userId: user._id });
        } else {
          throw err;
        }
      }

      if (!waitingDoc) {
        throw new ConflictError('Could not submit waiting-room request.', 'WAITING_REQUEST_FAILED');
      }
      if (waitingDoc.admissionStatus === 'REMOVED') {
        throw new ForbiddenError(
          'You were removed from this meeting and cannot rejoin.',
          'PARTICIPANT_REMOVED'
        );
      }

      // Post-write authoritative guard against concurrent lock or meeting termination
      const postWaitingMeeting = await Meeting.findById(meeting._id);
      if (
        !postWaitingMeeting ||
        postWaitingMeeting.status === 'ENDED' ||
        postWaitingMeeting.status === 'EXPIRED' ||
        postWaitingMeeting.isLocked
      ) {
        await MeetingParticipant.updateOne(
          { _id: waitingDoc._id, admissionStatus: 'WAITING' },
          { $set: { admissionStatus: 'CANCELLED', presenceStatus: 'OFFLINE', leftAt: now } }
        );
        if (postWaitingMeeting) this.throwMeetingUnavailableError(postWaitingMeeting);
        throw new NotFoundError('Meeting not found.', 'MEETING_NOT_FOUND');
      }

      const waitingList = await this.getWaitingParticipants(meeting._id);
      this.realtime.emitWaitingRoomUpdated(meeting._id.toString(), waitingList);

      return {
        joinResult: 'WAITING',
        meeting: await this.serializeMeeting(postWaitingMeeting),
        participant: this.serializeParticipant(waitingDoc),
      };
    }

    // Direct admission path (Host OR waiting room disabled):
    // Persists capacity reservation, ADMITTED participant transition, and a durable
    // PENDING `PARTICIPANT_JOINED` transactional outbox entry (atomically inside one
    // ACID transaction on Replica Sets; isolated dev/test path on standalone).
    const txSupported = await isReplicaSetTransactionsSupported();
    if (!txSupported && this.requireTransactions) {
      throw new ServiceUnavailableError(
        'Direct meeting admission requires a MongoDB Replica Set supporting multi-document transactions.',
        'TRANSACTION_REQUIRED'
      );
    }

    if (this.hooks.beforeDirectJoinReserve) {
      await this.hooks.beforeDirectJoinReserve();
    }

    const assignedRole: ParticipantRole = isHost ? 'host' : 'participant';
    let latestMeeting: IMeeting | null = null;
    let participantDoc: IMeetingParticipant | null = null;
    let claimedNewSlot = false;
    let joinOutboxId: Types.ObjectId | null = null;

    if (txSupported) {
      await ensureRevocationCollectionsReady();
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(
          async () => {
            const txNow = new Date();
            const existingInTx = await MeetingParticipant.findOne(
              { meetingId: meeting._id, userId: user._id },
              null,
              { session }
            );
            if (existingInTx?.admissionStatus === 'REMOVED') {
              throw new ForbiddenError(
                'You were removed from this meeting and cannot rejoin.',
                'PARTICIPANT_REMOVED'
              );
            }
            if (existingInTx?.admissionStatus === 'ADMITTED') {
              const currentMeeting = await Meeting.findById(meeting._id, null, { session });
              if (
                !currentMeeting ||
                currentMeeting.status === 'ENDED' ||
                currentMeeting.status === 'EXPIRED' ||
                txNow >= currentMeeting.expiresAt
              ) {
                if (currentMeeting) this.throwMeetingUnavailableError(currentMeeting);
                throw new NotFoundError('Meeting not found.', 'MEETING_NOT_FOUND');
              }
              latestMeeting = currentMeeting;
              participantDoc = existingInTx;
              claimedNewSlot = false;
              joinOutboxId = null;
              return;
            }

            const reserveFilter: Record<string, any> = {
              _id: meeting._id,
              status: { $in: ['CREATED', 'SCHEDULED', 'ACTIVE'] },
              expiresAt: { $gt: txNow },
              $expr: { $lt: ['$activeParticipantCount', '$maxParticipants'] },
            };
            if (!isHost) {
              reserveFilter.isLocked = false;
            }

            const reservedMeeting = await Meeting.findOneAndUpdate(
              reserveFilter,
              {
                $inc: { activeParticipantCount: 1, version: 1 },
                $set: {
                  status: 'ACTIVE',
                  ...(meeting.activatedAt ? {} : { activatedAt: txNow }),
                },
                ...(meeting.status === 'CREATED' || meeting.status === 'SCHEDULED'
                  ? {
                      $push: {
                        auditLog: {
                          $each: [
                            {
                              action: 'ACTIVATED',
                              actorId: user._id,
                              details: 'Meeting activated on first admission',
                              timestamp: txNow,
                            },
                          ],
                          $slice: -MAX_AUDIT_ENTRIES,
                        },
                      },
                    }
                  : {}),
              },
              { new: true, session }
            );

            if (!reservedMeeting) {
              const latest = await Meeting.findById(meeting._id, null, { session });
              if (latest) this.throwMeetingUnavailableError(latest);
              throw new NotFoundError('Meeting not found.', 'MEETING_NOT_FOUND');
            }

            if (this.hooks.beforeDirectJoinParticipantWrite) {
              await this.hooks.beforeDirectJoinParticipantWrite();
            }

            let admittedInTx: IMeetingParticipant | null = null;
            if (existingInTx) {
              admittedInTx = await MeetingParticipant.findOneAndUpdate(
                {
                  _id: existingInTx._id,
                  admissionStatus: { $nin: ['ADMITTED', 'REMOVED'] },
                },
                {
                  $set: {
                    displayName,
                    email: user.email,
                    avatarUrl: user.avatarUrl || null,
                    role: assignedRole,
                    admissionStatus: 'ADMITTED',
                    presenceStatus: 'ONLINE',
                    admissionSessionId: generateAdmissionSessionId(),
                    admittedAt: txNow,
                    joinedAt: txNow,
                    leftAt: null,
                  },
                  $inc: {
                    tokenEpoch: 1,
                    signalFenceVersion: 1,
                  },
                },
                { new: true, session }
              );
            } else {
              admittedInTx = await MeetingParticipant.findOneAndUpdate(
                {
                  meetingId: meeting._id,
                  userId: user._id,
                  admissionStatus: { $nin: ['ADMITTED', 'REMOVED'] },
                },
                {
                  $set: {
                    displayName,
                    email: user.email,
                    avatarUrl: user.avatarUrl || null,
                    role: assignedRole,
                    admissionStatus: 'ADMITTED',
                    presenceStatus: 'ONLINE',
                    admissionSessionId: generateAdmissionSessionId(),
                    admittedAt: txNow,
                    joinedAt: txNow,
                    leftAt: null,
                  },
                  $setOnInsert: {
                    requestedAt: txNow,
                  },
                },
                { upsert: true, new: true, setDefaultsOnInsert: true, session }
              );
            }

            if (!admittedInTx) {
              throw new ConflictError('Concurrent join collision. Please retry.', 'CONCURRENT_JOIN');
            }

            // Durable PENDING PARTICIPANT_JOINED outbox event committed atomically with admission
            const [outboxDoc] = await MeetingRealtimeEvent.create(
              [
                {
                  meetingId: meeting._id,
                  meetingVersion: reservedMeeting.version,
                  targetUserId: user._id,
                  type: 'PARTICIPANT_JOINED',
                  status: 'PENDING',
                  terminalAt: null,
                },
              ],
              { session }
            );

            latestMeeting = reservedMeeting;
            participantDoc = admittedInTx;
            claimedNewSlot = true;
            joinOutboxId = outboxDoc._id as Types.ObjectId;
          },
          {
            readConcern: { level: 'majority' },
            writeConcern: { w: 'majority' },
          }
        );
      } finally {
        await session.endSession().catch(() => {});
      }
    } else {
      // Isolated standalone MongoDB development/test path
      const reserveFilter: Record<string, any> = {
        _id: meeting._id,
        status: { $in: ['CREATED', 'SCHEDULED', 'ACTIVE'] },
        expiresAt: { $gt: now },
        $expr: { $lt: ['$activeParticipantCount', '$maxParticipants'] },
      };
      if (!isHost) {
        reserveFilter.isLocked = false;
      }

      const reservedMeeting = await Meeting.findOneAndUpdate(
        reserveFilter,
        {
          $inc: { activeParticipantCount: 1, version: 1 },
          $set: {
            status: 'ACTIVE',
            ...(meeting.activatedAt ? {} : { activatedAt: now }),
          },
          ...(meeting.status === 'CREATED' || meeting.status === 'SCHEDULED'
            ? {
                $push: {
                  auditLog: {
                    $each: [
                      {
                        action: 'ACTIVATED',
                        actorId: user._id,
                        details: 'Meeting activated on first admission',
                        timestamp: now,
                      },
                    ],
                    $slice: -MAX_AUDIT_ENTRIES,
                  },
                },
              }
            : {}),
        },
        { new: true }
      );

      if (!reservedMeeting) {
        const alreadyAdmitted = await MeetingParticipant.findOne({
          meetingId: meeting._id,
          userId: user._id,
          admissionStatus: 'ADMITTED',
        });
        const latest = await Meeting.findById(meeting._id);
        if (alreadyAdmitted && latest && (latest.status === 'ACTIVE' || latest.status === 'CREATED')) {
          const participants = await this.getAdmittedParticipants(meeting._id);
          return {
            joinResult: 'ALREADY_ADMITTED',
            meeting: await this.serializeMeeting(latest),
            participant: this.serializeParticipant(alreadyAdmitted),
            participants,
          };
        }
        if (latest) this.throwMeetingUnavailableError(latest);
        throw new NotFoundError('Meeting not found.', 'MEETING_NOT_FOUND');
      }

      if (this.hooks.beforeDirectJoinParticipantWrite) {
        await this.hooks.beforeDirectJoinParticipantWrite();
      }

      try {
        let priorDoc: IMeetingParticipant | null = null;
        if (existing) {
          priorDoc = await MeetingParticipant.findOneAndUpdate(
            {
              meetingId: meeting._id,
              userId: user._id,
              admissionStatus: { $nin: ['ADMITTED', 'REMOVED'] },
            },
            {
              $set: {
                displayName,
                email: user.email,
                avatarUrl: user.avatarUrl || null,
                role: assignedRole,
                admissionStatus: 'ADMITTED',
                presenceStatus: 'ONLINE',
                admissionSessionId: generateAdmissionSessionId(),
                admittedAt: now,
                joinedAt: now,
                leftAt: null,
              },
              $inc: {
                tokenEpoch: 1,
                signalFenceVersion: 1,
              },
            },
            { new: true }
          );
        } else {
          priorDoc = await MeetingParticipant.findOneAndUpdate(
            {
              meetingId: meeting._id,
              userId: user._id,
              admissionStatus: { $nin: ['ADMITTED', 'REMOVED'] },
            },
            {
              $set: {
                displayName,
                email: user.email,
                avatarUrl: user.avatarUrl || null,
                role: assignedRole,
                admissionStatus: 'ADMITTED',
                presenceStatus: 'ONLINE',
                admissionSessionId: generateAdmissionSessionId(),
                admittedAt: now,
                joinedAt: now,
                leftAt: null,
              },
              $setOnInsert: {
                requestedAt: now,
              },
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
          );
        }
        participantDoc = priorDoc;
        claimedNewSlot = Boolean(priorDoc);
        if (!participantDoc) {
          await Meeting.updateOne(
            { _id: meeting._id, activeParticipantCount: { $gt: 0 } },
            { $inc: { activeParticipantCount: -1 } }
          );
          participantDoc = await MeetingParticipant.findOne({
            meetingId: meeting._id,
            userId: user._id,
          });
        }
      } catch (err: any) {
        if (err?.code === 11000) {
          await Meeting.updateOne(
            { _id: meeting._id, activeParticipantCount: { $gt: 0 } },
            { $inc: { activeParticipantCount: -1 } }
          );
          participantDoc = await MeetingParticipant.findOne({
            meetingId: meeting._id,
            userId: user._id,
          });
        } else {
          await Meeting.updateOne(
            { _id: meeting._id, activeParticipantCount: { $gt: 0 } },
            { $inc: { activeParticipantCount: -1 } }
          );
          throw err;
        }
      }

      if (!participantDoc) {
        throw new ConflictError('Concurrent join collision. Please retry.', 'CONCURRENT_JOIN');
      }

      if (participantDoc.admissionStatus === 'REMOVED') {
        if (claimedNewSlot) {
          await Meeting.updateOne(
            { _id: meeting._id, activeParticipantCount: { $gt: 0 } },
            { $inc: { activeParticipantCount: -1 } }
          );
        }
        throw new ForbiddenError(
          'You were removed from this meeting and cannot rejoin.',
          'PARTICIPANT_REMOVED'
        );
      }

      latestMeeting = await Meeting.findById(meeting._id);
      if (!latestMeeting || latestMeeting.status === 'ENDED' || latestMeeting.status === 'EXPIRED') {
        if (claimedNewSlot) {
          await MeetingParticipant.updateOne(
            { _id: participantDoc._id, admissionStatus: 'ADMITTED' },
            { $set: { admissionStatus: 'LEFT', presenceStatus: 'OFFLINE', leftAt: now } }
          );
        }
        if (latestMeeting) this.throwMeetingUnavailableError(latestMeeting);
        throw new NotFoundError('Meeting not found.', 'MEETING_NOT_FOUND');
      }

      if (claimedNewSlot) {
        const outboxDoc = await MeetingRealtimeEvent.create({
          meetingId: meeting._id,
          meetingVersion: latestMeeting.version,
          targetUserId: user._id,
          type: 'PARTICIPANT_JOINED',
          status: 'PENDING',
          terminalAt: null,
        });
        joinOutboxId = outboxDoc._id as Types.ObjectId;
      }
    }

    if (!latestMeeting || !participantDoc) {
      throw new ConflictError('Concurrent join collision. Please retry.', 'CONCURRENT_JOIN');
    }

    const finalMeeting: IMeeting = latestMeeting;
    const finalParticipant: IMeetingParticipant = participantDoc;
    const serializedMeeting = await this.serializeMeeting(finalMeeting);
    const serializedParticipant = this.serializeParticipant(finalParticipant);
    const participants = await this.getAdmittedParticipants(meeting._id);
    const waitingList = this.canManageWaitingRoom(finalParticipant, finalMeeting)
      ? await this.getWaitingParticipants(meeting._id)
      : undefined;

    if (claimedNewSlot && joinOutboxId) {
      const dispatchResult = await this.outboxDispatcher.dispatchById(
        joinOutboxId,
        {
          serializedMeeting,
          serializedParticipant,
          waitingList: waitingList ?? [],
          activeParticipantCount: finalMeeting.activeParticipantCount,
        },
        {
          beforeClaim: this.hooks.beforeJoinOutboxClaim
            ? async () => {
                await this.hooks.beforeJoinOutboxClaim?.();
              }
            : undefined,
          afterClaimBeforePreEmitCheck: this.hooks.afterJoinOutboxClaim
            ? async () => {
                await this.hooks.afterJoinOutboxClaim?.();
              }
            : undefined,
          beforeEmit: this.hooks.beforeJoinEmit
            ? async () => {
                await this.hooks.beforeJoinEmit?.();
              }
            : undefined,
          afterEmitBeforeMarkDispatched: this.hooks.afterJoinEmitBeforeMarkDispatched
            ? async () => {
                await this.hooks.afterJoinEmitBeforeMarkDispatched?.();
              }
            : undefined,
        }
      );

      if (dispatchResult.status === 'SUPPRESSED') {
        const abortNow = new Date();
        await MeetingParticipant.updateOne(
          { _id: finalParticipant._id, admissionStatus: 'ADMITTED' },
          {
            $set: {
              admissionStatus: 'LEFT',
              presenceStatus: 'OFFLINE',
              leftAt: abortNow,
              tokenRevokedBefore: abortNow,
            },
            $inc: { tokenEpoch: 1, signalFenceVersion: 1 },
          }
        ).catch(() => {});
        throw new AppError('Meeting ended before join could be finalized.', 410, 'MEETING_ENDED');
      }
    }

    return {
      joinResult: claimedNewSlot ? 'ADMITTED' : 'ALREADY_ADMITTED',
      meeting: serializedMeeting,
      participant: serializedParticipant,
      participants,
      ...(waitingList !== undefined ? { waitingList } : {}),
    };
  }

  /**
   * 4. GET AUTHORITATIVE ROOM STATE (For admitted members or waiting user status check)
   */
  async getMeetingState(rawCode: string, userId: string): Promise<MeetingStateResult> {
    const meeting = await this.findMeetingAndEnforceExpiration(rawCode);
    const participant = await MeetingParticipant.findOne({
      meetingId: meeting._id,
      userId,
    });

    if (!participant) {
      throw new ForbiddenError(
        'You must join this meeting through the pre-join lobby first.',
        'NOT_A_PARTICIPANT'
      );
    }

    const serializedMeeting = await this.serializeMeeting(meeting);
    const serializedSelf = this.serializeParticipant(participant);

    if (participant.admissionStatus === 'ADMITTED') {
      const participants = await this.getAdmittedParticipants(meeting._id);
      const waitingList = this.canManageWaitingRoom(participant, meeting)
        ? await this.getWaitingParticipants(meeting._id)
        : undefined;
      return {
        meeting: serializedMeeting,
        self: serializedSelf,
        participants,
        ...(waitingList !== undefined ? { waitingList } : {}),
      };
    }

    // Waiting / Rejected / Removed / Left callers ONLY receive their own status — never private room roster!
    return {
      meeting: serializedMeeting,
      self: serializedSelf,
      participants: [],
    };
  }

  /**
   * 5. LIST ACTIVE PARTICIPANTS (Admitted members only)
   */
  async listParticipants(
    rawCode: string,
    userId: string
  ): Promise<{ participants: SerializedParticipant[]; count: number }> {
    const meeting = await this.findMeetingAndEnforceExpiration(rawCode);
    const actor = await MeetingParticipant.findOne({
      meetingId: meeting._id,
      userId,
      admissionStatus: 'ADMITTED',
    });

    if (!actor) {
      throw new ForbiddenError(
        'Only admitted participants can view the meeting participant list.',
        'FORBIDDEN'
      );
    }

    const participants = await this.getAdmittedParticipants(meeting._id);
    return { participants, count: participants.length };
  }

  /**
   * 6. LIST WAITING ROOM REQUESTS (Host / authorized Co-Host only)
   */
  async listWaitingRoom(
    rawCode: string,
    userId: string
  ): Promise<{ waitingList: SerializedParticipant[]; count: number }> {
    const meeting = await this.findMeetingAndEnforceExpiration(rawCode);
    const actor = await MeetingParticipant.findOne({
      meetingId: meeting._id,
      userId,
    });

    if (!actor || !this.canManageWaitingRoom(actor, meeting)) {
      throw new ForbiddenError(
        'Only the host or an authorized co-host can inspect the waiting room.',
        'FORBIDDEN'
      );
    }

    const waitingList = await this.getWaitingParticipants(meeting._id);
    return { waitingList, count: waitingList.length };
  }

  /**
   * 7. ADMIT WAITING PARTICIPANT (Atomic Replica Set transaction + ordered realtime outbox)
   *
   * - On Replica Sets (mandatory in production; no silent non-atomic fallback):
   *   Revalidates meeting status/expiry/capacity, revalidates actor membership/role/settings
   *   via a conditional write-conflict check on the actor document, reserves capacity,
   *   transitions WAITING -> ADMITTED (incrementing tokenEpoch & signalFenceVersion once),
   *   and inserts a PENDING transactional outbox entry inside ONE ACID MongoDB transaction.
   * - Ordered Realtime Emission: Claims the outbox entry (`PENDING -> DISPATCHED`) inside
   *   the hub's per-meeting serialized lifecycle queue so concurrent `endMeeting()`
   *   (which suppresses all PENDING admission outbox entries) cannot be followed by a stale
   *   `meeting:admission-approved` or `meeting:participant-joined` broadcast.
   */
  async admitParticipant(
    rawCode: string,
    actorUserId: string,
    targetUserId: string
  ): Promise<{
    participant: SerializedParticipant;
    activeParticipantCount: number;
    waitingList: SerializedParticipant[];
  }> {
    if (!Types.ObjectId.isValid(targetUserId)) {
      throw new BadRequestError('Invalid target participant identifier.', 'INVALID_IDENTIFIER');
    }

    const meeting = await this.findMeetingAndEnforceExpiration(rawCode);
    if (meeting.status === 'ENDED' || meeting.status === 'EXPIRED' || meeting.status === 'CANCELLED') {
      this.throwMeetingUnavailableError(meeting);
    }

    const actor = await MeetingParticipant.findOne({
      meetingId: meeting._id,
      userId: actorUserId,
    });

    if (!actor || !this.canManageWaitingRoom(actor, meeting)) {
      throw new ForbiddenError(
        'You do not have permission to admit waiting participants.',
        'FORBIDDEN'
      );
    }

    const txSupported = await isReplicaSetTransactionsSupported();
    if (this.requireTransactions && !txSupported) {
      throw new ServiceUnavailableError(
        'MongoDB Replica Set transactions are required for atomic waiting-room admission.',
        'TRANSACTION_REQUIRED'
      );
    }

    const now = new Date();
    const targetObjId = new Types.ObjectId(targetUserId);

    if (this.hooks.beforeAdmitReserve) {
      await this.hooks.beforeAdmitReserve();
    }

    let committedMeeting: IMeeting | null = null;
    let admitted: IMeetingParticipant | null = null;
    let outboxId: Types.ObjectId | null = null;

    if (txSupported) {
      // Production / Replica Set ACID transaction path
      await ensureRevocationCollectionsReady();
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(
          async () => {
            const txNow = new Date();
            // 1. Revalidate meeting status, expiry, settings, and capacity INSIDE transaction
            const txMeeting = await Meeting.findById(meeting._id).session(session);
            if (!txMeeting) {
              throw new NotFoundError('Meeting not found.', 'MEETING_NOT_FOUND');
            }
            if (
              txMeeting.status === 'ENDED' ||
              txMeeting.status === 'EXPIRED' ||
              txNow >= txMeeting.expiresAt
            ) {
              this.throwMeetingUnavailableError(txMeeting);
            }

            // 2. Revalidate actor membership, ADMITTED status, role & waiting-room permission
            //    via a conditional write touch inside the transaction so concurrent demotion
            //    or removal of the actor triggers a write conflict / fails immediately.
            const allowedActorRoles = txMeeting.settings.allowCoHostAdmit
              ? ['host', 'co-host']
              : ['host'];
            const verifiedActor = await MeetingParticipant.findOneAndUpdate(
              {
                meetingId: meeting._id,
                userId: actor.userId,
                admissionStatus: 'ADMITTED',
                role: { $in: allowedActorRoles },
              },
              { $set: { updatedAt: txNow } },
              { new: true, session }
            );
            if (!verifiedActor) {
              throw new ForbiddenError(
                'You no longer have permission to admit waiting participants.',
                'FORBIDDEN'
              );
            }

            // 3. Atomically reserve capacity on active, non-expired meeting
            const reservedMeeting = await Meeting.findOneAndUpdate(
              {
                _id: meeting._id,
                status: { $in: ['CREATED', 'ACTIVE'] },
                expiresAt: { $gt: txNow },
                $expr: { $lt: ['$activeParticipantCount', '$maxParticipants'] },
              },
              {
                $inc: { activeParticipantCount: 1, version: 1 },
                $set: {
                  status: 'ACTIVE',
                  ...(txMeeting.activatedAt ? {} : { activatedAt: txNow }),
                },
                $push: {
                  auditLog: {
                    $each: [
                      {
                        action: 'PARTICIPANT_ADMITTED',
                        actorId: verifiedActor.userId,
                        targetUserId: targetObjId,
                        timestamp: txNow,
                      },
                    ],
                    $slice: -MAX_AUDIT_ENTRIES,
                  },
                },
              },
              { new: true, session }
            );

            if (!reservedMeeting) {
              const latest = await Meeting.findById(meeting._id).session(session);
              if (latest) this.throwMeetingUnavailableError(latest);
              throw new NotFoundError('Meeting not found.', 'MEETING_NOT_FOUND');
            }

            if (this.hooks.beforeAdmitParticipantWrite) {
              await this.hooks.beforeAdmitParticipantWrite();
            }

            // 4. Atomically transition target WAITING -> ADMITTED, incrementing tokenEpoch & signalFenceVersion once
            const transitioned = await MeetingParticipant.findOneAndUpdate(
              {
                meetingId: meeting._id,
                userId: targetObjId,
                admissionStatus: 'WAITING',
              },
              {
                $set: {
                  admissionStatus: 'ADMITTED',
                  presenceStatus: 'ONLINE',
                  admissionSessionId: generateAdmissionSessionId(),
                  admittedAt: txNow,
                  joinedAt: txNow,
                  leftAt: null,
                  decidedBy: verifiedActor.userId,
                  decidedAt: txNow,
                },
                $inc: {
                  tokenEpoch: 1,
                  signalFenceVersion: 1,
                },
              },
              { new: true, session }
            );

            if (!transitioned) {
              // Throwing aborts transaction -> MongoDB rolls back activeParticipantCount cleanly (zero leak!)
              const latestAfterFail = await Meeting.findById(meeting._id).session(session);
              if (
                latestAfterFail &&
                (latestAfterFail.status === 'ENDED' ||
                  latestAfterFail.status === 'EXPIRED' ||
                  txNow >= latestAfterFail.expiresAt)
              ) {
                this.throwMeetingUnavailableError(latestAfterFail);
              }
              throw new ConflictError(
                'Waiting-room request is no longer pending (it may have been cancelled or already handled).',
                'WAITING_REQUEST_NOT_PENDING'
              );
            }

            // 5. Record durable PENDING transactional outbox entry for ordered realtime emission
            const [outboxDoc] = await MeetingRealtimeEvent.create(
              [
                {
                  meetingId: meeting._id,
                  meetingVersion: reservedMeeting.version,
                  targetUserId: targetObjId,
                  type: 'ADMISSION_APPROVED',
                  status: 'PENDING',
                },
              ],
              { session }
            );

            committedMeeting = reservedMeeting;
            admitted = transitioned;
            outboxId = outboxDoc._id as Types.ObjectId;
          },
          {
            readConcern: { level: 'majority' },
            writeConcern: { w: 'majority' },
          }
        );
      } finally {
        await session.endSession().catch(() => {});
      }
    } else {
      // Isolated standalone MongoDB development/test path (multi-document transactions unavailable)
      const freshMeeting = await Meeting.findById(meeting._id);
      if (!freshMeeting) {
        throw new NotFoundError('Meeting not found.', 'MEETING_NOT_FOUND');
      }
      if (
        freshMeeting.status === 'ENDED' ||
        freshMeeting.status === 'EXPIRED' ||
        now >= freshMeeting.expiresAt
      ) {
        this.throwMeetingUnavailableError(freshMeeting);
      }

      const freshActor = await MeetingParticipant.findOne({
        meetingId: meeting._id,
        userId: actor.userId,
      });
      if (!freshActor || !this.canManageWaitingRoom(freshActor, freshMeeting)) {
        throw new ForbiddenError(
          'You no longer have permission to admit waiting participants.',
          'FORBIDDEN'
        );
      }

      const reservedMeeting = await Meeting.findOneAndUpdate(
        {
          _id: meeting._id,
          status: { $in: ['CREATED', 'ACTIVE'] },
          expiresAt: { $gt: now },
          $expr: { $lt: ['$activeParticipantCount', '$maxParticipants'] },
        },
        {
          $inc: { activeParticipantCount: 1, version: 1 },
          $set: {
            status: 'ACTIVE',
            ...(freshMeeting.activatedAt ? {} : { activatedAt: now }),
          },
          $push: {
            auditLog: {
              $each: [
                {
                  action: 'PARTICIPANT_ADMITTED',
                  actorId: freshActor.userId,
                  targetUserId: targetObjId,
                  timestamp: now,
                },
              ],
              $slice: -MAX_AUDIT_ENTRIES,
            },
          },
        },
        { new: true }
      );

      if (!reservedMeeting) {
        const latest = await Meeting.findById(meeting._id);
        if (latest) this.throwMeetingUnavailableError(latest);
        throw new NotFoundError('Meeting not found.', 'MEETING_NOT_FOUND');
      }

      if (this.hooks.beforeAdmitParticipantWrite) {
        await this.hooks.beforeAdmitParticipantWrite();
      }

      // Re-verify actor authorization & meeting liveness right before WAITING -> ADMITTED
      const [midMeeting, midActor] = await Promise.all([
        Meeting.findById(meeting._id),
        MeetingParticipant.findOne({ meetingId: meeting._id, userId: actor.userId }),
      ]);
      if (
        !midMeeting ||
        midMeeting.status === 'ENDED' ||
        midMeeting.status === 'EXPIRED' ||
        new Date() >= midMeeting.expiresAt
      ) {
        await Meeting.updateOne(
          { _id: meeting._id, activeParticipantCount: { $gt: 0 } },
          { $inc: { activeParticipantCount: -1 } }
        );
        if (midMeeting) this.throwMeetingUnavailableError(midMeeting);
        throw new NotFoundError('Meeting not found.', 'MEETING_NOT_FOUND');
      }
      if (!midActor || !this.canManageWaitingRoom(midActor, midMeeting)) {
        await Meeting.updateOne(
          { _id: meeting._id, activeParticipantCount: { $gt: 0 } },
          { $inc: { activeParticipantCount: -1 } }
        );
        throw new ForbiddenError(
          'You no longer have permission to admit waiting participants.',
          'FORBIDDEN'
        );
      }

      const transitioned = await MeetingParticipant.findOneAndUpdate(
        {
          meetingId: meeting._id,
          userId: targetObjId,
          admissionStatus: 'WAITING',
        },
        {
          $set: {
            admissionStatus: 'ADMITTED',
            presenceStatus: 'ONLINE',
            admissionSessionId: generateAdmissionSessionId(),
            admittedAt: now,
            joinedAt: now,
            leftAt: null,
            decidedBy: midActor.userId,
            decidedAt: now,
          },
          $inc: {
            tokenEpoch: 1,
            signalFenceVersion: 1,
          },
        },
        { new: true }
      );

      if (!transitioned) {
        await Meeting.updateOne(
          { _id: meeting._id, activeParticipantCount: { $gt: 0 } },
          { $inc: { activeParticipantCount: -1 } }
        );
        const latestAfterFail = await Meeting.findById(meeting._id);
        if (
          latestAfterFail &&
          (latestAfterFail.status === 'ENDED' || latestAfterFail.status === 'EXPIRED')
        ) {
          this.throwMeetingUnavailableError(latestAfterFail);
        }
        throw new ConflictError(
          'Waiting-room request is no longer pending (it may have been cancelled or already handled).',
          'WAITING_REQUEST_NOT_PENDING'
        );
      }

      const postCheck = await Meeting.findById(meeting._id);
      if (
        !postCheck ||
        postCheck.status === 'ENDED' ||
        postCheck.status === 'EXPIRED' ||
        new Date() >= postCheck.expiresAt
      ) {
        await MeetingParticipant.updateOne(
          { _id: transitioned._id, admissionStatus: 'ADMITTED' },
          {
            $set: {
              admissionStatus: 'CANCELLED',
              presenceStatus: 'OFFLINE',
              leftAt: now,
              tokenRevokedBefore: now,
            },
            $inc: { tokenEpoch: 1, signalFenceVersion: 1 },
          }
        );
        throw new AppError('Meeting ended before admission could be finalized.', 410, 'MEETING_ENDED');
      }

      const outboxDoc = await MeetingRealtimeEvent.create({
        meetingId: meeting._id,
        meetingVersion: reservedMeeting.version,
        targetUserId: targetObjId,
        type: 'ADMISSION_APPROVED',
        status: 'PENDING',
      });

      committedMeeting = postCheck;
      admitted = transitioned;
      outboxId = outboxDoc._id as Types.ObjectId;
    }

    if (!committedMeeting || !admitted || !outboxId) {
      throw new ConflictError('Waiting-room admission did not complete.', 'CONFLICT');
    }

    const finalMeetingDoc: IMeeting = committedMeeting;
    const finalAdmittedDoc: IMeetingParticipant = admitted;
    const finalOutboxId: Types.ObjectId = outboxId;

    const serializedMeeting = await this.serializeMeeting(finalMeetingDoc);
    const serializedParticipant = this.serializeParticipant(finalAdmittedDoc);
    const waitingList = await this.getWaitingParticipants(meeting._id);

    // Recoverable Lease-Based Transactional Outbox Dispatch:
    // Atomically leases the outbox entry (`PENDING -> CLAIMED` with leaseOwner/leaseToken/
    // leaseExpiresAt), verifies lease + meeting liveness inside the per-meeting ordered queue,
    // emits Socket.IO notifications with stable `eventId`, and confirms `CLAIMED -> DISPATCHED`
    // (setting `terminalAt`). Any process crash before completion leaves the record recoverable
    // by another dispatcher instance once `leaseExpiresAt` elapses; concurrent meeting
    // termination atomically suppresses BOTH `PENDING` and `CLAIMED` records.
    const abortTerminatedAdmission = async (): Promise<never> => {
      const abortNow = new Date();
      await MeetingRealtimeEvent.updateOne(
        { _id: finalOutboxId, status: { $ne: 'SUPPRESSED' } },
        {
          $set: {
            status: 'SUPPRESSED',
            suppressedAt: abortNow,
            terminalAt: abortNow,
            leaseOwner: null,
            leaseToken: null,
            leaseExpiresAt: null,
          },
        }
      ).catch(() => {});
      await MeetingParticipant.updateOne(
        { _id: finalAdmittedDoc._id, admissionStatus: 'ADMITTED' },
        {
          $set: {
            admissionStatus: 'CANCELLED',
            presenceStatus: 'OFFLINE',
            leftAt: abortNow,
            tokenRevokedBefore: abortNow,
          },
          $inc: { tokenEpoch: 1, signalFenceVersion: 1 },
        }
      ).catch(() => {});
      throw new AppError('Meeting ended before admission could be finalized.', 410, 'MEETING_ENDED');
    };

    const dispatchResult = await this.outboxDispatcher.dispatchById(
      finalOutboxId,
      {
        serializedMeeting,
        serializedParticipant,
        waitingList,
        activeParticipantCount: finalMeetingDoc.activeParticipantCount,
      },
      {
        beforeClaim: this.hooks.beforeAdmitOutboxClaim
          ? async () => {
              await this.hooks.beforeAdmitOutboxClaim?.();
            }
          : undefined,
        afterClaimBeforePreEmitCheck: this.hooks.afterAdmitOutboxClaim
          ? async () => {
              await this.hooks.afterAdmitOutboxClaim?.();
            }
          : undefined,
        beforeEmit: this.hooks.beforeAdmitEmit
          ? async () => {
              await this.hooks.beforeAdmitEmit?.();
            }
          : undefined,
        afterEmitBeforeMarkDispatched: this.hooks.afterAdmitEmitBeforeMarkDispatched
          ? async () => {
              await this.hooks.afterAdmitEmitBeforeMarkDispatched?.();
            }
          : undefined,
      }
    );

    if (dispatchResult.status === 'SUPPRESSED') {
      await abortTerminatedAdmission();
    }

    return {
      participant: serializedParticipant,
      activeParticipantCount: finalMeetingDoc.activeParticipantCount,
      waitingList,
    };
  }

  /**
   * 8. REJECT WAITING PARTICIPANT
   */
  async rejectParticipant(
    rawCode: string,
    actorUserId: string,
    targetUserId: string,
    reason?: string
  ): Promise<{ waitingList: SerializedParticipant[] }> {
    if (!Types.ObjectId.isValid(targetUserId)) {
      throw new BadRequestError('Invalid target participant identifier.', 'INVALID_IDENTIFIER');
    }

    const meeting = await this.findMeetingAndEnforceExpiration(rawCode);
    if (meeting.status === 'ENDED' || meeting.status === 'EXPIRED' || meeting.status === 'CANCELLED') {
      this.throwMeetingUnavailableError(meeting);
    }

    const actor = await MeetingParticipant.findOne({
      meetingId: meeting._id,
      userId: actorUserId,
    });

    if (!actor || !this.canManageWaitingRoom(actor, meeting)) {
      throw new ForbiddenError(
        'You do not have permission to reject waiting participants.',
        'FORBIDDEN'
      );
    }

    const now = new Date();
    const targetObjId = new Types.ObjectId(targetUserId);
    if (this.hooks.beforeRejectWrite) {
      await this.hooks.beforeRejectWrite();
    }
    const rejected = await MeetingParticipant.findOneAndUpdate(
      {
        meetingId: meeting._id,
        userId: targetObjId,
        admissionStatus: 'WAITING',
      },
      {
        $set: {
          admissionStatus: 'REJECTED',
          presenceStatus: 'OFFLINE',
          decidedBy: actor.userId,
          decidedAt: now,
          rejectionReason: reason || 'Declined by host.',
        },
      },
      { new: true }
    );

    if (!rejected) {
      throw new ConflictError(
        'Waiting-room request is no longer pending.',
        'WAITING_REQUEST_NOT_PENDING'
      );
    }

    await Meeting.updateOne(
      { _id: meeting._id },
      {
        $push: {
          auditLog: {
            $each: [
              {
                action: 'PARTICIPANT_REJECTED',
                actorId: actor.userId,
                targetUserId: targetObjId,
                timestamp: now,
              },
            ],
            $slice: -MAX_AUDIT_ENTRIES,
          },
        },
      }
    );

    const waitingList = await this.getWaitingParticipants(meeting._id);
    this.realtime.emitAdmissionRejected(meeting._id.toString(), targetUserId, reason);
    this.realtime.emitWaitingRoomUpdated(meeting._id.toString(), waitingList);

    return { waitingList };
  }

  /**
   * 9. REMOVE PARTICIPANT (Host or authorized Co-Host)
   */
  async removeParticipant(
    rawCode: string,
    actorUserId: string,
    targetUserId: string,
    reason?: string
  ): Promise<{ activeParticipantCount: number; cleanup: RemovalCleanupReport }> {
    if (!Types.ObjectId.isValid(targetUserId)) {
      throw new BadRequestError('Invalid target participant identifier.', 'INVALID_IDENTIFIER');
    }

    const meeting = await this.findMeetingAndEnforceExpiration(rawCode);
    if (meeting.status === 'ENDED' || meeting.status === 'EXPIRED' || meeting.status === 'CANCELLED') {
      this.throwMeetingUnavailableError(meeting);
    }

    const [actor, target] = await Promise.all([
      MeetingParticipant.findOne({ meetingId: meeting._id, userId: actorUserId }),
      MeetingParticipant.findOne({ meetingId: meeting._id, userId: targetUserId }),
    ]);

    if (!actor || actor.admissionStatus !== 'ADMITTED') {
      throw new ForbiddenError('Only admitted meeting hosts can remove participants.', 'FORBIDDEN');
    }
    if (!target || target.admissionStatus !== 'ADMITTED') {
      throw new NotFoundError('Active participant not found in this meeting.', 'PARTICIPANT_NOT_FOUND');
    }

    if (!this.canRemoveParticipant(actor, target, meeting)) {
      throw new ForbiddenError(
        'You do not have permission to remove this participant.',
        'FORBIDDEN'
      );
    }

    const now = new Date();
    const txSupported = await isReplicaSetTransactionsSupported();
    if (!txSupported && this.requireTransactions) {
      throw new ServiceUnavailableError(
        'Atomic participant removal requires a MongoDB Replica Set supporting multi-document transactions.',
        'TRANSACTION_REQUIRED'
      );
    }
    let removed: IMeetingParticipant | null = null;
    let updatedMeeting: IMeeting | null = null;

    if (txSupported) {
      // Replica Set / Production ACID path: commit MeetingParticipant removal,
      // Meeting count/audit update, counter increment, and LiveKitRevocationEvent
      // atomically in ONE transaction so a crash or publish failure can never
      // leave a removed participant without a durable revocation event.
      await ensureRevocationCollectionsReady();
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(
          async () => {
            removed = await MeetingParticipant.findOneAndUpdate(
              { _id: target._id, admissionStatus: 'ADMITTED' },
              {
                $set: {
                  admissionStatus: 'REMOVED',
                  presenceStatus: 'OFFLINE',
                  role: 'participant',
                  leftAt: now,
                  decidedBy: actor.userId,
                  decidedAt: now,
                  removalReason: reason || 'Removed by host.',
                  tokenRevokedBefore: now,
                },
                $inc: {
                  tokenEpoch: 1,
                  signalFenceVersion: 1,
                },
              },
              { new: true, session }
            );
            if (!removed) {
              throw new NotFoundError(
                'Participant is no longer active in this meeting.',
                'PARTICIPANT_NOT_FOUND'
              );
            }

            updatedMeeting = await Meeting.findOneAndUpdate(
              { _id: meeting._id, activeParticipantCount: { $gt: 0 } },
              {
                $inc: { activeParticipantCount: -1, version: 1 },
                $push: {
                  auditLog: {
                    $each: [
                      {
                        action: 'PARTICIPANT_REMOVED',
                        actorId: actor.userId,
                        targetUserId: target.userId,
                        details: reason || 'Removed by host',
                        timestamp: now,
                      },
                    ],
                    $slice: -MAX_AUDIT_ENTRIES,
                  },
                },
              },
              { new: true, session }
            );

            await this.publishRevocation({
              meetingId: meeting._id.toString(),
              userId: targetUserId,
              kind: 'PARTICIPANT_REMOVED',
              revokedEpoch: removed.tokenEpoch,
              fenceVersion: removed.signalFenceVersion,
              reason: reason || 'Removed by host.',
              session,
            });

            // Enqueue durable LiveKit eviction job atomically inside the SAME transaction
            const sessionEvictionIdentity = getLiveKitParticipantIdentity(
              target.userId.toString(),
              target.admissionSessionId
            );
            const evictionJobId = generateEvictionJobId(
              meeting._id,
              target.userId,
              removed.tokenEpoch,
              target.admissionSessionId
            );
            await LiveKitEvictionJob.updateOne(
              { jobId: evictionJobId },
              {
                $setOnInsert: {
                  jobId: evictionJobId,
                  meetingId: meeting._id,
                  meetingCode: meeting.meetingCode,
                  userId: target.userId,
                  identity: sessionEvictionIdentity,
                  sessionId: target.admissionSessionId || null,
                  epoch: removed.tokenEpoch,
                  status: 'PENDING',
                  attempts: 0,
                  maxAttempts: 5,
                  nextRunAt: now,
                },
              },
              { upsert: true, session }
            );
          },
          {
            readConcern: { level: 'majority' },
            writeConcern: { w: 'majority' },
          }
        );
      } catch (err) {
        if (err instanceof AppError) {
          throw err;
        }
        logger.error('[MeetingService] Atomic participant removal transaction failed', {
          meetingId: meeting._id.toString(),
          targetUserId,
          message: err instanceof Error ? err.message : 'Transaction failure',
        });
        throw new ServiceUnavailableError(
          'Participant removal could not be committed atomically with revocation.',
          'LIVEKIT_REVOCATION_TRANSACTION_FAILED'
        );
      } finally {
        await session.endSession().catch(() => {});
      }

      if (!removed) {
        throw new NotFoundError('Participant is no longer active in this meeting.', 'PARTICIPANT_NOT_FOUND');
      }

      const committedRemoved: IMeetingParticipant = removed;
      const activeCount = (updatedMeeting as IMeeting | null)?.activeParticipantCount ?? 0;
      const cleanup = await this.executeRemovalPostCommitCleanup({
        meetingId: meeting._id.toString(),
        targetUserId,
        activeCount,
        revokedEpoch: committedRemoved.tokenEpoch,
        sessionId: target.admissionSessionId,
        reason,
      });
      return { activeParticipantCount: activeCount, cleanup };
    }

    // Standalone MongoDB non-production path (multi-document transactions unavailable)
    removed = await MeetingParticipant.findOneAndUpdate(
      { _id: target._id, admissionStatus: 'ADMITTED' },
      {
        $set: {
          admissionStatus: 'REMOVED',
          presenceStatus: 'OFFLINE',
          role: 'participant',
          leftAt: now,
          decidedBy: actor.userId,
          decidedAt: now,
          removalReason: reason || 'Removed by host.',
          tokenRevokedBefore: now,
        },
        $inc: {
          tokenEpoch: 1,
          signalFenceVersion: 1,
        },
      },
      { new: true }
    );

    if (!removed) {
      throw new NotFoundError('Participant is no longer active in this meeting.', 'PARTICIPANT_NOT_FOUND');
    }

    updatedMeeting = await Meeting.findOneAndUpdate(
      { _id: meeting._id, activeParticipantCount: { $gt: 0 } },
      {
        $inc: { activeParticipantCount: -1, version: 1 },
        $push: {
          auditLog: {
            $each: [
              {
                action: 'PARTICIPANT_REMOVED',
                actorId: actor.userId,
                targetUserId: target.userId,
                details: reason || 'Removed by host',
                timestamp: now,
              },
            ],
            $slice: -MAX_AUDIT_ENTRIES,
          },
        },
      },
      { new: true }
    );

    const activeCount = updatedMeeting?.activeParticipantCount ?? 0;
    let publishError: unknown = null;
    try {
      await this.publishRevocation({
        meetingId: meeting._id.toString(),
        userId: targetUserId,
        kind: 'PARTICIPANT_REMOVED',
        revokedEpoch: removed.tokenEpoch,
        fenceVersion: removed.signalFenceVersion,
        reason: reason || 'Removed by host.',
      });
    } catch (err) {
      publishError = err;
      logger.error(
        '[MeetingService] Durable revocation event publish failed after participant removal; executing immediate eviction & fail-closed',
        {
          meetingId: meeting._id.toString(),
          targetUserId,
          message: err instanceof Error ? err.message : 'Revocation publish error',
        }
      );
      this.revocationCoordinator.markUnavailable(
        'Durable revocation event publish failed after participant removal; failing closed.'
      );
    }

    const sessionEvictionIdentity = getLiveKitParticipantIdentity(
      target.userId.toString(),
      target.admissionSessionId
    );
    const fallbackEvictionJobId = generateEvictionJobId(
      meeting._id,
      target.userId,
      removed.tokenEpoch,
      target.admissionSessionId
    );
    await LiveKitEvictionJob.updateOne(
      { jobId: fallbackEvictionJobId },
      {
        $setOnInsert: {
          jobId: fallbackEvictionJobId,
          meetingId: meeting._id,
          meetingCode: meeting.meetingCode,
          userId: target.userId,
          identity: sessionEvictionIdentity,
          sessionId: target.admissionSessionId || null,
          epoch: removed.tokenEpoch,
          status: 'PENDING',
          attempts: 0,
          maxAttempts: 5,
          nextRunAt: now,
        },
      },
      { upsert: true }
    );

    const cleanup = await this.executeRemovalPostCommitCleanup({
      meetingId: meeting._id.toString(),
      targetUserId,
      activeCount,
      revokedEpoch: removed.tokenEpoch,
      sessionId: target.admissionSessionId,
      reason,
    });

    if (publishError) {
      throw publishError instanceof AppError
        ? publishError
        : new ServiceUnavailableError(
            'Durable revocation event publication failed after participant removal.',
            'LIVEKIT_REVOCATION_PUBLISH_FAILED'
          );
    }

    return { activeParticipantCount: activeCount, cleanup };
  }

  /**
   * 10. PROMOTE / REVOKE CO-HOST ROLE (Host ONLY)
   */
  async updateParticipantRole(
    rawCode: string,
    actorUserId: string,
    targetUserId: string,
    input: UpdateRoleInput
  ): Promise<{ participant: SerializedParticipant }> {
    if (!Types.ObjectId.isValid(targetUserId)) {
      throw new BadRequestError('Invalid target participant identifier.', 'INVALID_IDENTIFIER');
    }

    const meeting = await this.findMeetingAndEnforceExpiration(rawCode);
    if (meeting.status === 'ENDED' || meeting.status === 'EXPIRED' || meeting.status === 'CANCELLED') {
      this.throwMeetingUnavailableError(meeting);
    }

    const [actor, target] = await Promise.all([
      MeetingParticipant.findOne({ meetingId: meeting._id, userId: actorUserId }),
      MeetingParticipant.findOne({ meetingId: meeting._id, userId: targetUserId }),
    ]);

    // Strictly Host-only — co-hosts and participants can NEVER change roles or escalate privileges
    if (!actor || actor.admissionStatus !== 'ADMITTED' || actor.role !== 'host') {
      throw new ForbiddenError('Only the meeting host can promote or revoke co-hosts.', 'FORBIDDEN');
    }

    if (!target || target.admissionStatus !== 'ADMITTED') {
      throw new NotFoundError('Active participant not found in this meeting.', 'PARTICIPANT_NOT_FOUND');
    }

    if (target.userId.equals(actor.userId) || target.role === 'host') {
      throw new BadRequestError('Host role cannot be modified via co-host assignment.', 'INVALID_ROLE_CHANGE');
    }

    const now = new Date();
    const updated = await MeetingParticipant.findOneAndUpdate(
      { _id: target._id, admissionStatus: 'ADMITTED' },
      { $set: { role: input.role } },
      { new: true }
    );

    if (!updated) {
      throw new NotFoundError('Participant is no longer active.', 'PARTICIPANT_NOT_FOUND');
    }

    await Meeting.updateOne(
      { _id: meeting._id },
      {
        $inc: { version: 1 },
        $push: {
          auditLog: {
            $each: [
              {
                action: 'ROLE_UPDATED',
                actorId: actor.userId,
                targetUserId: target.userId,
                details: `Role changed to ${input.role}`,
                timestamp: now,
              },
            ],
            $slice: -MAX_AUDIT_ENTRIES,
          },
        },
      }
    );

    await this.realtime.emitRoleUpdated(
      meeting._id.toString(),
      targetUserId,
      input.role,
      meeting.hostId.toString()
    );

    return { participant: this.serializeParticipant(updated) };
  }

  /**
   * 11. LOCK / UNLOCK MEETING (Host or authorized Co-Host)
   */
  async setMeetingLock(
    rawCode: string,
    actorUserId: string,
    isLocked: boolean
  ): Promise<{ meeting: SerializedMeeting }> {
    const meeting = await this.findMeetingAndEnforceExpiration(rawCode);
    if (meeting.status === 'ENDED' || meeting.status === 'EXPIRED' || meeting.status === 'CANCELLED') {
      this.throwMeetingUnavailableError(meeting);
    }

    const actor = await MeetingParticipant.findOne({
      meetingId: meeting._id,
      userId: actorUserId,
    });

    if (!actor || !this.canToggleLock(actor, meeting)) {
      throw new ForbiddenError(
        'You do not have permission to lock or unlock this meeting.',
        'FORBIDDEN'
      );
    }

    const now = new Date();
    if (this.hooks.beforeLockWrite) {
      await this.hooks.beforeLockWrite();
    }
    const updated = await Meeting.findOneAndUpdate(
      {
        _id: meeting._id,
        status: { $in: ['CREATED', 'ACTIVE'] },
        expiresAt: { $gt: now },
      },
      {
        $set: { isLocked },
        $inc: { version: 1 },
        $push: {
          auditLog: {
            $each: [
              {
                action: isLocked ? 'LOCKED' : 'UNLOCKED',
                actorId: actor.userId,
                timestamp: now,
              },
            ],
            $slice: -MAX_AUDIT_ENTRIES,
          },
        },
      },
      { new: true }
    );

    if (!updated) {
      const latest = await Meeting.findById(meeting._id);
      if (latest) this.throwMeetingUnavailableError(latest);
      throw new NotFoundError('Meeting not found.', 'MEETING_NOT_FOUND');
    }

    if (this.hooks.beforeLockEmit) {
      await this.hooks.beforeLockEmit();
    }

    // Only broadcast if this committed version is still authoritative in MongoDB
    const authoritative = await Meeting.findById(meeting._id).select('status version isLocked');
    if (
      authoritative &&
      (authoritative.status === 'CREATED' || authoritative.status === 'ACTIVE') &&
      authoritative.version === updated.version
    ) {
      this.realtime.emitLockChanged(meeting._id.toString(), isLocked, actorUserId, updated.version);
    }

    return { meeting: await this.serializeMeeting(updated) };
  }

  /**
   * 12. UPDATE MEETING SETTINGS (Host ONLY)
   */
  async updateSettings(
    rawCode: string,
    actorUserId: string,
    input: UpdateMeetingSettingsInput
  ): Promise<{ meeting: SerializedMeeting }> {
    const meeting = await this.findMeetingAndEnforceExpiration(rawCode);
    if (meeting.status === 'ENDED' || meeting.status === 'EXPIRED' || meeting.status === 'CANCELLED') {
      this.throwMeetingUnavailableError(meeting);
    }

    const actor = await MeetingParticipant.findOne({
      meetingId: meeting._id,
      userId: actorUserId,
    });

    if (!actor || actor.admissionStatus !== 'ADMITTED' || actor.role !== 'host') {
      throw new ForbiddenError('Only the meeting host can modify meeting settings.', 'FORBIDDEN');
    }

    const updateSet: Record<string, any> = {};
    if (input.title !== undefined) updateSet.title = input.title.trim();
    if (input.waitingRoomEnabled !== undefined) {
      updateSet['settings.waitingRoomEnabled'] = input.waitingRoomEnabled;
    }
    if (input.allowCoHostAdmit !== undefined) {
      updateSet['settings.allowCoHostAdmit'] = input.allowCoHostAdmit;
    }
    if (input.allowCoHostRemove !== undefined) {
      updateSet['settings.allowCoHostRemove'] = input.allowCoHostRemove;
    }
    if (input.allowCoHostLock !== undefined) {
      updateSet['settings.allowCoHostLock'] = input.allowCoHostLock;
    }

    const now = new Date();
    const updated = await Meeting.findOneAndUpdate(
      {
        _id: meeting._id,
        status: { $in: ['CREATED', 'ACTIVE'] },
        expiresAt: { $gt: now },
      },
      {
        $set: updateSet,
        $inc: { version: 1 },
        $push: {
          auditLog: {
            $each: [
              {
                action: 'SETTINGS_UPDATED',
                actorId: actor.userId,
                timestamp: now,
              },
            ],
            $slice: -MAX_AUDIT_ENTRIES,
          },
        },
      },
      { new: true }
    );

    if (!updated) {
      const latest = await Meeting.findById(meeting._id);
      if (latest) this.throwMeetingUnavailableError(latest);
      throw new NotFoundError('Meeting not found.', 'MEETING_NOT_FOUND');
    }

    this.realtime.emitSettingsUpdated(meeting._id.toString(), updated.title, updated.settings);

    return { meeting: await this.serializeMeeting(updated) };
  }

  /**
   * 13. LEAVE MEETING OR CANCEL WAITING REQUEST
   *
   * Explicit Host Departure Policy:
   * - If the departing member is the Host:
   *   1. Transfer Host ownership deterministically to the earliest-joined admitted Co-Host.
   *   2. Otherwise transfer Host ownership to the earliest-joined admitted Participant.
   *   3. If no admitted participants remain, cleanly END the meeting and cancel any
   *      pending waiting-room requests so an active room never exists without an owner.
   */
  async leaveMeeting(
    rawCode: string,
    userId: string
  ): Promise<{
    left: true;
    meetingEnded: boolean;
    newHostId: string | null;
  }> {
    const meeting = await this.findMeetingAndEnforceExpiration(rawCode);
    const participant = await MeetingParticipant.findOne({
      meetingId: meeting._id,
      userId,
    });

    if (!participant) {
      return { left: true, meetingEnded: meeting.status === 'ENDED', newHostId: null };
    }

    const now = new Date();

    // Case 1: Waiting user cancels their pending request
    if (participant.admissionStatus === 'WAITING') {
      const cancelRes = await MeetingParticipant.updateOne(
        { _id: participant._id, admissionStatus: 'WAITING' },
        { $set: { admissionStatus: 'CANCELLED', presenceStatus: 'OFFLINE', leftAt: now } }
      );
      if (cancelRes.modifiedCount > 0) {
        await this.realtime.evictUserFromMeeting(meeting._id.toString(), userId);
        const waitingList = await this.getWaitingParticipants(meeting._id);
        this.realtime.emitWaitingRoomUpdated(meeting._id.toString(), waitingList);
      }
      return { left: true, meetingEnded: false, newHostId: null };
    }

    // Case 2: Admitted participant leaves
    if (participant.admissionStatus !== 'ADMITTED') {
      return { left: true, meetingEnded: meeting.status === 'ENDED', newHostId: null };
    }

    const txSupported = await isReplicaSetTransactionsSupported();
    if (this.requireTransactions && !txSupported) {
      throw new ServiceUnavailableError(
        'MongoDB Replica Set transactions are required for atomic participant departure.',
        'TRANSACTION_REQUIRED'
      );
    }

    const meetingIdStr = meeting._id.toString();

    if (txSupported) {
      // Production / Replica Set ACID path:
      // Atomically commit participant LEFT transition (with tokenEpoch & signalFenceVersion bump),
      // activeParticipantCount decrement, deterministic host succession OR automatic meeting
      // termination + waiting-room cancellation + outbox suppression, AND durable revocation event.
      await ensureRevocationCollectionsReady();
      const session = await mongoose.startSession();
      let txTransitioned: IMeetingParticipant | null = null;
      let txNewHostId: string | null = null;
      let txMeetingEnded = false;
      let txActiveCount = 0;
      let txWaitingUserIds: string[] = [];

      try {
        await session.withTransaction(
          async () => {
            txTransitioned = null;
            txNewHostId = null;
            txMeetingEnded = false;
            txActiveCount = 0;
            txWaitingUserIds = [];

            const txNow = new Date();
            const currentParticipant = await MeetingParticipant.findOne({
              _id: participant._id,
            }).session(session);
            if (!currentParticipant || currentParticipant.admissionStatus !== 'ADMITTED') {
              return;
            }
            const wasHostNow = currentParticipant.role === 'host';

            const transitionedDoc = await MeetingParticipant.findOneAndUpdate(
              { _id: participant._id, admissionStatus: 'ADMITTED' },
              {
                $set: {
                  admissionStatus: 'LEFT',
                  presenceStatus: 'OFFLINE',
                  role: 'participant',
                  leftAt: txNow,
                  tokenRevokedBefore: txNow,
                },
                $inc: {
                  tokenEpoch: 1,
                  signalFenceVersion: 1,
                },
              },
              { new: true, session }
            );
            if (!transitionedDoc) {
              return;
            }
            txTransitioned = transitionedDoc;

            if (this.hooks.beforeLeaveMeetingUpdate) {
              await this.hooks.beforeLeaveMeetingUpdate();
            }

            const updatedMeetingDoc = await Meeting.findOneAndUpdate(
              { _id: meeting._id, activeParticipantCount: { $gt: 0 } },
              { $inc: { activeParticipantCount: -1, version: 1 } },
              { new: true, session }
            );
            const txMeeting = updatedMeetingDoc ?? (await Meeting.findById(meeting._id).session(session));
            txActiveCount = txMeeting?.activeParticipantCount ?? 0;

            if (
              wasHostNow &&
              txMeeting &&
              txMeeting.status !== 'ENDED' &&
              txMeeting.status !== 'EXPIRED'
            ) {
              // Deterministic succession: earliest-joined admitted co-host, else earliest-joined admitted participant
              const remaining = await MeetingParticipant.find({
                meetingId: meeting._id,
                admissionStatus: 'ADMITTED',
              })
                .sort({ joinedAt: 1, createdAt: 1 })
                .session(session);

              const successor =
                remaining.find((p) => p.role === 'co-host') || remaining[0] || null;

              if (successor) {
                const promoted = await MeetingParticipant.findOneAndUpdate(
                  { _id: successor._id, admissionStatus: 'ADMITTED' },
                  { $set: { role: 'host' } },
                  { new: true, session }
                );
                if (!promoted) {
                  throw new ConflictError(
                    'Host successor state changed concurrently; retrying transaction.',
                    'CONCURRENT_HOST_TRANSFER'
                  );
                }
                await Meeting.updateOne(
                  { _id: meeting._id, status: { $in: ['CREATED', 'ACTIVE'] } },
                  {
                    $set: { hostId: successor.userId },
                    $inc: { version: 1 },
                    $push: {
                      auditLog: {
                        $each: [
                          {
                            action: 'HOST_TRANSFERRED',
                            actorId: participant.userId,
                            targetUserId: successor.userId,
                            details: 'Automatic host handover upon host departure',
                            timestamp: txNow,
                          },
                        ],
                        $slice: -MAX_AUDIT_ENTRIES,
                      },
                    },
                  },
                  { session }
                );
                txNewHostId = successor.userId.toString();
                txActiveCount = txMeeting.activeParticipantCount ?? remaining.length;

                await this.publishRevocation({
                  meetingId: meetingIdStr,
                  userId,
                  kind: 'PARTICIPANT_LEFT',
                  revokedEpoch: transitionedDoc.tokenEpoch,
                  fenceVersion: transitionedDoc.signalFenceVersion,
                  session,
                });
              } else {
                // Only auto-end if activeParticipantCount is 0 (serializes against concurrent joinMeeting!)
                const endedMeetingDoc = await Meeting.findOneAndUpdate(
                  {
                    _id: meeting._id,
                    status: { $in: ['CREATED', 'ACTIVE'] },
                    activeParticipantCount: 0,
                  },
                  {
                    $set: { status: 'ENDED', endedAt: txNow, activeParticipantCount: 0 },
                    $inc: { version: 1 },
                    $push: {
                      auditLog: {
                        $each: [
                          {
                            action: 'ENDED',
                            actorId: participant.userId,
                            details: 'Meeting ended automatically after last host left',
                            timestamp: txNow,
                          },
                        ],
                        $slice: -MAX_AUDIT_ENTRIES,
                      },
                    },
                  },
                  { new: true, session }
                );

                if (endedMeetingDoc) {
                  txMeetingEnded = true;
                  const waitingDocs = await MeetingParticipant.find({
                    meetingId: meeting._id,
                    admissionStatus: 'WAITING',
                  })
                    .select('userId')
                    .session(session);
                  txWaitingUserIds = waitingDocs.map((w) => w.userId.toString());

                  await MeetingParticipant.updateMany(
                    { meetingId: meeting._id, admissionStatus: 'WAITING' },
                    {
                      $set: {
                        admissionStatus: 'CANCELLED',
                        presenceStatus: 'OFFLINE',
                        decidedAt: txNow,
                      },
                    },
                    { session }
                  );
                  await MeetingRealtimeEvent.updateMany(
                    {
                      meetingId: meeting._id,
                      status: { $in: ['PENDING', 'CLAIMED'] },
                      type: { $ne: 'MEETING_ENDED' },
                    },
                    {
                      $set: {
                        status: 'SUPPRESSED',
                        suppressedAt: txNow,
                        terminalAt: txNow,
                        leaseOwner: null,
                        leaseToken: null,
                        leaseExpiresAt: null,
                      },
                    },
                    { session }
                  );
                  await MeetingRealtimeEvent.create(
                    [
                      {
                        meetingId: meeting._id,
                        meetingVersion: endedMeetingDoc.version,
                        type: 'MEETING_ENDED',
                        status: 'DISPATCHED',
                        dispatchedAt: txNow,
                        terminalAt: txNow,
                      },
                    ],
                    { session }
                  );

                  await this.publishRevocation({
                    meetingId: meetingIdStr,
                    kind: 'MEETING_ENDED',
                    reason: 'Last host left empty meeting.',
                    session,
                  });
                } else {
                  // Meeting already ended or another participant joined concurrently; publish PARTICIPANT_LEFT
                  await this.publishRevocation({
                    meetingId: meetingIdStr,
                    userId,
                    kind: 'PARTICIPANT_LEFT',
                    revokedEpoch: transitionedDoc.tokenEpoch,
                    fenceVersion: transitionedDoc.signalFenceVersion,
                    session,
                  });
                }
              }
            } else {
              await this.publishRevocation({
                meetingId: meetingIdStr,
                userId,
                kind: 'PARTICIPANT_LEFT',
                revokedEpoch: transitionedDoc.tokenEpoch,
                fenceVersion: transitionedDoc.signalFenceVersion,
                session,
              });
            }
          },
          {
            readConcern: { level: 'majority' },
            writeConcern: { w: 'majority' },
          }
        );
      } catch (err) {
        if (err instanceof AppError) {
          throw err;
        }
        logger.error('[MeetingService] Atomic leaveMeeting transaction failed', {
          metadata: {
            meetingId: meetingIdStr,
            participantId: userId,
            message: err instanceof Error ? err.message : 'Transaction failure',
          },
        });
        throw new ServiceUnavailableError(
          'Participant departure could not be committed atomically with revocation.',
          'LIVEKIT_REVOCATION_TRANSACTION_FAILED'
        );
      } finally {
        await session.endSession().catch(() => {});
      }

      if (!txTransitioned) {
        const latest = await Meeting.findById(meeting._id).select('status').lean();
        return { left: true, meetingEnded: latest?.status === 'ENDED', newHostId: null };
      }

      const committedLeave: IMeetingParticipant = txTransitioned;

      // Post-commit independent cleanup steps (never let one external failure skip local socket disconnect)
      try {
        if (txMeetingEnded) {
          this.signalGateway.disconnectMeetingSockets(meetingIdStr);
        } else {
          this.signalGateway.disconnectParticipantSockets(
            meetingIdStr,
            userId,
            committedLeave.tokenEpoch
          );
        }
      } catch (err) {
        logger.error('[MeetingService] Leave cleanup failed: local signaling sockets', {
          metadata: {
            meetingId: meetingIdStr,
            participantId: userId,
            operation: txMeetingEnded
              ? 'signalGateway.disconnectMeetingSockets'
              : 'signalGateway.disconnectParticipantSockets',
            message: err instanceof Error ? err.message : 'Gateway socket disconnect error',
          },
        });
      }

      try {
        await this.realtime.evictUserFromMeeting(meetingIdStr, userId);
        if (txMeetingEnded) {
          await this.realtime.runMeetingLifecycleOrdered(meetingIdStr, async () => {
            await this.realtime.emitMeetingEnded(
              meetingIdStr,
              userId,
              txWaitingUserIds,
              'The host left and no other participants remained, so this meeting has ended.'
            );
          });
        } else if (txNewHostId) {
          this.realtime.emitParticipantLeft(meetingIdStr, userId, txActiveCount, 'LEFT', txNewHostId);
          await this.realtime.emitRoleUpdated(meetingIdStr, txNewHostId, 'host', txNewHostId);
        } else {
          this.realtime.emitParticipantLeft(meetingIdStr, userId, txActiveCount, 'LEFT');
        }
      } catch (err) {
        logger.error('[MeetingService] Leave cleanup failed: realtime broadcasts', {
          metadata: {
            meetingId: meetingIdStr,
            participantId: userId,
            operation: 'realtime.leaveMeeting',
            message: err instanceof Error ? err.message : 'Realtime broadcast error',
          },
        });
      }

      try {
        if (txMeetingEnded) {
          await this.livekit.deleteRoom(meetingIdStr);
        } else {
          await this.livekit.removeParticipant(meetingIdStr, userId);
        }
      } catch (err) {
        logger.error('[MeetingService] Leave cleanup failed: LiveKit SFU cleanup', {
          metadata: {
            meetingId: meetingIdStr,
            participantId: userId,
            operation: txMeetingEnded ? 'livekit.deleteRoom' : 'livekit.removeParticipant',
            message: err instanceof Error ? err.message : 'LiveKit cleanup error',
          },
        });
      }

      return { left: true, meetingEnded: txMeetingEnded, newHostId: txNewHostId };
    }

    // Isolated standalone MongoDB development/test path
    const wasHost = participant.role === 'host';
    const transitioned = await MeetingParticipant.findOneAndUpdate(
      { _id: participant._id, admissionStatus: 'ADMITTED' },
      {
        $set: {
          admissionStatus: 'LEFT',
          presenceStatus: 'OFFLINE',
          role: 'participant',
          leftAt: now,
          tokenRevokedBefore: now,
        },
        $inc: {
          tokenEpoch: 1,
          signalFenceVersion: 1,
        },
      },
      { new: true }
    );

    if (!transitioned) {
      return { left: true, meetingEnded: false, newHostId: null };
    }

    if (this.hooks.beforeLeaveMeetingUpdate) {
      await this.hooks.beforeLeaveMeetingUpdate();
    }

    // Immediately strip the departing member's sockets from admitted/hosts channels so
    // old sockets cannot continue receiving privileged room or waiting-room events.
    try {
      await this.realtime.evictUserFromMeeting(meetingIdStr, userId);
    } catch (err) {
      logger.error('[MeetingService] Leave cleanup failed: evictUserFromMeeting', {
        metadata: {
          meetingId: meetingIdStr,
          participantId: userId,
          operation: 'realtime.evictUserFromMeeting',
          message: err instanceof Error ? err.message : 'Realtime eviction error',
        },
      });
    }

    const updatedMeeting = await Meeting.findOneAndUpdate(
      { _id: meeting._id, activeParticipantCount: { $gt: 0 } },
      { $inc: { activeParticipantCount: -1, version: 1 } },
      { new: true }
    );

    let newHostId: string | null = null;
    let meetingEnded = false;

    if (wasHost && meeting.status !== 'ENDED' && meeting.status !== 'EXPIRED') {
      // Find deterministic successor: earliest admitted co-host, else earliest admitted participant
      const remaining = await MeetingParticipant.find({
        meetingId: meeting._id,
        admissionStatus: 'ADMITTED',
      }).sort({ joinedAt: 1, createdAt: 1 });

      const successor =
        remaining.find((p) => p.role === 'co-host') || remaining[0] || null;

      if (successor) {
        await MeetingParticipant.updateOne(
          { _id: successor._id, admissionStatus: 'ADMITTED' },
          { $set: { role: 'host' } }
        );
        await Meeting.updateOne(
          { _id: meeting._id, status: { $in: ['CREATED', 'ACTIVE'] } },
          {
            $set: { hostId: successor.userId },
            $inc: { version: 1 },
            $push: {
              auditLog: {
                $each: [
                  {
                    action: 'HOST_TRANSFERRED',
                    actorId: participant.userId,
                    targetUserId: successor.userId,
                    details: 'Automatic host handover upon host departure',
                    timestamp: now,
                  },
                ],
                $slice: -MAX_AUDIT_ENTRIES,
              },
            },
          }
        );
        newHostId = successor.userId.toString();

        try {
          this.realtime.emitParticipantLeft(
            meetingIdStr,
            userId,
            updatedMeeting?.activeParticipantCount ?? remaining.length,
            'LEFT',
            newHostId
          );
          await this.realtime.emitRoleUpdated(meetingIdStr, newHostId, 'host', newHostId);
        } catch (err) {
          logger.error('[MeetingService] Leave cleanup failed: host handover broadcast', {
            metadata: {
              meetingId: meetingIdStr,
              participantId: userId,
              operation: 'realtime.hostHandover',
              message: err instanceof Error ? err.message : 'Realtime broadcast error',
            },
          });
        }
      } else {
        // Host was the last admitted participant -> terminate meeting cleanly if still empty
        const endedMeeting = await Meeting.findOneAndUpdate(
          { _id: meeting._id, status: { $in: ['CREATED', 'ACTIVE'] }, activeParticipantCount: 0 },
          {
            $set: { status: 'ENDED', endedAt: now, activeParticipantCount: 0 },
            $inc: { version: 1 },
            $push: {
              auditLog: {
                $each: [
                  {
                    action: 'ENDED',
                    actorId: participant.userId,
                    details: 'Meeting ended automatically after last host left',
                    timestamp: now,
                  },
                ],
                $slice: -MAX_AUDIT_ENTRIES,
              },
            },
          },
          { new: true }
        );
        if (endedMeeting) {
          meetingEnded = true;
          const waitingDocs = await MeetingParticipant.find({
            meetingId: meeting._id,
            admissionStatus: 'WAITING',
          }).select('userId');
          const waitingUserIds = waitingDocs.map((w) => w.userId.toString());

          await MeetingParticipant.updateMany(
            { meetingId: meeting._id, admissionStatus: 'WAITING' },
            { $set: { admissionStatus: 'CANCELLED', presenceStatus: 'OFFLINE', decidedAt: now } }
          );
          await MeetingRealtimeEvent.updateMany(
            {
              meetingId: meeting._id,
              status: { $in: ['PENDING', 'CLAIMED'] },
              type: { $ne: 'MEETING_ENDED' },
            },
            {
              $set: {
                status: 'SUPPRESSED',
                suppressedAt: now,
                terminalAt: now,
                leaseOwner: null,
                leaseToken: null,
                leaseExpiresAt: null,
              },
            }
          );
          await MeetingRealtimeEvent.create({
            meetingId: meeting._id,
            meetingVersion: endedMeeting.version,
            type: 'MEETING_ENDED',
            status: 'DISPATCHED',
            dispatchedAt: now,
            terminalAt: now,
          });

          let endPublishErr: unknown = null;
          try {
            await this.publishRevocation({
              meetingId: meetingIdStr,
              kind: 'MEETING_ENDED',
              reason: 'Last host left empty meeting.',
            });
          } catch (err) {
            endPublishErr = err;
            logger.error(
              '[MeetingService] Failed to publish MEETING_ENDED revocation on last host leave',
              {
                metadata: {
                  meetingId: meetingIdStr,
                  participantId: userId,
                  operation: 'publishRevocation.MEETING_ENDED',
                  message: err instanceof Error ? err.message : 'Revocation publish error',
                },
              }
            );
            this.revocationCoordinator.markUnavailable(
              'Durable revocation event publish failed during automatic meeting end; failing closed.'
            );
          }

          try {
            this.signalGateway.disconnectMeetingSockets(meetingIdStr);
          } catch (err) {
            logger.error('[MeetingService] Auto-end cleanup failed: local gateway sockets', {
              metadata: {
                meetingId: meetingIdStr,
                participantId: userId,
                operation: 'signalGateway.disconnectMeetingSockets',
                message: err instanceof Error ? err.message : 'Gateway disconnect error',
              },
            });
          }
          try {
            await this.realtime.runMeetingLifecycleOrdered(meetingIdStr, async () => {
              await this.realtime.emitMeetingEnded(
                meetingIdStr,
                userId,
                waitingUserIds,
                'The host left and no other participants remained, so this meeting has ended.'
              );
            });
          } catch (err) {
            logger.error('[MeetingService] Auto-end cleanup failed: realtime emitMeetingEnded', {
              metadata: {
                meetingId: meetingIdStr,
                participantId: userId,
                operation: 'realtime.emitMeetingEnded',
                message: err instanceof Error ? err.message : 'Realtime error',
              },
            });
          }
          try {
            await this.livekit.deleteRoom(meetingIdStr);
          } catch (err) {
            logger.error('[MeetingService] Auto-end cleanup failed: livekit.deleteRoom', {
              metadata: {
                meetingId: meetingIdStr,
                participantId: userId,
                operation: 'livekit.deleteRoom',
                message: err instanceof Error ? err.message : 'LiveKit deleteRoom error',
              },
            });
          }

          if (endPublishErr) {
            throw endPublishErr instanceof AppError
              ? endPublishErr
              : new ServiceUnavailableError(
                  'Durable revocation event publication failed during automatic meeting end.',
                  'LIVEKIT_REVOCATION_PUBLISH_FAILED'
                );
          }
        }
      }
    } else {
      try {
        this.realtime.emitParticipantLeft(
          meetingIdStr,
          userId,
          updatedMeeting?.activeParticipantCount ?? 0,
          'LEFT'
        );
      } catch (err) {
        logger.error('[MeetingService] Leave cleanup failed: realtime emitParticipantLeft', {
          metadata: {
            meetingId: meetingIdStr,
            participantId: userId,
            operation: 'realtime.emitParticipantLeft',
            message: err instanceof Error ? err.message : 'Realtime error',
          },
        });
      }
    }

    if (!meetingEnded) {
      let leavePublishErr: unknown = null;
      try {
        await this.publishRevocation({
          meetingId: meetingIdStr,
          userId,
          kind: 'PARTICIPANT_LEFT',
          revokedEpoch: transitioned.tokenEpoch,
          fenceVersion: transitioned.signalFenceVersion,
        });
      } catch (err) {
        leavePublishErr = err;
        logger.error('[MeetingService] Failed to publish PARTICIPANT_LEFT revocation event', {
          metadata: {
            meetingId: meetingIdStr,
            participantId: userId,
            operation: 'publishRevocation.PARTICIPANT_LEFT',
            message: err instanceof Error ? err.message : 'Revocation publish error',
          },
        });
        this.revocationCoordinator.markUnavailable(
          'Durable revocation event publish failed after participant leave; failing closed.'
        );
      }

      try {
        this.signalGateway.disconnectParticipantSockets(
          meetingIdStr,
          userId,
          transitioned.tokenEpoch
        );
      } catch (err) {
        logger.error('[MeetingService] Leave cleanup failed: local gateway sockets', {
          metadata: {
            meetingId: meetingIdStr,
            participantId: userId,
            operation: 'signalGateway.disconnectParticipantSockets',
            message: err instanceof Error ? err.message : 'Gateway disconnect error',
          },
        });
      }
      try {
        await this.livekit.removeParticipant(meetingIdStr, userId);
      } catch (err) {
        logger.error('[MeetingService] Leave cleanup failed: livekit.removeParticipant', {
          metadata: {
            meetingId: meetingIdStr,
            participantId: userId,
            operation: 'livekit.removeParticipant',
            message: err instanceof Error ? err.message : 'LiveKit removeParticipant error',
          },
        });
      }

      if (leavePublishErr) {
        throw leavePublishErr instanceof AppError
          ? leavePublishErr
          : new ServiceUnavailableError(
              'Durable revocation event publication failed after participant leave.',
              'LIVEKIT_REVOCATION_PUBLISH_FAILED'
            );
      }
    }

    return { left: true, meetingEnded, newHostId };
  }

  /**
   * 14. END MEETING FOR EVERYONE (Host ONLY)
   */
  async endMeeting(
    rawCode: string,
    actorUserId: string
  ): Promise<{ meeting: SerializedMeeting }> {
    const meeting = await this.findMeetingAndEnforceExpiration(rawCode);
    if (meeting.status === 'ENDED') {
      return { meeting: await this.serializeMeeting(meeting) };
    }
    if (meeting.status === 'EXPIRED') {
      this.throwMeetingUnavailableError(meeting);
    }

    const actor = await MeetingParticipant.findOne({
      meetingId: meeting._id,
      userId: actorUserId,
    });

    const isHostOwner =
      meeting.hostId.equals(new Types.ObjectId(actorUserId)) &&
      (!actor || actor.admissionStatus === 'ADMITTED' || meeting.status === 'CREATED');

    if (!isHostOwner) {
      throw new ForbiddenError('Only the meeting host can end the meeting for everyone.', 'FORBIDDEN');
    }

    const now = new Date();
    if (this.hooks.beforeEndWrite) {
      await this.hooks.beforeEndWrite();
    }

    const txSupported = await isReplicaSetTransactionsSupported();
    let ended: IMeeting | null = null;
    let waitingUserIds: string[] = [];

    if (txSupported) {
      // Replica Set / Production ACID path: commit Meeting ENDED, participant epoch/fence updates,
      // counter increment, and MEETING_ENDED revocation event atomically in ONE transaction.
      await ensureRevocationCollectionsReady();
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(
          async () => {
            ended = await Meeting.findOneAndUpdate(
              { _id: meeting._id, status: { $in: ['CREATED', 'ACTIVE'] } },
              {
                $set: {
                  status: 'ENDED',
                  endedAt: now,
                  activeParticipantCount: 0,
                },
                $inc: { version: 1 },
                $push: {
                  auditLog: {
                    $each: [
                      {
                        action: 'ENDED',
                        actorId: new Types.ObjectId(actorUserId),
                        details: 'Host terminated meeting for all participants',
                        timestamp: now,
                      },
                    ],
                    $slice: -MAX_AUDIT_ENTRIES,
                  },
                },
              },
              { new: true, session }
            );
            if (!ended) {
              return;
            }

            const waitingDocs = await MeetingParticipant.find({
              meetingId: meeting._id,
              admissionStatus: { $in: ['WAITING', 'ADMITTED'] },
            })
              .select('userId')
              .session(session);
            waitingUserIds = waitingDocs.map((w) => w.userId.toString());

            await MeetingParticipant.updateMany(
              { meetingId: meeting._id, admissionStatus: 'WAITING' },
              { $set: { admissionStatus: 'CANCELLED', presenceStatus: 'OFFLINE', decidedAt: now } },
              { session }
            );
            await MeetingParticipant.updateMany(
              { meetingId: meeting._id, admissionStatus: 'ADMITTED' },
              {
                $set: {
                  admissionStatus: 'LEFT',
                  presenceStatus: 'OFFLINE',
                  leftAt: now,
                  tokenRevokedBefore: now,
                },
                $inc: {
                  tokenEpoch: 1,
                  signalFenceVersion: 1,
                },
              },
              { session }
            );

            // Atomically suppress all PENDING and CLAIMED admission outbox entries and record MEETING_ENDED
            await MeetingRealtimeEvent.updateMany(
              {
                meetingId: meeting._id,
                status: { $in: ['PENDING', 'CLAIMED'] },
                type: { $ne: 'MEETING_ENDED' },
              },
              {
                $set: {
                  status: 'SUPPRESSED',
                  suppressedAt: now,
                  terminalAt: now,
                  leaseOwner: null,
                  leaseToken: null,
                  leaseExpiresAt: null,
                },
              },
              { session }
            );
            await MeetingRealtimeEvent.create(
              [
                {
                  meetingId: meeting._id,
                  meetingVersion: ended.version,
                  type: 'MEETING_ENDED',
                  status: 'DISPATCHED',
                  dispatchedAt: now,
                  terminalAt: now,
                },
              ],
              { session }
            );

            await this.publishRevocation({
              meetingId: meeting._id.toString(),
              kind: 'MEETING_ENDED',
              reason: 'Host terminated meeting for all participants.',
              session,
            });
          },
          {
            readConcern: { level: 'majority' },
            writeConcern: { w: 'majority' },
          }
        );
      } catch (err) {
        if (err instanceof AppError) {
          throw err;
        }
        logger.error('[MeetingService] Atomic meeting termination transaction failed', {
          meetingId: meeting._id.toString(),
          message: err instanceof Error ? err.message : 'Transaction failure',
        });
        throw new ServiceUnavailableError(
          'Meeting termination could not be committed atomically with revocation.',
          'LIVEKIT_REVOCATION_TRANSACTION_FAILED'
        );
      } finally {
        await session.endSession().catch(() => {});
      }

      if (!ended) {
        const latest = await Meeting.findById(meeting._id);
        if (latest) return { meeting: await this.serializeMeeting(latest) };
        throw new NotFoundError('Meeting not found.', 'MEETING_NOT_FOUND');
      }

      const endedIdStr = meeting._id.toString();
      try {
        this.signalGateway.disconnectMeetingSockets(endedIdStr);
      } catch (err) {
        logger.error('[MeetingService] endMeeting cleanup failed: local gateway sockets', {
          metadata: {
            meetingId: endedIdStr,
            operation: 'signalGateway.disconnectMeetingSockets',
            message: err instanceof Error ? err.message : 'Gateway disconnect error',
          },
        });
      }
      try {
        await this.realtime.runMeetingLifecycleOrdered(endedIdStr, async () => {
          await this.realtime.emitMeetingEnded(endedIdStr, actorUserId, waitingUserIds);
        });
      } catch (err) {
        logger.error('[MeetingService] endMeeting cleanup failed: realtime emitMeetingEnded', {
          metadata: {
            meetingId: endedIdStr,
            operation: 'realtime.emitMeetingEnded',
            message: err instanceof Error ? err.message : 'Realtime error',
          },
        });
      }
      try {
        await this.livekit.deleteRoom(endedIdStr);
      } catch (err) {
        logger.error('[MeetingService] endMeeting cleanup failed: livekit.deleteRoom', {
          metadata: {
            meetingId: endedIdStr,
            operation: 'livekit.deleteRoom',
            message: err instanceof Error ? err.message : 'LiveKit deleteRoom error',
          },
        });
      }
      return { meeting: await this.serializeMeeting(ended) };
    }

    // Standalone MongoDB non-production path
    ended = await Meeting.findOneAndUpdate(
      { _id: meeting._id, status: { $in: ['CREATED', 'ACTIVE'] } },
      {
        $set: {
          status: 'ENDED',
          endedAt: now,
          activeParticipantCount: 0,
        },
        $inc: { version: 1 },
        $push: {
          auditLog: {
            $each: [
              {
                action: 'ENDED',
                actorId: new Types.ObjectId(actorUserId),
                details: 'Host terminated meeting for all participants',
                timestamp: now,
              },
            ],
            $slice: -MAX_AUDIT_ENTRIES,
          },
        },
      },
      { new: true }
    );

    if (!ended) {
      const latest = await Meeting.findById(meeting._id);
      if (latest) return { meeting: await this.serializeMeeting(latest) };
      throw new NotFoundError('Meeting not found.', 'MEETING_NOT_FOUND');
    }

    const waitingDocs = await MeetingParticipant.find({
      meetingId: meeting._id,
      admissionStatus: { $in: ['WAITING', 'ADMITTED'] },
    }).select('userId');
    waitingUserIds = waitingDocs.map((w) => w.userId.toString());

    await Promise.all([
      MeetingParticipant.updateMany(
        { meetingId: meeting._id, admissionStatus: 'WAITING' },
        { $set: { admissionStatus: 'CANCELLED', presenceStatus: 'OFFLINE', decidedAt: now } }
      ),
      MeetingParticipant.updateMany(
        { meetingId: meeting._id, admissionStatus: 'ADMITTED' },
        {
          $set: {
            admissionStatus: 'LEFT',
            presenceStatus: 'OFFLINE',
            leftAt: now,
            tokenRevokedBefore: now,
          },
          $inc: {
            tokenEpoch: 1,
            signalFenceVersion: 1,
          },
        }
      ),
      MeetingRealtimeEvent.updateMany(
        {
          meetingId: meeting._id,
          status: { $in: ['PENDING', 'CLAIMED'] },
          type: { $ne: 'MEETING_ENDED' },
        },
        {
          $set: {
            status: 'SUPPRESSED',
            suppressedAt: now,
            terminalAt: now,
            leaseOwner: null,
            leaseToken: null,
            leaseExpiresAt: null,
          },
        }
      ),
    ]);
    await MeetingRealtimeEvent.create({
      meetingId: meeting._id,
      meetingVersion: ended.version,
      type: 'MEETING_ENDED',
      status: 'DISPATCHED',
      dispatchedAt: now,
      terminalAt: now,
    });

    const endedStandaloneIdStr = meeting._id.toString();
    let publishError: unknown = null;
    try {
      await this.publishRevocation({
        meetingId: endedStandaloneIdStr,
        kind: 'MEETING_ENDED',
        reason: 'Host terminated meeting for all participants.',
      });
    } catch (err) {
      publishError = err;
      logger.error(
        '[MeetingService] Durable revocation event publish failed during endMeeting; executing immediate room cleanup & fail-closed',
        {
          metadata: {
            meetingId: endedStandaloneIdStr,
            operation: 'publishRevocation.MEETING_ENDED',
            message: err instanceof Error ? err.message : 'Revocation publish error',
          },
        }
      );
      this.revocationCoordinator.markUnavailable(
        'Durable revocation event publish failed during meeting end; failing closed.'
      );
    }

    try {
      this.signalGateway.disconnectMeetingSockets(endedStandaloneIdStr);
    } catch (err) {
      logger.error('[MeetingService] endMeeting cleanup failed: local gateway sockets', {
        metadata: {
          meetingId: endedStandaloneIdStr,
          operation: 'signalGateway.disconnectMeetingSockets',
          message: err instanceof Error ? err.message : 'Gateway disconnect error',
        },
      });
    }
    try {
      await this.realtime.runMeetingLifecycleOrdered(endedStandaloneIdStr, async () => {
        await this.realtime.emitMeetingEnded(endedStandaloneIdStr, actorUserId, waitingUserIds);
      });
    } catch (err) {
      logger.error('[MeetingService] endMeeting cleanup failed: realtime emitMeetingEnded', {
        metadata: {
          meetingId: endedStandaloneIdStr,
          operation: 'realtime.emitMeetingEnded',
          message: err instanceof Error ? err.message : 'Realtime error',
        },
      });
    }
    try {
      await this.livekit.deleteRoom(endedStandaloneIdStr);
    } catch (err) {
      logger.error('[MeetingService] endMeeting cleanup failed: livekit.deleteRoom', {
        metadata: {
          meetingId: endedStandaloneIdStr,
          operation: 'livekit.deleteRoom',
          message: err instanceof Error ? err.message : 'LiveKit deleteRoom error',
        },
      });
    }

    if (publishError) {
      throw publishError instanceof AppError
        ? publishError
        : new ServiceUnavailableError(
            'Durable revocation event publication failed during meeting termination.',
            'LIVEKIT_REVOCATION_PUBLISH_FAILED'
          );
    }

    return { meeting: await this.serializeMeeting(ended) };
  }

  /**
   * 15. ISSUE SHORT-LIVED LIVEKIT ROOM ACCESS TOKEN (Phase 09 — Authoritative DB Gated)
   *
   * Enforces all 14 mandatory server-side authorization checks against MongoDB
   * before minting a short-lived least-privilege LiveKit JWT.
   */
  async issueLiveKitToken(
    rawCode: string,
    userId: string,
    requestId?: string,
    options?: { gatewayUrl?: string }
  ): Promise<LiveKitTokenBundle> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestError('Invalid user identifier.', 'INVALID_IDENTIFIER');
    }

    const meeting = await this.findMeetingAndEnforceExpiration(rawCode);
    if (meeting.status === 'ENDED') {
      throw new AppError(
        'This meeting has already ended and cannot accept media connections.',
        410,
        'LIVEKIT_MEETING_ENDED'
      );
    }
    if (meeting.status === 'EXPIRED') {
      throw new AppError(
        'This meeting has expired and can no longer be joined.',
        410,
        'MEETING_EXPIRED'
      );
    }

    const participant = await MeetingParticipant.findOne({
      meetingId: meeting._id,
      userId,
    });

    if (!participant) {
      if (meeting.isLocked && !meeting.hostId.equals(new Types.ObjectId(userId))) {
        throw new ForbiddenError(
          'This meeting is currently locked by the host.',
          'MEETING_LOCKED'
        );
      }
      throw new ForbiddenError(
        'You must be admitted to this meeting before establishing a LiveKit connection.',
        'LIVEKIT_ACCESS_DENIED'
      );
    }

    if (participant.admissionStatus === 'REMOVED') {
      throw new ForbiddenError(
        'You were removed from this meeting and cannot obtain a media token.',
        'PARTICIPANT_REMOVED'
      );
    }

    if (participant.admissionStatus !== 'ADMITTED') {
      throw new ForbiddenError(
        participant.admissionStatus === 'WAITING'
          ? 'Waiting-room participants cannot connect to LiveKit until admitted by the host.'
          : 'You are not an active admitted participant in this meeting.',
        'LIVEKIT_ACCESS_DENIED'
      );
    }

    if (meeting.activeParticipantCount > meeting.maxParticipants) {
      throw new ForbiddenError(
        `This meeting has exceeded its maximum capacity of ${meeting.maxParticipants} participants.`,
        'MEETING_FULL'
      );
    }

    const expectedTokenEpoch =
      typeof participant.tokenEpoch === 'number' && participant.tokenEpoch >= 1
        ? participant.tokenEpoch
        : 1;

    if (this.hooks.beforeLiveKitTokenIssue) {
      await this.hooks.beforeLiveKitTokenIssue();
    }

    const tokenBundle = await this.livekit.generateParticipantToken({
      meetingId: meeting._id.toString(),
      userId: participant.userId.toString(),
      displayName: participant.displayName,
      role: participant.role,
      maxParticipants: meeting.maxParticipants,
      tokenEpoch: expectedTokenEpoch,
      sessionId: participant.admissionSessionId || undefined,
      gatewayUrl: options?.gatewayUrl,
      requestId,
    });

    // Post-generation authoritative re-check: prevent token delivery if meeting ended/expired,
    // participant was removed/left, or tokenEpoch advanced concurrently during provisioning.
    const [latestMeeting, latestParticipant] = await Promise.all([
      Meeting.findById(meeting._id).select('status expiresAt'),
      MeetingParticipant.findById(participant._id).select('admissionStatus tokenEpoch'),
    ]);

    if (
      !latestMeeting ||
      latestMeeting.status === 'ENDED' ||
      latestMeeting.status === 'EXPIRED' ||
      new Date() >= latestMeeting.expiresAt
    ) {
      throw new AppError(
        'This meeting ended before your media connection could be authorized.',
        410,
        'LIVEKIT_MEETING_ENDED'
      );
    }

    if (
      !latestParticipant ||
      latestParticipant.admissionStatus !== 'ADMITTED' ||
      (latestParticipant.tokenEpoch ?? 1) !== expectedTokenEpoch
    ) {
      throw new ForbiddenError(
        latestParticipant?.admissionStatus === 'REMOVED'
          ? 'You were removed from this meeting.'
          : 'Your admission to this meeting is no longer active.',
        latestParticipant?.admissionStatus === 'REMOVED'
          ? 'PARTICIPANT_REMOVED'
          : 'LIVEKIT_ACCESS_DENIED'
      );
    }

    return tokenBundle;
  }
}

export const meetingService = new MeetingService();
