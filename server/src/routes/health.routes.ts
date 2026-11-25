import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { isDatabaseConnected, getDatabaseState } from '../config/database.js';
import { isReplicaSetTransactionsSupported } from '../models/LiveKitRevocationEvent.model.js';
import { env } from '../config/env.js';
import { createRateLimitMessage } from '../middlewares/rateLimiter.js';
import { chatRedisService } from '../services/chatRedis.service.js';

export const healthRouter = Router();

const REDIS_PING_CACHE_TTL_MS = 5_000;
const REDIS_PING_TIMEOUT_MS = 2_000;

let cachedRedisPing: { ok: boolean; checkedAt: number } | null = null;
let inFlightRedisPing: Promise<boolean> | null = null;

export function resetReadinessHealthCacheForTesting(): void {
  cachedRedisPing = null;
  inFlightRedisPing = null;
}

const readinessLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120, // generous for orchestrator probes while bounding flood abuse
  standardHeaders: true,
  legacyHeaders: false,
  message: createRateLimitMessage('Too many readiness check requests. Please slow down.'),
});

async function checkRedisWithBoundedCache(): Promise<boolean> {
  const now = Date.now();
  if (cachedRedisPing && now - cachedRedisPing.checkedAt < REDIS_PING_CACHE_TTL_MS) {
    return cachedRedisPing.ok;
  }

  if (inFlightRedisPing) {
    return inFlightRedisPing;
  }

  let timer: NodeJS.Timeout | null = null;
  inFlightRedisPing = Promise.race([
    chatRedisService.ping(),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), REDIS_PING_TIMEOUT_MS);
    }),
  ])
    .then((ok) => {
      cachedRedisPing = { ok, checkedAt: Date.now() };
      return ok;
    })
    .catch(() => {
      cachedRedisPing = { ok: false, checkedAt: Date.now() };
      return false;
    })
    .finally(() => {
      if (timer) clearTimeout(timer);
      inFlightRedisPing = null;
    });

  return inFlightRedisPing;
}

// Liveness probe: Confirms that the Express node process is alive (pure in-memory)
healthRouter.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    service: 'connectly-server',
    version: '0.1.0',
    timestamp: new Date().toISOString(),
  });
});

// Readiness probe: Confirms that required infrastructure is operational
// Protected with rate limiting, bounded timeout, and short-TTL single-flight Redis caching
healthRouter.get(['/ready', '/health/ready'], readinessLimiter, async (_req: Request, res: Response) => {
  const isConnected = isDatabaseConnected();
  const dbState = getDatabaseState();

  const checks: Record<string, any> = {
    database: {
      status: dbState.status,
      connected: isConnected,
    },
  };

  let isReady = isConnected;
  let failureReason: string | null = null;

  if (!isConnected) {
    isReady = false;
    failureReason = 'MongoDB is unavailable or still connecting. Service not ready to accept traffic.';
  } else {
    try {
      const txSupported = await isReplicaSetTransactionsSupported();
      checks.database.transactionsSupported = txSupported;
      if (env.NODE_ENV === 'production' && !txSupported) {
        isReady = false;
        failureReason = 'Production requires a MongoDB Replica Set supporting multi-document transactions.';
      }
    } catch {
      checks.database.transactionsSupported = false;
      if (env.NODE_ENV === 'production') {
        isReady = false;
        failureReason = 'Failed to verify MongoDB Replica Set transaction capability.';
      }
    }
  }

  // Redis check if configured or in production (bounded timeout & coalesced)
  if (env.REDIS_URL || env.NODE_ENV === 'production') {
    try {
      const redisOk = await checkRedisWithBoundedCache();
      checks.redis = { status: redisOk ? 'connected' : 'down' };
      if (!redisOk && (env.NODE_ENV === 'production' || env.SOCKET_IO_ADAPTER === 'redis')) {
        isReady = false;
        failureReason = failureReason || 'Redis is required in production/multi-instance but unavailable.';
      }
    } catch {
      checks.redis = { status: 'down' };
      if (env.NODE_ENV === 'production' || env.SOCKET_IO_ADAPTER === 'redis') {
        isReady = false;
        failureReason = failureReason || 'Redis connection check failed.';
      }
    }
  } else {
    checks.redis = { status: 'not_configured' };
  }

  // Storage check
  if (!env.ENABLE_FILE_SHARING || env.STORAGE_PROVIDER === 'disabled') {
    checks.storage = { status: 'disabled', fileSharing: false };
  } else {
    checks.storage = { status: env.STORAGE_PROVIDER, fileSharing: true };
  }

  if (isReady) {
    res.status(200).json({
      status: 'ready',
      database: dbState.status,
      checks,
      timestamp: new Date().toISOString(),
    });
  } else {
    res.status(503).json({
      status: 'down',
      database: dbState.status,
      message: failureReason || 'Service dependencies not ready.',
      checks,
      timestamp: new Date().toISOString(),
    });
  }
});
