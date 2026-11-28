import crypto from 'node:crypto';
import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { validateRedisUrl } from '../utils/redisUrl.js';
import { AppError } from '../utils/errors.js';

const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local maxEvents = tonumber(ARGV[3])
local ttlSec = tonumber(ARGV[4])
local member = ARGV[5]

local clearBefore = now - windowMs
redis.call('ZREMRANGEBYSCORE', key, '-inf', clearBefore)

local count = redis.call('ZCARD', key)
if count < maxEvents then
  redis.call('ZADD', key, now, member)
  redis.call('EXPIRE', key, ttlSec)
  return 1
else
  redis.call('EXPIRE', key, ttlSec)
  return 0
end
`;

const RESERVE_REACTION_LUA = `
-- connectly_reserve_rx
local current = redis.call('GET', KEYS[1])
if not current then
  redis.call('SET', KEYS[1], 'reserved:' .. ARGV[1], 'EX', ARGV[2])
  return 'acquired'
elseif current == 'completed' or current == '1' then
  return 'completed'
else
  return 'in_progress'
end
`;

const RELEASE_REACTION_LUA = `
-- connectly_release_rx
local current = redis.call('GET', KEYS[1])
if current == ('reserved:' .. ARGV[1]) then
  return redis.call('DEL', KEYS[1])
else
  return 0
end
`;

const COMPLETE_REACTION_LUA = `
-- connectly_complete_rx
local current = redis.call('GET', KEYS[1])
if current == ('reserved:' .. ARGV[1]) or current == 'completed' then
  redis.call('SET', KEYS[1], 'completed', 'EX', ARGV[2])
  return 1
else
  return 0
end
`;

interface InMemoryRateLimitEntry {
  timestamps: number[];
  lastUpdated: number;
}

interface InMemoryIdempotencyEntry {
  status: 'reserved' | 'completed';
  reservationToken: string;
  expiresAt: number;
}

export class ChatRedisService {
  private redisClient: Redis | null = null;
  private connectPromise: Promise<Redis | null> | null = null;
  private isExternalClient = false;
  private readonly inMemoryRateLimits = new Map<string, InMemoryRateLimitEntry>();
  private readonly inMemoryIdempotency = new Map<string, InMemoryIdempotencyEntry>();

  constructor(customClient?: Redis) {
    if (customClient) {
      this.redisClient = customClient;
      this.isExternalClient = true;
    }
  }

  /**
   * Returns whether multi-instance mode requires distributed Redis enforcement.
   * Single-instance deployments without REDIS_URL fall back cleanly to in-memory rate-limiting/idempotency.
   */
  public isDistributedRequired(): boolean {
    return (
      env.SOCKET_IO_MULTI_INSTANCE === 'true' ||
      env.SOCKET_IO_ADAPTER === 'redis'
    );
  }

  /**
   * Lazily initializes and returns the shared Redis client if configured.
   * Deduplicates concurrent cold-start initialization so only one TCP socket is opened.
   */
  public async getClient(): Promise<Redis | null> {
    if (this.redisClient) {
      return this.redisClient;
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }

    const connectAttempt = this.createSharedClient();
    this.connectPromise = connectAttempt;
    try {
      return await connectAttempt;
    } finally {
      if (this.connectPromise === connectAttempt) {
        this.connectPromise = null;
      }
    }
  }

  private async createSharedClient(): Promise<Redis | null> {
    const redisUrl = (env.REDIS_URL || '').trim();
    if (!redisUrl) {
      if (this.isDistributedRequired()) {
        throw new AppError(
          'CRITICAL: Distributed Redis is required in production or multi-instance mode, but REDIS_URL is not configured (fail-closed).',
          503,
          'REDIS_REQUIRED'
        );
      }
      return null;
    }

    validateRedisUrl(redisUrl, env.NODE_ENV);

    const client = new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      connectTimeout: 5_000,
      enableReadyCheck: true,
    });

    client.on('error', (err) => {
      logger.error('[ChatRedis] Redis connection error', {
        metadata: { message: err instanceof Error ? err.message : String(err) },
      });
    });

    try {
      await client.connect();
      const pong = await client.ping();
      if (pong !== 'PONG') {
        throw new Error(`Unexpected Redis PING response: ${String(pong)}`);
      }
      this.redisClient = client;
      logger.info('[ChatRedis] Successfully connected shared Redis client');
      return this.redisClient;
    } catch (err) {
      client.disconnect();
      if (this.isDistributedRequired()) {
        throw new AppError(
          `CRITICAL: Failed to connect to Redis in multi-instance/production mode (fail-closed): ${
            err instanceof Error ? err.message : String(err)
          }`,
          503,
          'REDIS_UNAVAILABLE'
        );
      }
      logger.warn('[ChatRedis] Redis connection failed; falling back to in-memory mode for development only', {
        metadata: { message: err instanceof Error ? err.message : String(err) },
      });
      return null;
    }
  }

  /**
   * Performs an active health check PING against Redis.
   * Returns true if Redis responds with PONG, false otherwise.
   */
  public async ping(): Promise<boolean> {
    try {
      const client = await this.getClient();
      if (!client) return false;
      const res = await client.ping();
      return res === 'PONG';
    } catch {
      return false;
    }
  }

  /**
   * Atomically checks and records an event against a sliding-window rate limit.
   * Uses Redis Lua script when Redis is available.
   *
   * @param key Fully scoped Redis key, e.g. "connectly:rl:chat:<meetingId>:<userId>"
   * @param windowMs Window duration in milliseconds (e.g. 5000 for chat, 3000 for reactions)
   * @param maxEvents Maximum allowed events in that sliding window (e.g. 10 for chat, 5 for reactions)
   * @returns true if allowed; false if rate limit exceeded.
   */
  public async checkRateLimit(
    key: string,
    windowMs: number,
    maxEvents: number
  ): Promise<boolean> {
    const client = await this.getClient();

    if (client) {
      const now = Date.now();
      const ttlSec = Math.max(Math.ceil(windowMs / 1000) * 2, 10);
      const member = `${now}:${crypto.randomUUID()}`;

      try {
        const result = await client.eval(
          SLIDING_WINDOW_LUA,
          1,
          key,
          now.toString(),
          windowMs.toString(),
          maxEvents.toString(),
          ttlSec.toString(),
          member
        );
        return result === 1;
      } catch (err) {
        if (this.isDistributedRequired()) {
          logger.error('[ChatRedis] Distributed rate limit check failed in production mode (fail-closed)', {
            metadata: { error: err instanceof Error ? err.message : String(err), key },
          });
          throw new AppError(
            'Distributed rate-limiting service unavailable (fail-closed).',
            503,
            'RATE_LIMIT_SERVICE_UNAVAILABLE'
          );
        }
        logger.warn('[ChatRedis] Redis rate limit eval error, using local fallback in non-production mode', {
          metadata: { error: err instanceof Error ? err.message : String(err) },
        });
        return this.checkInMemoryRateLimit(key, windowMs, maxEvents);
      }
    }

    if (this.isDistributedRequired()) {
      throw new AppError(
        'Distributed rate-limiting service unavailable (fail-closed in production).',
        503,
        'RATE_LIMIT_SERVICE_UNAVAILABLE'
      );
    }

    return this.checkInMemoryRateLimit(key, windowMs, maxEvents);
  }

  /**
   * In-memory sliding-window fallback strictly for local development and non-distributed unit tests.
   * Auto-prunes expired keys to prevent unbounded memory leaks.
   */
  private checkInMemoryRateLimit(
    key: string,
    windowMs: number,
    maxEvents: number
  ): boolean {
    const now = Date.now();

    // Auto-prune stale keys older than 2x window duration across the map
    for (const [k, entry] of this.inMemoryRateLimits.entries()) {
      if (now - entry.lastUpdated > windowMs * 2) {
        this.inMemoryRateLimits.delete(k);
      }
    }

    const entry = this.inMemoryRateLimits.get(key);
    const existing = entry ? entry.timestamps.filter((t) => now - t < windowMs) : [];

    if (existing.length >= maxEvents) {
      this.inMemoryRateLimits.set(key, { timestamps: existing, lastUpdated: now });
      return false;
    }

    existing.push(now);
    this.inMemoryRateLimits.set(key, { timestamps: existing, lastUpdated: now });
    return true;
  }

  /**
   * DEF-12-01: Atomically acquires an ownership-safe reaction idempotency reservation.
   *
   * @param meetingId Canonical meeting identifier
   * @param userId Authenticated user identifier
   * @param clientReactionId Client-provided reaction ID
   * @param reservationToken Unique token identifying this specific in-flight attempt
   * @param ttlSeconds Reservation TTL in seconds (default 30s)
   * @returns 'acquired' if the reservation was successfully locked by this attempt;
   *          'completed' if the reaction was already successfully delivered previously;
   *          'in_progress' if another concurrent request currently holds the reservation.
   */
  public async acquireReactionReservation(
    meetingId: string,
    userId: string,
    clientReactionId: string,
    reservationToken: string,
    ttlSeconds = 30
  ): Promise<'acquired' | 'completed' | 'in_progress'> {
    const key = `connectly:idemp:rx:${meetingId}:${userId}:${clientReactionId}`;
    const client = await this.getClient();

    if (client) {
      try {
        const res = await client.eval(
          RESERVE_REACTION_LUA,
          1,
          key,
          reservationToken,
          ttlSeconds.toString()
        );
        if (res === 'acquired' || res === 'completed' || res === 'in_progress') {
          return res;
        }
        return 'in_progress';
      } catch (err) {
        if (this.isDistributedRequired()) {
          logger.error(
            '[ChatRedis] Reaction idempotency reservation failed in production mode (fail-closed)',
            {
              metadata: { error: err instanceof Error ? err.message : String(err), key },
            }
          );
          throw new AppError(
            'Reaction idempotency service unavailable (fail-closed).',
            503,
            'REACTION_SERVICE_UNAVAILABLE'
          );
        }
        logger.warn(
          '[ChatRedis] Redis reservation EVAL error, falling back to local memory in non-production mode',
          {
            metadata: { error: err instanceof Error ? err.message : String(err) },
          }
        );
        return this.acquireInMemoryReactionReservation(key, reservationToken, ttlSeconds);
      }
    }

    if (this.isDistributedRequired()) {
      throw new AppError(
        'Reaction idempotency service unavailable (fail-closed in production).',
        503,
        'REACTION_SERVICE_UNAVAILABLE'
      );
    }

    return this.acquireInMemoryReactionReservation(key, reservationToken, ttlSeconds);
  }

  /**
   * DEF-12-01: Ownership-safe release using atomic compare-and-delete.
   * Only deletes the reservation if the key still contains the matching reservationToken.
   *
   * @param meetingId Canonical meeting identifier
   * @param userId Authenticated user identifier
   * @param clientReactionId Client-provided reaction ID
   * @param reservationToken The reservation token that acquired the lock
   * @returns true if released; false if token mismatched or key expired/completed.
   */
  public async releaseReactionReservation(
    meetingId: string,
    userId: string,
    clientReactionId: string,
    reservationToken: string
  ): Promise<boolean> {
    const key = `connectly:idemp:rx:${meetingId}:${userId}:${clientReactionId}`;
    const client = await this.getClient();

    if (client) {
      try {
        const res = await client.eval(RELEASE_REACTION_LUA, 1, key, reservationToken);
        return res === 1;
      } catch (err) {
        if (this.isDistributedRequired()) {
          logger.error(
            '[ChatRedis] Reaction reservation release failed in production mode',
            {
              metadata: { error: err instanceof Error ? err.message : String(err), key },
            }
          );
          return false;
        }
        return this.releaseInMemoryReactionReservation(key, reservationToken);
      }
    }

    return this.releaseInMemoryReactionReservation(key, reservationToken);
  }

  /**
   * DEF-12-01: Ownership-safe transition of reservation to completed status.
   *
   * @param meetingId Canonical meeting identifier
   * @param userId Authenticated user identifier
   * @param clientReactionId Client-provided reaction ID
   * @param reservationToken The reservation token that acquired the lock
   * @param ttlSeconds TTL for retention of completed status (default 30s)
   * @returns true if marked completed; false if mismatched or expired.
   */
  public async markReactionCompleted(
    meetingId: string,
    userId: string,
    clientReactionId: string,
    reservationToken: string,
    ttlSeconds = 30
  ): Promise<boolean> {
    const key = `connectly:idemp:rx:${meetingId}:${userId}:${clientReactionId}`;
    const client = await this.getClient();

    if (client) {
      try {
        const res = await client.eval(
          COMPLETE_REACTION_LUA,
          1,
          key,
          reservationToken,
          ttlSeconds.toString()
        );
        return res === 1;
      } catch (err) {
        if (this.isDistributedRequired()) {
          logger.error(
            '[ChatRedis] Reaction completion marking failed in production mode (fail-closed)',
            {
              metadata: { error: err instanceof Error ? err.message : String(err), key },
            }
          );
          throw new AppError(
            'Reaction idempotency service unavailable (fail-closed).',
            503,
            'REACTION_SERVICE_UNAVAILABLE'
          );
        }
        return this.markInMemoryReactionCompleted(key, reservationToken, ttlSeconds);
      }
    }

    if (this.isDistributedRequired()) {
      throw new AppError(
        'Reaction idempotency service unavailable (fail-closed in production).',
        503,
        'REACTION_SERVICE_UNAVAILABLE'
      );
    }

    return this.markInMemoryReactionCompleted(key, reservationToken, ttlSeconds);
  }

  /**
   * Backwards-compatible alias for acquiring reaction idempotency.
   */
  public async acquireReactionIdempotency(
    meetingId: string,
    userId: string,
    clientReactionId: string,
    ttlSeconds = 30
  ): Promise<boolean> {
    const reservationToken = crypto.randomUUID();
    const status = await this.acquireReactionReservation(
      meetingId,
      userId,
      clientReactionId,
      reservationToken,
      ttlSeconds
    );
    return status === 'acquired';
  }

  /**
   * In-memory reaction reservation fallback strictly for local dev/testing without Redis.
   * Auto-prunes expired keys to prevent memory leaks.
   */
  private acquireInMemoryReactionReservation(
    key: string,
    reservationToken: string,
    ttlSeconds: number
  ): 'acquired' | 'completed' | 'in_progress' {
    const now = Date.now();

    // Auto-prune expired keys
    for (const [k, entry] of this.inMemoryIdempotency.entries()) {
      if (entry.expiresAt <= now) {
        this.inMemoryIdempotency.delete(k);
      }
    }

    const existing = this.inMemoryIdempotency.get(key);
    if (existing && existing.expiresAt > now) {
      if (existing.status === 'completed') {
        return 'completed';
      }
      return 'in_progress';
    }

    this.inMemoryIdempotency.set(key, {
      status: 'reserved',
      reservationToken,
      expiresAt: now + ttlSeconds * 1000,
    });
    return 'acquired';
  }

  /**
   * In-memory ownership-safe release fallback.
   */
  private releaseInMemoryReactionReservation(key: string, reservationToken: string): boolean {
    const now = Date.now();
    const existing = this.inMemoryIdempotency.get(key);
    if (
      existing &&
      existing.expiresAt > now &&
      existing.reservationToken === reservationToken &&
      existing.status === 'reserved'
    ) {
      this.inMemoryIdempotency.delete(key);
      return true;
    }
    return false;
  }

  /**
   * In-memory mark completed fallback.
   */
  private markInMemoryReactionCompleted(
    key: string,
    reservationToken: string,
    ttlSeconds: number
  ): boolean {
    const now = Date.now();
    const existing = this.inMemoryIdempotency.get(key);
    if (
      existing &&
      existing.expiresAt > now &&
      (existing.reservationToken === reservationToken || existing.status === 'completed')
    ) {
      this.inMemoryIdempotency.set(key, {
        status: 'completed',
        reservationToken,
        expiresAt: now + ttlSeconds * 1000,
      });
      return true;
    }
    return false;
  }

  /**
   * Resets all in-memory rate limit and idempotency states (for testing).
   */
  public clearLocalState(): void {
    this.inMemoryRateLimits.clear();
    this.inMemoryIdempotency.clear();
  }

  /**
   * Clears in-memory state and deletes test rate-limit / idempotency keys from Redis.
   * Strictly no-ops against Redis outside NODE_ENV=test.
   */
  public async clearTestState(): Promise<void> {
    this.clearLocalState();
    if (env.NODE_ENV !== 'test') {
      return;
    }

    const client = await this.getClient();
    if (!client) {
      return;
    }

    for (const pattern of ['connectly:rl:*', 'connectly:idemp:*']) {
      let cursor = '0';
      do {
        const [nextCursor, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
        cursor = nextCursor;
        if (keys.length > 0) {
          await client.del(...keys);
        }
      } while (cursor !== '0');
    }
  }

  /**
   * Closes the managed Redis connection if owned.
   */
  public async close(): Promise<void> {
    this.clearLocalState();
    if (this.connectPromise) {
      await this.connectPromise.catch(() => null);
    }
    if (this.redisClient && !this.isExternalClient) {
      await this.redisClient.quit().catch(() => {});
      this.redisClient.disconnect();
      this.redisClient = null;
    }
  }
}

export const chatRedisService = new ChatRedisService();
