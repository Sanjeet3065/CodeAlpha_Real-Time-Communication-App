import { z } from 'zod';
import { validateRedisUrl } from '../utils/redisUrl.js';
import { validateTrustProxySetting, validateProxySecret } from './proxy.js';
import { validateEncryptionKey, validateJwtSecret } from './secretValidation.js';

export const envSchema = z
  .object({
    PORT: z.coerce.number().default(5000),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    DB_PROVIDER: z.enum(['auto', 'supabase', 'mongo']).default('auto'),
    SUPABASE_URL: z.string().trim().optional().default(''),
    SUPABASE_ANON_KEY: z.string().trim().optional().default(''),
    SUPABASE_SERVICE_ROLE_KEY: z.string().trim().optional().default(''),
    MONGODB_URI: z.string().default('mongodb://127.0.0.1:27017/connectly'),
    JWT_ACCESS_SECRET: z
      .string()
      .min(16)
      .default('connectly_dev_access_secret_super_secure_key_32_bytes_min_length'),
    JWT_REFRESH_SECRET: z
      .string()
      .min(16)
      .default('connectly_dev_refresh_secret_super_secure_key_32_bytes_min_length'),
    CLIENT_ORIGIN: z.string().default('http://localhost:5173'),
    ARGON2_MEMORY_COST: z.coerce.number().default(65536),
    ARGON2_TIME_COST: z.coerce.number().default(3),
    ARGON2_PARALLELISM: z.coerce.number().default(1),
    LIVEKIT_URL: z.string().trim().optional().default(''),
    LIVEKIT_PUBLIC_URL: z.string().trim().optional().default(''),
    LIVEKIT_SIGNAL_GATEWAY_ENABLED: z.enum(['auto', 'true', 'false']).default('auto'),
    LIVEKIT_API_KEY: z.string().trim().optional().default(''),
    LIVEKIT_API_SECRET: z.string().trim().optional().default(''),
    LIVEKIT_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(600),
    SOCKET_IO_ADAPTER: z.enum(['auto', 'redis', 'mongo', 'memory']).default('auto'),
    SOCKET_IO_MULTI_INSTANCE: z.enum(['auto', 'true', 'false']).default('auto'),
    REDIS_URL: z.string().trim().optional().default(''),
    REDIS_SOCKET_PREFIX: z.string().trim().min(1).default('connectly:socketio'),
    SOCKET_IO_MONGO_COLLECTION: z.string().trim().min(1).default('socket_io_adapter_events'),
    ENABLE_FILE_SHARING: z
      .union([z.boolean(), z.enum(['true', 'false'])])
      .default('true')
      .transform((val) => val === true || val === 'true'),
    STORAGE_PROVIDER: z.enum(['auto', 'supabase', 's3', 'local', 'memory', 'disabled']).default('auto'),
    SUPABASE_STORAGE_BUCKET: z.string().trim().min(1).default('connectly-files'),
    STORAGE_S3_ENDPOINT: z.string().trim().optional().default(''),
    STORAGE_S3_REGION: z.string().trim().default('us-east-1'),
    STORAGE_S3_BUCKET: z.string().trim().default('connectly-files'),
    STORAGE_S3_ACCESS_KEY_ID: z.string().trim().optional().default(''),
    STORAGE_S3_SECRET_ACCESS_KEY: z.string().trim().optional().default(''),
    STORAGE_S3_FORCE_PATH_STYLE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((val) => val === 'true'),
    STORAGE_LOCAL_DIR: z.string().trim().default('uploads'),
    STORAGE_MAX_FILE_SIZE_BYTES: z.coerce.number().int().positive().default(26214400), // 25 MB
    STORAGE_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(86400).default(900), // 15 mins
    CONNECTLY_ENCRYPTION_KEY_V1: z.string().trim().optional().default(''),
    REQUIRE_TRANSACTIONS: z
      .enum(['true', 'false', 'auto'])
      .default('auto'),
    TRUST_PROXY: z
      .string()
      .trim()
      .default('loopback')
      .superRefine((val, ctx) => {
        const result = validateTrustProxySetting(val);
        if (!result.valid) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: result.error || 'Invalid TRUST_PROXY configuration.',
          });
        }
      }),
    PROXY_SECRET: z
      .string()
      .trim()
      .optional(),
    ORIGIN_AUTH_MODE: z.enum(['proxy', 'direct']).default('proxy'),
    COOKIE_SAME_SITE: z.enum(['auto', 'lax', 'none']).default('auto'),
  })
  .refine(
    (data) => {
      if (data.NODE_ENV === 'production') {
        if (!data.LIVEKIT_URL || !data.LIVEKIT_API_KEY || !data.LIVEKIT_API_SECRET) {
          return false;
        }
        let parsed: URL;
        try {
          parsed = new URL(data.LIVEKIT_URL);
        } catch {
          return false;
        }
        const hostLower = parsed.hostname.toLowerCase();
        const isLiveKitCloud = hostLower.endsWith('.livekit.cloud');
        const isLoopback = hostLower === '127.0.0.1' || hostLower === 'localhost' || hostLower === '::1';

        // Self-hosted production MUST NOT silently bypass the Signaling Admission Gateway
        if (!isLiveKitCloud && data.LIVEKIT_SIGNAL_GATEWAY_ENABLED === 'false') {
          return false;
        }

        if (data.LIVEKIT_PUBLIC_URL) {
          try {
            const pubParsed = new URL(data.LIVEKIT_PUBLIC_URL);
            if (pubParsed.protocol !== 'wss:' && pubParsed.protocol !== 'https:') {
              return false;
            }
          } catch {
            return false;
          }
          // When a TLS LIVEKIT_PUBLIC_URL gateway is configured, internal LIVEKIT_URL may be wss/https or private loopback ws/http
          const allowedInternal = isLoopback
            ? ['ws:', 'wss:', 'http:', 'https:']
            : ['wss:', 'https:'];
          if (!allowedInternal.includes(parsed.protocol)) {
            return false;
          }
        } else if (parsed.protocol !== 'wss:' && parsed.protocol !== 'https:') {
          return false;
        }
        const placeholders = ['replace_with_', 'your_livekit_', 'devkey', 'secret'];
        const keyLower = data.LIVEKIT_API_KEY.toLowerCase();
        const secretLower = data.LIVEKIT_API_SECRET.toLowerCase();
        if (
          placeholders.some((p) => keyLower === p || keyLower.startsWith(p) || secretLower === p || secretLower.startsWith(p))
        ) {
          return false;
        }
      } else {
        for (const candidate of [data.LIVEKIT_URL, data.LIVEKIT_PUBLIC_URL]) {
          if (!candidate) continue;
          try {
            const parsed = new URL(candidate);
            if (!['ws:', 'wss:', 'http:', 'https:'].includes(parsed.protocol)) {
              return false;
            }
          } catch {
            return false;
          }
        }
      }
      return true;
    },
    {
      message:
        'CRITICAL: Invalid LiveKit configuration. Production requires non-placeholder LIVEKIT_API_KEY, LIVEKIT_API_SECRET, and a secure wss:// or https:// LIVEKIT_URL.',
    }
  )
  .superRefine((data, ctx) => {
    // JWT secrets validation (strict entropy, non-placeholder, and >=32 chars in production)
    if (data.NODE_ENV === 'production') {
      const accessCheck = validateJwtSecret(data.JWT_ACCESS_SECRET, 'JWT_ACCESS_SECRET', true);
      if (!accessCheck.valid) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_ACCESS_SECRET'],
          message: `CRITICAL: Production deployment requires cryptographically secure JWT_ACCESS_SECRET (${accessCheck.reason})`,
        });
      }
      const refreshCheck = validateJwtSecret(data.JWT_REFRESH_SECRET, 'JWT_REFRESH_SECRET', true);
      if (!refreshCheck.valid) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_REFRESH_SECRET'],
          message: `CRITICAL: Production deployment requires cryptographically secure JWT_REFRESH_SECRET (${refreshCheck.reason})`,
        });
      }
    }

    const clientOrigin = data.CLIENT_ORIGIN.trim();
    let parsedClientOrigin: URL | null = null;
    if (!clientOrigin || clientOrigin === '*') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CLIENT_ORIGIN'],
        message: 'CRITICAL: CLIENT_ORIGIN must be an explicit trusted origin (wildcard * is prohibited).',
      });
    } else {
      try {
        parsedClientOrigin = new URL(clientOrigin);
        if (parsedClientOrigin.protocol !== 'http:' && parsedClientOrigin.protocol !== 'https:') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['CLIENT_ORIGIN'],
            message: 'CRITICAL: CLIENT_ORIGIN must use http:// or https:// scheme.',
          });
        } else if (data.NODE_ENV === 'production' && parsedClientOrigin.protocol !== 'https:') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['CLIENT_ORIGIN'],
            message: 'CRITICAL: Production CLIENT_ORIGIN must use https:// scheme.',
          });
        }
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['CLIENT_ORIGIN'],
          message: 'CRITICAL: CLIENT_ORIGIN is not a valid URL.',
        });
      }
    }

    const multiInstance =
      data.SOCKET_IO_MULTI_INSTANCE === 'true' ||
      (data.SOCKET_IO_MULTI_INSTANCE === 'auto' && data.NODE_ENV === 'production');

    if (data.SOCKET_IO_ADAPTER === 'redis' && !data.REDIS_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['REDIS_URL'],
        message: 'CRITICAL: SOCKET_IO_ADAPTER=redis requires REDIS_URL (redis:// or rediss://).',
      });
    }

    if (data.REDIS_URL) {
      try {
        validateRedisUrl(data.REDIS_URL, data.NODE_ENV);
      } catch (err) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['REDIS_URL'],
          message: err instanceof Error ? err.message : 'CRITICAL: Invalid REDIS_URL.',
        });
      }
    }

    if (multiInstance) {
      if (data.SOCKET_IO_ADAPTER === 'memory') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SOCKET_IO_ADAPTER'],
          message:
            'CRITICAL: Multi-instance / production Socket.IO requires a shared adapter (configure REDIS_URL with SOCKET_IO_ADAPTER=redis|auto, or SOCKET_IO_ADAPTER=mongo). In-memory adapter is prohibited in multi-instance/production mode.',
        });
      } else if (data.SOCKET_IO_ADAPTER === 'auto' && !data.REDIS_URL) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SOCKET_IO_ADAPTER'],
          message:
            'CRITICAL: Multi-instance / production Socket.IO requires a shared adapter (configure REDIS_URL with SOCKET_IO_ADAPTER=redis|auto, or SOCKET_IO_ADAPTER=mongo). In-memory adapter is prohibited in multi-instance/production mode.',
        });
      }
    }

    const wantsSupabaseDb =
      data.DB_PROVIDER === 'supabase' ||
      (data.DB_PROVIDER === 'auto' && Boolean(data.SUPABASE_URL.trim()));

    // Phase 18 — File Sharing Feature Gate Validation
    if (data.ENABLE_FILE_SHARING && data.STORAGE_PROVIDER === 'disabled') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['STORAGE_PROVIDER'],
        message:
          'CRITICAL: STORAGE_PROVIDER=disabled is permitted only when ENABLE_FILE_SHARING=false. File sharing cannot be enabled without an active storage provider.',
      });
    }

    // Phase 13 & 18 — Storage Provider & Database Validation
    if (data.NODE_ENV === 'production') {
      if (data.DB_PROVIDER === 'supabase') {
        if (!data.SUPABASE_URL.trim()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['SUPABASE_URL'],
            message: 'CRITICAL: DB_PROVIDER=supabase requires a valid SUPABASE_URL in production.',
          });
        }
        if (!data.SUPABASE_SERVICE_ROLE_KEY.trim() && !data.SUPABASE_ANON_KEY.trim()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['SUPABASE_SERVICE_ROLE_KEY'],
            message:
              'CRITICAL: DB_PROVIDER=supabase requires SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY) in production.',
          });
        }
      }

      if (data.STORAGE_PROVIDER === 'disabled') {
        if (data.ENABLE_FILE_SHARING) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['STORAGE_PROVIDER'],
            message:
              'CRITICAL: STORAGE_PROVIDER=disabled requires ENABLE_FILE_SHARING=false in production.',
          });
        }
      } else if (data.STORAGE_PROVIDER === 'local') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['STORAGE_PROVIDER'],
          message:
            'CRITICAL: Local disk storage (STORAGE_PROVIDER=local) is prohibited in production. Configure STORAGE_PROVIDER=supabase, STORAGE_PROVIDER=s3, or STORAGE_PROVIDER=disabled with ENABLE_FILE_SHARING=false.',
        });
      } else if (data.STORAGE_PROVIDER === 'memory') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['STORAGE_PROVIDER'],
          message:
            'CRITICAL: In-memory storage (STORAGE_PROVIDER=memory) is prohibited in production. Configure STORAGE_PROVIDER=supabase, STORAGE_PROVIDER=s3, or STORAGE_PROVIDER=disabled with ENABLE_FILE_SHARING=false.',
        });
      } else if (
        data.STORAGE_PROVIDER === 'supabase' ||
        (data.STORAGE_PROVIDER === 'auto' &&
          data.ENABLE_FILE_SHARING &&
          wantsSupabaseDb &&
          !data.STORAGE_S3_ACCESS_KEY_ID &&
          !data.STORAGE_S3_ENDPOINT)
      ) {
        if (!data.SUPABASE_URL.trim() || (!data.SUPABASE_SERVICE_ROLE_KEY.trim() && !data.SUPABASE_ANON_KEY.trim())) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['SUPABASE_URL'],
            message:
              'CRITICAL: Supabase Storage requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in production.',
          });
        }
      } else if (
        data.STORAGE_PROVIDER === 's3' ||
        (data.STORAGE_PROVIDER === 'auto' && data.ENABLE_FILE_SHARING)
      ) {
        if (!data.STORAGE_S3_BUCKET || data.STORAGE_S3_BUCKET.includes('replace_with')) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['STORAGE_S3_BUCKET'],
            message: 'CRITICAL: Production S3 storage requires a valid STORAGE_S3_BUCKET.',
          });
        }
      }

      // Phase 15 — Application Envelope Encryption Key Validation (aligned with keyManager.assertValid())
      const encResult = validateEncryptionKey(data.CONNECTLY_ENCRYPTION_KEY_V1, {
        required: true,
        allowDevDefault: false,
      });
      if (!encResult.valid) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['CONNECTLY_ENCRYPTION_KEY_V1'],
          message: `CRITICAL: Production deployment requires a cryptographically secure 256-bit CONNECTLY_ENCRYPTION_KEY_V1 (${encResult.reason})`,
        });
      }

      // Phase 18 Sprint 06H — Production Transaction Enforcement (MongoDB mode only; Supabase PostgreSQL supports ACID natively)
      if (!wantsSupabaseDb && data.REQUIRE_TRANSACTIONS === 'false') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['REQUIRE_TRANSACTIONS'],
          message:
            'CRITICAL: Setting REQUIRE_TRANSACTIONS=false is strictly prohibited in production. Production deployment requires a MongoDB Replica Set supporting multi-document transactions.',
        });
      }

      // Phase 18 Sprint 06T: Mandatory 64-hex non-placeholder PROXY_SECRET in production proxy mode.
      // When ORIGIN_AUTH_MODE='direct' (split-origin Vercel + Render deployment), PROXY_SECRET is optional unless supplied.
      const requireProxySecret = data.ORIGIN_AUTH_MODE !== 'direct';
      if (requireProxySecret || data.PROXY_SECRET) {
        const proxySecretResult = validateProxySecret(data.PROXY_SECRET, requireProxySecret);
        if (!proxySecretResult.valid) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['PROXY_SECRET'],
            message: proxySecretResult.error!,
          });
        }
      }
    } else if (data.PROXY_SECRET) {
      // Non-production environment: if PROXY_SECRET is explicitly configured, enforce format and placeholder checks
      const proxySecretResult = validateProxySecret(data.PROXY_SECRET, false);
      if (!proxySecretResult.valid) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['PROXY_SECRET'],
          message: proxySecretResult.error!,
        });
      }
    }
  });
