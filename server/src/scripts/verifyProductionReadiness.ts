/**
 * CONNECTLY — Production Readiness Preflight Verification Script
 *
 * Verifies that all infrastructure, environment variables, security constraints,
 * database topology, Redis TLS, and SFU credentials satisfy CONNECTLY's production requirements.
 *
 * Note: Intentionally imports ONLY side-effect-free config/schema modules at top-level so
 * incomplete production environments generate structured preflight reports rather than
 * crashing at module import time.
 *
 * Modes:
 *   - development: Non-fatal warnings for missing external services; allows standalone MongoDB.
 *   - staging: Strict fail-closed verification; replica set required; LiveKit & Redis required.
 *   - production: Strict fail-closed verification; all production security gates enforced.
 *
 * CLI Usage:
 *   npm run verify:production --workspace=server -- --mode=development
 *   npm run verify:production --workspace=server -- --mode=staging
 *   npm run verify:production --workspace=server -- --mode=production
 */

import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { Redis } from 'ioredis';
import { RoomServiceClient } from 'livekit-server-sdk';
import { envSchema } from '../config/envSchema.js';
import { validateRedisUrl } from '../utils/redisUrl.js';
import { isReplicaSetTransactionsSupported } from '../models/LiveKitRevocationEvent.model.js';
import { toLiveKitHttpUrl, validateLiveKitConfig } from '../utils/livekitConfig.js';
import { validateProxySecret, validateTrustProxySetting } from '../config/proxy.js';
import { validateEncryptionKey, validateJwtSecret } from '../config/secretValidation.js';

export type ReadinessMode = 'development' | 'staging' | 'production';

export interface CheckResult {
  category: string;
  name: string;
  status: 'PASS' | 'FAIL' | 'WARN' | 'INFO';
  message: string;
  remediation?: string;
}

export interface RedisClientAdapter {
  connect: () => Promise<void>;
  ping: () => Promise<string>;
  eval: (script: string, numkeys: number, ...args: string[]) => Promise<unknown>;
  del: (key: string) => Promise<number>;
  disconnect: () => void;
  on?: (event: string, listener: (...args: unknown[]) => void) => unknown;
}

export interface RoomClientAdapter {
  listRooms: () => Promise<unknown>;
}

export interface StorageVerifierAdapter {
  verifyBucketVersioning: () => Promise<unknown>;
}

export interface PreflightOptions {
  mode?: ReadinessMode;
  env?: Record<string, string | undefined>;
  exitOnError?: boolean;
  quiet?: boolean;
  redisClientFactory?: (url: string) => RedisClientAdapter;
  roomClientFactory?: (url: string, key: string, secret: string) => RoomClientAdapter;
  storageVerifierFactory?: (config: {
    bucket: string;
    region: string;
    endpoint?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    forcePathStyle?: boolean;
  }) => StorageVerifierAdapter;
}

export interface PreflightReport {
  success: boolean;
  mode: ReadinessMode;
  results: CheckResult[];
  failures: CheckResult[];
  warnings: CheckResult[];
}

export interface ResolvedFileSharingConfig {
  enableFileSharing: boolean;
  configuredProvider: string;
  effectiveProvider: string;
}

/**
 * Resolves ENABLE_FILE_SHARING and STORAGE_PROVIDER with exact schema parity:
 * unset ENABLE_FILE_SHARING defaults to true (matching envSchema);
 * unset STORAGE_PROVIDER defaults to 'auto'.
 */
export function resolveFileSharingConfig(
  rawEnv: Record<string, string | undefined>,
  isStrict: boolean
): ResolvedFileSharingConfig {
  const rawEnable = rawEnv.ENABLE_FILE_SHARING;
  const enableFileSharing =
    rawEnable === undefined || rawEnable === ''
      ? true
      : String(rawEnable).trim().toLowerCase() === 'true';

  const configuredProvider = (rawEnv.STORAGE_PROVIDER || 'auto').trim().toLowerCase();

  let effectiveProvider: string;
  if (configuredProvider === 'auto') {
    effectiveProvider = !enableFileSharing ? 'disabled' : isStrict ? 's3' : 'local';
  } else {
    effectiveProvider = configuredProvider;
  }

  return {
    enableFileSharing,
    configuredProvider,
    effectiveProvider,
  };
}

/**
 * Strips password credentials, API keys, and auth tokens from error strings
 * before logging or recording check results.
 */
export function sanitizeSecrets(text: string): string {
  if (!text) return '';
  return text
    .replace(/:([^/@:\s]+)@/g, ':***@')
    .replace(/(default|user|username):([^\s,;@]+)/gi, '$1:***')
    .replace(/(api[-_]?key|secret|password|token)[=:]\s*["']?[^"'\s,]+["']?/gi, '$1=***');
}

/**
 * Resolves the operational readiness mode in order of precedence:
 * 1. CLI flag (--mode=xxx or --mode xxx)
 * 2. READINESS_MODE environment variable
 * 3. NODE_ENV environment variable
 * 4. Fallback to 'development'
 */
export function resolveReadinessMode(
  argv: string[] = process.argv,
  env: Record<string, string | undefined> = process.env
): ReadinessMode {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--mode=')) {
      const val = arg.slice(7).trim().toLowerCase();
      if (val === 'production' || val === 'staging' || val === 'development') {
        return val;
      }
    } else if (arg === '--mode' && i + 1 < argv.length) {
      const val = argv[i + 1].trim().toLowerCase();
      if (val === 'production' || val === 'staging' || val === 'development') {
        return val;
      }
    }
  }

  const envMode = env.READINESS_MODE?.trim().toLowerCase();
  if (envMode === 'production' || envMode === 'staging' || envMode === 'development') {
    return envMode;
  }

  const nodeEnv = env.NODE_ENV?.trim().toLowerCase();
  if (nodeEnv === 'production') return 'production';
  if (nodeEnv === 'staging') return 'staging';

  return 'development';
}

export async function runPreflight(options: PreflightOptions = {}): Promise<PreflightReport> {
  const mergedEnv: Record<string, string | undefined> = {
    ...process.env,
    ...(options.env || {}),
  };

  const mode = options.mode || resolveReadinessMode(process.argv, mergedEnv);
  const isStrict = mode === 'production' || mode === 'staging';
  const quiet = options.quiet ?? false;
  const results: CheckResult[] = [];

  function record(
    category: string,
    name: string,
    status: 'PASS' | 'FAIL' | 'WARN' | 'INFO',
    message: string,
    remediation?: string
  ) {
    results.push({ category, name, status, message: sanitizeSecrets(message), remediation });
  }

  if (!quiet) {
    console.log('================================================================');
    console.log(`       CONNECTLY — READINESS PREFLIGHT AUDIT [MODE: ${mode.toUpperCase()}]`);
    console.log('================================================================\n');
  }

  // -------------------------------------------------------------------------
  // 1. Environment Schema & Security Gate Check
  // -------------------------------------------------------------------------
  if (!quiet) console.log('[1/5] Auditing environment configuration & cryptographic keys...');
  const schemaValidationEnv: Record<string, string | undefined> = {
    ...mergedEnv,
    ...(mode === 'production' ? { NODE_ENV: 'production' } : {}),
  };
  const envParsed = envSchema.safeParse(schemaValidationEnv);
  if (!envParsed.success) {
    for (const issue of envParsed.error.issues) {
      record(
        'Configuration',
        `env.${issue.path.join('.')}`,
        isStrict ? 'FAIL' : 'WARN',
        issue.message,
        'Provide valid value in environment variables.'
      );
    }
  } else {
    record('Configuration', 'Schema Validation', 'PASS', 'Environment schema is valid.');
  }

  // Evaluate explicit security controls independently so users always get complete, actionable diagnostics
  const rawAccessSecret =
    mergedEnv.JWT_ACCESS_SECRET ??
    (envParsed.success ? envParsed.data.JWT_ACCESS_SECRET : undefined);
  const accessCheck = validateJwtSecret(rawAccessSecret, 'JWT_ACCESS_SECRET', isStrict);
  if (accessCheck.valid) {
    record('Security', 'JWT_ACCESS_SECRET', 'PASS', 'Access secret is non-default, non-placeholder, and >= 32 chars.');
  } else {
    record(
      'Security',
      'JWT_ACCESS_SECRET',
      isStrict ? 'FAIL' : 'WARN',
      accessCheck.reason || 'Insecure or default JWT access secret.',
      'Set high-entropy 32+ char secret (avoid placeholders or dev defaults).'
    );
  }

  const rawRefreshSecret =
    mergedEnv.JWT_REFRESH_SECRET ??
    (envParsed.success ? envParsed.data.JWT_REFRESH_SECRET : undefined);
  const refreshCheck = validateJwtSecret(rawRefreshSecret, 'JWT_REFRESH_SECRET', isStrict);
  if (refreshCheck.valid) {
    record('Security', 'JWT_REFRESH_SECRET', 'PASS', 'Refresh secret is non-default, non-placeholder, and >= 32 chars.');
  } else {
    record(
      'Security',
      'JWT_REFRESH_SECRET',
      isStrict ? 'FAIL' : 'WARN',
      refreshCheck.reason || 'Insecure or default JWT refresh secret.',
      'Set high-entropy 32+ char secret (avoid placeholders or dev defaults).'
    );
  }

  // Envelope Encryption Key (aligned strictly with keyManager.assertValid())
  const rawEncKey = mergedEnv.CONNECTLY_ENCRYPTION_KEY_V1;
  const encKeyResult = validateEncryptionKey(rawEncKey, {
    required: isStrict,
    allowDevDefault: !isStrict,
  });
  if (!rawEncKey || !rawEncKey.trim()) {
    if (isStrict) {
      record(
        'Security',
        'Envelope Encryption Key',
        'FAIL',
        encKeyResult.reason || 'CONNECTLY_ENCRYPTION_KEY_V1 must be configured in production.',
        'Generate 32 cryptographically random bytes (openssl rand -hex 32).'
      );
    } else {
      record('Security', 'Envelope Encryption Key', 'WARN', 'Encryption key not configured for development.');
    }
  } else if (encKeyResult.valid) {
    record('Security', 'Envelope Encryption Key', 'PASS', 'Valid 256-bit envelope key detected.');
  } else {
    record(
      'Security',
      'Envelope Encryption Key',
      isStrict ? 'FAIL' : 'WARN',
      encKeyResult.reason || 'CONNECTLY_ENCRYPTION_KEY_V1 must be a valid non-default 256-bit key.',
      'Generate 32 cryptographically random bytes (openssl rand -hex 32); never use dev fallback 0123456789abcdef...'
    );
  }

  // Client Origin
  const rawClientOrigin = (mergedEnv.CLIENT_ORIGIN || 'http://localhost:5173').trim();
  if (rawClientOrigin.startsWith('https://')) {
    record('Security', 'CLIENT_ORIGIN', 'PASS', `Trusted HTTPS origin configured: ${rawClientOrigin}`);
  } else if (isStrict) {
    record(
      'Security',
      'CLIENT_ORIGIN',
      'FAIL',
      'CLIENT_ORIGIN must use https:// in staging and production.',
      'Update CLIENT_ORIGIN to https:// domain (e.g. your Cloudflare Worker URL).'
    );
  } else {
    record('Security', 'CLIENT_ORIGIN', 'INFO', `Development HTTP origin: ${rawClientOrigin}`);
  }

  // Reverse Proxy Trust Configuration (Phase 18 Sprint 06P: F-06O-03)
  const rawTrustProxy = (mergedEnv.TRUST_PROXY || 'loopback').trim();
  const trustProxyValidation = validateTrustProxySetting(rawTrustProxy);
  if (!trustProxyValidation.valid) {
    record(
      'Security',
      'TRUST_PROXY',
      'FAIL',
      trustProxyValidation.error || 'Invalid TRUST_PROXY configuration.',
      'Configure an explicit hop count (e.g. "1" or "2"), subnet preset ("loopback", "uniquelocal"), or "false".'
    );
  } else {
    record('Security', 'TRUST_PROXY', 'PASS', `Reverse proxy trust safely configured as '${rawTrustProxy}'.`);
  }

  // Worker-to-Backend Origin Authentication Secret (Phase 18 Sprint 06R & 06T: F-06Q-01, F-06S-01, F-06S-02)
  const proxySecretResult = validateProxySecret(mergedEnv.PROXY_SECRET, isStrict);
  if (!proxySecretResult.valid) {
    record(
      'Security',
      'PROXY_SECRET',
      isStrict ? 'FAIL' : 'WARN',
      proxySecretResult.error || 'Invalid PROXY_SECRET configuration.',
      'Generate a 64-hex character secret using "openssl rand -hex 32" and configure in both Koyeb/Render and Cloudflare Worker.'
    );
  } else if (mergedEnv.PROXY_SECRET) {
    record(
      'Security',
      'PROXY_SECRET',
      'PASS',
      'Worker-to-backend origin authentication secret is configured with high entropy (64-char hex).'
    );
  } else {
    record('Security', 'PROXY_SECRET', 'INFO', 'PROXY_SECRET is optional for local development.');
  }

  // File Sharing Feature Gate Configuration (unified schema parity)
  const fileSharingCfg = resolveFileSharingConfig(mergedEnv, isStrict);
  const s3Bucket = (mergedEnv.STORAGE_S3_BUCKET || 'connectly-files').trim();

  if (fileSharingCfg.effectiveProvider === 'disabled') {
    if (fileSharingCfg.enableFileSharing) {
      record(
        'Storage',
        'File Sharing Gate',
        isStrict ? 'FAIL' : 'WARN',
        'STORAGE_PROVIDER=disabled is incompatible with ENABLE_FILE_SHARING=true.',
        'Set ENABLE_FILE_SHARING=false with STORAGE_PROVIDER=disabled, or configure STORAGE_PROVIDER=s3.'
      );
    } else {
      record(
        'Storage',
        'File Sharing Gate',
        'INFO',
        'File sharing is explicitly DISABLED (ENABLE_FILE_SHARING=false). S3 bucket versioning check will be skipped.'
      );
    }
  } else if (fileSharingCfg.effectiveProvider === 's3') {
    if (fileSharingCfg.enableFileSharing) {
      record(
        'Storage',
        'File Sharing Gate',
        'PASS',
        `File sharing enabled with S3 provider (bucket: ${s3Bucket}).`
      );
    } else {
      record(
        'Storage',
        'File Sharing Gate',
        'INFO',
        'File sharing is disabled via ENABLE_FILE_SHARING=false.'
      );
    }
  } else if (isStrict) {
    record(
      'Storage',
      'File Sharing Gate',
      'FAIL',
      `Non-S3 storage provider '${fileSharingCfg.configuredProvider}' configured while ENABLE_FILE_SHARING=true in ${mode}.`,
      'In staging/production, either configure STORAGE_PROVIDER=s3 or disable file sharing via ENABLE_FILE_SHARING=false and STORAGE_PROVIDER=disabled.'
    );
  }

  // -------------------------------------------------------------------------
  // 2. Database Connectivity & Replica Set Multi-Document Transactions
  // -------------------------------------------------------------------------
  if (!quiet) console.log('\n[2/5] Testing MongoDB connectivity and transaction capabilities...');
  const mongoUri = mergedEnv.MONGODB_URI || 'mongodb://127.0.0.1:27017/connectly';
  try {
    const conn = await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
    record('Database', 'MongoDB Connection', 'PASS', `Connected to database '${conn.connection.name}'.`);

    const txSupported = await isReplicaSetTransactionsSupported(true);
    if (txSupported) {
      record(
        'Database',
        'Replica Set Transactions',
        'PASS',
        'Multi-document ACID transactions and change streams are fully supported.'
      );
    } else {
      record(
        'Database',
        'Replica Set Transactions',
        isStrict ? 'FAIL' : 'WARN',
        'Connected to Standalone MongoDB. Multi-document transactions are unavailable.',
        isStrict
          ? 'Staging and production deployment strictly require a MongoDB Replica Set (e.g. MongoDB Atlas M0 3-node cluster).'
          : 'Replica set is recommended but not mandatory for local development.'
      );
    }
  } catch (err) {
    record(
      'Database',
      'MongoDB Connection',
      'FAIL',
      `Failed to connect to MongoDB: ${err instanceof Error ? err.message : String(err)}`,
      'Verify MONGODB_URI and network access.'
    );
  } finally {
    try {
      await mongoose.disconnect();
    } catch {
      // Disconnect cleanup ignored
    }
  }

  // -------------------------------------------------------------------------
  // 3. Redis TLS & Lua Scripting Capability (with bounded timeout & secret redaction)
  // -------------------------------------------------------------------------
  if (!quiet) console.log('\n[3/5] Testing Redis connectivity, in-transit TLS, and Lua scripting...');
  const redisUrl = mergedEnv.REDIS_URL?.trim();
  if (!redisUrl) {
    record(
      'Redis',
      'REDIS_URL Configuration',
      isStrict ? 'FAIL' : 'WARN',
      'REDIS_URL is not configured.',
      'Distributed rate-limiting, presence, and pub/sub fail closed in production without Redis. Provide a TLS-enabled endpoint (e.g. Upstash Redis rediss://).'
    );
  } else {
    try {
      validateRedisUrl(redisUrl, isStrict ? 'production' : 'development');
      record('Redis', 'Redis TLS Enforcement', 'PASS', 'REDIS_URL conforms to TLS enforcement.');

      const client: RedisClientAdapter = options.redisClientFactory
        ? options.redisClientFactory(redisUrl)
        : new Redis(redisUrl, {
            lazyConnect: true,
            connectTimeout: 5000,
            maxRetriesPerRequest: 1,
            retryStrategy: () => null,
            enableOfflineQueue: false,
          });
      client.on?.('error', () => {
        // Handled explicitly via connect()/ping() failure capture below
      });

      let redisTimer: NodeJS.Timeout | null = null;
      try {
        const connectAndPingPromise = (async () => {
          await client.connect();
          return await client.ping();
        })();

        const timeoutPromise = new Promise<never>((_, reject) => {
          redisTimer = setTimeout(() => reject(new Error('Redis connection timed out after 5000ms')), 5000);
        });

        const pong = await Promise.race([connectAndPingPromise, timeoutPromise]);
        if (pong === 'PONG') {
          record('Redis', 'Redis Ping', 'PASS', 'Successfully received PONG from Redis.');

          // Test atomic Lua script execution
          const testKey = `connectly:preflight:${Date.now()}`;
          await client.eval('return redis.call("SET", KEYS[1], "ok", "EX", 10)', 1, testKey);
          await client.del(testKey);
          record('Redis', 'Lua Scripting', 'PASS', 'Lua scripting and EVAL commands executed successfully.');
        } else {
          record('Redis', 'Redis Ping', 'FAIL', `Unexpected ping response: ${String(pong)}`);
        }
      } finally {
        if (redisTimer) clearTimeout(redisTimer);
        try {
          client.disconnect();
        } catch {
          // Disconnect error ignored
        }
      }
    } catch (err) {
      const errMsg = sanitizeSecrets(err instanceof Error ? err.message : String(err));
      record(
        'Redis',
        'Redis Connection',
        isStrict ? 'FAIL' : 'WARN',
        `Failed to connect or validate Redis: ${errMsg}`,
        'Verify REDIS_URL credentials and ensure port terminates TLS (rediss://).'
      );
    }
  }

  // -------------------------------------------------------------------------
  // 4. LiveKit SFU Configuration & Authenticated API Verification
  // -------------------------------------------------------------------------
  if (!quiet) console.log('\n[4/5] Checking LiveKit SFU configuration & authenticated credentials...');
  const lkUrl = mergedEnv.LIVEKIT_URL?.trim();
  const lkPublicUrl = mergedEnv.LIVEKIT_PUBLIC_URL?.trim();
  const lkSignalGatewayEnabled = mergedEnv.LIVEKIT_SIGNAL_GATEWAY_ENABLED?.trim() as
    | 'auto'
    | 'true'
    | 'false'
    | undefined;
  const lkKey = mergedEnv.LIVEKIT_API_KEY?.trim();
  const lkSecret = mergedEnv.LIVEKIT_API_SECRET?.trim();

  if (!lkUrl || !lkKey || !lkSecret) {
    record(
      'LiveKit',
      'SFU Credentials',
      isStrict ? 'FAIL' : 'WARN',
      'LiveKit credentials missing.',
      'Configure LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET.'
    );
  } else {
    const lkValidation = validateLiveKitConfig(
      {
        url: lkUrl,
        ...(lkPublicUrl ? { publicUrl: lkPublicUrl } : {}),
        ...(lkSignalGatewayEnabled ? { signalGatewayEnabled: lkSignalGatewayEnabled } : {}),
        apiKey: lkKey,
        apiSecret: lkSecret,
      },
      isStrict ? 'production' : 'development'
    );

    if (!lkValidation.valid) {
      record(
        'LiveKit',
        'SFU Config Validation',
        isStrict ? 'FAIL' : 'WARN',
        `LiveKit configuration rejected: ${lkValidation.reason}`,
        'Verify LIVEKIT_URL format and replace placeholder dev credentials.'
      );
    } else {
      record('LiveKit', 'SFU Config Validation', 'PASS', `LiveKit configuration valid for ${lkUrl}`);

      // Authenticated API Call Verification
      let lkTimer: NodeJS.Timeout | null = null;
      try {
        const httpUrl = toLiveKitHttpUrl(lkUrl);
        const roomClient: RoomClientAdapter = options.roomClientFactory
          ? options.roomClientFactory(httpUrl, lkKey, lkSecret)
          : new RoomServiceClient(httpUrl, lkKey, lkSecret, {
              requestTimeout: 5,
              failover: false,
            });

        // Enforce 5000ms timeout on RoomServiceClient call
        const listPromise = roomClient.listRooms();
        const timeoutPromise = new Promise<never>((_, reject) => {
          lkTimer = setTimeout(() => reject(new Error('LiveKit API request timed out after 5000ms')), 5000);
        });

        await Promise.race([listPromise, timeoutPromise]);
        record(
          'LiveKit',
          'LiveKit Authenticated API',
          'PASS',
          `LiveKit SFU credentials verified successfully via authenticated API call (listRooms).`
        );
      } catch (err) {
        const errMsg = sanitizeSecrets(err instanceof Error ? err.message : String(err));
        record(
          'LiveKit',
          'LiveKit Authenticated API',
          isStrict ? 'FAIL' : 'WARN',
          `LiveKit authenticated API call failed: ${errMsg}`,
          'Verify LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET against your LiveKit Cloud dashboard.'
        );
      } finally {
        if (lkTimer) clearTimeout(lkTimer);
      }
    }
  }

  // -------------------------------------------------------------------------
  // 5. Storage & Object Versioning Check (aligned with Step 1 schema defaults)
  // -------------------------------------------------------------------------
  if (!quiet) console.log('\n[5/5] Checking object storage configuration...');

  if (!fileSharingCfg.enableFileSharing || fileSharingCfg.effectiveProvider === 'disabled') {
    if (fileSharingCfg.enableFileSharing && fileSharingCfg.effectiveProvider === 'disabled') {
      record(
        'Storage',
        'Object Storage Gate',
        isStrict ? 'FAIL' : 'WARN',
        'Invalid storage state: ENABLE_FILE_SHARING resolves to true while STORAGE_PROVIDER=disabled.',
        'Set ENABLE_FILE_SHARING=false when STORAGE_PROVIDER=disabled.'
      );
    } else {
      record(
        'Storage',
        'Object Storage Gate',
        'INFO',
        'File sharing is DISABLED. Object storage bucket versioning validation safely skipped.'
      );
    }
  } else if (fileSharingCfg.effectiveProvider === 's3') {
    try {
      const s3Config = {
        bucket: s3Bucket,
        region: (mergedEnv.STORAGE_S3_REGION || 'us-east-1').trim(),
        endpoint: mergedEnv.STORAGE_S3_ENDPOINT?.trim() || undefined,
        accessKeyId: mergedEnv.STORAGE_S3_ACCESS_KEY_ID?.trim() || undefined,
        secretAccessKey: mergedEnv.STORAGE_S3_SECRET_ACCESS_KEY?.trim() || undefined,
        forcePathStyle: mergedEnv.STORAGE_S3_FORCE_PATH_STYLE === 'true',
      };

      const verifier: StorageVerifierAdapter = options.storageVerifierFactory
        ? options.storageVerifierFactory(s3Config)
        : new (await import('../storage/s3StorageProvider.js')).S3StorageProvider(s3Config);

      await verifier.verifyBucketVersioning();
      record('Storage', 'S3 Bucket Versioning', 'PASS', 'S3 bucket exists and bucket versioning is ACTIVE.');
    } catch (err) {
      const errMsg = sanitizeSecrets(err instanceof Error ? err.message : String(err));
      record(
        'Storage',
        'S3 Bucket Versioning',
        isStrict ? 'FAIL' : 'WARN',
        `S3 bucket versioning check failed: ${errMsg}`,
        'Ensure AWS S3 bucket exists and has Versioning enabled, or set ENABLE_FILE_SHARING=false and STORAGE_PROVIDER=disabled.'
      );
    }
  } else if (isStrict) {
    record(
      'Storage',
      'S3 Bucket Versioning',
      'FAIL',
      `Expected S3 storage provider in ${mode}, but active provider is '${fileSharingCfg.effectiveProvider}'.`,
      'Set STORAGE_PROVIDER=s3 or disable file sharing via ENABLE_FILE_SHARING=false.'
    );
  } else {
    record(
      'Storage',
      'Object Storage',
      'INFO',
      `Using ${fileSharingCfg.effectiveProvider} storage in development.`
    );
  }

  // -------------------------------------------------------------------------
  // Summary & Failure Evaluation
  // -------------------------------------------------------------------------
  const failures = results.filter((r) => r.status === 'FAIL');
  const warnings = results.filter((r) => r.status === 'WARN');
  const hasFailures = failures.length > 0;
  const success = !hasFailures;

  if (!quiet) {
    console.log('\n================================================================');
    console.log(`            PREFLIGHT AUDIT SUMMARY [${mode.toUpperCase()}]`);
    console.log('================================================================\n');

    for (const r of results) {
      const symbol =
        r.status === 'PASS'
          ? '\x1b[32m✔ PASS\x1b[0m'
          : r.status === 'FAIL'
            ? '\x1b[31m✖ FAIL\x1b[0m'
            : r.status === 'WARN'
              ? '\x1b[33m⚠ WARN\x1b[0m'
              : '\x1b[36mℹ INFO\x1b[0m';

      console.log(`[${r.category}] ${symbol} ${r.name}: ${r.message}`);
      if (r.remediation) {
        console.log(`    \x1b[90mRemediation:\x1b[0m ${r.remediation}`);
      }
    }

    console.log('\n================================================================');
    if (!success) {
      console.log(`\x1b[31m[PREFLIGHT FAILED]\x1b[0m ${failures.length} critical requirement(s) failed in ${mode} mode.`);
      console.log('Resolve the remediation items above before proceeding.');
      console.log('================================================================\n');
    } else {
      console.log(`\x1b[32m[PREFLIGHT PASSED]\x1b[0m All audited requirements satisfied for ${mode} readiness.`);
      if (warnings.length > 0) {
        console.log(`\x1b[33m[NOTICE]\x1b[0m ${warnings.length} non-blocking warning(s) reported.`);
      }
      console.log('================================================================\n');
    }
  }

  if (options.exitOnError !== false && !success && isStrict) {
    process.exit(1);
  }

  return {
    success,
    mode,
    results,
    failures,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Entry point check: only execute immediately if invoked directly from CLI
// ---------------------------------------------------------------------------
const isMain =
  process.argv[1] &&
  (path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) ||
    process.argv[1].endsWith('verifyProductionReadiness.ts') ||
    process.argv[1].endsWith('verifyProductionReadiness.js'));

if (isMain) {
  dotenv.config();
  runPreflight()
    .then((report) => {
      if (!report.success && (report.mode === 'production' || report.mode === 'staging')) {
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error('Fatal preflight execution error:', err);
      process.exit(1);
    });
}
