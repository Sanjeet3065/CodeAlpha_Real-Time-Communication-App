import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveReadinessMode,
  runPreflight,
  sanitizeSecrets,
} from '../scripts/verifyProductionReadiness.js';

describe('Production & Staging Readiness Preflight Verification Suite', () => {
  describe('1. Mode Resolution Logic', () => {
    it('resolves mode from --mode=xxx flag', () => {
      assert.strictEqual(resolveReadinessMode(['node', 'script.js', '--mode=production'], {}), 'production');
      assert.strictEqual(resolveReadinessMode(['node', 'script.js', '--mode=staging'], {}), 'staging');
      assert.strictEqual(resolveReadinessMode(['node', 'script.js', '--mode=development'], {}), 'development');
    });

    it('resolves mode from --mode xxx separate flag', () => {
      assert.strictEqual(resolveReadinessMode(['node', 'script.js', '--mode', 'production'], {}), 'production');
      assert.strictEqual(resolveReadinessMode(['node', 'script.js', '--mode', 'staging'], {}), 'staging');
    });

    it('resolves mode from READINESS_MODE env var if CLI flag absent', () => {
      assert.strictEqual(resolveReadinessMode(['node', 'script.js'], { READINESS_MODE: 'staging' }), 'staging');
      assert.strictEqual(resolveReadinessMode(['node', 'script.js'], { READINESS_MODE: 'production' }), 'production');
    });

    it('falls back to NODE_ENV when CLI flag and READINESS_MODE are absent', () => {
      assert.strictEqual(resolveReadinessMode(['node', 'script.js'], { NODE_ENV: 'production' }), 'production');
      assert.strictEqual(resolveReadinessMode(['node', 'script.js'], { NODE_ENV: 'staging' }), 'staging');
      assert.strictEqual(resolveReadinessMode(['node', 'script.js'], { NODE_ENV: 'development' }), 'development');
    });

    it('defaults to development when no mode indicators are present', () => {
      assert.strictEqual(resolveReadinessMode(['node', 'script.js'], {}), 'development');
    });
  });

  describe('2. Secret Redaction & Sanitization Utility', () => {
    it('redacts password from redis:// and https:// URLs', () => {
      const sanitized = sanitizeSecrets('Failed to connect to rediss://default:super_secret_redis_pass@upstash.io:6379');
      assert.ok(!sanitized.includes('super_secret_redis_pass'));
      assert.ok(sanitized.includes('default:***@upstash.io:6379'));
    });

    it('redacts API key and secret tokens from error strings', () => {
      const sanitized = sanitizeSecrets('Invalid key: api_key=LIVEKIT_DEV_SECRET_ABC123456');
      assert.ok(!sanitized.includes('LIVEKIT_DEV_SECRET_ABC123456'));
      assert.ok(sanitized.includes('api_key=***'));
    });
  });

  describe('3. Database Topology & Transaction Gates', () => {
    it('fails closed in staging/production when connected to Standalone MongoDB', async () => {
      // Connects to local standalone instance on port 27017
      const report = await runPreflight({
        mode: 'staging',
        env: {
          MONGODB_URI: 'mongodb://127.0.0.1:27017/connectly_test_preflight_standalone',
        },
        exitOnError: false,
        quiet: true,
      });

      const txResult = report.results.find((r) => r.name === 'Replica Set Transactions');
      assert.ok(txResult, 'Must evaluate replica set transactions');
      assert.strictEqual(txResult.status, 'FAIL', 'Standalone MongoDB must FAIL in staging');
      assert.match(txResult.message, /Standalone MongoDB/);
      assert.strictEqual(report.success, false, 'Preflight report must indicate failure');
    });

    it('warns but does not fail in development mode when connected to Standalone MongoDB', async () => {
      const report = await runPreflight({
        mode: 'development',
        env: {
          MONGODB_URI: 'mongodb://127.0.0.1:27017/connectly_test_preflight_dev',
        },
        exitOnError: false,
        quiet: true,
      });

      const txResult = report.results.find((r) => r.name === 'Replica Set Transactions');
      assert.ok(txResult);
      assert.strictEqual(txResult.status, 'WARN', 'Standalone MongoDB must WARN in development');
    });

    it('passes replica set transaction check when connected to Replica Set MongoDB', async () => {
      // Connects to local replica set instance on port 27018
      const report = await runPreflight({
        mode: 'staging',
        env: {
          MONGODB_URI: 'mongodb://127.0.0.1:27018/connectly_test_preflight_rs?replicaSet=rs0',
        },
        exitOnError: false,
        quiet: true,
      });

      const txResult = report.results.find((r) => r.name === 'Replica Set Transactions');
      assert.ok(txResult);
      assert.strictEqual(txResult.status, 'PASS', 'Replica Set must PASS in staging');
      assert.match(txResult.message, /Multi-document ACID transactions/);
    });
  });

  describe('4. Redis In-Transit TLS & Dynamic Connectivity Gates', () => {
    it('fails closed in staging when REDIS_URL is missing', async () => {
      const report = await runPreflight({
        mode: 'staging',
        env: {
          REDIS_URL: '',
        },
        exitOnError: false,
        quiet: true,
      });

      const redisResult = report.results.find((r) => r.name === 'REDIS_URL Configuration');
      assert.ok(redisResult);
      assert.strictEqual(redisResult.status, 'FAIL');
      assert.strictEqual(report.success, false);
    });

    it('warns in development when REDIS_URL is missing', async () => {
      const report = await runPreflight({
        mode: 'development',
        env: {
          REDIS_URL: '',
        },
        exitOnError: false,
        quiet: true,
      });

      const redisResult = report.results.find((r) => r.name === 'REDIS_URL Configuration');
      assert.ok(redisResult);
      assert.strictEqual(redisResult.status, 'WARN');
    });

    it('rejects plaintext remote redis:// URLs in staging and production', async () => {
      const report = await runPreflight({
        mode: 'staging',
        env: {
          REDIS_URL: 'redis://default:somepassword@redis-cloud.com:12345',
        },
        exitOnError: false,
        quiet: true,
      });

      const redisResult = report.results.find((r) => r.name === 'Redis Connection');
      assert.ok(redisResult);
      assert.strictEqual(redisResult.status, 'FAIL');
      assert.match(redisResult.message, /rediss:\/\//i);
    });

    it('passes Redis check when authenticated PING and Lua EVAL succeed', async () => {
      const mockRedisFactory = () => ({
        connect: async () => {},
        ping: async () => 'PONG',
        eval: async () => 'ok',
        del: async () => 1,
        disconnect: () => {},
      });

      const report = await runPreflight({
        mode: 'staging',
        env: {
          REDIS_URL: 'rediss://default:valid_token@upstash.io:6379',
        },
        redisClientFactory: mockRedisFactory,
        exitOnError: false,
        quiet: true,
      });

      const pingResult = report.results.find((r) => r.name === 'Redis Ping');
      assert.ok(pingResult);
      assert.strictEqual(pingResult.status, 'PASS');

      const luaResult = report.results.find((r) => r.name === 'Lua Scripting');
      assert.ok(luaResult);
      assert.strictEqual(luaResult.status, 'PASS');
    });

    it('fails closed in staging on Redis authentication failure without printing secret', async () => {
      const mockRedisFactory = () => ({
        connect: async () => {
          throw new Error('WRONGPASS invalid username-password pair for default:top_secret_token_999');
        },
        ping: async () => 'PONG',
        eval: async () => 'ok',
        del: async () => 1,
        disconnect: () => {},
      });

      const report = await runPreflight({
        mode: 'staging',
        env: {
          REDIS_URL: 'rediss://default:top_secret_token_999@upstash.io:6379',
        },
        redisClientFactory: mockRedisFactory,
        exitOnError: false,
        quiet: true,
      });

      const connResult = report.results.find((r) => r.name === 'Redis Connection');
      assert.ok(connResult);
      assert.strictEqual(connResult.status, 'FAIL');
      assert.ok(!connResult.message.includes('top_secret_token_999'), 'Must redact token from error message');
      assert.strictEqual(report.success, false);
    });

    it('fails closed in staging on Redis connection timeout', async () => {
      const mockRedisFactory = () => ({
        connect: () => new Promise<void>(() => {}), // Never resolves (hangs)
        ping: async () => 'PONG',
        eval: async () => 'ok',
        del: async () => 1,
        disconnect: () => {},
      });

      const report = await runPreflight({
        mode: 'staging',
        env: {
          REDIS_URL: 'rediss://default:token@upstash.io:6379',
        },
        redisClientFactory: mockRedisFactory,
        exitOnError: false,
        quiet: true,
      });

      const connResult = report.results.find((r) => r.name === 'Redis Connection');
      assert.ok(connResult);
      assert.strictEqual(connResult.status, 'FAIL');
      assert.match(connResult.message, /timed out/i);
    });

    it('fails closed in staging on Redis unreachable host (DNS/network error)', async () => {
      const mockRedisFactory = () => ({
        connect: async () => {
          throw new Error('getaddrinfo ENOTFOUND non-existent-redis.upstash.io');
        },
        ping: async () => 'PONG',
        eval: async () => 'ok',
        del: async () => 1,
        disconnect: () => {},
      });

      const report = await runPreflight({
        mode: 'staging',
        env: {
          REDIS_URL: 'rediss://default:token@non-existent-redis.upstash.io:6379',
        },
        redisClientFactory: mockRedisFactory,
        exitOnError: false,
        quiet: true,
      });

      const connResult = report.results.find((r) => r.name === 'Redis Connection');
      assert.ok(connResult);
      assert.strictEqual(connResult.status, 'FAIL');
      assert.match(connResult.message, /ENOTFOUND/);
    });
  });

  describe('5. LiveKit SFU Configuration & Authenticated API Gates', () => {
    it('fails in staging when LiveKit credentials are not provided', async () => {
      const report = await runPreflight({
        mode: 'staging',
        env: {
          LIVEKIT_URL: '',
          LIVEKIT_API_KEY: '',
          LIVEKIT_API_SECRET: '',
        },
        exitOnError: false,
        quiet: true,
      });

      const lkResult = report.results.find((r) => r.name === 'SFU Credentials');
      assert.ok(lkResult);
      assert.strictEqual(lkResult.status, 'FAIL');
      assert.strictEqual(report.success, false);
    });

    it('passes LiveKit check when RoomServiceClient.listRooms() succeeds', async () => {
      const mockRoomClientFactory = () => ({
        listRooms: async () => [],
      });

      const report = await runPreflight({
        mode: 'staging',
        env: {
          LIVEKIT_URL: 'wss://my-project.livekit.cloud',
          LIVEKIT_API_KEY: 'API_VALID_KEY_1234567890',
          LIVEKIT_API_SECRET: 'SECRET_VALID_SECRET_12345678901234567890',
        },
        roomClientFactory: mockRoomClientFactory,
        exitOnError: false,
        quiet: true,
      });

      const apiResult = report.results.find((r) => r.name === 'LiveKit Authenticated API');
      assert.ok(apiResult);
      assert.strictEqual(apiResult.status, 'PASS');
      assert.match(apiResult.message, /verified successfully/i);
    });

    it('fails in staging when LiveKit authenticated API call throws unauthorized error', async () => {
      const mockRoomClientFactory = () => ({
        listRooms: async () => {
          throw new Error('Twirp error unauthenticated: invalid API key or secret token=SECRET_VAL_123');
        },
      });

      const report = await runPreflight({
        mode: 'staging',
        env: {
          LIVEKIT_URL: 'wss://my-project.livekit.cloud',
          LIVEKIT_API_KEY: 'API_VALID_KEY_1234567890',
          LIVEKIT_API_SECRET: 'SECRET_VALID_SECRET_12345678901234567890',
        },
        roomClientFactory: mockRoomClientFactory,
        exitOnError: false,
        quiet: true,
      });

      const apiResult = report.results.find((r) => r.name === 'LiveKit Authenticated API');
      assert.ok(apiResult);
      assert.strictEqual(apiResult.status, 'FAIL');
      assert.ok(!apiResult.message.includes('SECRET_VAL_123'), 'Must redact token from error message');
      assert.strictEqual(report.success, false);
    });

    it('fails in staging when LiveKit authenticated API call times out', async () => {
      const mockRoomClientFactory = () => ({
        listRooms: () => new Promise<unknown>(() => {}), // Never resolves (hangs)
      });

      const report = await runPreflight({
        mode: 'staging',
        env: {
          LIVEKIT_URL: 'wss://my-project.livekit.cloud',
          LIVEKIT_API_KEY: 'API_VALID_KEY_1234567890',
          LIVEKIT_API_SECRET: 'SECRET_VALID_SECRET_12345678901234567890',
        },
        roomClientFactory: mockRoomClientFactory,
        exitOnError: false,
        quiet: true,
      });

      const apiResult = report.results.find((r) => r.name === 'LiveKit Authenticated API');
      assert.ok(apiResult);
      assert.strictEqual(apiResult.status, 'FAIL');
      assert.match(apiResult.message, /timed out/i);
      assert.strictEqual(report.success, false);
    });
  });

  describe('6. Security, Cryptographic & Origin Gates', () => {
    it('fails in staging when JWT secrets use development defaults or are under 32 chars', async () => {
      const report = await runPreflight({
        mode: 'staging',
        env: {
          JWT_ACCESS_SECRET: 'dev_access_secret_insecure_default',
        },
        exitOnError: false,
        quiet: true,
      });

      const jwtResult = report.results.find((r) => r.name === 'JWT_ACCESS_SECRET');
      assert.ok(jwtResult);
      assert.strictEqual(jwtResult.status, 'FAIL');
    });

    it('fails in staging when CONNECTLY_ENCRYPTION_KEY_V1 is missing or not 256 bits', async () => {
      const report = await runPreflight({
        mode: 'staging',
        env: {
          CONNECTLY_ENCRYPTION_KEY_V1: 'too-short-key',
        },
        exitOnError: false,
        quiet: true,
      });

      const encResult = report.results.find((r) => r.name === 'Envelope Encryption Key');
      assert.ok(encResult);
      assert.strictEqual(encResult.status, 'FAIL');
    });

    it('fails in staging when CLIENT_ORIGIN is not HTTPS', async () => {
      const report = await runPreflight({
        mode: 'staging',
        env: {
          CLIENT_ORIGIN: 'http://my-unsecured-domain.com',
        },
        exitOnError: false,
        quiet: true,
      });

      const originResult = report.results.find((r) => r.name === 'CLIENT_ORIGIN');
      assert.ok(originResult);
      assert.strictEqual(originResult.status, 'FAIL');
    });

    it('passes CLIENT_ORIGIN when HTTPS is used', async () => {
      const report = await runPreflight({
        mode: 'staging',
        env: {
          CLIENT_ORIGIN: 'https://connectly-proxy.subdomain.workers.dev',
        },
        exitOnError: false,
        quiet: true,
      });

      const originResult = report.results.find((r) => r.name === 'CLIENT_ORIGIN');
      assert.ok(originResult);
      assert.strictEqual(originResult.status, 'PASS');
    });
  });

  describe('7. File Sharing Feature Gate Permutations', () => {
    it('safely skips S3 bucket validation when file sharing is explicitly disabled', async () => {
      const report = await runPreflight({
        mode: 'staging',
        env: {
          ENABLE_FILE_SHARING: 'false',
          STORAGE_PROVIDER: 'disabled',
        },
        exitOnError: false,
        quiet: true,
      });

      const gateResult = report.results.find((r) => r.name === 'File Sharing Gate');
      assert.ok(gateResult);
      assert.strictEqual(gateResult.status, 'INFO');
      assert.match(gateResult.message, /DISABLED/);

      const storageResult = report.results.find((r) => r.name === 'Object Storage Gate');
      assert.ok(storageResult);
      assert.strictEqual(storageResult.status, 'INFO');
    });

    it('fails in staging when ENABLE_FILE_SHARING=true but STORAGE_PROVIDER is not s3', async () => {
      const report = await runPreflight({
        mode: 'staging',
        env: {
          ENABLE_FILE_SHARING: 'true',
          STORAGE_PROVIDER: 'local',
        },
        exitOnError: false,
        quiet: true,
      });

      const gateResult = report.results.find((r) => r.name === 'File Sharing Gate');
      assert.ok(gateResult);
      assert.strictEqual(gateResult.status, 'FAIL');
    });
  });

  describe('8. Timeout Cleanup & Repeated Execution Resilience', () => {
    it('ensures disconnect is called on Redis client when connection times out', async () => {
      let disconnectCalled = false;
      const mockRedisFactory = () => ({
        connect: () => new Promise<void>(() => {}), // Never resolves (hangs)
        ping: async () => 'PONG',
        eval: async () => 'ok',
        del: async () => 1,
        disconnect: () => {
          disconnectCalled = true;
        },
      });

      const report = await runPreflight({
        mode: 'staging',
        env: {
          REDIS_URL: 'rediss://default:token@upstash.io:6379',
        },
        redisClientFactory: mockRedisFactory,
        exitOnError: false,
        quiet: true,
      });

      assert.strictEqual(disconnectCalled, true, 'client.disconnect() must be called in finally block upon timeout');
      const connResult = report.results.find((r) => r.name === 'Redis Connection');
      assert.ok(connResult);
      assert.strictEqual(connResult.status, 'FAIL');
    });

    it('survives repeated sequential preflight executions without state or handle leaks', async () => {
      let callCount = 0;
      const mockRedisFactory = () => ({
        connect: async () => {},
        ping: async () => 'PONG',
        eval: async () => 'ok',
        del: async () => 1,
        disconnect: () => {
          callCount++;
        },
      });

      const mockRoomClientFactory = () => ({
        listRooms: async () => [],
      });

      // Run 3 consecutive preflight passes
      for (let i = 0; i < 3; i++) {
        const report = await runPreflight({
          mode: 'development',
          env: {
            REDIS_URL: 'rediss://default:token@upstash.io:6379',
            LIVEKIT_URL: 'wss://my-project.livekit.cloud',
            LIVEKIT_API_KEY: 'API_VALID_KEY_1234567890',
            LIVEKIT_API_SECRET: 'SECRET_VALID_SECRET_12345678901234567890',
          },
          redisClientFactory: mockRedisFactory,
          roomClientFactory: mockRoomClientFactory,
          exitOnError: false,
          quiet: true,
        });

        assert.strictEqual(report.success, true);
      }

      assert.strictEqual(callCount, 3, 'Redis disconnect must have been cleanly called across all 3 passes');
    });
  });
});
