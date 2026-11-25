import http, { type IncomingMessage, type Server as HttpServer } from 'node:http';
import https from 'node:https';
import type { Duplex } from 'node:stream';
import { Router, type Request, type Response } from 'express';
import { TokenVerifier } from 'livekit-server-sdk';
import { env } from '../config/env.js';
import { Meeting } from '../models/Meeting.model.js';
import { MeetingParticipant } from '../models/MeetingParticipant.model.js';
import {
  livekitService,
  parseLiveKitParticipantUserId,
  parseLiveKitRoomMeetingId,
  toLiveKitHttpUrl,
  type LiveKitConfig,
  type LiveKitService,
} from '../services/livekit.service.js';
import {
  livekitRevocationCoordinator,
  type DistributedRevocationPayload,
  type LiveKitRevocationCoordinator,
} from './livekitRevocationCoordinator.js';
import { logger } from '../utils/logger.js';

export const LIVEKIT_SIGNAL_GATEWAY_PATH = '/livekit-signal';

export type SignalAuthResult =
  | {
      allowed: true;
      meetingId: string;
      userId: string;
      roomName: string;
      identity: string;
      tokenEpoch: number;
      tokenNbf?: number;
      upstreamConfig: LiveKitConfig;
    }
  | {
      allowed: false;
      statusCode: number;
      code: string;
      message: string;
    };

export type RevalidationResult =
  | { allowed: true }
  | { allowed: false; statusCode: number; code: string; message: string };

export interface LiveKitSignalGatewayHooks {
  beforeAuthorize?: () => Promise<void>;
  afterAuthorize?: () => Promise<void>;
  beforeUpstreamConnect?: () => Promise<void>;
  duringUpstreamHandshake?: () => Promise<void>;
  afterUpstreamHandshake?: () => Promise<void>;
  duringSocketRegister?: () => Promise<void>;
  /** Fires AFTER post-handshake MongoDB revalidation succeeded, BEFORE syncNow() & atomic fence. */
  beforeWrite101?: () => Promise<void>;
  /** Fires AFTER syncNow() AND final read check succeeded, immediately BEFORE atomic claimSignalingAdmissionFence(). */
  afterSyncBeforeAtomicFence?: () => Promise<void>;
  /** Fires INSIDE claimSignalingAdmissionFence() AFTER MeetingParticipant atomic fence succeeded, BEFORE post-fence Meeting status check. */
  afterParticipantFenceBeforeMeetingRecheck?: () => Promise<void>;
  /** Fires AFTER atomic claimSignalingAdmissionFence() linearized as ADMITTED, immediately BEFORE clientSocket.write(HTTP 101). */
  afterAtomicFenceBeforeSocketWrite101?: () => Promise<void>;
  /** Fires IMMEDIATELY AFTER HTTP 101 Switching Protocols has been written to the client socket. */
  afterWrite101?: () => Promise<void>;
  afterSocketRegister?: () => Promise<void>;
}

interface PendingUpgradeHandle {
  aborted: boolean;
  abortStatusCode: number;
  abortMessage: string;
  tokenEpoch: number;
  proxyReq?: http.ClientRequest;
  abort: (statusCode?: number, message?: string) => void;
}

interface TrackedSocketEntry {
  meetingId: string;
  userId: string;
  tokenEpoch: number;
  clientSocket: Duplex;
  proxySocket: Duplex;
}

function extractBearerOrQueryToken(rawUrl: string, authHeader?: string): string | null {
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length).trim();
    if (token) return token;
  }
  try {
    const parsed = new URL(rawUrl, 'http://localhost');
    const qToken = parsed.searchParams.get('access_token');
    if (qToken && qToken.trim()) {
      return qToken.trim();
    }
  } catch {
    return null;
  }
  return null;
}

function parseTokenMetadata(
  metadata?: string
): { epoch: number; meetingId: string } | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata) as { epoch?: unknown; meetingId?: unknown };
    if (
      typeof parsed.epoch === 'number' &&
      Number.isInteger(parsed.epoch) &&
      parsed.epoch >= 1 &&
      typeof parsed.meetingId === 'string' &&
      /^[a-f0-9]{24}$/i.test(parsed.meetingId)
    ) {
      return {
        epoch: parsed.epoch,
        meetingId: parsed.meetingId.toLowerCase(),
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Authoritative MongoDB revalidation of meeting & participant state.
 * Strictly fails CLOSED (`503 LIVEKIT_AUTH_UNAVAILABLE`) on any database error.
 */
export async function revalidateParticipantAccess(
  meetingId: string,
  userId: string,
  tokenEpoch: number,
  tokenNbf?: number
): Promise<RevalidationResult> {
  let meeting: { status: string; expiresAt: Date } | null;
  let participant: {
    admissionStatus: string;
    tokenEpoch?: number;
    tokenRevokedBefore?: Date | null;
  } | null;

  try {
    [meeting, participant] = await Promise.all([
      Meeting.findById(meetingId).select('status expiresAt'),
      MeetingParticipant.findOne({ meetingId, userId }).select(
        'admissionStatus tokenEpoch tokenRevokedBefore'
      ),
    ]);
  } catch (err) {
    logger.error('[LiveKitGateway] MongoDB authorization check failed (fail-closed)', {
      meetingId,
      userId,
      errorCategory: 'LIVEKIT_AUTH_UNAVAILABLE',
      message: err instanceof Error ? err.message : 'Database lookup failed',
    });
    return {
      allowed: false,
      statusCode: 503,
      code: 'LIVEKIT_AUTH_UNAVAILABLE',
      message: 'Authorization service is temporarily unavailable.',
    };
  }

  if (!meeting) {
    return {
      allowed: false,
      statusCode: 404,
      code: 'MEETING_NOT_FOUND',
      message: 'Meeting no longer exists.',
    };
  }

  const now = new Date();
  if (meeting.status === 'ENDED' || meeting.status === 'EXPIRED' || now >= meeting.expiresAt) {
    return {
      allowed: false,
      statusCode: 410,
      code: 'LIVEKIT_MEETING_ENDED',
      message: 'This meeting has ended and no longer accepts media signaling connections.',
    };
  }

  if (!participant) {
    return {
      allowed: false,
      statusCode: 403,
      code: 'LIVEKIT_ACCESS_DENIED',
      message: 'Participant is not authorized for this meeting.',
    };
  }

  if (participant.admissionStatus === 'REMOVED') {
    return {
      allowed: false,
      statusCode: 403,
      code: 'PARTICIPANT_REMOVED',
      message: 'Participant has been removed from this meeting; token access revoked.',
    };
  }

  if (participant.admissionStatus !== 'ADMITTED') {
    return {
      allowed: false,
      statusCode: 403,
      code: 'LIVEKIT_ACCESS_DENIED',
      message: 'Participant is not currently admitted to this meeting.',
    };
  }

  const expectedEpoch =
    typeof participant.tokenEpoch === 'number' && participant.tokenEpoch >= 1
      ? participant.tokenEpoch
      : 1;
  if (tokenEpoch !== expectedEpoch) {
    return {
      allowed: false,
      statusCode: 403,
      code: 'LIVEKIT_TOKEN_REVOKED',
      message: 'LiveKit access token has been revoked.',
    };
  }

  if (participant.tokenRevokedBefore && typeof tokenNbf === 'number') {
    const cutoffSec = Math.floor(participant.tokenRevokedBefore.getTime() / 1000);
    if (tokenNbf < cutoffSec) {
      return {
        allowed: false,
        statusCode: 403,
        code: 'LIVEKIT_TOKEN_REVOKED',
        message: 'LiveKit access token predates revocation cutoff.',
      };
    }
  }

  return { allowed: true };
}

export type AtomicFenceResult =
  | { allowed: true; fenceVersion: number }
  | { allowed: false; statusCode: number; code: string; message: string };

/**
 * MongoDB-backed atomic admission linearization point.
 *
 * Serializes signaling admission against concurrent `removeParticipant` / `leaveMeeting`
 * on the exact same `MeetingParticipant` document via single-document conditional
 * `findOneAndUpdate`:
 * - If removal commits first (`admissionStatus = REMOVED`, `tokenEpoch` incremented),
 *   this conditional update atomically returns `null` (loses the race) and the gateway
 *   NEVER emits HTTP 101.
 * - If admission commits first (`$inc: { signalFenceVersion: 1 }`), admission linearized
 *   before removal; any subsequent removal publishes a durable `LiveKitRevocationEvent`
 *   that terminates the already-registered socket pair via `LiveKitRevocationCoordinator`.
 * - Fails strictly CLOSED (`503 LIVEKIT_FENCE_UNAVAILABLE`) on any MongoDB error.
 */
export async function claimSignalingAdmissionFence(
  meetingId: string,
  userId: string,
  tokenEpoch: number,
  tokenNbf?: number,
  hooks?: { afterParticipantFenceBeforeMeetingRecheck?: () => Promise<void> }
): Promise<AtomicFenceResult> {
  try {
    const now = new Date();
    const meeting = await Meeting.findById(meetingId).select('status expiresAt').lean();
    if (!meeting) {
      return {
        allowed: false,
        statusCode: 404,
        code: 'MEETING_NOT_FOUND',
        message: 'Meeting no longer exists.',
      };
    }
    if (meeting.status === 'ENDED' || meeting.status === 'EXPIRED' || now >= meeting.expiresAt) {
      return {
        allowed: false,
        statusCode: 410,
        code: 'LIVEKIT_MEETING_ENDED',
        message: 'This meeting has ended and no longer accepts media signaling connections.',
      };
    }

    const filter: Record<string, unknown> = {
      meetingId,
      userId,
      admissionStatus: 'ADMITTED',
      tokenEpoch,
    };
    if (typeof tokenNbf === 'number') {
      // Allow tokens whose nbf (seconds) >= floor(tokenRevokedBefore / 1000)
      filter.$or = [
        { tokenRevokedBefore: null },
        { tokenRevokedBefore: { $exists: false } },
        { tokenRevokedBefore: { $lt: new Date((tokenNbf + 1) * 1000) } },
      ];
    }

    const claimed = await MeetingParticipant.findOneAndUpdate(
      filter,
      { $inc: { signalFenceVersion: 1 } },
      { new: true, projection: { signalFenceVersion: 1 } }
    ).lean();

    if (!claimed) {
      // Admission lost the atomic document race; determine exact authoritative denial reason
      const diag = await revalidateParticipantAccess(meetingId, userId, tokenEpoch, tokenNbf);
      if (!diag.allowed) {
        return diag;
      }
      return {
        allowed: false,
        statusCode: 403,
        code: 'LIVEKIT_TOKEN_REVOKED',
        message: 'Signaling admission lost atomic authorization fence.',
      };
    }

    if (hooks?.afterParticipantFenceBeforeMeetingRecheck) {
      await hooks.afterParticipantFenceBeforeMeetingRecheck();
    }

    // Post-fence Meeting status & expiration check:
    // Closes the cross-collection race where endMeeting/expiration sets Meeting.status = ENDED|EXPIRED
    // right between the pre-fence Meeting read and MeetingParticipant.updateMany().
    // If Meeting terminated BEFORE this read -> reject (410), never emit HTTP 101.
    // If Meeting terminates AFTER this read -> endMeeting/expiration publishes MEETING_ENDED
    // and terminates the already-registered socket pair.
    const postFenceMeeting = await Meeting.findById(meetingId).select('status expiresAt').lean();
    if (
      !postFenceMeeting ||
      postFenceMeeting.status === 'ENDED' ||
      postFenceMeeting.status === 'EXPIRED' ||
      new Date() >= postFenceMeeting.expiresAt
    ) {
      return {
        allowed: false,
        statusCode: 410,
        code: 'LIVEKIT_MEETING_ENDED',
        message: 'This meeting has ended and no longer accepts media signaling connections.',
      };
    }

    return {
      allowed: true,
      fenceVersion: typeof claimed.signalFenceVersion === 'number' ? claimed.signalFenceVersion : 1,
    };
  } catch (err) {
    logger.error('[LiveKitGateway] Atomic admission fence failed (fail-closed)', {
      meetingId,
      userId,
      errorCategory: 'LIVEKIT_FENCE_UNAVAILABLE',
      message: err instanceof Error ? err.message : 'Atomic fence database error',
    });
    return {
      allowed: false,
      statusCode: 503,
      code: 'LIVEKIT_FENCE_UNAVAILABLE',
      message: 'Signaling admission fencing service is temporarily unavailable.',
    };
  }
}

/**
 * Authoritative pre-admission verification executed BEFORE any HTTP validate
 * or WebSocket signaling upgrade is forwarded to the self-hosted LiveKit SFU.
 */
export async function authorizeLiveKitSignalHandshake(
  rawUrl: string,
  authHeader?: string,
  livekitSvc: LiveKitService = livekitService,
  revocationCoordinator?: LiveKitRevocationCoordinator
): Promise<SignalAuthResult> {
  if (revocationCoordinator && !revocationCoordinator.isHealthy()) {
    return {
      allowed: false,
      statusCode: 503,
      code: 'LIVEKIT_REVOCATION_UNAVAILABLE',
      message: 'Signaling revocation service is temporarily unavailable.',
    };
  }

  const token = extractBearerOrQueryToken(rawUrl, authHeader);
  if (!token) {
    return {
      allowed: false,
      statusCode: 401,
      code: 'LIVEKIT_MISSING_TOKEN',
      message: 'Missing LiveKit access token.',
    };
  }

  let cfg: LiveKitConfig;
  try {
    cfg = livekitSvc.assertConfigured();
  } catch {
    return {
      allowed: false,
      statusCode: 503,
      code: 'LIVEKIT_NOT_CONFIGURED',
      message: 'LiveKit signaling infrastructure is not configured.',
    };
  }

  let claims: Awaited<ReturnType<TokenVerifier['verify']>>;
  try {
    const verifier = new TokenVerifier(cfg.apiKey, cfg.apiSecret);
    claims = await verifier.verify(token);
  } catch {
    return {
      allowed: false,
      statusCode: 401,
      code: 'LIVEKIT_INVALID_TOKEN',
      message: 'Invalid or expired LiveKit access token.',
    };
  }

  const roomName = claims.video?.room || '';
  const identity = claims.sub || '';
  if (!claims.video?.roomJoin || !roomName || !identity) {
    return {
      allowed: false,
      statusCode: 401,
      code: 'LIVEKIT_INVALID_TOKEN',
      message: 'LiveKit access token lacks valid roomJoin claims.',
    };
  }

  const meetingId = parseLiveKitRoomMeetingId(roomName);
  const userId = parseLiveKitParticipantUserId(identity);
  if (!meetingId || !userId) {
    return {
      allowed: false,
      statusCode: 403,
      code: 'LIVEKIT_ACCESS_DENIED',
      message: 'Token room or identity does not match CONNECTLY authorization policy.',
    };
  }

  const meta = parseTokenMetadata(claims.metadata);
  if (!meta) {
    return {
      allowed: false,
      statusCode: 403,
      code: 'LIVEKIT_TOKEN_REVOKED',
      message: 'LiveKit access token lacks valid signed epoch metadata.',
    };
  }

  if (meta.meetingId !== meetingId) {
    return {
      allowed: false,
      statusCode: 403,
      code: 'LIVEKIT_ACCESS_DENIED',
      message: 'Token meeting metadata does not match room grant.',
    };
  }

  const recheck = await revalidateParticipantAccess(
    meetingId,
    userId,
    meta.epoch,
    typeof claims.nbf === 'number' ? claims.nbf : undefined
  );
  if (!recheck.allowed) {
    return recheck;
  }

  return {
    allowed: true,
    meetingId,
    userId,
    roomName,
    identity,
    tokenEpoch: meta.epoch,
    tokenNbf: typeof claims.nbf === 'number' ? claims.nbf : undefined,
    upstreamConfig: cfg,
  };
}

function writeSocketHttpError(socket: Duplex, statusCode: number, message: string): void {
  if (socket.destroyed) return;
  const statusText = http.STATUS_CODES[statusCode] || 'Error';
  const body = message;
  const response =
    `HTTP/1.1 ${statusCode} ${statusText}\r\n` +
    `Content-Type: text/plain; charset=utf-8\r\n` +
    `Content-Length: ${Buffer.byteLength(body)}\r\n` +
    `Connection: close\r\n` +
    `\r\n` +
    body;
  try {
    socket.end(response);
  } catch {
    socket.destroy();
  }
}

function buildUpstreamHeaders(
  req: IncomingMessage,
  upstreamHost: string
): Record<string, string | string[]> {
  const headers: Record<string, string | string[]> = {
    host: upstreamHost,
    connection: 'Upgrade',
    upgrade: 'websocket',
  };
  const forwardNames = [
    'sec-websocket-key',
    'sec-websocket-version',
    'sec-websocket-extensions',
    'sec-websocket-protocol',
    'origin',
    'user-agent',
    'authorization',
    'x-forwarded-for',
  ];
  for (const name of forwardNames) {
    const val = req.headers[name];
    if (val !== undefined) {
      headers[name] = val;
    }
  }
  return headers;
}

function normalizeUpgradePath(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl, 'http://localhost');
    const normalized = parsed.pathname.replace(/\/+$/, '') || '/';
    return normalized;
  } catch {
    return null;
  }
}

export interface LiveKitSignalGatewayOptions {
  /**
   * Defense-in-depth periodic revalidation interval (ms) for active tracked sockets.
   * Ensures that even if an out-of-band DB change or revocation publish failure occurs,
   * a removed/departed participant or ended/expired meeting cannot remain connected
   * indefinitely. Set to `0` to disable the background timer (explicit calls still work).
   */
  activeSocketRevalidationIntervalMs?: number;
  /**
   * Consecutive MongoDB failures during `revalidateActiveSockets()` before failing
   * closed and closing active signaling connections. Default: `1` (immediate fail-closed).
   */
  maxRevalidationFailures?: number;
  /** Optional override for trusted CLIENT_ORIGIN (defaults to env.CLIENT_ORIGIN). */
  clientOrigin?: string;
  /** Optional override for NODE_ENV (defaults to env.NODE_ENV). */
  nodeEnv?: string;
}

/**
 * Resolves and strictly validates the trusted browser CORS origin allowlist for
 * the LiveKit Signaling Admission Gateway (`/livekit-signal`).
 *
 * Fail-closed policy:
 * - Never permits wildcard `*`.
 * - In `production`, requires a valid, explicit `https://` `CLIENT_ORIGIN` and
 *   excludes localhost development origins.
 * - In non-production (`development` / `test`), permits the configured valid
 *   `http(s)://` `CLIENT_ORIGIN` plus standard local Vite dev origins.
 */
export function resolveSignalGatewayAllowedOrigins(options?: {
  clientOrigin?: string;
  nodeEnv?: string;
}): string[] {
  const nodeEnv = options?.nodeEnv ?? env.NODE_ENV;
  const rawOrigin = (options?.clientOrigin ?? env.CLIENT_ORIGIN ?? '').trim();

  if (!rawOrigin || rawOrigin === '*') {
    throw new Error(
      'CRITICAL: LiveKit Signaling Gateway requires a valid trusted CLIENT_ORIGIN (wildcard * or empty origin prohibited).'
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(rawOrigin);
  } catch {
    throw new Error(
      'CRITICAL: LiveKit Signaling Gateway CLIENT_ORIGIN is not a valid URL.'
    );
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      'CRITICAL: LiveKit Signaling Gateway CLIENT_ORIGIN must use http:// or https:// scheme.'
    );
  }

  if (nodeEnv === 'production' && parsed.protocol !== 'https:') {
    throw new Error(
      'CRITICAL: Production LiveKit Signaling Gateway requires an https:// CLIENT_ORIGIN.'
    );
  }

  const normalizedClientOrigin = `${parsed.protocol}//${parsed.host}`;
  if (nodeEnv === 'production') {
    return [normalizedClientOrigin];
  }

  return Array.from(
    new Set([normalizedClientOrigin, 'http://localhost:5173', 'http://127.0.0.1:5173'])
  );
}

function normalizeHttpOriginHeader(originHeader: string | undefined): string | null {
  if (!originHeader || typeof originHeader !== 'string') return null;
  const trimmed = originHeader.trim();
  if (!trimmed || trimmed === '*') return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

export class LiveKitSignalGateway {
  private readonly livekit: LiveKitService;
  private readonly hooks: LiveKitSignalGatewayHooks;
  private readonly coordinator: LiveKitRevocationCoordinator;
  private readonly activeSocketRevalidationIntervalMs: number;
  private readonly maxRevalidationFailures: number;
  private readonly clientOrigin?: string;
  private readonly nodeEnv?: string;
  private consecutiveRevalidationFailures = 0;
  private readonly entriesByParticipant = new Map<string, Set<TrackedSocketEntry>>();
  private readonly entriesByMeeting = new Map<string, Set<TrackedSocketEntry>>();
  private readonly pendingByParticipant = new Map<string, Set<PendingUpgradeHandle>>();
  private readonly pendingByMeeting = new Map<string, Set<PendingUpgradeHandle>>();
  private readonly unsubEvent: () => void;
  private readonly unsubHealth: () => void;
  private revalidationTimer: ReturnType<typeof setInterval> | null = null;
  private isClosing = false;

  constructor(
    livekitSvc: LiveKitService = livekitService,
    hooks: LiveKitSignalGatewayHooks = {},
    coordinator: LiveKitRevocationCoordinator = livekitRevocationCoordinator,
    options: LiveKitSignalGatewayOptions = {}
  ) {
    this.livekit = livekitSvc;
    this.hooks = hooks;
    this.coordinator = coordinator;
    this.activeSocketRevalidationIntervalMs =
      options.activeSocketRevalidationIntervalMs ?? 5_000;
    this.maxRevalidationFailures = Math.max(1, options.maxRevalidationFailures ?? 1);
    this.clientOrigin = options.clientOrigin;
    this.nodeEnv = options.nodeEnv;

    this.unsubEvent = this.coordinator.subscribe((event) => {
      this.applyRevocationEvent(event);
    });
    this.unsubHealth = this.coordinator.onHealthChange((healthy, reason) => {
      if (!healthy) {
        this.failClosedOnCoordinatorOutage(reason);
      }
    });

    if (this.activeSocketRevalidationIntervalMs > 0) {
      this.revalidationTimer = setInterval(() => {
        if (this.entriesByMeeting.size === 0 || this.isClosing) return;
        void this.revalidateActiveSockets();
      }, this.activeSocketRevalidationIntervalMs);
      if (typeof this.revalidationTimer.unref === 'function') {
        this.revalidationTimer.unref();
      }
    }
  }

  private participantKey(meetingId: string, userId: string): string {
    return `${meetingId}:${userId}`;
  }

  public getActiveSocketCount(): number {
    let total = 0;
    for (const set of this.entriesByMeeting.values()) {
      total += set.size * 2; // client + upstream pair per tracked connection
    }
    return total;
  }

  public getPendingUpgradeCount(): number {
    let total = 0;
    for (const set of this.pendingByMeeting.values()) {
      total += set.size;
    }
    return total;
  }

  /**
   * Applies a distributed cross-instance revocation event received via MongoDB
   * Change Stream or durable cursor sweep. Terminates ONLY affected pending
   * handshakes and active sockets whose tokenEpoch predates `revokedEpoch`
   * (or all sockets for MEETING_ENDED), leaving Host and unrelated peers untouched.
   */
  public applyRevocationEvent(event: DistributedRevocationPayload): number {
    if (event.kind === 'MEETING_ENDED' || !event.userId) {
      return this.disconnectMeetingSockets(event.meetingId);
    }

    const cutoffEpoch =
      typeof event.revokedEpoch === 'number' && event.revokedEpoch >= 1
        ? event.revokedEpoch
        : null;
    return this.disconnectParticipantSockets(event.meetingId, event.userId, cutoffEpoch);
  }

  private failClosedOnCoordinatorOutage(reason?: string): number {
    let closed = 0;
    const msg = reason || 'Signaling revocation service unavailable; failing closed.';

    for (const set of Array.from(this.pendingByMeeting.values())) {
      for (const handle of Array.from(set)) {
        handle.abort(503, msg);
        closed += 1;
      }
    }
    this.pendingByParticipant.clear();
    this.pendingByMeeting.clear();

    for (const set of Array.from(this.entriesByMeeting.values())) {
      for (const entry of Array.from(set)) {
        closed += this.destroySocketEntry(entry);
      }
    }
    this.entriesByParticipant.clear();
    this.entriesByMeeting.clear();

    return closed;
  }

  private destroySocketEntry(entry: TrackedSocketEntry): number {
    let closed = 0;
    try {
      if (!entry.clientSocket.destroyed) {
        entry.clientSocket.destroy();
        closed += 1;
      }
    } catch {
      // ignore
    }
    try {
      if (!entry.proxySocket.destroyed) {
        entry.proxySocket.destroy();
        closed += 1;
      }
    } catch {
      // ignore
    }
    return closed;
  }

  private trackPendingUpgrade(
    meetingId: string,
    userId: string,
    handle: PendingUpgradeHandle
  ): () => void {
    const pKey = this.participantKey(meetingId, userId);
    let pSet = this.pendingByParticipant.get(pKey);
    if (!pSet) {
      pSet = new Set();
      this.pendingByParticipant.set(pKey, pSet);
    }
    let mSet = this.pendingByMeeting.get(meetingId);
    if (!mSet) {
      mSet = new Set();
      this.pendingByMeeting.set(meetingId, mSet);
    }

    pSet.add(handle);
    mSet.add(handle);

    let cleaned = false;
    return () => {
      if (cleaned) return;
      cleaned = true;
      pSet?.delete(handle);
      if (pSet && pSet.size === 0) this.pendingByParticipant.delete(pKey);
      mSet?.delete(handle);
      if (mSet && mSet.size === 0) this.pendingByMeeting.delete(meetingId);
    };
  }

  private trackSocketEntry(entry: TrackedSocketEntry): () => void {
    const pKey = this.participantKey(entry.meetingId, entry.userId);
    let pSet = this.entriesByParticipant.get(pKey);
    if (!pSet) {
      pSet = new Set();
      this.entriesByParticipant.set(pKey, pSet);
    }
    let mSet = this.entriesByMeeting.get(entry.meetingId);
    if (!mSet) {
      mSet = new Set();
      this.entriesByMeeting.set(entry.meetingId, mSet);
    }

    pSet.add(entry);
    mSet.add(entry);

    let cleaned = false;
    return () => {
      if (cleaned) return;
      cleaned = true;
      pSet?.delete(entry);
      if (pSet && pSet.size === 0) this.entriesByParticipant.delete(pKey);
      mSet?.delete(entry);
      if (mSet && mSet.size === 0) this.entriesByMeeting.delete(entry.meetingId);
    };
  }

  /**
   * Immediately aborts matching pending handshakes AND terminates active proxied
   * signaling sockets for ONLY the specified participant, without affecting
   * Host or any other admitted participant in the room.
   *
   * If `revokedEpoch` is provided, only connections whose `tokenEpoch < revokedEpoch`
   * are terminated (preventing delayed events from disrupting newer re-admitted sessions).
   */
  public disconnectParticipantSockets(
    meetingId: string,
    userId: string,
    revokedEpoch: number | null = null
  ): number {
    const pKey = this.participantKey(meetingId, userId);
    let closed = 0;

    const pending = this.pendingByParticipant.get(pKey);
    const meetingPending = this.pendingByMeeting.get(meetingId);
    if (pending && pending.size > 0) {
      for (const handle of Array.from(pending)) {
        if (revokedEpoch !== null && handle.tokenEpoch >= revokedEpoch) {
          continue;
        }
        handle.abort(403, 'Participant has been removed from this meeting; token access revoked.');
        pending.delete(handle);
        meetingPending?.delete(handle);
        closed += 1;
      }
      if (pending.size === 0) this.pendingByParticipant.delete(pKey);
      if (meetingPending && meetingPending.size === 0) {
        this.pendingByMeeting.delete(meetingId);
      }
    }

    const entries = this.entriesByParticipant.get(pKey);
    const meetingEntries = this.entriesByMeeting.get(meetingId);
    if (entries && entries.size > 0) {
      for (const entry of Array.from(entries)) {
        if (revokedEpoch !== null && entry.tokenEpoch >= revokedEpoch) {
          continue;
        }
        entries.delete(entry);
        meetingEntries?.delete(entry);
        closed += this.destroySocketEntry(entry);
      }
      if (entries.size === 0) this.entriesByParticipant.delete(pKey);
      if (meetingEntries && meetingEntries.size === 0) {
        this.entriesByMeeting.delete(meetingId);
      }
    }

    return closed;
  }

  /**
   * Aborts all pending handshakes and terminates all active proxied signaling
   * sockets belonging to an ended meeting.
   */
  public disconnectMeetingSockets(meetingId: string): number {
    let closed = 0;

    const pending = this.pendingByMeeting.get(meetingId);
    if (pending && pending.size > 0) {
      for (const handle of Array.from(pending)) {
        handle.abort(410, 'This meeting has ended and no longer accepts media signaling connections.');
        closed += 1;
      }
      this.pendingByMeeting.delete(meetingId);
    }
    for (const [pKey, pSet] of Array.from(this.pendingByParticipant.entries())) {
      if (pKey.startsWith(`${meetingId}:`)) {
        pSet.clear();
        this.pendingByParticipant.delete(pKey);
      }
    }

    const entries = this.entriesByMeeting.get(meetingId);
    if (entries && entries.size > 0) {
      for (const entry of Array.from(entries)) {
        closed += this.destroySocketEntry(entry);
      }
      this.entriesByMeeting.delete(meetingId);
    }
    for (const [pKey, pSet] of Array.from(this.entriesByParticipant.entries())) {
      if (pKey.startsWith(`${meetingId}:`)) {
        pSet.clear();
        this.entriesByParticipant.delete(pKey);
      }
    }

    return closed;
  }

  /**
   * Defense-in-depth authoritative sweep of all active tracked signaling sockets
   * against MongoDB (`Meeting` + `MeetingParticipant`). Terminates any socket whose
   * meeting ended/expired or whose participant is no longer `ADMITTED` at the exact
   * socket `tokenEpoch`. Preserves Host and all still-authorized peers.
   */
  public async revalidateActiveSockets(): Promise<number> {
    if (this.entriesByMeeting.size === 0 || this.isClosing) {
      return 0;
    }

    let closed = 0;
    const now = new Date();
    const meetingIds = Array.from(this.entriesByMeeting.keys());

    try {
      const meetings = await Meeting.find({ _id: { $in: meetingIds } })
        .select('status expiresAt')
        .lean();
      const meetingMap = new Map(meetings.map((m) => [m._id.toString(), m]));

      for (const meetingId of meetingIds) {
        const meeting = meetingMap.get(meetingId);
        if (
          !meeting ||
          meeting.status === 'ENDED' ||
          meeting.status === 'EXPIRED' ||
          now >= new Date(meeting.expiresAt)
        ) {
          closed += this.disconnectMeetingSockets(meetingId);
        }
      }

      const remainingKeys = Array.from(this.entriesByParticipant.keys());
      if (remainingKeys.length === 0) {
        return closed;
      }

      const pairs = remainingKeys.map((k) => {
        const [meetingId, userId] = k.split(':');
        return { meetingId, userId };
      });
      const participants = await MeetingParticipant.find({
        $or: pairs.map((p) => ({ meetingId: p.meetingId, userId: p.userId })),
      })
        .select('meetingId userId admissionStatus tokenEpoch')
        .lean();
      const participantMap = new Map(
        participants.map((p) => [
          this.participantKey(p.meetingId.toString(), p.userId.toString()),
          p,
        ])
      );

      for (const pKey of remainingKeys) {
        const entries = this.entriesByParticipant.get(pKey);
        if (!entries || entries.size === 0) continue;
        const doc = participantMap.get(pKey);
        const [meetingId, userId] = pKey.split(':');

        if (!doc || doc.admissionStatus !== 'ADMITTED') {
          closed += this.disconnectParticipantSockets(meetingId, userId, null);
          continue;
        }

        const expectedEpoch =
          typeof doc.tokenEpoch === 'number' && doc.tokenEpoch >= 1 ? doc.tokenEpoch : 1;
        const meetingEntries = this.entriesByMeeting.get(meetingId);
        for (const entry of Array.from(entries)) {
          if (entry.tokenEpoch !== expectedEpoch) {
            entries.delete(entry);
            meetingEntries?.delete(entry);
            closed += this.destroySocketEntry(entry);
          }
        }
        if (entries.size === 0) this.entriesByParticipant.delete(pKey);
        if (meetingEntries && meetingEntries.size === 0) {
          this.entriesByMeeting.delete(meetingId);
        }
      }
      this.consecutiveRevalidationFailures = 0;
    } catch (err) {
      this.consecutiveRevalidationFailures += 1;
      logger.error('[LiveKitGateway] Active socket revalidation failed', {
        metadata: {
          consecutiveFailures: this.consecutiveRevalidationFailures,
          maxRevalidationFailures: this.maxRevalidationFailures,
          message: err instanceof Error ? err.message : 'Database sweep error',
        },
      });
      if (this.consecutiveRevalidationFailures >= this.maxRevalidationFailures) {
        // Fail-closed policy: never silently keep active sockets authorized when
        // MongoDB authorization revalidation cannot be established.
        closed += this.failClosedOnCoordinatorOutage(
          'Active socket authorization revalidation failed (fail-closed).'
        );
      }
    }

    return closed;
  }

  /**
   * Gracefully shuts down the Signaling Admission Gateway: unsubscribes from
   * revocation events, rejects new upgrades, aborts all pending handshakes,
   * and closes all active proxied sockets.
   */
  public close(): number {
    this.isClosing = true;
    if (this.revalidationTimer) {
      clearInterval(this.revalidationTimer);
      this.revalidationTimer = null;
    }
    this.unsubEvent();
    this.unsubHealth();

    let closed = 0;
    for (const set of Array.from(this.pendingByMeeting.values())) {
      for (const handle of Array.from(set)) {
        handle.abort(503, 'Signaling gateway shutting down.');
        closed += 1;
      }
    }
    this.pendingByParticipant.clear();
    this.pendingByMeeting.clear();

    for (const set of Array.from(this.entriesByMeeting.values())) {
      for (const entry of Array.from(set)) {
        closed += this.destroySocketEntry(entry);
      }
    }
    this.entriesByParticipant.clear();
    this.entriesByMeeting.clear();

    return closed;
  }

  /**
   * Express router handling `HEAD /livekit-signal`, `OPTIONS`, and
   * authoritative pre-admission validation for `/rtc/validate` and `/rtc/v1/validate`.
   */
  public createRouter(): Router {
    const allowedOrigins = resolveSignalGatewayAllowedOrigins({
      clientOrigin: this.clientOrigin,
      nodeEnv: this.nodeEnv,
    });
    const allowedOriginSet = new Set(allowedOrigins);
    const router = Router();

    router.use((req: Request, res: Response, next) => {
      res.setHeader('Vary', 'Origin');
      const normalizedOrigin = normalizeHttpOriginHeader(req.headers.origin);
      if (normalizedOrigin && allowedOriginSet.has(normalizedOrigin)) {
        res.setHeader('Access-Control-Allow-Origin', normalizedOrigin);
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      }
      // Explicitly non-credentialed: NEVER emit Access-Control-Allow-Credentials
      next();
    });

    router.options('*', (req: Request, res: Response) => {
      const rawOrigin = req.headers.origin;
      if (typeof rawOrigin === 'string' && rawOrigin.trim().length > 0) {
        const normalizedOrigin = normalizeHttpOriginHeader(rawOrigin);
        if (!normalizedOrigin || !allowedOriginSet.has(normalizedOrigin)) {
          res.status(403).end();
          return;
        }
      }
      res.status(204).end();
    });

    router.head('/', (_req: Request, res: Response) => {
      if (this.isClosing || !this.coordinator.isHealthy()) {
        res.status(503).end();
        return;
      }
      res.status(200).end();
    });

    router.get('/', (_req: Request, res: Response) => {
      if (this.isClosing || !this.coordinator.isHealthy()) {
        res.status(503).type('text/plain').send('Signaling gateway unavailable.');
        return;
      }
      res.status(200).type('text/plain').send('OK');
    });

    const handleValidate = async (req: Request, res: Response): Promise<void> => {
      if (this.isClosing) {
        res.status(503).type('text/plain').send('Signaling gateway shutting down.');
        return;
      }

      const auth = await authorizeLiveKitSignalHandshake(
        req.originalUrl,
        req.headers.authorization,
        this.livekit,
        this.coordinator
      );

      if (!auth.allowed) {
        logger.warn('[LiveKitGateway] Rejected signaling validate request', {
          statusCode: auth.statusCode,
          code: auth.code,
        });
        res.status(auth.statusCode).type('text/plain').send(auth.message);
        return;
      }

      const upstreamHttpBase = toLiveKitHttpUrl(auth.upstreamConfig.url);
      const strippedUrl = req.originalUrl.slice(LIVEKIT_SIGNAL_GATEWAY_PATH.length) || '/rtc/validate';
      const targetUrl = `${upstreamHttpBase}${strippedUrl}`;

      try {
        const upstreamRes = await fetch(targetUrl, {
          method: 'GET',
          headers: req.headers.authorization
            ? { Authorization: req.headers.authorization }
            : undefined,
        });
        const text = await upstreamRes.text();
        res.status(upstreamRes.status).type('text/plain').send(text);
      } catch {
        res.status(503).type('text/plain').send('LiveKit signaling server is unavailable.');
      }
    };

    router.get('/rtc/validate', (req, res, next) => {
      handleValidate(req, res).catch(next);
    });
    router.get('/rtc/v1/validate', (req, res, next) => {
      handleValidate(req, res).catch(next);
    });

    // Explicitly block any alternate or malformed sub-routes under /livekit-signal/*
    router.all('*', (_req: Request, res: Response) => {
      res.status(404).type('text/plain').send('Unknown LiveKit signaling route.');
    });

    return router;
  }

  /**
   * Attaches an HTTP Upgrade interceptor for `/livekit-signal/rtc` and `/livekit-signal/rtc/v1`.
   * Leaves Socket.IO (`/socket.io`) untouched and rejects any unauthorized or alternate
   * `/rtc*` or `/livekit-signal/*` upgrade paths cleanly.
   */
  public attach(httpServer: HttpServer): void {
    httpServer.on('upgrade', (req: IncomingMessage, clientSocket: Duplex, head: Buffer) => {
      const rawUrl = req.url || '';
      const normalizedPath = normalizeUpgradePath(rawUrl);
      if (!normalizedPath) {
        writeSocketHttpError(clientSocket, 400, 'Malformed signaling request URL.');
        return;
      }

      if (normalizedPath.startsWith('/socket.io')) {
        return;
      }

      clientSocket.on('error', () => {
        // Prevent uncaught socket reset exceptions
      });

      if (
        normalizedPath !== `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc` &&
        normalizedPath !== `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1`
      ) {
        writeSocketHttpError(clientSocket, 404, 'Unknown WebSocket signaling route.');
        return;
      }

      if (this.isClosing) {
        writeSocketHttpError(clientSocket, 503, 'Signaling gateway shutting down.');
        return;
      }

      if (!this.coordinator.isHealthy()) {
        writeSocketHttpError(clientSocket, 503, 'Signaling revocation service is temporarily unavailable.');
        return;
      }

      this.handleWebSocketUpgrade(req, clientSocket, head).catch((err) => {
        logger.error('[LiveKitGateway] Unexpected signaling upgrade error', {
          message: err instanceof Error ? err.message : 'Unknown upgrade error',
        });
        writeSocketHttpError(clientSocket, 500, 'Signaling gateway error.');
      });
    });
  }

  private async handleWebSocketUpgrade(
    req: IncomingMessage,
    clientSocket: Duplex,
    head: Buffer
  ): Promise<void> {
    const rawUrl = req.url || '';

    if (this.hooks.beforeAuthorize) {
      await this.hooks.beforeAuthorize();
    }
    if (this.isClosing || !this.coordinator.isHealthy() || clientSocket.destroyed) {
      writeSocketHttpError(clientSocket, 503, 'Signaling gateway unavailable.');
      return;
    }

    const auth = await authorizeLiveKitSignalHandshake(
      rawUrl,
      req.headers.authorization,
      this.livekit,
      this.coordinator
    );

    if (!auth.allowed) {
      logger.warn('[LiveKitGateway] Blocked unauthorized/revoked WebSocket upgrade', {
        statusCode: auth.statusCode,
        code: auth.code,
      });
      writeSocketHttpError(clientSocket, auth.statusCode, auth.message);
      return;
    }

    const pendingHandle: PendingUpgradeHandle = {
      aborted: false,
      abortStatusCode: 403,
      abortMessage: 'Participant access revoked.',
      tokenEpoch: auth.tokenEpoch,
      abort: (statusCode = 403, message = 'Participant access revoked.') => {
        if (pendingHandle.aborted) return;
        pendingHandle.aborted = true;
        pendingHandle.abortStatusCode = statusCode;
        pendingHandle.abortMessage = message;
        try {
          pendingHandle.proxyReq?.destroy();
        } catch {
          // ignore
        }
        writeSocketHttpError(clientSocket, statusCode, message);
      },
    };
    const untrackPending = this.trackPendingUpgrade(auth.meetingId, auth.userId, pendingHandle);

    const onClientAbortEarly = () => {
      pendingHandle.aborted = true;
      untrackPending();
      try {
        pendingHandle.proxyReq?.destroy();
      } catch {
        // ignore
      }
    };
    clientSocket.once('close', onClientAbortEarly);

    if (this.hooks.afterAuthorize) {
      await this.hooks.afterAuthorize();
    }
    if (pendingHandle.aborted || this.isClosing || !this.coordinator.isHealthy() || clientSocket.destroyed) {
      untrackPending();
      writeSocketHttpError(
        clientSocket,
        !this.coordinator.isHealthy() ? 503 : pendingHandle.abortStatusCode,
        !this.coordinator.isHealthy() ? 'Signaling revocation service unavailable.' : pendingHandle.abortMessage
      );
      return;
    }

    if (this.hooks.beforeUpstreamConnect) {
      await this.hooks.beforeUpstreamConnect();
    }
    if (pendingHandle.aborted || this.isClosing || !this.coordinator.isHealthy() || clientSocket.destroyed) {
      untrackPending();
      writeSocketHttpError(
        clientSocket,
        !this.coordinator.isHealthy() ? 503 : pendingHandle.abortStatusCode,
        !this.coordinator.isHealthy() ? 'Signaling revocation service unavailable.' : pendingHandle.abortMessage
      );
      return;
    }

    const preUpstreamCheck = await revalidateParticipantAccess(
      auth.meetingId,
      auth.userId,
      auth.tokenEpoch,
      auth.tokenNbf
    );
    if (
      !preUpstreamCheck.allowed ||
      pendingHandle.aborted ||
      this.isClosing ||
      !this.coordinator.isHealthy() ||
      clientSocket.destroyed
    ) {
      untrackPending();
      const status = !this.coordinator.isHealthy()
        ? 503
        : preUpstreamCheck.allowed
          ? pendingHandle.abortStatusCode
          : preUpstreamCheck.statusCode;
      const msg = !this.coordinator.isHealthy()
        ? 'Signaling revocation service unavailable.'
        : preUpstreamCheck.allowed
          ? pendingHandle.abortMessage
          : preUpstreamCheck.message;
      writeSocketHttpError(clientSocket, status, msg);
      return;
    }

    const upstreamBase = new URL(toLiveKitHttpUrl(auth.upstreamConfig.url));
    const parsedClientUrl = new URL(rawUrl, 'http://localhost');
    const normalizedPath = parsedClientUrl.pathname.replace(/\/+$/, '');
    const strippedPathname = normalizedPath.slice(LIVEKIT_SIGNAL_GATEWAY_PATH.length) || '/rtc';
    const strippedPathWithQuery = `${strippedPathname}${parsedClientUrl.search}`;
    const isTls = upstreamBase.protocol === 'https:';
    const transport = isTls ? https : http;

    const proxyReq = transport.request({
      protocol: upstreamBase.protocol,
      hostname: upstreamBase.hostname,
      port: upstreamBase.port || (isTls ? 443 : 80),
      method: 'GET',
      path: strippedPathWithQuery,
      headers: buildUpstreamHeaders(req, upstreamBase.host),
    });
    pendingHandle.proxyReq = proxyReq;

    const duringHandshakePromise = this.hooks.duringUpstreamHandshake
      ? this.hooks.duringUpstreamHandshake()
      : Promise.resolve();

    proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
      proxySocket.pause();
      proxySocket.on('error', () => {
        // prevent uncaught upstream socket errors
      });

      let untrackSockets: (() => void) | null = null;

      const rejectUpgradedSocket = (statusCode: number, message: string): void => {
        clientSocket.off('close', onClientAbortEarly);
        untrackPending();
        untrackSockets?.();
        if (!proxySocket.destroyed) proxySocket.destroy();
        writeSocketHttpError(clientSocket, statusCode, message);
      };

      const finalizeUpgrade = async () => {
        await duringHandshakePromise;

        if (this.hooks.afterUpstreamHandshake) {
          await this.hooks.afterUpstreamHandshake();
        }

        if (
          pendingHandle.aborted ||
          this.isClosing ||
          !this.coordinator.isHealthy() ||
          clientSocket.destroyed ||
          proxySocket.destroyed
        ) {
          rejectUpgradedSocket(
            !this.coordinator.isHealthy() ? 503 : pendingHandle.abortStatusCode,
            !this.coordinator.isHealthy()
              ? 'Signaling revocation service unavailable.'
              : pendingHandle.abortMessage
          );
          return;
        }

        if (this.hooks.duringSocketRegister) {
          await this.hooks.duringSocketRegister();
        }

        if (
          pendingHandle.aborted ||
          this.isClosing ||
          !this.coordinator.isHealthy() ||
          clientSocket.destroyed ||
          proxySocket.destroyed
        ) {
          rejectUpgradedSocket(
            !this.coordinator.isHealthy() ? 503 : pendingHandle.abortStatusCode,
            !this.coordinator.isHealthy()
              ? 'Signaling revocation service unavailable.'
              : pendingHandle.abortMessage
          );
          return;
        }

        // Register socket entry BEFORE post-handshake revalidation and BEFORE 101
        // so both local disconnectParticipantSockets() AND cross-instance coordinator
        // events can terminate the socket pair at any point before, during, or after 101.
        clientSocket.off('close', onClientAbortEarly);
        const socketEntry: TrackedSocketEntry = {
          meetingId: auth.meetingId,
          userId: auth.userId,
          tokenEpoch: auth.tokenEpoch,
          clientSocket,
          proxySocket,
        };
        untrackSockets = this.trackSocketEntry(socketEntry);

        const cleanupBoth = () => {
          untrackPending();
          untrackSockets?.();
          if (!clientSocket.destroyed) clientSocket.destroy();
          if (!proxySocket.destroyed) proxySocket.destroy();
        };

        clientSocket.once('error', cleanupBoth);
        proxySocket.once('error', cleanupBoth);
        clientSocket.once('end', cleanupBoth);
        proxySocket.once('end', cleanupBoth);
        clientSocket.once('close', cleanupBoth);
        proxySocket.once('close', cleanupBoth);

        // Post-handshake authoritative MongoDB revalidation
        const postHandshakeCheck = await revalidateParticipantAccess(
          auth.meetingId,
          auth.userId,
          auth.tokenEpoch,
          auth.tokenNbf
        );

        if (
          !postHandshakeCheck.allowed ||
          pendingHandle.aborted ||
          this.isClosing ||
          !this.coordinator.isHealthy() ||
          clientSocket.destroyed ||
          proxySocket.destroyed
        ) {
          const status = !this.coordinator.isHealthy()
            ? 503
            : postHandshakeCheck.allowed
              ? pendingHandle.abortStatusCode
              : postHandshakeCheck.statusCode;
          const msg = !this.coordinator.isHealthy()
            ? 'Signaling revocation service unavailable.'
            : postHandshakeCheck.allowed
              ? pendingHandle.abortMessage
              : postHandshakeCheck.message;
          logger.warn('[LiveKitGateway] Post-handshake revalidation rejected upgraded socket', {
            metadata: {
              meetingId: auth.meetingId,
              userId: auth.userId,
              statusCode: status,
              code: postHandshakeCheck.allowed ? 'GATEWAY_ABORTED' : postHandshakeCheck.code,
            },
          });
          rejectUpgradedSocket(status, msg);
          return;
        }

        // Deterministic hook boundary: AFTER postHandshakeCheck succeeded, BEFORE syncNow() & atomic fence
        if (this.hooks.beforeWrite101) {
          await this.hooks.beforeWrite101();
        }

        // Pre-101 Distributed Sync & Atomic Linearization Fence:
        // 1. Fail closed if coordinator became unhealthy/stalled.
        // 2. Synchronize distributed revocation cursor (`syncNow`).
        // 3. Complete final MongoDB authorization read (`finalReadCheck`).
        // 4. Execute atomic MongoDB single-document linearization point (`claimSignalingAdmissionFence`)
        //    strictly serialized against `removeParticipant` / `leaveMeeting` on `MeetingParticipant`.
        if (!this.coordinator.isHealthy() || this.isClosing) {
          rejectUpgradedSocket(503, 'Signaling revocation service unavailable.');
          return;
        }

        if (this.coordinator.isRunning()) {
          const synced = await this.coordinator.syncNow();
          if (!synced || !this.coordinator.isHealthy()) {
            rejectUpgradedSocket(503, 'Signaling revocation sync failed (fail-closed).');
            return;
          }
        }

        const finalReadCheck = await revalidateParticipantAccess(
          auth.meetingId,
          auth.userId,
          auth.tokenEpoch,
          auth.tokenNbf
        );

        if (
          !finalReadCheck.allowed ||
          pendingHandle.aborted ||
          this.isClosing ||
          !this.coordinator.isHealthy() ||
          clientSocket.destroyed ||
          proxySocket.destroyed
        ) {
          const status = !this.coordinator.isHealthy()
            ? 503
            : finalReadCheck.allowed
              ? pendingHandle.abortStatusCode
              : finalReadCheck.statusCode;
          const msg = !this.coordinator.isHealthy()
            ? 'Signaling revocation service unavailable.'
            : finalReadCheck.allowed
              ? pendingHandle.abortMessage
              : finalReadCheck.message;
          logger.warn('[LiveKitGateway] Pre-101 read check rejected upgraded socket', {
            metadata: {
              meetingId: auth.meetingId,
              userId: auth.userId,
              statusCode: status,
              code: finalReadCheck.allowed ? 'GATEWAY_ABORTED' : finalReadCheck.code,
            },
          });
          rejectUpgradedSocket(status, msg);
          return;
        }

        // Deterministic barrier AFTER syncNow() AND AFTER final MongoDB read, BEFORE atomic fence
        if (this.hooks.afterSyncBeforeAtomicFence) {
          await this.hooks.afterSyncBeforeAtomicFence();
        }

        // ATOMIC LINEARIZATION POINT: conditional single-document findOneAndUpdate on MeetingParticipant
        // followed by post-fence Meeting termination/expiration re-check.
        const fenceClaim = await claimSignalingAdmissionFence(
          auth.meetingId,
          auth.userId,
          auth.tokenEpoch,
          auth.tokenNbf,
          {
            afterParticipantFenceBeforeMeetingRecheck:
              this.hooks.afterParticipantFenceBeforeMeetingRecheck,
          }
        );

        if (
          !fenceClaim.allowed ||
          pendingHandle.aborted ||
          this.isClosing ||
          !this.coordinator.isHealthy() ||
          clientSocket.destroyed ||
          proxySocket.destroyed
        ) {
          const status = !this.coordinator.isHealthy()
            ? 503
            : fenceClaim.allowed
              ? pendingHandle.abortStatusCode
              : fenceClaim.statusCode;
          const msg = !this.coordinator.isHealthy()
            ? 'Signaling revocation service unavailable.'
            : fenceClaim.allowed
              ? pendingHandle.abortMessage
              : fenceClaim.message;
          logger.warn('[LiveKitGateway] Atomic admission fence rejected upgraded socket', {
            metadata: {
              meetingId: auth.meetingId,
              userId: auth.userId,
              statusCode: status,
              code: fenceClaim.allowed ? 'GATEWAY_ABORTED' : fenceClaim.code,
              fenceAllowed: fenceClaim.allowed,
              aborted: pendingHandle.aborted,
              healthy: this.coordinator.isHealthy(),
              clientDestroyed: clientSocket.destroyed,
              proxyDestroyed: proxySocket.destroyed,
            },
          });
          rejectUpgradedSocket(status, msg);
          return;
        }

        // Deterministic barrier AFTER atomic linearization point, immediately BEFORE clientSocket.write(HTTP 101)
        if (this.hooks.afterAtomicFenceBeforeSocketWrite101) {
          await this.hooks.afterAtomicFenceBeforeSocketWrite101();
        }

        untrackPending();

        if (
          pendingHandle.aborted ||
          this.isClosing ||
          !this.coordinator.isHealthy() ||
          clientSocket.destroyed ||
          proxySocket.destroyed
        ) {
          rejectUpgradedSocket(
            !this.coordinator.isHealthy() ? 503 : pendingHandle.abortStatusCode,
            !this.coordinator.isHealthy()
              ? 'Signaling revocation service unavailable.'
              : pendingHandle.abortMessage
          );
          return;
        }

        const statusLine = `HTTP/1.1 ${proxyRes.statusCode || 101} ${proxyRes.statusMessage || 'Switching Protocols'}\r\n`;
        const headerLines: string[] = [];
        for (const [key, val] of Object.entries(proxyRes.headers)) {
          if (val === undefined) continue;
          if (Array.isArray(val)) {
            for (const v of val) {
              headerLines.push(`${key}: ${v}\r\n`);
            }
          } else {
            headerLines.push(`${key}: ${val}\r\n`);
          }
        }

        clientSocket.write(`${statusLine}${headerLines.join('')}\r\n`);
        if (proxyHead && proxyHead.length > 0) {
          clientSocket.write(proxyHead);
        }
        if (head && head.length > 0) {
          proxySocket.write(head);
        }

        // Attach .pipe() BEFORE resuming so buffered upstream WebSocket frames
        // received during post-handshake fencing are never lost.
        clientSocket.pipe(proxySocket);
        proxySocket.pipe(clientSocket);
        proxySocket.resume();

        if (this.hooks.afterWrite101) {
          await this.hooks.afterWrite101();
        }
        if (this.hooks.afterSocketRegister) {
          await this.hooks.afterSocketRegister();
        }
      };

      finalizeUpgrade().catch((err) => {
        logger.error('[LiveKitGateway] Error during post-handshake upgrade finalization', {
          metadata: {
            meetingId: auth.meetingId,
            userId: auth.userId,
            message: err instanceof Error ? err.message : 'Unknown upgrade finalization error',
          },
        });
        rejectUpgradedSocket(500, 'Signaling handshake finalization error.');
      });
    });

    proxyReq.on('response', (proxyRes) => {
      clientSocket.off('close', onClientAbortEarly);
      untrackPending();
      const chunks: Buffer[] = [];
      proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk));
      proxyRes.on('end', () => {
        const body =
          Buffer.concat(chunks).toString('utf8') || 'Upstream signaling rejected connection.';
        writeSocketHttpError(clientSocket, proxyRes.statusCode || 502, body);
      });
    });

    proxyReq.on('error', () => {
      clientSocket.off('close', onClientAbortEarly);
      untrackPending();
      if (!pendingHandle.aborted) {
        writeSocketHttpError(clientSocket, 503, 'LiveKit signaling server is unavailable.');
      }
    });

    proxyReq.end();
  }
}

export const livekitSignalGateway = new LiveKitSignalGateway();
