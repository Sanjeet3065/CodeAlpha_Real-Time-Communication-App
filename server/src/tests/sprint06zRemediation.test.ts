import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Duplex } from 'node:stream';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { io as ClientSocket } from 'socket.io-client';
import { AccessToken } from 'livekit-server-sdk';
import { createApp } from '../app.js';
import { env, envSchema } from '../config/env.js';
import {
  DEV_FALLBACK_ENCRYPTION_KEY_HEX,
  validateEncryptionKey,
  validateJwtSecret,
} from '../config/secretValidation.js';
import { EnvKeyProvider, SecurityConfigurationError } from '../services/keyManagement.service.js';
import {
  resolveFileSharingConfig,
  runPreflight,
} from '../scripts/verifyProductionReadiness.js';
import { User } from '../models/User.model.js';
import { Meeting } from '../models/Meeting.model.js';
import { MeetingParticipant } from '../models/MeetingParticipant.model.js';
import { MeetingRealtimeHub } from '../realtime/meetingSocket.js';
import {
  LiveKitSignalGateway,
  LIVEKIT_SIGNAL_GATEWAY_PATH,
} from '../realtime/livekitSignalGateway.js';
import { LiveKitRevocationCoordinator } from '../realtime/livekitRevocationCoordinator.js';
import {
  LiveKitService,
  getLiveKitParticipantIdentity,
  getLiveKitRoomName,
} from '../services/livekit.service.js';
import { hashPassword } from '../utils/password.js';
import { generateAccessToken } from '../utils/tokens.js';
import { resetReadinessHealthCacheForTesting } from '../routes/health.routes.js';
import { chatRedisService } from '../services/chatRedis.service.js';

const execFileAsync = promisify(execFile);

const TEST_MONGO_URI = 'mongodb://127.0.0.1:27017/connectly_sprint06z_test';
const TEST_RS_MONGO_URI = 'mongodb://127.0.0.1:27018/connectly_sprint06z_rs_test?replicaSet=rs0';

const VALID_PROD_SYNTHETIC_ENV: Record<string, string> = {
  NODE_ENV: 'production',
  PORT: '5000',
  CLIENT_ORIGIN: 'https://connectly-proxy.example.workers.dev',
  TRUST_PROXY: '1',
  PROXY_SECRET: 'b7e3c9f1a2d4e6b8c0f1a2d4e6b8c0f1b7e3c9f1a2d4e6b8c0f1a2d4e6b8c0f1',
  JWT_ACCESS_SECRET: 'synth_prod_jwt_access_key_9f8e7d6c5b4a392817',
  JWT_REFRESH_SECRET: 'synth_prod_jwt_refresh_key_1728394a5b6c7d8e9f',
  CONNECTLY_ENCRYPTION_KEY_V1: '9f8e7d6c5b4a392817161514131211100f0e0d0c0b0a090807060504030201f0',
  MONGODB_URI: TEST_RS_MONGO_URI,
  REQUIRE_TRANSACTIONS: 'true',
  REDIS_URL: 'rediss://default:synth_redis_token@example.upstash.io:6379',
  SOCKET_IO_ADAPTER: 'redis',
  SOCKET_IO_MULTI_INSTANCE: 'true',
  LIVEKIT_URL: 'wss://example-proj.livekit.cloud',
  LIVEKIT_API_KEY: 'API_SYNTH_TEST_KEY_01',
  LIVEKIT_API_SECRET: 'SynthLiveKitSecretKeyForSprint06ZTests987654',
  ENABLE_FILE_SHARING: 'false',
  STORAGE_PROVIDER: 'disabled',
};

const mockRedis = () => ({
  connect: async () => {},
  ping: async () => 'PONG',
  eval: async () => 'ok',
  del: async () => 1,
  disconnect: () => {},
});

const mockLiveKitClient = () => ({
  listRooms: async () => [],
});

interface WsResult {
  statusCode: number;
  socket?: Duplex;
}

function attemptWsUpgrade(
  port: number,
  reqPath: string,
  extraHeaders: Record<string, string> = {}
): Promise<WsResult> {
  return new Promise((resolve) => {
    const key = crypto.randomBytes(16).toString('base64');
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: reqPath,
      method: 'GET',
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Key': key,
        'Sec-WebSocket-Version': '13',
        ...extraHeaders,
      },
    });
    let settled = false;
    const finish = (r: WsResult) => {
      if (!settled) {
        settled = true;
        resolve(r);
      }
    };
    req.on('upgrade', (res, socket) => finish({ statusCode: res.statusCode || 101, socket }));
    req.on('response', (res) => {
      res.resume();
      finish({ statusCode: res.statusCode || 0 });
    });
    req.on('error', () => finish({ statusCode: 0 }));
    req.end();
  });
}

describe('Phase 18 Sprint 06Z — Final Preflight, Secret Validation & Realtime Closure Suite', () => {
  describe('1. Production Encryption Key Validation Alignment', () => {
    it('rejects dev fallback key (hex and base64), missing, malformed, and weak keys in production', async () => {
      const devFallbackBase64 = Buffer.from(DEV_FALLBACK_ENCRYPTION_KEY_HEX, 'hex').toString('base64');
      const invalidCases: Array<[string, string]> = [
        ['missing empty string', ''],
        ['malformed short', 'not_256_bits'],
        ['weak all zeroes', '00'.repeat(32)],
        ['weak repeated byte', 'ab'.repeat(32)],
        ['placeholder prefix', 'replace_with_high_entropy_64_hex_encryption_key_padded_to_len_ok'],
        ['dev fallback hex', DEV_FALLBACK_ENCRYPTION_KEY_HEX],
        ['dev fallback base64', devFallbackBase64],
      ];

      for (const [label, candidate] of invalidCases) {
        // Direct helper check
        assert.strictEqual(
          validateEncryptionKey(candidate, { required: true, allowDevDefault: false }).valid,
          false,
          `Helper must reject ${label}`
        );

        // Schema check
        const parsed = envSchema.safeParse({
          ...VALID_PROD_SYNTHETIC_ENV,
          CONNECTLY_ENCRYPTION_KEY_V1: candidate,
        });
        assert.strictEqual(parsed.success, false, `envSchema must reject ${label}`);

        // Preflight check
        const report = await runPreflight({
          mode: 'production',
          env: {
            ...VALID_PROD_SYNTHETIC_ENV,
            CONNECTLY_ENCRYPTION_KEY_V1: candidate,
          },
          exitOnError: false,
          quiet: true,
          redisClientFactory: mockRedis,
          roomClientFactory: mockLiveKitClient,
        });
        assert.strictEqual(report.success, false, `runPreflight must reject ${label}`);
        const encCheck = report.results.find((r) => r.name === 'Envelope Encryption Key');
        assert.strictEqual(encCheck?.status, 'FAIL', `Preflight Envelope check must FAIL for ${label}`);

        // KeyManager parity
        if (candidate && /^[0-9a-fA-F]{64}$/.test(candidate)) {
          assert.throws(() => {
            const p = new EnvKeyProvider({ nodeEnv: 'production', keys: { v1: candidate }, activeVersion: 'v1' });
            p.assertValid();
          }, SecurityConfigurationError);
        }
      }
    });

    it('accepts valid synthetic 64-hex and 44-base64 encryption keys', async () => {
      const validHex = '8c1e72b940f5a3d8c6123948ab7ef10293847561bcdefa908172635443322110';
      const validBase64 = Buffer.from(validHex, 'hex').toString('base64');

      for (const candidate of [validHex, validBase64]) {
        const parsed = envSchema.safeParse({
          ...VALID_PROD_SYNTHETIC_ENV,
          CONNECTLY_ENCRYPTION_KEY_V1: candidate,
        });
        assert.strictEqual(parsed.success, true, 'envSchema must accept valid 256-bit key');

        const report = await runPreflight({
          mode: 'production',
          env: {
            ...VALID_PROD_SYNTHETIC_ENV,
            CONNECTLY_ENCRYPTION_KEY_V1: candidate,
          },
          exitOnError: false,
          quiet: true,
          redisClientFactory: mockRedis,
          roomClientFactory: mockLiveKitClient,
        });
        const encCheck = report.results.find((r) => r.name === 'Envelope Encryption Key');
        assert.strictEqual(encCheck?.status, 'PASS');
      }
    });
  });

  describe('2. JWT Secret Validation (Access & Refresh Independent Enforcement)', () => {
    it('rejects replace_with_, REPLACE_WITH_, dev defaults, short (<32), and low-entropy JWT secrets', async () => {
      const badJwtValues = [
        'replace_with_at_least_32_char_cryptographically_secure_access_secret',
        'REPLACE_WITH_HIGH_ENTROPY_ACCESS_SECRET_MIN_32_CHARS',
        'dev_access_secret_insecure_default_string_32',
        'dev_refresh_secret_insecure_default_string_32',
        'connectly_dev_access_secret_super_secure_key',
        'changeme_insecure_jwt_secret_value_long_enough',
        'short_key_20_chars_x',
        'a'.repeat(40),
      ];

      for (const secret of badJwtValues) {
        // Test JWT_ACCESS_SECRET independently
        assert.strictEqual(validateJwtSecret(secret, 'JWT_ACCESS_SECRET', true).valid, false);
        assert.strictEqual(
          envSchema.safeParse({ ...VALID_PROD_SYNTHETIC_ENV, JWT_ACCESS_SECRET: secret }).success,
          false,
          `envSchema must reject bad JWT_ACCESS_SECRET: ${secret}`
        );

        // Test JWT_REFRESH_SECRET independently
        assert.strictEqual(validateJwtSecret(secret, 'JWT_REFRESH_SECRET', true).valid, false);
        assert.strictEqual(
          envSchema.safeParse({ ...VALID_PROD_SYNTHETIC_ENV, JWT_REFRESH_SECRET: secret }).success,
          false,
          `envSchema must reject bad JWT_REFRESH_SECRET: ${secret}`
        );

        const report = await runPreflight({
          mode: 'production',
          env: {
            ...VALID_PROD_SYNTHETIC_ENV,
            JWT_ACCESS_SECRET: secret,
            JWT_REFRESH_SECRET: secret,
          },
          exitOnError: false,
          quiet: true,
          redisClientFactory: mockRedis,
          roomClientFactory: mockLiveKitClient,
        });
        assert.strictEqual(
          report.results.find((r) => r.name === 'JWT_ACCESS_SECRET')?.status,
          'FAIL'
        );
        assert.strictEqual(
          report.results.find((r) => r.name === 'JWT_REFRESH_SECRET')?.status,
          'FAIL'
        );
      }
    });

    it('keeps development mode compatible with standard dev secrets', async () => {
      const parsedDev = envSchema.safeParse({
        NODE_ENV: 'development',
        JWT_ACCESS_SECRET: 'connectly_dev_access_secret_super_secure_key_32_bytes_min_length',
        JWT_REFRESH_SECRET: 'connectly_dev_refresh_secret_super_secure_key_32_bytes_min_length',
      });
      assert.strictEqual(parsedDev.success, true);
    });
  });

  describe('3. Preflight Eager-Import Fix & Synthetic CLI Execution', () => {
    it('prints structured [PREFLIGHT AUDIT SUMMARY] instead of raw Zod crash when NODE_ENV=production has incomplete env', async () => {
      let stdout = '';
      let exitCode: number | string | undefined = 0;

      try {
        const res = await execFileAsync(
          process.execPath,
          ['--import', 'tsx', 'src/scripts/verifyProductionReadiness.ts', '--mode=production'],
          {
            cwd: process.cwd(),
            env: {
              PATH: process.env.PATH,
              SYSTEMROOT: process.env.SYSTEMROOT,
              NODE_ENV: 'production',
              MONGODB_URI: TEST_MONGO_URI,
            },
            timeout: 20_000,
          }
        );
        stdout = res.stdout;
      } catch (err: any) {
        stdout = String(err.stdout || '') + String(err.stderr || '');
        exitCode = err.code;
      }

      assert.strictEqual(exitCode, 1, 'Incomplete production env must exit non-zero cleanly');
      assert.ok(
        stdout.includes('PREFLIGHT AUDIT SUMMARY [PRODUCTION]'),
        `Expected formatted preflight summary instead of raw Zod import crash; got:\n${stdout}`
      );
      assert.ok(stdout.includes('PROXY_SECRET'), 'Must report PROXY_SECRET diagnostic');
      assert.ok(stdout.includes('[PREFLIGHT FAILED]'), 'Must print structured preflight summary footer');
    });
  });

  describe('4. ENABLE_FILE_SHARING & Storage Provider Default Consistency', () => {
    it('interprets unset ENABLE_FILE_SHARING identically across Step 1 and Step 5', async () => {
      const resolvedUnsetStrict = resolveFileSharingConfig({ STORAGE_PROVIDER: 'auto' }, true);
      assert.strictEqual(resolvedUnsetStrict.enableFileSharing, true);
      assert.strictEqual(resolvedUnsetStrict.effectiveProvider, 's3');

      const resolvedDisabled = resolveFileSharingConfig(
        { ENABLE_FILE_SHARING: 'false', STORAGE_PROVIDER: 'disabled' },
        true
      );
      assert.strictEqual(resolvedDisabled.enableFileSharing, false);
      assert.strictEqual(resolvedDisabled.effectiveProvider, 'disabled');

      // When ENABLE_FILE_SHARING is unset and STORAGE_PROVIDER='local' in production, Step 1 and Step 5 MUST NOT disagree
      const envCopy = { ...VALID_PROD_SYNTHETIC_ENV };
      delete (envCopy as any).ENABLE_FILE_SHARING;
      envCopy.STORAGE_PROVIDER = 'local';

      const report = await runPreflight({
        mode: 'production',
        env: envCopy,
        exitOnError: false,
        quiet: true,
        redisClientFactory: mockRedis,
        roomClientFactory: mockLiveKitClient,
      });

      const gate = report.results.find((r) => r.name === 'File Sharing Gate');
      const obj = report.results.find((r) => r.name === 'S3 Bucket Versioning' || r.name === 'Object Storage Gate');
      assert.strictEqual(gate?.status, 'FAIL');
      assert.strictEqual(obj?.status, 'FAIL');
      assert.ok(!String(obj?.message).includes('DISABLED'), 'Must not claim file sharing is disabled when unset');
    });

    it('invokes storageVerifierFactory when ENABLE_FILE_SHARING=true & STORAGE_PROVIDER=s3', async () => {
      let verifierCalled = false;
      const report = await runPreflight({
        mode: 'production',
        env: {
          ...VALID_PROD_SYNTHETIC_ENV,
          ENABLE_FILE_SHARING: 'true',
          STORAGE_PROVIDER: 's3',
          STORAGE_S3_BUCKET: 'synthetic-test-bucket',
          STORAGE_S3_REGION: 'us-east-1',
        },
        exitOnError: false,
        quiet: true,
        redisClientFactory: mockRedis,
        roomClientFactory: mockLiveKitClient,
        storageVerifierFactory: () => ({
          verifyBucketVersioning: async () => {
            verifierCalled = true;
          },
        }),
      });
      assert.strictEqual(verifierCalled, true);
      assert.strictEqual(report.results.find((r) => r.name === 'S3 Bucket Versioning')?.status, 'PASS');
      assert.strictEqual(report.success, true);
    });
  });

  describe('5. Socket.IO & /livekit-signal Direct-Origin Upgrade Security', () => {
    let httpServer: http.Server;
    let port: number;
    let hub: MeetingRealtimeHub;
    let gateway: LiveKitSignalGateway;
    let coordinator: LiveKitRevocationCoordinator;
    let lkMockServer: http.Server;
    let lkPort: number;
    const upstreamSockets = new Set<Duplex>();

    let hostUser: any;
    let admittedUser: any;
    let waitingUser: any;
    let outsiderUser: any;
    let meeting: any;
    let meetingCode: string;

    const lkApiKey = 'API_SPRINT06Z_KEY';
    const lkApiSecret = 'SuperSecureLiveKitSecretKeySprint06ZTest987654';

    before(async () => {
      if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
      }
      await mongoose.connect(TEST_MONGO_URI);

      // Local mock upstream LiveKit SFU server to verify real gateway 101 upgrades
      lkMockServer = http.createServer((_req, res) => res.end('ok'));
      lkMockServer.on('upgrade', (_req, socket) => {
        upstreamSockets.add(socket);
        socket.on('close', () => upstreamSockets.delete(socket));
        socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
      });
      await new Promise<void>((r) => lkMockServer.listen(0, '127.0.0.1', r));
      lkPort = (lkMockServer.address() as any).port;

      const unique = Date.now();
      const pwHash = await hashPassword('Password123!');
      [hostUser, admittedUser, waitingUser, outsiderUser] = await User.create([
        { email: `h_06z_${unique}@test.local`, passwordHash: pwHash, firstName: 'Host', lastName: 'Z', isEmailVerified: true },
        { email: `a_06z_${unique}@test.local`, passwordHash: pwHash, firstName: 'Admitted', lastName: 'Z', isEmailVerified: true },
        { email: `w_06z_${unique}@test.local`, passwordHash: pwHash, firstName: 'Waiting', lastName: 'Z', isEmailVerified: true },
        { email: `o_06z_${unique}@test.local`, passwordHash: pwHash, firstName: 'Outsider', lastName: 'Z', isEmailVerified: true },
      ]);

      meetingCode = `cly-szz-${String(unique).slice(-3)}`;
      meeting = await Meeting.create({
        meetingCode,
        title: 'Sprint 06Z Security Audit Meeting',
        hostId: hostUser._id,
        originalHostId: hostUser._id,
        status: 'ACTIVE',
        maxParticipants: 60,
        activeParticipantCount: 2,
        expiresAt: new Date(Date.now() + 3600_000),
      });

      await MeetingParticipant.create([
        { meetingId: meeting._id, userId: hostUser._id, email: hostUser.email, displayName: 'Host Z', role: 'host', admissionStatus: 'ADMITTED', tokenEpoch: 1 },
        { meetingId: meeting._id, userId: admittedUser._id, email: admittedUser.email, displayName: 'Admitted Z', role: 'participant', admissionStatus: 'ADMITTED', tokenEpoch: 1 },
        { meetingId: meeting._id, userId: waitingUser._id, email: waitingUser.email, displayName: 'Waiting Z', role: 'participant', admissionStatus: 'WAITING', tokenEpoch: 1 },
      ]);

      const lkSvc = new LiveKitService({
        nodeEnv: 'development',
        config: {
          url: `ws://127.0.0.1:${lkPort}`,
          apiKey: lkApiKey,
          apiSecret: lkApiSecret,
          signalGatewayEnabled: 'true',
          tokenTtlSeconds: 600,
        },
      });
      coordinator = new LiveKitRevocationCoordinator({ transactionPolicy: 'optional' });
      await coordinator.start();

      hub = new MeetingRealtimeHub();
      gateway = new LiveKitSignalGateway(lkSvc, {}, coordinator, { activeSocketRevalidationIntervalMs: 0 });

      const app = createApp({ signalGateway: gateway });
      httpServer = http.createServer(app);
      hub.attach(httpServer);
      gateway.attach(httpServer);

      await new Promise<void>((r) => httpServer.listen(0, '127.0.0.1', r));
      port = (httpServer.address() as any).port;
    });

    after(async () => {
      try {
        gateway?.close();
        if (coordinator) await coordinator.stop();
        if (hub) await hub.closeAsync();
        for (const s of upstreamSockets) {
          s.destroy();
        }
        upstreamSockets.clear();
        httpServer?.closeAllConnections?.();
        lkMockServer?.closeAllConnections?.();
        if (httpServer?.listening) await new Promise<void>((r) => httpServer.close(() => r()));
        if (lkMockServer?.listening) await new Promise<void>((r) => lkMockServer.close(() => r()));
        if (meeting?._id) {
          await MeetingParticipant.deleteMany({ meetingId: meeting._id });
          await Meeting.deleteOne({ _id: meeting._id });
        }
        const userIds = [hostUser?._id, admittedUser?._id, waitingUser?._id, outsiderUser?._id].filter(Boolean);
        if (userIds.length > 0) {
          await User.deleteMany({ _id: { $in: userIds } });
        }
      } finally {
        if (mongoose.connection.readyState !== 0) {
          await mongoose.disconnect();
        }
      }
    });

    it('rejects unauthenticated, expired, and forged JWTs on direct Socket.IO handshake even with trusted Origin header', async () => {
      const noToken = ClientSocket(`http://127.0.0.1:${port}`, {
        transports: ['websocket'],
        extraHeaders: { Origin: env.CLIENT_ORIGIN },
        reconnection: false,
      });
      const errNoToken = await new Promise<Error>((r) => noToken.on('connect_error', r));
      assert.match(errNoToken.message, /UNAUTHORIZED/);
      noToken.close();

      const expiredJwt = jwt.sign({ sub: outsiderUser._id.toString() }, env.JWT_ACCESS_SECRET, { expiresIn: -10 });
      const expSocket = ClientSocket(`http://127.0.0.1:${port}`, {
        auth: { token: expiredJwt },
        transports: ['websocket'],
        extraHeaders: { Origin: env.CLIENT_ORIGIN },
        reconnection: false,
      });
      const errExp = await new Promise<Error>((r) => expSocket.on('connect_error', r));
      assert.match(errExp.message, /UNAUTHORIZED/);
      expSocket.close();

      const forgedJwt = jwt.sign({ sub: hostUser._id.toString() }, 'wrong_forged_jwt_signing_key_123456', { expiresIn: '5m' });
      const forgedSocket = ClientSocket(`http://127.0.0.1:${port}`, {
        auth: { token: forgedJwt },
        transports: ['websocket'],
        reconnection: false,
      });
      const errForged = await new Promise<Error>((r) => forgedSocket.on('connect_error', r));
      assert.match(errForged.message, /UNAUTHORIZED/);
      forgedSocket.close();
    });

    it('blocks outsider and WAITING users from subscribing to admitted room or spoofing whiteboard:cursor, while legitimate clients work without X-Proxy-Secret', async () => {
      const admittedJwt = generateAccessToken({ sub: admittedUser._id.toString(), email: admittedUser.email, firstName: 'Admitted', lastName: 'Z' });
      const waitingJwt = generateAccessToken({ sub: waitingUser._id.toString(), email: waitingUser.email, firstName: 'Waiting', lastName: 'Z' });
      const outsiderJwt = generateAccessToken({ sub: outsiderUser._id.toString(), email: outsiderUser.email, firstName: 'Outsider', lastName: 'Z' });

      const sAdmitted = ClientSocket(`http://127.0.0.1:${port}`, { auth: { token: admittedJwt }, transports: ['websocket'], reconnection: false });
      const sWaiting = ClientSocket(`http://127.0.0.1:${port}`, { auth: { token: waitingJwt }, transports: ['websocket'], reconnection: false });
      const sOutsider = ClientSocket(`http://127.0.0.1:${port}`, { auth: { token: outsiderJwt }, transports: ['websocket'], reconnection: false });

      await Promise.all([
        new Promise<void>((r) => sAdmitted.on('connect', r)),
        new Promise<void>((r) => sWaiting.on('connect', r)),
        new Promise<void>((r) => sOutsider.on('connect', r)),
      ]);

      // Admitted subscribes OK without X-Proxy-Secret
      const subAdmitted = await new Promise<any>((r) => sAdmitted.emit('meeting:subscribe', { meetingCode }, r));
      assert.strictEqual(subAdmitted.ok, true);
      assert.strictEqual(subAdmitted.status, 'ADMITTED');

      // Outsider subscribe denied
      const subOutsider = await new Promise<any>((r) => sOutsider.emit('meeting:subscribe', { meetingCode }, r));
      assert.strictEqual(subOutsider.ok, false);
      assert.strictEqual(subOutsider.code, 'FORBIDDEN');

      // Waiting subscribe stays strictly WAITING (cannot join admitted channel)
      const subWaiting = await new Promise<any>((r) => sWaiting.emit('meeting:subscribe', { meetingCode }, r));
      assert.strictEqual(subWaiting.ok, true);
      assert.strictEqual(subWaiting.status, 'WAITING');

      const observedCursors: any[] = [];
      sAdmitted.on('whiteboard:cursor', (c: any) => observedCursors.push(c));

      // Outsider & Waiting attempt spoofed cursor injection
      sOutsider.emit('whiteboard:cursor', { meetingCode, x: 100, y: 100 });
      sWaiting.emit('whiteboard:cursor', { meetingCode, x: 200, y: 200 });
      await new Promise((r) => setTimeout(r, 150));

      assert.strictEqual(observedCursors.length, 0, 'Outsider and WAITING users MUST NOT inject whiteboard cursors');

      sAdmitted.disconnect();
      sWaiting.disconnect();
      sOutsider.disconnect();
    });

    it('enforces JWT signature/expiry, ADMITTED state, and epoch revocation on direct /livekit-signal/rtc upgrades without breaking valid clients', async () => {
      const roomName = getLiveKitRoomName(meeting._id.toString());

      // Missing token
      const missingRes = await attemptWsUpgrade(port, `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc`);
      missingRes.socket?.destroy();
      assert.strictEqual(missingRes.statusCode, 401);

      // Expired LiveKit JWT (beyond TokenVerifier clock tolerance)
      const expToken = new AccessToken(lkApiKey, lkApiSecret, {
        identity: getLiveKitParticipantIdentity(admittedUser._id.toString(), 'sess1'),
        ttl: -120,
        metadata: JSON.stringify({ epoch: 1, meetingId: meeting._id.toString() }),
      });
      expToken.addGrant({ roomJoin: true, room: roomName });
      const expRes = await attemptWsUpgrade(
        port,
        `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc?access_token=${encodeURIComponent(await expToken.toJwt())}`
      );
      expRes.socket?.destroy();
      assert.strictEqual(expRes.statusCode, 401);

      // Forged-signature LiveKit JWT
      const forgedLkToken = new AccessToken(lkApiKey, 'WrongForgedLiveKitSecretKeySprint06Z98765432', {
        identity: getLiveKitParticipantIdentity(admittedUser._id.toString(), 'sessforged'),
        ttl: 600,
        metadata: JSON.stringify({ epoch: 1, meetingId: meeting._id.toString() }),
      });
      forgedLkToken.addGrant({ roomJoin: true, room: roomName });
      const forgedLkRes = await attemptWsUpgrade(
        port,
        `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc?access_token=${encodeURIComponent(await forgedLkToken.toJwt())}`
      );
      forgedLkRes.socket?.destroy();
      assert.strictEqual(forgedLkRes.statusCode, 401);

      // Waiting user with syntactically valid LiveKit token -> denied 403
      const waitToken = new AccessToken(lkApiKey, lkApiSecret, {
        identity: getLiveKitParticipantIdentity(waitingUser._id.toString(), 'sessw'),
        ttl: 600,
        metadata: JSON.stringify({ epoch: 1, meetingId: meeting._id.toString() }),
      });
      waitToken.addGrant({ roomJoin: true, room: roomName });
      const waitRes = await attemptWsUpgrade(
        port,
        `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc?access_token=${encodeURIComponent(await waitToken.toJwt())}`,
        { Origin: env.CLIENT_ORIGIN }
      );
      waitRes.socket?.destroy();
      assert.strictEqual(waitRes.statusCode, 403);

      // Stale epoch token -> denied 403
      const staleToken = new AccessToken(lkApiKey, lkApiSecret, {
        identity: getLiveKitParticipantIdentity(admittedUser._id.toString(), 'sessold'),
        ttl: 600,
        metadata: JSON.stringify({ epoch: 99, meetingId: meeting._id.toString() }),
      });
      staleToken.addGrant({ roomJoin: true, room: roomName });
      const staleRes = await attemptWsUpgrade(
        port,
        `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc?access_token=${encodeURIComponent(await staleToken.toJwt())}`
      );
      staleRes.socket?.destroy();
      assert.strictEqual(staleRes.statusCode, 403);

      // Valid ADMITTED user succeeds (101) directly without X-Proxy-Secret
      const validToken = new AccessToken(lkApiKey, lkApiSecret, {
        identity: getLiveKitParticipantIdentity(admittedUser._id.toString(), 'sessgood'),
        ttl: 600,
        metadata: JSON.stringify({ epoch: 1, meetingId: meeting._id.toString() }),
      });
      validToken.addGrant({ roomJoin: true, room: roomName });
      const validRes = await attemptWsUpgrade(
        port,
        `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc?access_token=${encodeURIComponent(await validToken.toJwt())}`
      );
      assert.strictEqual(validRes.statusCode, 101);
      validRes.socket?.destroy();
    });
  });

  describe('6. Public Readiness Endpoint Coalescing, Caching & Timeout Hardening', () => {
    it('coalesces/caches Redis ping probes across burst requests without masking DB state', async () => {
      if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
      }
      await mongoose.connect(TEST_MONGO_URI);
      resetReadinessHealthCacheForTesting();

      const originalPing = chatRedisService.ping.bind(chatRedisService);
      const originalRedisUrl = (env as any).REDIS_URL;
      let pingCalls = 0;

      (env as any).REDIS_URL = 'rediss://default:synth@example.upstash.io:6379';
      (chatRedisService as any).ping = async () => {
        pingCalls += 1;
        await new Promise((r) => setTimeout(r, 25));
        return true;
      };

      const app = createApp();
      const server = http.createServer(app);
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      const port = (server.address() as any).port;

      try {
        // Send 10 concurrent + sequential readiness requests
        const batch = await Promise.all(
          Array.from({ length: 10 }, () => fetch(`http://127.0.0.1:${port}/ready`))
        );
        for (const r of batch) {
          assert.strictEqual(r.status, 200);
        }
        assert.strictEqual(pingCalls, 1, 'Burst /ready calls MUST coalesce/cache to at most 1 Redis PING within TTL');

        // Verify disconnect still fails immediately (DB check is not masked by Redis cache)
        await mongoose.disconnect();
        const disconnectedRes = await fetch(`http://127.0.0.1:${port}/ready`);
        assert.strictEqual(disconnectedRes.status, 503);
      } finally {
        (chatRedisService as any).ping = originalPing;
        (env as any).REDIS_URL = originalRedisUrl;
        resetReadinessHealthCacheForTesting();
        await new Promise<void>((r) => server.close(() => r()));
        if (mongoose.connection.readyState !== 0) {
          await mongoose.disconnect();
        }
      }
    });
  });
});
