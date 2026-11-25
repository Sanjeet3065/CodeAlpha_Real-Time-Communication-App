import type { Server as HttpServer } from 'node:http';
import { Server as SocketIOServer, type Socket } from 'socket.io';
import { env } from '../config/env.js';
import { verifyAccessToken, type AccessTokenPayload } from '../utils/tokens.js';
import { normalizeMeetingCode } from '../utils/meetingCode.js';
import { Meeting } from '../models/Meeting.model.js';
import { MeetingParticipant } from '../models/MeetingParticipant.model.js';
import { logger } from '../utils/logger.js';
import {
  attachSharedSocketIoAdapter,
  type SocketIoAdapterConfigInput,
  type SocketIoAdapterMode,
} from './socketAdapter.js';

let _chatService: any = null;
async function getChatService() {
  if (!_chatService) {
    const mod = await import('../services/chat.service.js');
    _chatService = mod.chatService;
  }
  return _chatService;
}

let _whiteboardService: any = null;
async function getWhiteboardService() {
  if (!_whiteboardService) {
    const mod = await import('../services/whiteboard.service.js');
    _whiteboardService = mod.whiteboardService;
  }
  return _whiteboardService;
}

export interface SocketUserData {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  subscribedMeetingIds: Set<string>;
  subscribedEpochsByMeeting: Map<string, number>;
}

export interface MeetingRealtimeHubHooks {
  beforeSubscribeJoinChannels?: (ctx: { meetingId: string; userId: string }) => Promise<void>;
  afterSubscribeJoinBeforeRevalidate?: (ctx: {
    meetingId: string;
    userId: string;
  }) => Promise<void>;
  beforePresenceUpdate?: (ctx: { meetingId: string; userId: string }) => Promise<void>;
}

const SOCKET_RATE_LIMIT_WINDOW_MS = 10_000;
const SOCKET_RATE_LIMIT_MAX_EVENTS = 30;
const CURSOR_RATE_LIMIT_WINDOW_MS = 1_000;
const CURSOR_RATE_LIMIT_MAX_EVENTS = 30;

export class MeetingRealtimeHub {
  private io: SocketIOServer | null = null;
  private adapterMode: SocketIoAdapterMode = 'memory';
  private adapterCleanup: (() => Promise<void>) | null = null;
  private readonly hooks: MeetingRealtimeHubHooks;
  // Tracks active socket IDs per `${meetingId}:${userId}` so presence only flips
  // OFFLINE when the user's last connected socket for that meeting disconnects.
  private readonly activeSocketsByMember = new Map<string, Set<string>>();
  // Monotonic event-ordering guards: prevent stale post-termination or out-of-order
  // lock broadcasts from contradicting authoritative MongoDB state.
  private readonly endedMeetingIds = new Set<string>();
  private readonly lastLockVersionByMeeting = new Map<string, number>();
  // Per-meeting serialized emission queue so admission and termination broadcasts
  // on a hub cannot interleave out of order.
  private readonly meetingEmissionQueues = new Map<string, Promise<unknown>>();

  constructor(hooks: MeetingRealtimeHubHooks = {}) {
    this.hooks = hooks;
  }

  public getAdapterMode(): SocketIoAdapterMode {
    return this.adapterMode;
  }

  public getIo(): SocketIOServer | null {
    return this.io;
  }

  public markMeetingEnded(meetingId: string): void {
    this.endedMeetingIds.add(meetingId);
  }

  public isMeetingMarkedEnded(meetingId: string): boolean {
    return this.endedMeetingIds.has(meetingId);
  }

  public runMeetingLifecycleOrdered<T>(
    meetingId: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const prev = this.meetingEmissionQueues.get(meetingId) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.then(
      () => {},
      () => {}
    );
    this.meetingEmissionQueues.set(meetingId, tail);
    void tail.finally(() => {
      if (this.meetingEmissionQueues.get(meetingId) === tail) {
        this.meetingEmissionQueues.delete(meetingId);
      }
    });
    return run;
  }

  /**
   * Attaches the configured shared Socket.IO adapter (`redis` preferred, or `mongo`).
   * Fails closed in multi-instance/production mode if no shared adapter is configured or reachable.
   */
  public async attachSharedAdapter(
    override?: Partial<SocketIoAdapterConfigInput>
  ): Promise<SocketIoAdapterMode> {
    if (!this.io) {
      throw new Error('Cannot attach shared Socket.IO adapter before hub.attach(httpServer).');
    }
    const attached = await attachSharedSocketIoAdapter(this.io, override);
    this.adapterMode = attached.mode;
    this.adapterCleanup = attached.cleanup;
    return this.adapterMode;
  }

  public attach(httpServer: HttpServer): SocketIOServer {
    const allowedOrigins =
      env.NODE_ENV === 'production'
        ? [env.CLIENT_ORIGIN]
        : [env.CLIENT_ORIGIN, 'http://localhost:5173', 'http://127.0.0.1:5173'];

    const io = new SocketIOServer(httpServer, {
      cors: {
        origin: (origin, callback) => {
          if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
          } else {
            callback(new Error('Origin not allowed by CORS'));
          }
        },
        credentials: true,
        methods: ['GET', 'POST'],
      },
      transports: ['websocket', 'polling'],
      pingInterval: 25_000,
      pingTimeout: 20_000,
    });

    // Cluster-wide local state sync listeners (invoked via io.serverSideEmit across shared adapter)
    io.on('meeting:sync-ended', (payload: { meetingId?: string }) => {
      if (payload?.meetingId) {
        this.endedMeetingIds.add(payload.meetingId);
        this.clearLocalMeetingState(payload.meetingId);
      }
    });

    io.on('meeting:sync-evict', (payload: { meetingId?: string; userId?: string }) => {
      if (payload?.meetingId && payload?.userId) {
        this.clearLocalUserMeetingState(payload.meetingId, payload.userId);
      }
    });

    // Strict JWT handshake authentication middleware
    io.use((socket, next) => {
      try {
        const authToken =
          (typeof socket.handshake.auth?.token === 'string' && socket.handshake.auth.token) ||
          (typeof socket.handshake.headers?.authorization === 'string' &&
          socket.handshake.headers.authorization.startsWith('Bearer ')
            ? socket.handshake.headers.authorization.substring(7).trim()
            : null);

        if (!authToken) {
          next(new Error('UNAUTHORIZED: Missing authentication token.'));
          return;
        }

        const decoded: AccessTokenPayload = verifyAccessToken(authToken);
        const data: SocketUserData = {
          userId: decoded.sub,
          email: decoded.email,
          firstName: decoded.firstName,
          lastName: decoded.lastName,
          subscribedMeetingIds: new Set<string>(),
          subscribedEpochsByMeeting: new Map<string, number>(),
        };
        socket.data = data;
        next();
      } catch {
        next(new Error('UNAUTHORIZED: Invalid or expired authentication token.'));
      }
    });

    io.on('connection', (socket: Socket) => {
      const userData = socket.data as SocketUserData;
      if (userData?.userId) {
        socket.join(this.userGlobalChannel(userData.userId));
      }
      const eventTimestamps: number[] = [];
      const cursorTimestamps: number[] = [];

      const checkRateLimit = (): boolean => {
        const now = Date.now();
        while (
          eventTimestamps.length > 0 &&
          now - eventTimestamps[0] > SOCKET_RATE_LIMIT_WINDOW_MS
        ) {
          eventTimestamps.shift();
        }
        if (eventTimestamps.length >= SOCKET_RATE_LIMIT_MAX_EVENTS) {
          return false;
        }
        eventTimestamps.push(now);
        return true;
      };

      const checkCursorRateLimit = (): boolean => {
        const now = Date.now();
        while (
          cursorTimestamps.length > 0 &&
          now - cursorTimestamps[0] > CURSOR_RATE_LIMIT_WINDOW_MS
        ) {
          cursorTimestamps.shift();
        }
        if (cursorTimestamps.length >= CURSOR_RATE_LIMIT_MAX_EVENTS) {
          return false;
        }
        cursorTimestamps.push(now);
        return true;
      };

      const undoSubscribeChannels = async (
        meetingId: string,
        userData: SocketUserData
      ): Promise<void> => {
        await socket.leave(this.admittedChannel(meetingId));
        await socket.leave(this.hostsChannel(meetingId));
        await socket.leave(this.waitingChannel(meetingId, userData.userId));
        await socket.leave(this.userChannel(meetingId, userData.userId));
        userData.subscribedMeetingIds.delete(meetingId);
        userData.subscribedEpochsByMeeting.delete(meetingId);
        const memberKey = `${meetingId}:${userData.userId}`;
        const memberSockets = this.activeSocketsByMember.get(memberKey);
        if (memberSockets) {
          memberSockets.delete(socket.id);
          if (memberSockets.size === 0) {
            this.activeSocketsByMember.delete(memberKey);
          }
        }
      };

      // Subscribe to a meeting's isolated Socket.IO room channels after DB membership verification
      // with mandatory post-join authoritative revalidation to close TOCTOU subscription races.
      socket.on(
        'meeting:subscribe',
        async (
          payload: { meetingCode?: unknown },
          ack?: (response: { ok: boolean; code?: string; message?: string; status?: string }) => void
        ) => {
          if (!checkRateLimit()) {
            ack?.({ ok: false, code: 'RATE_LIMIT_EXCEEDED', message: 'Too many socket requests.' });
            return;
          }

          try {
            const rawCode = typeof payload?.meetingCode === 'string' ? payload.meetingCode : '';
            const normalized = normalizeMeetingCode(rawCode);
            if (!normalized) {
              ack?.({ ok: false, code: 'INVALID_MEETING_CODE', message: 'Invalid meeting code.' });
              return;
            }

            const userData = socket.data as SocketUserData;
            const meeting = await Meeting.findOne({ meetingCode: normalized });
            if (!meeting) {
              ack?.({ ok: false, code: 'MEETING_NOT_FOUND', message: 'Meeting not found.' });
              return;
            }

            const meetingId = meeting._id.toString();
            const now = new Date();
            if (
              this.endedMeetingIds.has(meetingId) ||
              meeting.status === 'ENDED' ||
              meeting.status === 'EXPIRED' ||
              now >= meeting.expiresAt
            ) {
              this.endedMeetingIds.add(meetingId);
              ack?.({
                ok: false,
                code:
                  meeting.status === 'EXPIRED' || now >= meeting.expiresAt
                    ? 'MEETING_EXPIRED'
                    : 'MEETING_ENDED',
                message: 'Meeting is no longer active.',
              });
              return;
            }

            // Strictly verify membership in MongoDB — NEVER trust client-supplied roles or admission claims
            const participant = await MeetingParticipant.findOne({
              meetingId: meeting._id,
              userId: userData.userId,
            });

            if (
              !participant ||
              (participant.admissionStatus !== 'ADMITTED' &&
                participant.admissionStatus !== 'WAITING')
            ) {
              ack?.({
                ok: false,
                code: 'FORBIDDEN',
                message: 'You are not authorized to subscribe to this meeting room.',
              });
              return;
            }

            const expectedStatus = participant.admissionStatus;
            const expectedRole = participant.role;
            const expectedTokenEpoch = participant.tokenEpoch;

            if (this.hooks.beforeSubscribeJoinChannels) {
              await this.hooks.beforeSubscribeJoinChannels({
                meetingId,
                userId: userData.userId,
              });
            }

            userData.subscribedMeetingIds.add(meetingId);
            userData.subscribedEpochsByMeeting.set(meetingId, expectedTokenEpoch);

            // Track socket presence for clean multi-tab/reconnect tracking
            const memberKey = `${meetingId}:${userData.userId}`;
            const memberSockets = this.activeSocketsByMember.get(memberKey) ?? new Set<string>();
            memberSockets.add(socket.id);
            this.activeSocketsByMember.set(memberKey, memberSockets);

            // Always join private user-scoped channel for direct notifications
            await socket.join(this.userChannel(meetingId, userData.userId));

            if (expectedStatus === 'ADMITTED') {
              await socket.leave(this.waitingChannel(meetingId, userData.userId));
              await socket.join(this.admittedChannel(meetingId));
              if (expectedRole === 'host' || expectedRole === 'co-host') {
                await socket.join(this.hostsChannel(meetingId));
              } else {
                await socket.leave(this.hostsChannel(meetingId));
              }
            } else {
              // WAITING users join ONLY their private waiting channel — NEVER admitted or hosts channels
              await socket.leave(this.admittedChannel(meetingId));
              await socket.leave(this.hostsChannel(meetingId));
              await socket.join(this.waitingChannel(meetingId, userData.userId));
            }

            if (this.hooks.afterSubscribeJoinBeforeRevalidate) {
              await this.hooks.afterSubscribeJoinBeforeRevalidate({
                meetingId,
                userId: userData.userId,
              });
            }

            // MANDATORY POST-JOIN AUTHORITATIVE REVALIDATION:
            // Closes TOCTOU race where removal, rejection, demotion, or meeting termination
            // commits between the initial DB check and socket.join().
            const recheckNow = new Date();
            const [freshMeeting, freshParticipant] = await Promise.all([
              Meeting.findById(meeting._id).select('status expiresAt').lean(),
              MeetingParticipant.findOne({
                meetingId: meeting._id,
                userId: userData.userId,
              })
                .select('_id admissionStatus role tokenEpoch signalFenceVersion presenceStatus')
                .lean(),
            ]);

            if (
              this.endedMeetingIds.has(meetingId) ||
              !freshMeeting ||
              freshMeeting.status === 'ENDED' ||
              freshMeeting.status === 'EXPIRED' ||
              recheckNow >= new Date(freshMeeting.expiresAt)
            ) {
              this.endedMeetingIds.add(meetingId);
              await undoSubscribeChannels(meetingId, userData);
              ack?.({
                ok: false,
                code:
                  freshMeeting?.status === 'EXPIRED' ||
                  (freshMeeting && recheckNow >= new Date(freshMeeting.expiresAt))
                    ? 'MEETING_EXPIRED'
                    : 'MEETING_ENDED',
                message: 'Meeting is no longer active.',
              });
              return;
            }

            if (
              !freshParticipant ||
              freshParticipant.admissionStatus !== expectedStatus ||
              freshParticipant.tokenEpoch !== expectedTokenEpoch
            ) {
              await undoSubscribeChannels(meetingId, userData);
              ack?.({
                ok: false,
                code: 'FORBIDDEN',
                message: 'Your meeting authorization changed before subscription completed.',
              });
              return;
            }

            // Synchronize role-restricted hosts channel if role changed concurrently (e.g., demoted co-host)
            if (expectedStatus === 'ADMITTED' && freshParticipant.role !== expectedRole) {
              if (freshParticipant.role === 'host' || freshParticipant.role === 'co-host') {
                await socket.join(this.hostsChannel(meetingId));
              } else {
                await socket.leave(this.hostsChannel(meetingId));
              }
            }

            if (expectedStatus === 'ADMITTED') {
              if (this.hooks.beforePresenceUpdate) {
                await this.hooks.beforePresenceUpdate({
                  meetingId,
                  userId: userData.userId,
                });
              }

              // Conditional epoch- & fence-guarded presence write: NEVER overwrites a newer state
              // (e.g., concurrent removal, leave, expiration, or re-admission).
              if (freshParticipant.presenceStatus !== 'ONLINE') {
                const updatedPresence = await MeetingParticipant.findOneAndUpdate(
                  {
                    _id: freshParticipant._id,
                    admissionStatus: 'ADMITTED',
                    tokenEpoch: freshParticipant.tokenEpoch,
                    signalFenceVersion: freshParticipant.signalFenceVersion,
                    presenceStatus: { $ne: 'ONLINE' },
                  },
                  { $set: { presenceStatus: 'ONLINE' } },
                  { new: true }
                ).lean();

                if (updatedPresence && !this.endedMeetingIds.has(meetingId)) {
                  this.io?.to(this.admittedChannel(meetingId)).emit('meeting:presence-updated', {
                    meetingId,
                    userId: userData.userId,
                    presenceStatus: 'ONLINE',
                  });
                }
              }

              ack?.({ ok: true, status: 'ADMITTED' });
            } else {
              ack?.({ ok: true, status: 'WAITING' });
            }
          } catch (err) {
            logger.error('[Socket] Error during meeting:subscribe', {
              error: err instanceof Error ? err.message : String(err),
            });
            ack?.({ ok: false, code: 'INTERNAL_SERVER_ERROR', message: 'Subscription failed.' });
          }
        }
      );

      socket.on('meeting:unsubscribe', async (payload: { meetingId?: unknown }) => {
        if (!checkRateLimit()) return;
        const meetingId = typeof payload?.meetingId === 'string' ? payload.meetingId : '';
        if (!meetingId) return;
        await this.detachSocketFromMeeting(socket, meetingId);
      });

      // Phase 12 — Real-Time Meeting Chat Message Submission
      socket.on(
        'chat:send',
        async (
          payload: { meetingCode?: unknown; content?: unknown; clientMessageId?: unknown },
          ack?: (response: { ok: boolean; message?: unknown; error?: string; code?: string }) => void
        ) => {
          if (!checkRateLimit()) {
            ack?.({ ok: false, code: 'RATE_LIMIT_EXCEEDED', error: 'Too many socket requests.' });
            return;
          }
          const userData = socket.data as SocketUserData | undefined;
          if (!userData?.userId) {
            ack?.({ ok: false, code: 'UNAUTHORIZED', error: 'Authentication required.' });
            return;
          }
          const rawCode = typeof payload?.meetingCode === 'string' ? payload.meetingCode : '';
          const content = typeof payload?.content === 'string' ? payload.content : '';
          const clientMessageId =
            typeof payload?.clientMessageId === 'string' ? payload.clientMessageId : undefined;

          try {
            const chatSvc = await getChatService();
            const msg = await chatSvc.sendMessage(rawCode, userData.userId, {
              content,
              clientMessageId,
            });
            ack?.({ ok: true, message: msg });
          } catch (err: any) {
            ack?.({
              ok: false,
              code: err?.code || 'CHAT_ERROR',
              error: err instanceof Error ? err.message : 'Failed to send message.',
            });
          }
        }
      );

      // Phase 12 — Real-Time Meeting Emoji Reaction Submission
      socket.on(
        'reaction:send',
        async (
          payload: { meetingCode?: unknown; emoji?: unknown; clientReactionId?: unknown },
          ack?: (response: { ok: boolean; reaction?: unknown; error?: string; code?: string }) => void
        ) => {
          if (!checkRateLimit()) {
            ack?.({ ok: false, code: 'RATE_LIMIT_EXCEEDED', error: 'Too many socket requests.' });
            return;
          }
          const userData = socket.data as SocketUserData | undefined;
          if (!userData?.userId) {
            ack?.({ ok: false, code: 'UNAUTHORIZED', error: 'Authentication required.' });
            return;
          }
          const rawCode = typeof payload?.meetingCode === 'string' ? payload.meetingCode : '';
          const emoji = typeof payload?.emoji === 'string' ? payload.emoji : '';
          const clientReactionId =
            typeof payload?.clientReactionId === 'string' ? payload.clientReactionId : undefined;

          try {
            const chatSvc = await getChatService();
            const rx = await chatSvc.sendReaction(rawCode, userData.userId, {
              emoji,
              clientReactionId,
            });
            ack?.({ ok: true, reaction: rx });
          } catch (err: any) {
            ack?.({
              ok: false,
              code: err?.code || 'REACTION_ERROR',
              error: err instanceof Error ? err.message : 'Failed to send reaction.',
            });
          }
        }
      );

      // Phase 14 — Collaborative Whiteboard Operation Submission
      socket.on(
        'whiteboard:draw',
        async (
          payload: { meetingCode?: unknown; operations?: unknown },
          ack?: (response: { ok: boolean; version?: number; appliedCount?: number; error?: string; code?: string }) => void
        ) => {
          if (!checkRateLimit()) {
            ack?.({ ok: false, code: 'RATE_LIMIT_EXCEEDED', error: 'Too many socket requests.' });
            return;
          }
          const userData = socket.data as SocketUserData | undefined;
          if (!userData?.userId) {
            ack?.({ ok: false, code: 'UNAUTHORIZED', error: 'Authentication required.' });
            return;
          }
          const rawCode = typeof payload?.meetingCode === 'string' ? payload.meetingCode : '';
          const operations = Array.isArray(payload?.operations) ? payload.operations : [];

          try {
            const wbSvc = await getWhiteboardService();
            const result = await wbSvc.applyOperations(rawCode, userData.userId, { operations });
            ack?.({ ok: true, version: result.version, appliedCount: result.appliedCount });
          } catch (err: any) {
            ack?.({
              ok: false,
              code: err?.code || 'WHITEBOARD_ERROR',
              error: err instanceof Error ? err.message : 'Failed to apply whiteboard operations.',
            });
          }
        }
      );

      // Phase 14 — Real-Time Ephemeral Collaborative Cursor Broadcast
      socket.on(
        'whiteboard:cursor',
        async (payload: { meetingCode?: unknown; x?: unknown; y?: unknown; tool?: unknown; color?: unknown }) => {
          if (!checkCursorRateLimit()) return;
          const userData = socket.data as SocketUserData | undefined;
          if (!userData?.userId) return;
          const rawCode = typeof payload?.meetingCode === 'string' ? payload.meetingCode : '';
          const x = typeof payload?.x === 'number' && Number.isFinite(payload.x) ? payload.x : 0;
          const y = typeof payload?.y === 'number' && Number.isFinite(payload.y) ? payload.y : 0;
          const tool = typeof payload?.tool === 'string' ? payload.tool.slice(0, 32) : 'pen';
          const color = typeof payload?.color === 'string' ? payload.color.slice(0, 32) : '#168B83';

          try {
            const normalized = normalizeMeetingCode(rawCode);
            if (!normalized) return;
            const meeting = await Meeting.findOne({ meetingCode: normalized })
              .select('_id status expiresAt')
              .lean();
            if (!meeting) return;
            const meetingId = meeting._id.toString();

            // Strictly enforce active meeting state, room admission membership, and DB authorization
            if (
              this.endedMeetingIds.has(meetingId) ||
              meeting.status !== 'ACTIVE' ||
              new Date() >= new Date(meeting.expiresAt) ||
              !userData.subscribedMeetingIds.has(meetingId) ||
              !socket.rooms.has(this.admittedChannel(meetingId))
            ) {
              return;
            }

            const subscribedEpoch = userData.subscribedEpochsByMeeting.get(meetingId);
            const admittedParticipant = await MeetingParticipant.findOne({
              meetingId: meeting._id,
              userId: userData.userId,
              admissionStatus: 'ADMITTED',
              ...(typeof subscribedEpoch === 'number' ? { tokenEpoch: subscribedEpoch } : {}),
            })
              .select('_id')
              .lean();
            if (!admittedParticipant) {
              return;
            }

            // Broadcast to other admitted participants in the room excluding the sender
            this.emitWhiteboardCursor(
              meetingId,
              {
                userId: userData.userId,
                userName: `${userData.firstName} ${userData.lastName}`.trim() || 'Participant',
                x,
                y,
                tool,
                color,
              },
              socket.id
            );
          } catch {
            // Ephemeral cursor updates are non-fatal
          }
        }
      );

      // Phase 14 — Undo Whiteboard Operation
      socket.on(
        'whiteboard:undo',
        async (
          payload: { meetingCode?: unknown },
          ack?: (response: { ok: boolean; version?: number; elementId?: string; error?: string; code?: string }) => void
        ) => {
          if (!checkRateLimit()) {
            ack?.({ ok: false, code: 'RATE_LIMIT_EXCEEDED', error: 'Too many socket requests.' });
            return;
          }
          const userData = socket.data as SocketUserData | undefined;
          if (!userData?.userId) {
            ack?.({ ok: false, code: 'UNAUTHORIZED', error: 'Authentication required.' });
            return;
          }
          const rawCode = typeof payload?.meetingCode === 'string' ? payload.meetingCode : '';

          try {
            const wbSvc = await getWhiteboardService();
            const result = await wbSvc.undoOperation(rawCode, userData.userId);
            ack?.(result);
          } catch (err: any) {
            ack?.({
              ok: false,
              code: err?.code || 'WHITEBOARD_UNDO_ERROR',
              error: err instanceof Error ? err.message : 'Failed to undo whiteboard operation.',
            });
          }
        }
      );

      // Phase 14 — Redo Whiteboard Operation
      socket.on(
        'whiteboard:redo',
        async (
          payload: { meetingCode?: unknown },
          ack?: (response: { ok: boolean; version?: number; elementId?: string; error?: string; code?: string }) => void
        ) => {
          if (!checkRateLimit()) {
            ack?.({ ok: false, code: 'RATE_LIMIT_EXCEEDED', error: 'Too many socket requests.' });
            return;
          }
          const userData = socket.data as SocketUserData | undefined;
          if (!userData?.userId) {
            ack?.({ ok: false, code: 'UNAUTHORIZED', error: 'Authentication required.' });
            return;
          }
          const rawCode = typeof payload?.meetingCode === 'string' ? payload.meetingCode : '';

          try {
            const wbSvc = await getWhiteboardService();
            const result = await wbSvc.redoOperation(rawCode, userData.userId);
            ack?.(result);
          } catch (err: any) {
            ack?.({
              ok: false,
              code: err?.code || 'WHITEBOARD_REDO_ERROR',
              error: err instanceof Error ? err.message : 'Failed to redo whiteboard operation.',
            });
          }
        }
      );

      // Phase 14 — Clear Whiteboard (Host/Co-Host only)
      socket.on(
        'whiteboard:clear',
        async (
          payload: { meetingCode?: unknown },
          ack?: (response: { ok: boolean; version?: number; clearedAt?: string; error?: string; code?: string }) => void
        ) => {
          if (!checkRateLimit()) {
            ack?.({ ok: false, code: 'RATE_LIMIT_EXCEEDED', error: 'Too many socket requests.' });
            return;
          }
          const userData = socket.data as SocketUserData | undefined;
          if (!userData?.userId) {
            ack?.({ ok: false, code: 'UNAUTHORIZED', error: 'Authentication required.' });
            return;
          }
          const rawCode = typeof payload?.meetingCode === 'string' ? payload.meetingCode : '';

          try {
            const wbSvc = await getWhiteboardService();
            const result = await wbSvc.clearWhiteboard(rawCode, userData.userId);
            ack?.({ ok: true, version: result.version, clearedAt: result.clearedAt });
          } catch (err: any) {
            ack?.({
              ok: false,
              code: err?.code || 'WHITEBOARD_CLEAR_ERROR',
              error: err instanceof Error ? err.message : 'Failed to clear whiteboard.',
            });
          }
        }
      );

      socket.on('disconnect', async () => {
        const userData = socket.data as SocketUserData | undefined;
        if (!userData) return;
        const subscribed = Array.from(userData.subscribedMeetingIds);
        for (const meetingId of subscribed) {
          await this.detachSocketFromMeeting(socket, meetingId);
        }
      });
    });

    this.io = io;
    return io;
  }

  public close(): void {
    const cleanup = this.adapterCleanup;
    this.adapterCleanup = null;
    this.adapterMode = 'memory';
    if (this.io) {
      this.io.close();
      this.io = null;
    }
    if (cleanup) {
      void cleanup().catch(() => {});
    }
    this.activeSocketsByMember.clear();
    this.endedMeetingIds.clear();
    this.lastLockVersionByMeeting.clear();
    this.meetingEmissionQueues.clear();
  }

  public async closeAsync(): Promise<void> {
    const cleanup = this.adapterCleanup;
    this.adapterCleanup = null;
    this.adapterMode = 'memory';
    if (this.io) {
      await new Promise<void>((resolve) => {
        this.io?.close(() => resolve());
      });
      this.io = null;
    }
    if (cleanup) {
      await cleanup().catch(() => {});
    }
    this.activeSocketsByMember.clear();
    this.endedMeetingIds.clear();
    this.lastLockVersionByMeeting.clear();
    this.meetingEmissionQueues.clear();
  }

  private clearLocalUserMeetingState(meetingId: string, userId: string): void {
    this.activeSocketsByMember.delete(`${meetingId}:${userId}`);
    if (!this.io) return;
    for (const s of this.io.sockets.sockets.values()) {
      const data = s.data as SocketUserData | undefined;
      if (data?.userId === userId) {
        data.subscribedMeetingIds?.delete(meetingId);
        data.subscribedEpochsByMeeting?.delete(meetingId);
      }
    }
  }

  private clearLocalMeetingState(meetingId: string): void {
    const prefix = `${meetingId}:`;
    for (const key of Array.from(this.activeSocketsByMember.keys())) {
      if (key.startsWith(prefix)) {
        this.activeSocketsByMember.delete(key);
      }
    }
    if (!this.io) return;
    for (const s of this.io.sockets.sockets.values()) {
      const data = s.data as SocketUserData | undefined;
      data?.subscribedMeetingIds?.delete(meetingId);
      data?.subscribedEpochsByMeeting?.delete(meetingId);
    }
  }

  public async evictUserFromMeeting(meetingId: string, userId: string): Promise<void> {
    if (!this.io) return;
    const targetChan = this.userChannel(meetingId, userId);
    const roomsToLeave = [
      this.admittedChannel(meetingId),
      this.hostsChannel(meetingId),
      this.waitingChannel(meetingId, userId),
      targetChan,
    ];

    // Cluster barrier: fetchSockets() round-trips through the shared adapter so any
    // immediately preceding emit (e.g., meeting:participant-removed) is published and
    // delivered BEFORE socketsLeave() removes remote sockets from targetChan.
    const sockets = await this.io.in(targetChan).fetchSockets();
    for (const s of sockets) {
      s.leave(this.admittedChannel(meetingId));
      s.leave(this.hostsChannel(meetingId));
      s.leave(this.waitingChannel(meetingId, userId));
      s.leave(targetChan);
    }
    this.io.in(targetChan).socketsLeave(roomsToLeave);
    this.clearLocalUserMeetingState(meetingId, userId);
    if (this.adapterMode !== 'memory') {
      this.io.serverSideEmit('meeting:sync-evict', { meetingId, userId });
    }
  }

  private async detachSocketFromMeeting(socket: Socket, meetingId: string): Promise<void> {
    const userData = socket.data as SocketUserData | undefined;
    if (!userData) return;

    const subscribedEpoch = userData.subscribedEpochsByMeeting.get(meetingId);
    userData.subscribedMeetingIds.delete(meetingId);
    userData.subscribedEpochsByMeeting.delete(meetingId);
    await socket.leave(this.admittedChannel(meetingId));
    await socket.leave(this.hostsChannel(meetingId));
    await socket.leave(this.waitingChannel(meetingId, userData.userId));
    await socket.leave(this.userChannel(meetingId, userData.userId));

    const memberKey = `${meetingId}:${userData.userId}`;
    const memberSockets = this.activeSocketsByMember.get(memberKey);
    if (memberSockets) {
      memberSockets.delete(socket.id);
      if (memberSockets.size === 0) {
        this.activeSocketsByMember.delete(memberKey);
        // Condition OFFLINE presence update on subscribed tokenEpoch so a stale disconnecting
        // socket from an older epoch can NEVER overwrite a newer re-admitted session's state.
        const updated = await MeetingParticipant.findOneAndUpdate(
          {
            meetingId,
            userId: userData.userId,
            admissionStatus: 'ADMITTED',
            ...(typeof subscribedEpoch === 'number' ? { tokenEpoch: subscribedEpoch } : {}),
          },
          { $set: { presenceStatus: 'OFFLINE' } },
          { new: true }
        ).catch(() => null);
        if (updated && !this.endedMeetingIds.has(meetingId)) {
          this.io?.to(this.admittedChannel(meetingId)).emit('meeting:presence-updated', {
            meetingId,
            userId: userData.userId,
            presenceStatus: 'OFFLINE',
          });
        }
      }
    }
  }

  public admittedChannel(meetingId: string): string {
    return `meeting:${meetingId}:admitted`;
  }

  public hostsChannel(meetingId: string): string {
    return `meeting:${meetingId}:hosts`;
  }

  public waitingChannel(meetingId: string, userId: string): string {
    return `meeting:${meetingId}:waiting:${userId}`;
  }

  public userChannel(meetingId: string, userId: string): string {
    return `meeting:${meetingId}:user:${userId}`;
  }

  public userGlobalChannel(userId: string): string {
    return `user:${userId}`;
  }

  public emitParticipantJoined(
    meetingId: string,
    participant: Record<string, any>,
    activeParticipantCount: number,
    eventId?: string
  ): void {
    if (this.endedMeetingIds.has(meetingId)) return;
    this.io?.to(this.admittedChannel(meetingId)).emit('meeting:participant-joined', {
      ...(eventId ? { eventId } : {}),
      meetingId,
      participant,
      activeParticipantCount,
      timestamp: new Date().toISOString(),
    });
  }

  public emitParticipantLeft(
    meetingId: string,
    userId: string,
    activeParticipantCount: number,
    reason: string,
    newHostId?: string | null
  ): void {
    this.io?.to(this.admittedChannel(meetingId)).emit('meeting:participant-left', {
      meetingId,
      userId,
      activeParticipantCount,
      reason,
      ...(newHostId ? { newHostId } : {}),
      timestamp: new Date().toISOString(),
    });
  }

  public emitWaitingRoomUpdated(meetingId: string, waitingList: Record<string, any>[]): void {
    if (this.endedMeetingIds.has(meetingId)) return;
    // Strictly emitted to hosts channel ONLY — regular participants never receive waiting-room PII
    this.io?.to(this.hostsChannel(meetingId)).emit('meeting:waiting-room-updated', {
      meetingId,
      waitingList,
      count: waitingList.length,
      timestamp: new Date().toISOString(),
    });
  }

  public async emitAdmissionApproved(
    meetingId: string,
    targetUserId: string,
    meetingSummary: Record<string, any>,
    participant: Record<string, any>,
    eventId?: string
  ): Promise<void> {
    if (!this.io || this.endedMeetingIds.has(meetingId)) return;
    const waitChan = this.waitingChannel(meetingId, targetUserId);
    const admitChan = this.admittedChannel(meetingId);

    this.io.to(waitChan).emit('meeting:admission-approved', {
      ...(eventId ? { eventId } : {}),
      meetingId,
      meeting: meetingSummary,
      participant,
      timestamp: new Date().toISOString(),
    });

    // Cluster barrier: fetchSockets() ensures the admission-approved broadcast is ordered
    // ahead of leaving waitChan across async shared adapters (Redis / MongoDB).
    const sockets = await this.io.in(waitChan).fetchSockets();
    for (const s of sockets) {
      s.join(admitChan);
      s.leave(waitChan);
    }
    this.io.in(waitChan).socketsJoin(admitChan);
    this.io.in(waitChan).socketsLeave(waitChan);
  }

  public emitAdmissionRejected(meetingId: string, targetUserId: string, reason?: string): void {
    this.io?.to(this.waitingChannel(meetingId, targetUserId)).emit('meeting:admission-rejected', {
      meetingId,
      reason: reason || 'Your request to join this meeting was declined by the host.',
      timestamp: new Date().toISOString(),
    });
  }

  public async emitParticipantRemoved(
    meetingId: string,
    targetUserId: string,
    activeParticipantCount: number,
    reason?: string
  ): Promise<void> {
    if (!this.io) return;
    const payload = {
      meetingId,
      userId: targetUserId,
      activeParticipantCount,
      reason: reason || 'You have been removed from this meeting by the host.',
      timestamp: new Date().toISOString(),
    };

    // Notify target directly and remove their sockets from ALL meeting channels across all instances
    const targetChan = this.userChannel(meetingId, targetUserId);
    this.io.to(targetChan).emit('meeting:participant-removed', payload);

    await this.evictUserFromMeeting(meetingId, targetUserId);

    // Broadcast updated roster removal to remaining admitted participants
    this.io.to(this.admittedChannel(meetingId)).emit('meeting:participant-left', {
      meetingId,
      userId: targetUserId,
      activeParticipantCount,
      reason: 'REMOVED',
      timestamp: new Date().toISOString(),
    });
  }

  public async emitRoleUpdated(
    meetingId: string,
    targetUserId: string,
    newRole: 'host' | 'co-host' | 'participant',
    hostId: string
  ): Promise<void> {
    if (!this.io || this.endedMeetingIds.has(meetingId)) return;

    // Synchronize hosts channel membership immediately across ALL instances on promote/demote
    const targetChan = this.userChannel(meetingId, targetUserId);
    const hostsChan = this.hostsChannel(meetingId);
    if (newRole === 'host' || newRole === 'co-host') {
      this.io.in(targetChan).socketsJoin(hostsChan);
    } else {
      this.io.in(targetChan).socketsLeave(hostsChan);
    }

    const sockets = await this.io.in(targetChan).fetchSockets();
    for (const s of sockets) {
      if (newRole === 'host' || newRole === 'co-host') {
        s.join(hostsChan);
      } else {
        s.leave(hostsChan);
      }
    }

    this.io.to(this.admittedChannel(meetingId)).emit('meeting:role-updated', {
      meetingId,
      userId: targetUserId,
      role: newRole,
      hostId,
      timestamp: new Date().toISOString(),
    });
  }

  public emitLockChanged(
    meetingId: string,
    isLocked: boolean,
    actorId: string,
    version?: number
  ): void {
    if (this.endedMeetingIds.has(meetingId)) return;
    if (typeof version === 'number') {
      const lastVer = this.lastLockVersionByMeeting.get(meetingId) ?? 0;
      if (version <= lastVer) {
        return; // Suppress stale lock/unlock event that would contradict newer committed version
      }
      this.lastLockVersionByMeeting.set(meetingId, version);
    }
    const eventName = isLocked ? 'meeting:locked' : 'meeting:unlocked';
    this.io?.to(this.admittedChannel(meetingId)).emit(eventName, {
      meetingId,
      isLocked,
      actorId,
      ...(typeof version === 'number' ? { version } : {}),
      timestamp: new Date().toISOString(),
    });
  }

  public emitSettingsUpdated(
    meetingId: string,
    title: string,
    settings: Record<string, any>
  ): void {
    if (this.endedMeetingIds.has(meetingId)) return;
    this.io?.to(this.admittedChannel(meetingId)).emit('meeting:settings-updated', {
      meetingId,
      title,
      settings,
      timestamp: new Date().toISOString(),
    });
  }

  public async emitMeetingEnded(
    meetingId: string,
    endedBy: string,
    waitingUserIds: string[],
    reason = 'The host has ended this meeting for everyone.'
  ): Promise<void> {
    this.endedMeetingIds.add(meetingId);
    if (!this.io) return;
    const payload = {
      meetingId,
      endedBy,
      reason,
      timestamp: new Date().toISOString(),
    };

    const admittedChan = this.admittedChannel(meetingId);
    const hostsChan = this.hostsChannel(meetingId);

    this.io.to(admittedChan).emit('meeting:ended', payload);
    for (const waitingUserId of waitingUserIds) {
      this.io.to(this.waitingChannel(meetingId, waitingUserId)).emit('meeting:ended', payload);
    }

    // Fetch all admitted sockets across ALL cluster instances to evict from meeting & user channels
    const admittedSockets = await this.io.in(admittedChan).fetchSockets();
    const userIdsToEvict = new Set<string>(waitingUserIds);
    for (const s of admittedSockets) {
      const data = s.data as { userId?: string } | undefined;
      s.leave(admittedChan);
      s.leave(hostsChan);
      if (data?.userId) {
        userIdsToEvict.add(data.userId);
        s.leave(this.userChannel(meetingId, data.userId));
      }
    }
    this.io.in(admittedChan).socketsLeave([admittedChan, hostsChan]);
    this.io.in(hostsChan).socketsLeave([admittedChan, hostsChan]);
    for (const uid of userIdsToEvict) {
      const uChan = this.userChannel(meetingId, uid);
      this.io.in(uChan).socketsLeave([
        admittedChan,
        hostsChan,
        this.waitingChannel(meetingId, uid),
        uChan,
      ]);
    }
    this.clearLocalMeetingState(meetingId);
    if (this.adapterMode !== 'memory') {
      this.io.serverSideEmit('meeting:sync-ended', { meetingId });
    }
  }

  public emitChatMessage(meetingId: string, message: Record<string, any>): void {
    if (this.endedMeetingIds.has(meetingId)) return;
    this.io?.to(this.admittedChannel(meetingId)).emit('chat:message-received', message);
  }

  public emitReaction(meetingId: string, reaction: Record<string, any>): void {
    if (this.endedMeetingIds.has(meetingId)) return;
    this.io?.to(this.admittedChannel(meetingId)).emit('reaction:received', reaction);
  }

  public emitFileShared(meetingId: string, file: Record<string, any>): void {
    if (this.endedMeetingIds.has(meetingId)) return;
    this.io?.to(this.admittedChannel(meetingId)).emit('file:shared', file);
  }

  public emitFileDeleted(meetingId: string, payload: { fileId: string; meetingId: string }): void {
    if (this.endedMeetingIds.has(meetingId)) return;
    this.io?.to(this.admittedChannel(meetingId)).emit('file:deleted', payload);
  }

  // Phase 14 — Whiteboard Real-Time Broadcasts
  public emitWhiteboardOperation(meetingId: string, payload: Record<string, any>): void {
    if (this.endedMeetingIds.has(meetingId)) return;
    this.io?.to(this.admittedChannel(meetingId)).emit('whiteboard:operation', payload);
  }

  public emitWhiteboardUndo(meetingId: string, payload: Record<string, any>): void {
    if (this.endedMeetingIds.has(meetingId)) return;
    this.io?.to(this.admittedChannel(meetingId)).emit('whiteboard:undo', payload);
  }

  public emitWhiteboardRedo(meetingId: string, payload: Record<string, any>): void {
    if (this.endedMeetingIds.has(meetingId)) return;
    this.io?.to(this.admittedChannel(meetingId)).emit('whiteboard:redo', payload);
  }

  public emitWhiteboardCleared(meetingId: string, payload: Record<string, any>): void {
    if (this.endedMeetingIds.has(meetingId)) return;
    this.io?.to(this.admittedChannel(meetingId)).emit('whiteboard:cleared', payload);
  }

  public emitWhiteboardCursor(
    meetingId: string,
    payload: Record<string, any>,
    excludeSocketId?: string
  ): void {
    if (this.endedMeetingIds.has(meetingId)) return;
    if (excludeSocketId) {
      this.io?.to(this.admittedChannel(meetingId)).except(excludeSocketId).emit('whiteboard:cursor', payload);
    } else {
      this.io?.to(this.admittedChannel(meetingId)).emit('whiteboard:cursor', payload);
    }
  }

  // Phase 16 — Scheduling & In-App Notification Broadcasts (User-scoped channels)
  public emitNotification(userId: string, notification: Record<string, any>): void {
    this.io?.to(this.userGlobalChannel(userId)).emit('notification:new', notification);
  }

  public emitMeetingScheduled(userId: string, meeting: Record<string, any>): void {
    this.io?.to(this.userGlobalChannel(userId)).emit('meeting:scheduled', meeting);
  }

  public emitMeetingUpdated(userId: string, meeting: Record<string, any>): void {
    this.io?.to(this.userGlobalChannel(userId)).emit('meeting:updated', meeting);
  }

  public emitMeetingRescheduled(userId: string, meeting: Record<string, any>): void {
    this.io?.to(this.userGlobalChannel(userId)).emit('meeting:rescheduled', meeting);
  }

  public emitMeetingCancelled(userId: string, meeting: Record<string, any>): void {
    this.io?.to(this.userGlobalChannel(userId)).emit('meeting:cancelled', meeting);
  }
}

export const meetingRealtime = new MeetingRealtimeHub();
