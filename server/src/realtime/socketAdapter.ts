import type { Server as SocketIOServer } from 'socket.io';
import { createAdapter as createRedisAdapter } from '@socket.io/redis-adapter';
import { createAdapter as createMongoAdapter } from '@socket.io/mongo-adapter';
import { Redis } from 'ioredis';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { isReplicaSetTransactionsSupported } from '../models/LiveKitRevocationEvent.model.js';
import { logger } from '../utils/logger.js';
import { validateRedisUrl } from '../utils/redisUrl.js';

export type SocketIoAdapterMode = 'redis' | 'mongo' | 'memory';
export type SocketIoAdapterSetting = 'auto' | SocketIoAdapterMode;
export type SocketIoMultiInstanceSetting = 'auto' | 'true' | 'false';

export interface SocketIoAdapterConfigInput {
  nodeEnv: 'development' | 'production' | 'test';
  adapterSetting: SocketIoAdapterSetting;
  multiInstanceSetting: SocketIoMultiInstanceSetting;
  redisUrl?: string;
  redisPrefix?: string;
  mongoCollection?: string;
}

export interface ResolvedSocketIoAdapterConfig {
  mode: SocketIoAdapterMode;
  multiInstanceRequired: boolean;
  redisUrl: string;
  redisPrefix: string;
  mongoCollection: string;
}

export interface AttachedSocketIoAdapter {
  mode: SocketIoAdapterMode;
  cleanup: () => Promise<void>;
}

/**
 * Pure, fail-closed policy resolver for Socket.IO cross-instance adapters.
 *
 * Rules:
 * - Production (`NODE_ENV=production`) or `SOCKET_IO_MULTI_INSTANCE=true` REQUIRES a shared
 *   adapter (`redis` preferred, or explicit `mongo`). It NEVER silently falls back to `memory`.
 * - `SOCKET_IO_ADAPTER=redis` ALWAYS requires a valid `redis://` or `rediss://` `REDIS_URL`.
 *   In production (`NODE_ENV=production`), non-loopback Redis endpoints MUST use TLS (`rediss://`);
 *   plaintext `redis://` is permitted in production ONLY for explicitly recognized loopback hosts
 *   (`127.0.0.1`, `localhost`, `::1`, `[::1]`).
 * - `SOCKET_IO_ADAPTER=auto` selects `redis` whenever `REDIS_URL` is configured; otherwise in
 *   multi-instance/production mode it fails closed (throws), and in single-instance dev/test mode
 *   it selects `memory`.
 */
export function resolveSocketIoAdapterConfig(
  input: SocketIoAdapterConfigInput
): ResolvedSocketIoAdapterConfig {
  const multiInstanceRequired =
    input.multiInstanceSetting === 'true' ||
    (input.multiInstanceSetting === 'auto' && input.nodeEnv === 'production');
  const redisUrl = (input.redisUrl || '').trim();
  const redisPrefix = (input.redisPrefix || 'connectly:socketio').trim() || 'connectly:socketio';
  const mongoCollection =
    (input.mongoCollection || 'socket_io_adapter_events').trim() || 'socket_io_adapter_events';

  let mode: SocketIoAdapterMode;
  if (input.adapterSetting === 'auto') {
    if (redisUrl) {
      mode = 'redis';
    } else if (multiInstanceRequired) {
      throw new Error(
        'CRITICAL: Multi-instance/production Socket.IO requires a shared adapter. Configure REDIS_URL (with SOCKET_IO_ADAPTER=redis or auto) or explicitly configure SOCKET_IO_ADAPTER=mongo. Refusing to start with in-memory adapter.'
      );
    } else {
      mode = 'memory';
    }
  } else {
    mode = input.adapterSetting;
  }

  if (mode === 'memory' && multiInstanceRequired) {
    throw new Error(
      'CRITICAL: In-memory Socket.IO adapter is prohibited when NODE_ENV=production or SOCKET_IO_MULTI_INSTANCE=true. Configure REDIS_URL (SOCKET_IO_ADAPTER=redis) or SOCKET_IO_ADAPTER=mongo.'
    );
  }

  if (mode === 'redis') {
    if (!redisUrl) {
      throw new Error(
        'CRITICAL: SOCKET_IO_ADAPTER=redis requires REDIS_URL (redis:// or rediss://).'
      );
    }
    validateRedisUrl(redisUrl, input.nodeEnv);
  } else if (redisUrl) {
    // Also validate any explicitly provided REDIS_URL even if mongo/memory adapter is selected
    validateRedisUrl(redisUrl, input.nodeEnv);
  }

  return {
    mode,
    multiInstanceRequired,
    redisUrl,
    redisPrefix,
    mongoCollection,
  };
}

/**
 * Attaches the configured shared Socket.IO adapter (`redis` or `mongo`) to `io`,
 * failing closed on connection or initialization error (never silently downgrading to memory).
 */
export async function attachSharedSocketIoAdapter(
  io: SocketIOServer,
  override?: Partial<SocketIoAdapterConfigInput>
): Promise<AttachedSocketIoAdapter> {
  const resolved = resolveSocketIoAdapterConfig({
    nodeEnv: override?.nodeEnv ?? env.NODE_ENV,
    adapterSetting: override?.adapterSetting ?? env.SOCKET_IO_ADAPTER,
    multiInstanceSetting: override?.multiInstanceSetting ?? env.SOCKET_IO_MULTI_INSTANCE,
    redisUrl: override?.redisUrl ?? env.REDIS_URL,
    redisPrefix: override?.redisPrefix ?? env.REDIS_SOCKET_PREFIX,
    mongoCollection: override?.mongoCollection ?? env.SOCKET_IO_MONGO_COLLECTION,
  });

  if (resolved.mode === 'memory') {
    logger.warn(
      '[SocketAdapter] Running single-instance in-memory Socket.IO adapter (non-production only).'
    );
    return {
      mode: 'memory',
      cleanup: async () => {},
    };
  }

  if (resolved.mode === 'redis') {
    const pubClient = new Redis(resolved.redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      connectTimeout: 5_000,
      enableReadyCheck: true,
    });
    const subClient = pubClient.duplicate();

    const onRedisError = (clientRole: string) => (err: Error) => {
      logger.error(`[SocketAdapter] Redis ${clientRole} error`, {
        metadata: { message: err.message },
      });
    };
    pubClient.on('error', onRedisError('pubClient'));
    subClient.on('error', onRedisError('subClient'));

    try {
      await Promise.all([pubClient.connect(), subClient.connect()]);
      const pong = await pubClient.ping();
      if (pong !== 'PONG') {
        throw new Error(`Unexpected Redis PING response: ${String(pong)}`);
      }
      io.adapter(
        createRedisAdapter(pubClient, subClient, {
          key: resolved.redisPrefix,
          requestsTimeout: 5_000,
        })
      );
      logger.info('[SocketAdapter] Attached shared Redis Socket.IO adapter', {
        metadata: { prefix: resolved.redisPrefix },
      });
    } catch (err) {
      await Promise.allSettled([pubClient.quit(), subClient.quit()]);
      pubClient.disconnect();
      subClient.disconnect();
      throw new Error(
        `CRITICAL: Failed to initialize Redis Socket.IO adapter (fail-closed): ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }

    return {
      mode: 'redis',
      cleanup: async () => {
        await Promise.allSettled([pubClient.quit(), subClient.quit()]);
        pubClient.disconnect();
        subClient.disconnect();
      },
    };
  }

  // `resolved.mode === 'mongo'` — official @socket.io/mongo-adapter requires a MongoDB Replica Set
  // (because it relies on MongoDB Change Streams via collection.watch()). Fail closed on standalone.
  const db = mongoose.connection.db;
  if (!db || mongoose.connection.readyState !== 1) {
    throw new Error(
      'CRITICAL: Failed to initialize MongoDB Socket.IO adapter: Mongoose connection is not ready.'
    );
  }
  const rsSupported = await isReplicaSetTransactionsSupported(true);
  if (!rsSupported) {
    throw new Error(
      'CRITICAL: SOCKET_IO_ADAPTER=mongo requires a MongoDB Replica Set (Change Streams are unavailable on standalone MongoDB). Fail-closed.'
    );
  }

  const collectionName = resolved.mongoCollection;
  const existingCols = await db.listCollections({ name: collectionName }).toArray();
  if (existingCols.length === 0) {
    try {
      await db.createCollection(collectionName, {
        capped: true,
        size: 16 * 1024 * 1024, // 16 MB capped ring buffer for real-time cluster pub/sub
      });
    } catch (err: any) {
      if (err?.code !== 48 && err?.codeName !== 'NamespaceExists') {
        throw new Error(
          `CRITICAL: Failed to create capped collection '${collectionName}' for MongoDB Socket.IO adapter: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }
  } else {
    const info = existingCols[0] as { options?: { capped?: boolean } };
    if (!info?.options?.capped) {
      throw new Error(
        `CRITICAL: Collection '${collectionName}' exists but is NOT capped; @socket.io/mongo-adapter requires a capped collection.`
      );
    }
  }

  const mongoCollection = db.collection(collectionName);
  io.adapter(
    createMongoAdapter(mongoCollection as any, {
      addCreatedAtField: true,
      requestsTimeout: 5_000,
    })
  );
  logger.info('[SocketAdapter] Attached shared MongoDB Socket.IO adapter', {
    metadata: { collection: collectionName },
  });

  return {
    mode: 'mongo',
    cleanup: async () => {
      try {
        await (io.of('/').adapter as { close?: () => Promise<void> | void })?.close?.();
      } catch {
        // Ignore close errors during teardown
      }
    },
  };
}
