import { AccessToken, RoomServiceClient, TrackSource, type VideoGrant } from 'livekit-server-sdk';
import { env } from '../config/env.js';
import type { ParticipantRole } from '../models/MeetingParticipant.model.js';
import { AppError, ServiceUnavailableError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import {
  toLiveKitHttpUrl,
  toLiveKitWsUrl,
  validateLiveKitConfig as validateLiveKitConfigPure,
  type LiveKitConfig,
} from '../utils/livekitConfig.js';

export { toLiveKitHttpUrl, toLiveKitWsUrl, type LiveKitConfig };

export function validateLiveKitConfig(
  config: Partial<LiveKitConfig>,
  nodeEnv: string = env.NODE_ENV
): { valid: true; resolved: LiveKitConfig } | { valid: false; reason: string } {
  return validateLiveKitConfigPure(config, nodeEnv);
}

export type LiveKitPublishableSource =
  | 'camera'
  | 'microphone'
  | 'screen_share'
  | 'screen_share_audio';

export interface LiveKitTokenPermissions {
  roomJoin: boolean;
  canPublish: boolean;
  canPublishSources: LiveKitPublishableSource[];
  canSubscribe: boolean;
  canPublishData: boolean;
}

export interface LiveKitTokenBundle {
  livekitUrl: string;
  token: string;
  roomName: string;
  participantIdentity: string;
  expiresAt: string;
  ttlSeconds: number;
  role: ParticipantRole;
  permissions: LiveKitTokenPermissions;
}

export interface LiveKitRoomClientAdapter {
  createRoom(options: { name: string; maxParticipants?: number; emptyTimeout?: number }): Promise<unknown>;
  removeParticipant(
    room: string,
    identity: string,
    options?: { revokeTokenTs?: bigint }
  ): Promise<unknown>;
  deleteRoom(room: string): Promise<unknown>;
  getParticipant?(room: string, identity: string): Promise<unknown>;
}

const ROOM_NAME_PREFIX = 'cly_room_';
const PARTICIPANT_IDENTITY_PREFIX = 'usr_';
const DEFAULT_EMPTY_ROOM_TIMEOUT_SECONDS = 300;

/**
 * Parses a CONNECTLY internal MongoDB meeting ID from an opaque LiveKit room name.
 */
export function parseLiveKitRoomMeetingId(roomName: string): string | null {
  const match = /^cly_room_([a-f0-9]{24})$/.exec(roomName.trim());
  return match ? match[1] : null;
}

/**
 * Parses a CONNECTLY internal MongoDB user ID from an opaque LiveKit participant identity.
 * Supports both legacy `usr_<24-hex>` and session-scoped `usr_<24-hex>_<sessionId>`.
 * Note: Session IDs must be alphanumeric `[a-zA-Z0-9]+` (e.g. 12-hex, 16-hex, or un-hyphenated 32-hex).
 * Hyphenated UUIDs (e.g. RFC 4122) return null; production uses 12-hex tokens.
 */
export function parseLiveKitParticipantUserId(identity: string): string | null {
  const match = /^usr_([a-f0-9]{24})(?:_([a-zA-Z0-9]+))?$/i.exec(identity.trim());
  return match ? match[1].toLowerCase() : null;
}

/**
 * Parses the optional admission session ID from an opaque session-scoped LiveKit identity.
 * Note: Matches alphanumeric strings `[a-zA-Z0-9]+`. Hyphenated UUIDs return null.
 */
export function parseLiveKitParticipantSessionId(identity: string): string | null {
  const match = /^usr_([a-f0-9]{24})(?:_([a-zA-Z0-9]+))?$/i.exec(identity.trim());
  return match && match[2] ? match[2].toLowerCase() : null;
}

export function isLiveKitCloudHost(rawUrl: string): boolean {
  try {
    return new URL(rawUrl).hostname.toLowerCase().endsWith('.livekit.cloud');
  } catch {
    return false;
  }
}

/**
 * Determines whether browser signaling should route through CONNECTLY's
 * authoritative Signaling Admission Gateway before reaching LiveKit SFU.
 *
 * Self-hosted LiveKit OSS (including v1.13.11) does not enforce server-side
 * JWT revocation (`revokeTokenTs`), so routing signaling through CONNECTLY's
 * admission gateway guarantees immediate pre-handshake rejection of removed
 * or revoked participants. Managed LiveKit Cloud (`*.livekit.cloud`) enforces
 * `revokeTokenTs` natively on its control plane.
 */
export function shouldUseLiveKitSignalGateway(
  livekitUrl: string,
  mode: 'auto' | 'true' | 'false' = env.LIVEKIT_SIGNAL_GATEWAY_ENABLED
): boolean {
  if (mode === 'true') return true;
  if (mode === 'false') return false;
  try {
    new URL(livekitUrl);
    return !isLiveKitCloudHost(livekitUrl);
  } catch {
    return false;
  }
}

/**
 * Deterministic, opaque mapping from CONNECTLY internal MongoDB meeting ID
 * to a LiveKit SFU room name. Never embeds titles, emails, or client input.
 */
export function getLiveKitRoomName(meetingId: string): string {
  const clean = meetingId.trim();
  if (!clean || !/^[a-fA-F0-9]{24}$/.test(clean)) {
    throw new AppError('Invalid meeting identifier for LiveKit room mapping.', 400, 'INVALID_IDENTIFIER');
  }
  return `${ROOM_NAME_PREFIX}${clean.toLowerCase()}`;
}

/**
 * Deterministic, privacy-preserving opaque LiveKit participant identity derived
 * strictly from CONNECTLY's internal user ObjectId and optional admission session ID.
 */
export function getLiveKitParticipantIdentity(userId: string, sessionId?: string | null): string {
  const clean = userId.trim();
  if (!clean || !/^[a-fA-F0-9]{24}$/.test(clean)) {
    throw new AppError('Invalid user identifier for LiveKit identity mapping.', 400, 'INVALID_IDENTIFIER');
  }
  if (sessionId && sessionId.trim()) {
    const cleanSession = sessionId.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    if (cleanSession) {
      return `${PARTICIPANT_IDENTITY_PREFIX}${clean.toLowerCase()}_${cleanSession}`;
    }
  }
  return `${PARTICIPANT_IDENTITY_PREFIX}${clean.toLowerCase()}`;
}

function isNotFoundLiveKitError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { status?: number; code?: string | number; message?: string };
  if (e.status === 404 || e.code === 'not_found' || e.code === 404) return true;
  const msg = String(e.message || '').toLowerCase();
  return msg.includes('not found') || msg.includes('does not exist') || msg.includes('room not found');
}

function isAlreadyExistsLiveKitError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { status?: number; code?: string | number; message?: string };
  if (e.status === 409 || e.code === 'already_exists') return true;
  const msg = String(e.message || '').toLowerCase();
  return msg.includes('already exists');
}

export class LiveKitService {
  private readonly customConfig?: Partial<LiveKitConfig>;
  private readonly nodeEnvOverride?: string;
  private readonly roomClientFactory?: (httpUrl: string, apiKey: string, apiSecret: string) => LiveKitRoomClientAdapter;
  private cachedClientKey: string | null = null;
  private cachedClient: LiveKitRoomClientAdapter | null = null;

  constructor(options?: {
    config?: Partial<LiveKitConfig>;
    nodeEnv?: string;
    roomClientFactory?: (httpUrl: string, apiKey: string, apiSecret: string) => LiveKitRoomClientAdapter;
  }) {
    this.customConfig = options?.config;
    this.nodeEnvOverride = options?.nodeEnv;
    this.roomClientFactory = options?.roomClientFactory;
  }

  private readCurrentConfig(): Partial<LiveKitConfig> {
    if (this.customConfig) {
      return this.customConfig;
    }
    const rawMode = (
      process.env.LIVEKIT_SIGNAL_GATEWAY_ENABLED ?? env.LIVEKIT_SIGNAL_GATEWAY_ENABLED
    ) as 'auto' | 'true' | 'false';
    return {
      url: process.env.LIVEKIT_URL ?? env.LIVEKIT_URL,
      publicUrl: process.env.LIVEKIT_PUBLIC_URL ?? env.LIVEKIT_PUBLIC_URL,
      signalGatewayEnabled: rawMode,
      apiKey: process.env.LIVEKIT_API_KEY ?? env.LIVEKIT_API_KEY,
      apiSecret: process.env.LIVEKIT_API_SECRET ?? env.LIVEKIT_API_SECRET,
      tokenTtlSeconds: env.LIVEKIT_TOKEN_TTL_SECONDS,
    };
  }

  public isConfigured(): boolean {
    const check = validateLiveKitConfig(this.readCurrentConfig(), this.nodeEnvOverride ?? env.NODE_ENV);
    return check.valid;
  }

  public assertConfigured(): LiveKitConfig {
    const check = validateLiveKitConfig(this.readCurrentConfig(), this.nodeEnvOverride ?? env.NODE_ENV);
    if (!check.valid) {
      logger.warn('[LiveKit] Configuration check failed', {
        errorCategory: 'LIVEKIT_NOT_CONFIGURED',
        reason: check.reason,
      });
      throw new ServiceUnavailableError(
        'Real-time media infrastructure (LiveKit) is not configured on this server.',
        'LIVEKIT_NOT_CONFIGURED'
      );
    }
    return check.resolved;
  }

  private getRoomClient(cfg: LiveKitConfig): LiveKitRoomClientAdapter {
    const httpUrl = toLiveKitHttpUrl(cfg.url);
    const cacheKey = `${httpUrl}|${cfg.apiKey}`;
    if (this.cachedClient && this.cachedClientKey === cacheKey) {
      return this.cachedClient;
    }
    const client: LiveKitRoomClientAdapter = this.roomClientFactory
      ? this.roomClientFactory(httpUrl, cfg.apiKey, cfg.apiSecret)
      : new RoomServiceClient(httpUrl, cfg.apiKey, cfg.apiSecret);
    this.cachedClient = client;
    this.cachedClientKey = cacheKey;
    return client;
  }

  /**
   * Lazily ensures the LiveKit SFU room exists for an authorized CONNECTLY meeting.
   * Safe under concurrent calls (idempotent if the room already exists).
   */
  public async ensureRoomExists(
    meetingId: string,
    maxParticipants: number,
    requestId?: string
  ): Promise<string> {
    const cfg = this.assertConfigured();
    const roomName = getLiveKitRoomName(meetingId);
    const client = this.getRoomClient(cfg);

    try {
      await client.createRoom({
        name: roomName,
        maxParticipants,
        emptyTimeout: DEFAULT_EMPTY_ROOM_TIMEOUT_SECONDS,
      });
      return roomName;
    } catch (err) {
      if (isAlreadyExistsLiveKitError(err)) {
        return roomName;
      }
      logger.error('[LiveKit] Failed to reach LiveKit server while provisioning room', {
        requestId,
        meetingId,
        roomName,
        errorCategory: 'LIVEKIT_UNAVAILABLE',
        message: err instanceof Error ? err.message : 'Unknown LiveKit transport error',
      });
      throw new ServiceUnavailableError(
        'LiveKit media server is currently unreachable. Please try reconnecting shortly.',
        'LIVEKIT_UNAVAILABLE'
      );
    }
  }

  /**
   * Issues a short-lived, least-privilege LiveKit JWT for a verified ADMITTED participant.
   *
   * Strict Phase 11 Permission Boundary (Screen Sharing):
   * - roomJoin: true (room connection & signaling)
   * - canPublish: true restricted strictly to `canPublishSources: [CAMERA, MICROPHONE, SCREEN_SHARE, SCREEN_SHARE_AUDIO]`
   * - canSubscribe: true (receive admitted participants' audio/video/screen tracks)
   * - canPublishData: false (chat/reactions data channel remains disabled until Phase 12)
   * - roomAdmin / roomCreate / roomList / roomRecord: ALWAYS false for every role
   */
  public async generateParticipantToken(params: {
    meetingId: string;
    userId: string;
    displayName: string;
    role: ParticipantRole;
    maxParticipants: number;
    tokenEpoch?: number;
    sessionId?: string | null;
    gatewayUrl?: string;
    requestId?: string;
    provisionRoom?: boolean;
  }): Promise<LiveKitTokenBundle> {
    const cfg = this.assertConfigured();
    const roomName = getLiveKitRoomName(params.meetingId);
    const participantIdentity = getLiveKitParticipantIdentity(params.userId, params.sessionId);
    const tokenEpoch =
      typeof params.tokenEpoch === 'number' && Number.isInteger(params.tokenEpoch) && params.tokenEpoch >= 1
        ? params.tokenEpoch
        : 1;

    if (params.provisionRoom !== false) {
      await this.ensureRoomExists(params.meetingId, params.maxParticipants, params.requestId);
    }

    const permissions: LiveKitTokenPermissions = {
      roomJoin: true,
      canPublish: true,
      canPublishSources: ['camera', 'microphone', 'screen_share', 'screen_share_audio'],
      canSubscribe: true,
      canPublishData: false,
    };

    const grant: VideoGrant = {
      roomJoin: permissions.roomJoin,
      room: roomName,
      canPublish: permissions.canPublish,
      canPublishSources: [
        TrackSource.CAMERA,
        TrackSource.MICROPHONE,
        TrackSource.SCREEN_SHARE,
        TrackSource.SCREEN_SHARE_AUDIO,
      ],
      canSubscribe: permissions.canSubscribe,
      canPublishData: permissions.canPublishData,
      roomAdmin: false,
      roomCreate: false,
      roomList: false,
      roomRecord: false,
    };

    const activeNodeEnv = this.nodeEnvOverride ?? env.NODE_ENV;
    const publicOverride = (cfg.publicUrl || '').trim();
    const signalMode: 'auto' | 'true' | 'false' = cfg.signalGatewayEnabled ?? 'auto';
    const requiresGateway = shouldUseLiveKitSignalGateway(cfg.url, signalMode);
    let clientLivekitUrl = cfg.url;

    if (publicOverride) {
      clientLivekitUrl = toLiveKitWsUrl(publicOverride);
    } else if (requiresGateway && params.gatewayUrl) {
      const candidateGatewayUrl = toLiveKitWsUrl(params.gatewayUrl);
      if (activeNodeEnv === 'production' && !candidateGatewayUrl.startsWith('wss://')) {
        throw new ServiceUnavailableError(
          'Production LiveKit Signaling Admission Gateway requires a secure wss:// URL.',
          'LIVEKIT_NOT_CONFIGURED'
        );
      }
      clientLivekitUrl = candidateGatewayUrl;
    } else if (requiresGateway && activeNodeEnv === 'production') {
      // Fail closed in production: NEVER fall back silently to raw self-hosted LiveKit signaling
      throw new ServiceUnavailableError(
        'Production self-hosted LiveKit requires LIVEKIT_PUBLIC_URL or an HTTPS/WSS Signaling Admission Gateway.',
        'LIVEKIT_NOT_CONFIGURED'
      );
    }

    try {
      const accessToken = new AccessToken(cfg.apiKey, cfg.apiSecret, {
        identity: participantIdentity,
        name: params.displayName,
        ttl: cfg.tokenTtlSeconds,
        metadata: JSON.stringify({
          role: params.role,
          meetingId: params.meetingId,
          epoch: tokenEpoch,
          sessionId: params.sessionId || null,
        }),
      });
      accessToken.addGrant(grant);

      const jwt = await accessToken.toJwt();
      const expiresAt = new Date(Date.now() + cfg.tokenTtlSeconds * 1000).toISOString();

      logger.info('[LiveKit] Issued short-lived room access token', {
        requestId: params.requestId,
        meetingId: params.meetingId,
        roomName,
        participantIdentity,
        role: params.role,
        tokenEpoch,
        ttlSeconds: cfg.tokenTtlSeconds,
        viaSignalGateway: clientLivekitUrl !== cfg.url,
      });

      return {
        livekitUrl: clientLivekitUrl,
        token: jwt,
        roomName,
        participantIdentity,
        expiresAt,
        ttlSeconds: cfg.tokenTtlSeconds,
        role: params.role,
        permissions,
      };
    } catch (err) {
      logger.error('[LiveKit] Token signing failed', {
        requestId: params.requestId,
        meetingId: params.meetingId,
        participantIdentity,
        errorCategory: 'LIVEKIT_TOKEN_GENERATION_FAILED',
        message: err instanceof Error ? err.message : 'Token signing error',
      });
      throw new AppError(
        'Unable to generate secure media session token.',
        500,
        'LIVEKIT_TOKEN_GENERATION_FAILED'
      );
    }
  }

  /**
   * Inspects participant presence on the LiveKit SFU.
   * Returns null if participant or room does not exist (404), or the participant object if present.
   */
  public async getParticipant(
    meetingId: string,
    identityOrUserId: string,
    requestId?: string
  ): Promise<any | null | undefined> {
    if (!this.isConfigured()) {
      return null;
    }

    const cfg = this.assertConfigured();
    const roomName = getLiveKitRoomName(meetingId);
    const participantIdentity = identityOrUserId.startsWith(PARTICIPANT_IDENTITY_PREFIX)
      ? identityOrUserId
      : getLiveKitParticipantIdentity(identityOrUserId);
    const client = this.getRoomClient(cfg);

    if (typeof client.getParticipant !== 'function') {
      return undefined;
    }

    try {
      const p = await client.getParticipant(roomName, participantIdentity);
      return p ?? null;
    } catch (err) {
      if (isNotFoundLiveKitError(err)) {
        return null;
      }
      logger.warn('[LiveKit] Failed to inspect participant presence', {
        requestId,
        meetingId,
        roomName,
        participantIdentity,
        message: err instanceof Error ? err.message : 'Unknown inspection error',
      });
      throw err;
    }
  }

  /**
   * Evicts a participant from the LiveKit SFU room with detailed result context.
   */
  public async evictParticipant(
    meetingId: string,
    identityOrUserId: string,
    requestId?: string
  ): Promise<{ success: boolean; notFound?: boolean; error?: string }> {
    if (!this.isConfigured()) {
      return { success: false, error: 'LiveKit is not configured.' };
    }

    const cfg = this.assertConfigured();
    const roomName = getLiveKitRoomName(meetingId);
    const participantIdentity = identityOrUserId.startsWith(PARTICIPANT_IDENTITY_PREFIX)
      ? identityOrUserId
      : getLiveKitParticipantIdentity(identityOrUserId);
    const client = this.getRoomClient(cfg);
    const revokeTokenTs = BigInt(Math.floor(Date.now() / 1000) + 1);

    try {
      await client.removeParticipant(roomName, participantIdentity, { revokeTokenTs });
      logger.info('[LiveKit] Evicted participant from SFU room', {
        requestId,
        meetingId,
        roomName,
        participantIdentity,
        revokeTokenTs: revokeTokenTs.toString(),
      });
      return { success: true };
    } catch (err) {
      if (isNotFoundLiveKitError(err)) {
        logger.info('[LiveKit] Participant already absent from SFU room', {
          requestId,
          meetingId,
          roomName,
          participantIdentity,
        });
        return { success: true, notFound: true };
      }
      const rawMsg = err instanceof Error ? err.message : 'Unknown eviction error';
      logger.warn('[LiveKit] Failed to evict participant from SFU room (non-fatal)', {
        requestId,
        meetingId,
        roomName,
        participantIdentity,
        errorCategory: 'LIVEKIT_UNAVAILABLE',
        message: rawMsg,
      });
      return { success: false, error: rawMsg };
    }
  }

  /**
   * Disconnects a removed or departed participant from the LiveKit SFU room.
   * Best-effort with sanitized error logging so CONNECTLY DB state remains authoritative.
   */
  public async removeParticipant(
    meetingId: string,
    identityOrUserId: string,
    requestId?: string
  ): Promise<boolean> {
    const outcome = await this.evictParticipant(meetingId, identityOrUserId, requestId);
    return outcome.success;
  }

  /**
   * Closes/deletes the LiveKit SFU room when a CONNECTLY meeting ends.
   * Performs 1 bounded retry on transient failure; falls back safely to LiveKit's
   * emptyTimeout reconciliation while logging safe diagnostic metadata.
   */
  public async deleteRoom(meetingId: string, requestId?: string): Promise<boolean> {
    if (!this.isConfigured()) {
      return false;
    }

    const cfg = this.assertConfigured();
    const roomName = getLiveKitRoomName(meetingId);
    const client = this.getRoomClient(cfg);

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        await client.deleteRoom(roomName);
        logger.info('[LiveKit] Deleted SFU room upon meeting termination', {
          requestId,
          meetingId,
          roomName,
          attempt,
        });
        return true;
      } catch (err) {
        if (isNotFoundLiveKitError(err)) {
          return true;
        }
        logger.warn('[LiveKit] Room cleanup attempt failed', {
          requestId,
          meetingId,
          roomName,
          attempt,
          errorCategory: 'LIVEKIT_UNAVAILABLE',
          message: err instanceof Error ? err.message : 'Unknown room deletion error',
        });
      }
    }

    return false;
  }
}

export const livekitService = new LiveKitService();
