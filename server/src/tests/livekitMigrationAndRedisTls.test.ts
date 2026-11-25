import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import mongoose from 'mongoose';
import {
  LIVEKIT_REVOCATION_EVENT_TTL_SECONDS,
  LIVEKIT_REVOCATION_TTL_INDEX_NAME,
  LiveKitRevocationEvent,
  ensureRevocationCollectionsReady,
  resetRevocationTopologyCache,
} from '../models/LiveKitRevocationEvent.model.js';
import { LiveKitRevocationCoordinator } from '../realtime/livekitRevocationCoordinator.js';
import { resolveSocketIoAdapterConfig } from '../realtime/socketAdapter.js';
import { envSchema } from '../config/env.js';
import { isLoopbackRedisHost, validateRedisUrl } from '../utils/redisUrl.js';

const TEST_MONGO_URI =
  process.env.TEST_MIGRATION_MONGO_URI || 'mongodb://127.0.0.1:27017/connectly_test_phase09_mig_tls';

function buildValidProdEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    NODE_ENV: 'production',
    PORT: '5000',
    MONGODB_URI: 'mongodb://127.0.0.1:27017/connectly_prod_test',
    JWT_ACCESS_SECRET: 'prod_access_secret_9876543210_abcdefghijklmnopqrstuvwxyz',
    JWT_REFRESH_SECRET: 'prod_refresh_secret_9876543210_abcdefghijklmnopqrstuvwxyz',
    CONNECTLY_ENCRYPTION_KEY_V1: '9f8e7d6c5b4a392817161514131211100f0e0d0c0b0a090807060504030201f0',
    CLIENT_ORIGIN: 'https://app.connectly.example',
    LIVEKIT_URL: 'wss://connectly.livekit.cloud',
    LIVEKIT_API_KEY: 'APIprodkey1234567890',
    LIVEKIT_API_SECRET: 'prodLiveKitSecretKey_9876543210_secure',
    LIVEKIT_SIGNAL_GATEWAY_ENABLED: 'auto',
    SOCKET_IO_ADAPTER: 'redis',
    SOCKET_IO_MULTI_INSTANCE: 'true',
    REDIS_URL: 'rediss://redis.prod.internal:6379',
    PROXY_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    ...overrides,
  };
}

describe('Phase 09 — LiveKit Revocation TTL Migration, Error Observability & Production Redis TLS', () => {
  before(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(TEST_MONGO_URI);
    }
    resetRevocationTopologyCache();
  });

  after(async () => {
    try {
      await mongoose.connection.dropDatabase();
    } catch {
      // Ignore cleanup errors on teardown
    }
    await mongoose.disconnect();
  });

  it('1. Migrates existing livekitrevocationevents.createdAt_1 TTL from 3600s to 86400s via collMod, init() succeeds, and coordinator becomes HEALTHY', async () => {
    resetRevocationTopologyCache();
    const colName = LiveKitRevocationEvent.collection.collectionName;
    const db = mongoose.connection.db!;

    // Start from a clean collection and seed legacy 3600s TTL index
    await db.dropCollection(colName).catch(() => {});
    await db.createCollection(colName);
    await db.collection(colName).createIndex(
      { createdAt: 1 },
      { name: LIVEKIT_REVOCATION_TTL_INDEX_NAME, expireAfterSeconds: 3600 }
    );

    const beforeIndexes = await db.collection(colName).indexes();
    const beforeTtl = beforeIndexes.find((i) => i.name === LIVEKIT_REVOCATION_TTL_INDEX_NAME);
    assert.strictEqual(beforeTtl?.expireAfterSeconds, 3600, 'Precondition: legacy index must have TTL 3600');

    // Run updated initialization path
    await ensureRevocationCollectionsReady();

    // Verify migrated TTL is now 86400
    const afterIndexes = await db.collection(colName).indexes();
    const afterTtl = afterIndexes.find((i) => i.name === LIVEKIT_REVOCATION_TTL_INDEX_NAME);
    assert.strictEqual(
      afterTtl?.expireAfterSeconds,
      LIVEKIT_REVOCATION_EVENT_TTL_SECONDS,
      'createdAt_1 TTL index must be migrated to 86400'
    );

    // Verify LiveKitRevocationEvent.init() succeeds with zero IndexOptionsConflict
    await LiveKitRevocationEvent.init();

    // Verify revocation coordinator becomes healthy
    const coordinator = new LiveKitRevocationCoordinator({
      enableChangeStream: false,
      pollIntervalMs: 60_000,
      requireTransactions: false,
    });
    try {
      await coordinator.start();
      assert.strictEqual(coordinator.isHealthy(), true, 'Coordinator must start HEALTHY after migration');
      assert.strictEqual(coordinator.getUnavailableReason(), null);
      assert.strictEqual(coordinator.getLastHealthError(), null);
    } finally {
      await coordinator.stop();
    }
  });

  it('2. Leaves already-correct 86400s TTL index unchanged (no collMod or dropIndex) and handles missing index on fresh collection', async () => {
    const colName = LiveKitRevocationEvent.collection.collectionName;
    const db = mongoose.connection.db!;

    // Case A: Already-correct 86400s index remains untouched
    resetRevocationTopologyCache();
    let collModCalled = false;
    let dropIndexCalled = false;

    const origCommand = db.command.bind(db);
    const origDropIndex = LiveKitRevocationEvent.collection.dropIndex.bind(
      LiveKitRevocationEvent.collection
    );

    (db as any).command = async (cmd: any, ...rest: any[]) => {
      if (cmd && cmd.collMod === colName) {
        collModCalled = true;
      }
      return origCommand(cmd, ...rest);
    };
    (LiveKitRevocationEvent.collection as any).dropIndex = async (...args: any[]) => {
      dropIndexCalled = true;
      return origDropIndex(...(args as [string]));
    };

    try {
      await ensureRevocationCollectionsReady();
      assert.strictEqual(collModCalled, false, 'Already-correct 86400 index must NOT run collMod');
      assert.strictEqual(dropIndexCalled, false, 'Already-correct 86400 index must NOT dropIndex');
    } finally {
      (db as any).command = origCommand;
      (LiveKitRevocationEvent.collection as any).dropIndex = origDropIndex;
    }

    // Case B: Missing index on fresh collection is created with 86400s
    resetRevocationTopologyCache();
    await db.dropCollection(colName).catch(() => {});
    await ensureRevocationCollectionsReady();
    const freshIndexes = await db.collection(colName).indexes();
    const freshTtl = freshIndexes.find((i) => i.name === LIVEKIT_REVOCATION_TTL_INDEX_NAME);
    assert.strictEqual(freshTtl?.expireAfterSeconds, 86400);
  });

  it('3. Safely executes explicit drop-and-recreate fallback when collMod is unsupported or index is non-TTL', async () => {
    const colName = LiveKitRevocationEvent.collection.collectionName;
    const db = mongoose.connection.db!;

    // Subcase A: collMod unsupported (CommandNotFound code 59) -> explicit drop-and-recreate succeeds
    resetRevocationTopologyCache();
    await db.dropCollection(colName).catch(() => {});
    await db.createCollection(colName);
    await db.collection(colName).createIndex(
      { createdAt: 1 },
      { name: LIVEKIT_REVOCATION_TTL_INDEX_NAME, expireAfterSeconds: 3600 }
    );

    const origCommand = db.command.bind(db);
    (db as any).command = async (cmd: any, ...rest: any[]) => {
      if (cmd && cmd.collMod === colName) {
        const err = Object.assign(new Error('no such command: collMod'), {
          name: 'MongoServerError',
          code: 59,
          codeName: 'CommandNotFound',
        });
        throw err;
      }
      return origCommand(cmd, ...rest);
    };

    try {
      await ensureRevocationCollectionsReady();
      const indexes = await db.collection(colName).indexes();
      const ttl = indexes.find((i) => i.name === LIVEKIT_REVOCATION_TTL_INDEX_NAME);
      assert.strictEqual(ttl?.expireAfterSeconds, 86400);
    } finally {
      (db as any).command = origCommand;
    }

    // Subcase B: Legacy non-TTL { createdAt: 1 } index -> migrated to 86400s TTL
    resetRevocationTopologyCache();
    await db.dropCollection(colName).catch(() => {});
    await db.createCollection(colName);
    await db.collection(colName).createIndex({ createdAt: 1 }, { name: LIVEKIT_REVOCATION_TTL_INDEX_NAME });

    await ensureRevocationCollectionsReady();
    const migratedIndexes = await db.collection(colName).indexes();
    const migratedTtl = migratedIndexes.find((i) => i.name === LIVEKIT_REVOCATION_TTL_INDEX_NAME);
    assert.strictEqual(migratedTtl?.expireAfterSeconds, 86400);
  });

  it('4. Handles concurrent startup calls safely when migrating a 3600s TTL index', async () => {
    const colName = LiveKitRevocationEvent.collection.collectionName;
    const db = mongoose.connection.db!;

    resetRevocationTopologyCache();
    await db.dropCollection(colName).catch(() => {});
    await db.createCollection(colName);
    await db.collection(colName).createIndex(
      { createdAt: 1 },
      { name: LIVEKIT_REVOCATION_TTL_INDEX_NAME, expireAfterSeconds: 3600 }
    );

    // Concurrent calls in the same process coalesce cleanly
    await Promise.all([
      ensureRevocationCollectionsReady(),
      ensureRevocationCollectionsReady(),
      ensureRevocationCollectionsReady(),
    ]);

    const indexes = await db.collection(colName).indexes();
    const ttl = indexes.find((i) => i.name === LIVEKIT_REVOCATION_TTL_INDEX_NAME);
    assert.strictEqual(ttl?.expireAfterSeconds, 86400);
  });

  it('5. Fails closed on genuine migration/index errors, exposes original error metadata (name, message, code), and redacts secrets', async () => {
    const colName = LiveKitRevocationEvent.collection.collectionName;
    const db = mongoose.connection.db!;

    resetRevocationTopologyCache();
    await db.dropCollection(colName).catch(() => {});
    await db.createCollection(colName);
    await db.collection(colName).createIndex(
      { createdAt: 1 },
      { name: LIVEKIT_REVOCATION_TTL_INDEX_NAME, expireAfterSeconds: 3600 }
    );

    const origCommand = db.command.bind(db);
    const origConsoleError = console.error;
    const capturedErrorLogs: string[] = [];

    console.error = (...args: unknown[]) => {
      capturedErrorLogs.push(args.map((a) => String(a)).join(' '));
    };

    (db as any).command = async (cmd: any, ...rest: any[]) => {
      if (cmd && cmd.collMod === colName) {
        throw Object.assign(
          new Error(
            'not authorized on connectly to execute command collMod via mongodb://dbadmin:SuperSecretPass99@mongo.internal:27017/connectly'
          ),
          {
            name: 'MongoServerError',
            code: 13,
            codeName: 'Unauthorized',
          }
        );
      }
      return origCommand(cmd, ...rest);
    };

    const coordinator = new LiveKitRevocationCoordinator({
      instanceId: 'obs-test-instance-1',
      enableChangeStream: false,
      pollIntervalMs: 60_000,
      requireTransactions: false,
      maxConsecutiveFailures: 1,
    });

    try {
      await coordinator.start();

      // Must fail closed
      assert.strictEqual(coordinator.isHealthy(), false, 'Coordinator must be UNHEALTHY on genuine migration failure');
      const healthErr = coordinator.getLastHealthError();
      assert.ok(healthErr, 'Coordinator must retain structured lastHealthError');
      assert.strictEqual(healthErr.name, 'MongoServerError');
      assert.strictEqual(healthErr.code, 13);
      assert.strictEqual(healthErr.codeName, 'Unauthorized');
      assert.match(healthErr.message, /not authorized on connectly/);
      assert.ok(!healthErr.message.includes('SuperSecretPass99'), 'Embedded URI credentials must be redacted');
      assert.ok(healthErr.message.includes('[REDACTED]'), 'Redacted placeholder must replace credentials');

      // Structured error log must NOT be empty `{}` and must expose name, message, and MongoDB code
      const unhealthyLog = capturedErrorLogs.find((line) =>
        line.includes('Coordinator transitioned to UNHEALTHY (fail-closed)')
      );
      assert.ok(unhealthyLog, 'Must emit structured UNHEALTHY transition log');
      assert.ok(!unhealthyLog.endsWith(' {}'), 'Log metadata must never be empty {}');
      assert.ok(unhealthyLog.includes('"name":"MongoServerError"'), 'Log must include original error name');
      assert.ok(unhealthyLog.includes('"code":13'), 'Log must include original MongoDB error code');
      assert.ok(unhealthyLog.includes('"errorCodeName":"Unauthorized"'), 'Log must include codeName');
      assert.ok(unhealthyLog.includes('not authorized on connectly'), 'Log must include original error message');
      assert.ok(!unhealthyLog.includes('SuperSecretPass99'), 'Log must NEVER leak secrets/passwords');

      // Subsequent syncNow() must NOT falsely recover while migration still fails
      const syncWhileBroken = await coordinator.syncNow();
      assert.strictEqual(syncWhileBroken, false);
      assert.strictEqual(coordinator.isHealthy(), false);

      // Once DB permission/issue is resolved, syncNow() runs migration and recovers cleanly to HEALTHY
      (db as any).command = origCommand;
      const syncAfterFix = await coordinator.syncNow();
      assert.strictEqual(syncAfterFix, true);
      assert.strictEqual(coordinator.isHealthy(), true);
      assert.strictEqual(coordinator.getLastHealthError(), null);

      const verifiedIndexes = await db.collection(colName).indexes();
      const verifiedTtl = verifiedIndexes.find((i) => i.name === LIVEKIT_REVOCATION_TTL_INDEX_NAME);
      assert.strictEqual(verifiedTtl?.expireAfterSeconds, 86400);
    } finally {
      (db as any).command = origCommand;
      console.error = origConsoleError;
      await coordinator.stop();
    }
  });

  it('6. Enforces production Redis TLS (rediss://) for non-loopback hosts while permitting loopback plaintext and non-production redis://', () => {
    // Loopback helper precision
    assert.strictEqual(isLoopbackRedisHost('127.0.0.1'), true);
    assert.strictEqual(isLoopbackRedisHost('localhost'), true);
    assert.strictEqual(isLoopbackRedisHost('LOCALHOST'), true);
    assert.strictEqual(isLoopbackRedisHost('::1'), true);
    assert.strictEqual(isLoopbackRedisHost('[::1]'), true);
    assert.strictEqual(isLoopbackRedisHost('0.0.0.0'), false);
    assert.strictEqual(isLoopbackRedisHost('localhost.evil.com'), false);
    assert.strictEqual(isLoopbackRedisHost('127.0.0.2'), false);
    assert.strictEqual(isLoopbackRedisHost('redis.prod.internal'), false);

    // A. Production remote plaintext redis:// MUST be rejected (resolveSocketIoAdapterConfig + envSchema)
    for (const remotePlaintext of [
      'redis://redis.prod.internal:6379',
      'redis://default:SuperRedisSecret@10.0.0.12:6379',
      'redis://0.0.0.0:6379',
      'redis://localhost.evil.com:6379',
    ]) {
      assert.throws(
        () =>
          resolveSocketIoAdapterConfig({
            nodeEnv: 'production',
            adapterSetting: 'redis',
            multiInstanceSetting: 'true',
            redisUrl: remotePlaintext,
          }),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.match(err.message, /must use TLS \(rediss:\/\/\)/);
          assert.ok(!err.message.includes('SuperRedisSecret'), 'Error must not leak Redis password');
          return true;
        }
      );

      const envRes = envSchema.safeParse(buildValidProdEnv({ REDIS_URL: remotePlaintext }));
      assert.strictEqual(envRes.success, false, `envSchema must reject production ${remotePlaintext}`);
    }

    // B. Production remote TLS rediss:// MUST be accepted
    const tlsResolved = resolveSocketIoAdapterConfig({
      nodeEnv: 'production',
      adapterSetting: 'redis',
      multiInstanceSetting: 'true',
      redisUrl: 'rediss://default:pass@redis.prod.internal:6379',
    });
    assert.strictEqual(tlsResolved.mode, 'redis');
    const envTls = envSchema.safeParse(
      buildValidProdEnv({ REDIS_URL: 'rediss://default:pass@redis.prod.internal:6379' })
    );
    assert.strictEqual(envTls.success, true, 'envSchema must accept production rediss://');

    // C. Production loopback plaintext redis:// MUST be accepted
    for (const loopbackUrl of [
      'redis://127.0.0.1:6379',
      'redis://localhost:6379',
      'redis://[::1]:6379',
    ]) {
      const resolved = resolveSocketIoAdapterConfig({
        nodeEnv: 'production',
        adapterSetting: 'redis',
        multiInstanceSetting: 'true',
        redisUrl: loopbackUrl,
      });
      assert.strictEqual(resolved.mode, 'redis');

      const envLoopback = envSchema.safeParse(buildValidProdEnv({ REDIS_URL: loopbackUrl }));
      assert.strictEqual(envLoopback.success, true, `envSchema must accept production loopback ${loopbackUrl}`);
    }

    // D. Malformed URLs and unsupported protocols MUST be rejected in ALL environments
    for (const badUrl of [
      'not-a-valid-url',
      'redis://',
      'rediss://',
      'http://redis.prod.internal:6379',
      'https://redis.prod.internal:6379',
      'ws://127.0.0.1:6379',
    ]) {
      assert.throws(() => validateRedisUrl(badUrl, 'development'));
      assert.throws(() => validateRedisUrl(badUrl, 'production'));
      assert.throws(() =>
        resolveSocketIoAdapterConfig({
          nodeEnv: 'development',
          adapterSetting: 'redis',
          multiInstanceSetting: 'false',
          redisUrl: badUrl,
        })
      );
      const envBad = envSchema.safeParse({
        NODE_ENV: 'development',
        SOCKET_IO_ADAPTER: 'redis',
        REDIS_URL: badUrl,
      });
      assert.strictEqual(envBad.success, false, `envSchema must reject invalid URL ${badUrl}`);
    }

    // E. Non-production (development / test) remote plaintext redis:// MUST be accepted
    for (const nonProdEnv of ['development', 'test'] as const) {
      const resolved = resolveSocketIoAdapterConfig({
        nodeEnv: nonProdEnv,
        adapterSetting: 'redis',
        multiInstanceSetting: 'false',
        redisUrl: 'redis://redis.dev.internal:6379',
      });
      assert.strictEqual(resolved.mode, 'redis');

      const envNonProd = envSchema.safeParse({
        NODE_ENV: nonProdEnv,
        SOCKET_IO_ADAPTER: 'redis',
        REDIS_URL: 'redis://redis.dev.internal:6379',
      });
      assert.strictEqual(envNonProd.success, true, `envSchema must accept ${nonProdEnv} remote redis://`);
    }
  });

  it('7. Cold mongoose.connect() against a pre-existing 3600s database does NOT trigger autoIndex error 85 and migrates cleanly to 86400s', async () => {
    const colName = LiveKitRevocationEvent.collection.collectionName;

    // Seed pre-existing 3600s TTL index, then completely disconnect Mongoose
    const db = mongoose.connection.db!;
    await db.dropCollection(colName).catch(() => {});
    await db.createCollection(colName);
    await db.collection(colName).createIndex(
      { createdAt: 1 },
      { name: LIVEKIT_REVOCATION_TTL_INDEX_NAME, expireAfterSeconds: 3600 }
    );
    await mongoose.disconnect();
    resetRevocationTopologyCache();

    // Reconnect cold against the already-3600s database (simulating real server restart on legacy DB)
    await mongoose.connect(TEST_MONGO_URI);

    // Give Mongoose's connection 'open' listeners a turn on the event loop to prove autoIndex does NOT race
    await new Promise((r) => setTimeout(r, 50));

    // Pre-migration TTL is still 3600 (no failed autoIndex race)
    const preIndexes = await mongoose.connection.db!.collection(colName).indexes();
    const preTtl = preIndexes.find((i) => i.name === LIVEKIT_REVOCATION_TTL_INDEX_NAME);
    assert.strictEqual(preTtl?.expireAfterSeconds, 3600);

    // Run initialization & start coordinator
    await ensureRevocationCollectionsReady();
    await LiveKitRevocationEvent.init();

    const postIndexes = await mongoose.connection.db!.collection(colName).indexes();
    const postTtl = postIndexes.find((i) => i.name === LIVEKIT_REVOCATION_TTL_INDEX_NAME);
    assert.strictEqual(postTtl?.expireAfterSeconds, 86400);

    const coordinator = new LiveKitRevocationCoordinator({
      enableChangeStream: false,
      pollIntervalMs: 60_000,
      requireTransactions: false,
    });
    try {
      await coordinator.start();
      assert.strictEqual(coordinator.isHealthy(), true);
      assert.strictEqual(coordinator.getLastHealthError(), null);
    } finally {
      await coordinator.stop();
    }
  });
});
