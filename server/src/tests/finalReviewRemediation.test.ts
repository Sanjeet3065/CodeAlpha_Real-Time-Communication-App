import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import mongoose from 'mongoose';
import express, { type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { RoomServiceClient } from 'livekit-server-sdk';
import { createValidateRequestOrigin, getAllowedCsrfOrigins, requireCsrfHeader } from '../middlewares/csrf.middleware.js';
import { createRateLimitMessage } from '../middlewares/rateLimiter.js';
import { register } from '../controllers/auth.controller.js';
import { listAuditLogs } from '../controllers/admin.controller.js';
import { getMeetingInvitationHandler } from '../controllers/scheduling.controller.js';
import { SecurityAuditEntry } from '../models/SecurityAuditEntry.model.js';
import { schedulingService } from '../services/scheduling.service.js';
import { User } from '../models/User.model.js';
import { createApp } from '../app.js';
import { createGracefulShutdown } from '../utils/gracefulShutdown.js';
import {
  startDeterministicLiveKitTwirpMock,
  runCiPreflightWithMockLiveKit,
} from '../scripts/runCiProductionPreflight.js';
import { runPreflight } from '../scripts/verifyProductionReadiness.js';
import { DEV_FALLBACK_ENCRYPTION_KEY_HEX } from '../config/secretValidation.js';

const REPO_ROOT = path.resolve(process.cwd(), '..');

describe('Final Code Review Remediation Regression Suite', () => {
  describe('F-REV-01 — CI Pipeline & Deterministic LiveKit Preflight Harness', () => {
    it('ensures .github/workflows/ci.yml uses deterministic CI preflight, high-entropy synthetic secrets, and push/pull_request triggers', () => {
      const ciPath = path.join(REPO_ROOT, '.github', 'workflows', 'ci.yml');
      const ciContent = fs.readFileSync(ciPath, 'utf-8');

      assert.match(ciContent, /push:/);
      assert.match(ciContent, /pull_request:/);
      assert.match(ciContent, /npm run verify:ci-production --workspace=server/);
      assert.ok(
        !ciContent.includes(DEV_FALLBACK_ENCRYPTION_KEY_HEX),
        'CI workflow must not use deterministic dev fallback encryption key'
      );
      assert.ok(
        !ciContent.includes('wss://example.livekit.cloud'),
        'CI workflow must not attempt live calls to example.livekit.cloud'
      );
      assert.match(ciContent, /PROXY_SECRET:\s*[0-9a-fA-F]{64}/);
      assert.match(ciContent, /CONNECTLY_ENCRYPTION_KEY_V1:\s*[0-9a-fA-F]{64}/);
    });

    it('authenticates signed LiveKit RoomService.listRooms() calls locally without external network calls and rejects invalid tokens', async () => {
      const apiKey = 'API_SYNTH_TWIRP_TEST';
      const apiSecret = 'SynthTwirpSecretForLocalUnitTest9876543210';
      const mock = await startDeterministicLiveKitTwirpMock(apiKey, apiSecret);

      try {
        const httpUrl = mock.url.replace(/^ws:/, 'http:');
        const validClient = new RoomServiceClient(httpUrl, apiKey, apiSecret);
        const rooms = await validClient.listRooms();
        assert.deepStrictEqual(rooms, []);

        const invalidClient = new RoomServiceClient(httpUrl, apiKey, 'WrongLiveKitSecret000000000000000000');
        await assert.rejects(() => invalidClient.listRooms());
      } finally {
        await mock.close();
      }
    });

    it('passes strict production preflight when loopback LIVEKIT_URL is paired with TLS LIVEKIT_PUBLIC_URL gateway and still blocks insecure non-loopback ws://', async () => {
      const apiKey = 'API_SYNTH_GW_PREFLIGHT';
      const apiSecret = 'SynthGatewayPreflightSecret9876543210abcd';
      const mock = await startDeterministicLiveKitTwirpMock(apiKey, apiSecret);

      const baseEnv = {
        NODE_ENV: 'production',
        PORT: '5000',
        CLIENT_ORIGIN: 'https://connectly.example.com',
        TRUST_PROXY: '1',
        PROXY_SECRET: 'a9d4f2c8e1b73056c2a8f4e9d1b63708e5a1c3f7b9d20468a1c5e7f9b3d10246',
        MONGODB_URI: 'mongodb://127.0.0.1:27018/connectly_ci_gateway_preflight?replicaSet=rs0',
        REQUIRE_TRANSACTIONS: 'true',
        REDIS_URL: 'rediss://default:synth_upstash_tok@example.upstash.io:6379',
        SOCKET_IO_ADAPTER: 'redis',
        SOCKET_IO_MULTI_INSTANCE: 'true',
        JWT_ACCESS_SECRET: 'ci_synth_jwt_access_key_9f8e7d6c5b4a39281706',
        JWT_REFRESH_SECRET: 'ci_synth_jwt_refresh_key_1728394a5b6c7d8e9f',
        CONNECTLY_ENCRYPTION_KEY_V1:
          '8f4e2a9c1b7d5e3f0a8c6e4d2b1f9a7c5e3d1b9f7e5c3a1d9b7f5e3c1a9d7b5f',
        LIVEKIT_PUBLIC_URL: 'wss://connectly.example.com/livekit-signal',
        LIVEKIT_SIGNAL_GATEWAY_ENABLED: 'true',
        LIVEKIT_API_KEY: apiKey,
        LIVEKIT_API_SECRET: apiSecret,
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

      try {
        const passReport = await runPreflight({
          mode: 'production',
          exitOnError: false,
          quiet: true,
          env: { ...baseEnv, LIVEKIT_URL: mock.url },
          redisClientFactory: mockRedis,
        });
        assert.strictEqual(passReport.success, true, 'Loopback Twirp mock + TLS gateway must pass');
        assert.strictEqual(
          passReport.results.find((r) => r.name === 'LiveKit Authenticated API')?.status,
          'PASS'
        );

        const failReport = await runPreflight({
          mode: 'production',
          exitOnError: false,
          quiet: true,
          env: { ...baseEnv, LIVEKIT_URL: 'ws://untrusted-remote.example.com:7880' },
          redisClientFactory: mockRedis,
        });
        assert.strictEqual(failReport.success, false, 'Non-loopback ws:// must remain blocked in production');
        assert.strictEqual(
          failReport.results.find((r) => r.name === 'SFU Config Validation')?.status,
          'FAIL'
        );
      } finally {
        await mock.close();
      }
    });

    it('preserves strict production secret validation in CI preflight (rejects dev encryption key & missing PROXY_SECRET)', async () => {
      const devKeyFail = await runCiPreflightWithMockLiveKit({
        CONNECTLY_ENCRYPTION_KEY_V1: DEV_FALLBACK_ENCRYPTION_KEY_HEX,
        PROXY_SECRET: 'a9d4f2c8e1b73056c2a8f4e9d1b63708e5a1c3f7b9d20468a1c5e7f9b3d10246',
        JWT_ACCESS_SECRET: 'ci_synth_jwt_access_key_9f8e7d6c5b4a39281706',
        JWT_REFRESH_SECRET: 'ci_synth_jwt_refresh_key_1728394a5b6c7d8e9f',
        LIVEKIT_API_KEY: 'API_CI_SYNTH_KEY_918273',
        LIVEKIT_API_SECRET: 'CiSynthLiveKitSecretKey9876543210abcd',
        CLIENT_ORIGIN: 'https://connectly.example.com',
        TRUST_PROXY: '1',
        MONGODB_URI: 'mongodb://127.0.0.1:27017/connectly_ci_neg_test',
        REDIS_URL: 'rediss://default:synth@127.0.0.1:6399',
        ENABLE_FILE_SHARING: 'false',
        STORAGE_PROVIDER: 'disabled',
      });

      assert.strictEqual(devKeyFail.exitCode, 1);
      assert.match(devKeyFail.stdout + devKeyFail.stderr, /Envelope Encryption Key/);

      const missingProxySecretFail = await runCiPreflightWithMockLiveKit({
        CONNECTLY_ENCRYPTION_KEY_V1: '8f4e2a9c1b7d5e3f0a8c6e4d2b1f9a7c5e3d1b9f7e5c3a1d9b7f5e3c1a9d7b5f',
        PROXY_SECRET: '',
        JWT_ACCESS_SECRET: 'ci_synth_jwt_access_key_9f8e7d6c5b4a39281706',
        JWT_REFRESH_SECRET: 'ci_synth_jwt_refresh_key_1728394a5b6c7d8e9f',
        LIVEKIT_API_KEY: 'API_CI_SYNTH_KEY_918273',
        LIVEKIT_API_SECRET: 'CiSynthLiveKitSecretKey9876543210abcd',
        CLIENT_ORIGIN: 'https://connectly.example.com',
        TRUST_PROXY: '1',
        MONGODB_URI: 'mongodb://127.0.0.1:27017/connectly_ci_neg_test',
        REDIS_URL: 'rediss://default:synth@127.0.0.1:6399',
        ENABLE_FILE_SHARING: 'false',
        STORAGE_PROVIDER: 'disabled',
      });

      assert.strictEqual(missingProxySecretFail.exitCode, 1);
      assert.match(missingProxySecretFail.stdout + missingProxySecretFail.stderr, /PROXY_SECRET/);
    });
  });

  describe('F-REV-02 — Production vs Development CSRF Origin Policy', () => {
    it('getAllowedCsrfOrigins includes localhost only outside production', () => {
      assert.deepStrictEqual(getAllowedCsrfOrigins('https://connectly.example.com', 'production'), [
        'https://connectly.example.com',
      ]);

      const devAllowed = getAllowedCsrfOrigins('https://connectly.example.com', 'development');
      assert.ok(devAllowed.includes('https://connectly.example.com'));
      assert.ok(devAllowed.includes('http://localhost:5173'));
      assert.ok(devAllowed.includes('http://127.0.0.1:5173'));
    });

    it('enforces configured CLIENT_ORIGIN strictly in production while allowing localhost in development', async () => {
      const prodApp = express();
      prodApp.use(
        createValidateRequestOrigin({
          clientOrigin: 'https://connectly.example.com',
          nodeEnv: 'production',
        })
      );
      prodApp.post('/state-change', (_req, res) => res.status(200).json({ ok: true }));
      prodApp.post('/cookie-change', requireCsrfHeader, (_req, res) => res.status(200).json({ ok: true }));

      const prodServer = http.createServer(prodApp);
      await new Promise<void>((r) => prodServer.listen(0, '127.0.0.1', r));
      const prodPort = (prodServer.address() as { port: number }).port;

      const devApp = express();
      devApp.use(
        createValidateRequestOrigin({
          clientOrigin: 'https://connectly.example.com',
          nodeEnv: 'development',
        })
      );
      devApp.post('/state-change', (_req, res) => res.status(200).json({ ok: true }));

      const devServer = http.createServer(devApp);
      await new Promise<void>((r) => devServer.listen(0, '127.0.0.1', r));
      const devPort = (devServer.address() as { port: number }).port;

      try {
        // Production rejects localhost Origin & Referer
        const prodLocalOrigin = await fetch(`http://127.0.0.1:${prodPort}/state-change`, {
          method: 'POST',
          headers: { Origin: 'http://localhost:5173' },
        });
        assert.strictEqual(prodLocalOrigin.status, 403);
        assert.strictEqual(((await prodLocalOrigin.json()) as { code: string }).code, 'CSRF_INVALID_ORIGIN');

        const prodLoopbackReferer = await fetch(`http://127.0.0.1:${prodPort}/state-change`, {
          method: 'POST',
          headers: { Referer: 'http://127.0.0.1:5173/login' },
        });
        assert.strictEqual(prodLoopbackReferer.status, 403);
        assert.strictEqual(
          ((await prodLoopbackReferer.json()) as { code: string }).code,
          'CSRF_INVALID_REFERER'
        );

        // Production rejects sandboxed "null" origin
        const prodNullOrigin = await fetch(`http://127.0.0.1:${prodPort}/state-change`, {
          method: 'POST',
          headers: { Origin: 'null' },
        });
        assert.strictEqual(prodNullOrigin.status, 403);

        // Production accepts exact CLIENT_ORIGIN
        const prodAllowed = await fetch(`http://127.0.0.1:${prodPort}/state-change`, {
          method: 'POST',
          headers: { Origin: 'https://connectly.example.com' },
        });
        assert.strictEqual(prodAllowed.status, 200);

        // Cookie route without Origin/Referer still blocks without custom CSRF header
        const cookieNoHeader = await fetch(`http://127.0.0.1:${prodPort}/cookie-change`, {
          method: 'POST',
        });
        assert.strictEqual(cookieNoHeader.status, 403);
        assert.strictEqual(
          ((await cookieNoHeader.json()) as { code: string }).code,
          'CSRF_VERIFICATION_FAILED'
        );

        // Development accepts localhost & 127.0.0.1 Vite origins
        const devAllowed = await fetch(`http://127.0.0.1:${devPort}/state-change`, {
          method: 'POST',
          headers: { Origin: 'http://localhost:5173' },
        });
        assert.strictEqual(devAllowed.status, 200);
      } finally {
        await new Promise<void>((r) => prodServer.close(() => r()));
        await new Promise<void>((r) => devServer.close(() => r()));
      }
    });
  });

  describe('F-REV-03 — Secret Hygiene, Archived Bundles & README Sync', () => {
    it('verifies .gitignore excludes .env.* and proxy/.dev.vars while preserving *.env.example templates and archived bundles', () => {
      const gitignore = fs.readFileSync(path.join(REPO_ROOT, '.gitignore'), 'utf-8');
      assert.match(gitignore, /^\.env\.\*$/m);
      assert.match(gitignore, /^!\*\*\/\.env\.example$/m);
      assert.match(gitignore, /^!\*\*\/\.env\.\*\.example$/m);
      assert.match(gitignore, /^proxy\/\.dev\.vars$/m);

      assert.ok(fs.existsSync(path.join(REPO_ROOT, 'docs', 'archive', 'phase-09', 'EXPORT_REPORT.md')));
      assert.ok(
        fs.existsSync(
          path.join(REPO_ROOT, 'docs', 'archive', 'phase-09', 'CONNECTLY_PHASE_09_AUDIT_BUNDLE.zip')
        )
      );
      assert.ok(!fs.existsSync(path.join(REPO_ROOT, 'CONNECTLY_PHASE_09_AUDIT_BUNDLE.zip')));

      const readme = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf-8');
      assert.match(readme, /\| \*\*18\*\*/);
      assert.match(readme, /client\//);
      assert.match(readme, /server\//);
      assert.match(readme, /proxy\//);
    });
  });

  describe('Low-Priority Code Quality Fixes (11000 Race, Dynamic 429 Timestamp, Bounded Shutdown)', () => {
    let mongoConnected = false;

    before(async () => {
      if (mongoose.connection.readyState === 0) {
        await mongoose.connect('mongodb://127.0.0.1:27017/connectly_rev_remediation_test');
        mongoConnected = true;
      }
      await User.init();
      await User.deleteMany({ email: /^rev\.race\./ });
    });

    after(async () => {
      await User.deleteMany({ email: /^rev\.race\./ });
      if (mongoConnected && mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
      }
    });

    it('maps MongoDB duplicate-key error 11000 during register() to 409 EMAIL_ALREADY_EXISTS', async () => {
      const originalFindOne = User.findOne;
      const originalCreate = User.create;
      let capturedStatus = 0;
      let capturedBody: Record<string, unknown> = {};

      (User as unknown as { findOne: () => Promise<null> }).findOne = async () => null;
      (User as unknown as { create: () => Promise<never> }).create = async () => {
        throw Object.assign(new Error('E11000 duplicate key error collection'), { code: 11000 });
      };

      try {
        const fakeReq = {
          body: {
            email: `rev.race.${Date.now()}@example.com`,
            password: 'StrongTestPassword123!',
            firstName: 'Race',
            lastName: 'User',
          },
        } as unknown as Request;

        const fakeRes = {
          status(code: number) {
            capturedStatus = code;
            return this;
          },
          json(payload: Record<string, unknown>) {
            capturedBody = payload;
            return this;
          },
        } as unknown as Response;

        await register(fakeReq, fakeRes);
        assert.strictEqual(capturedStatus, 409);
        assert.strictEqual(capturedBody.code, 'EMAIL_ALREADY_EXISTS');
      } finally {
        User.findOne = originalFindOne;
        User.create = originalCreate;
      }

      // Also exercise concurrent parallel HTTP registrations on the same email
      const app = createApp();
      const server = http.createServer(app);
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      const port = (server.address() as { port: number }).port;
      const concurrentEmail = `rev.race.${Date.now()}.${Math.random().toString(16).slice(2)}@example.com`;

      try {
        const sendReg = () =>
          fetch(`http://127.0.0.1:${port}/api/v1/auth/register`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Origin: 'http://localhost:5173',
            },
            body: JSON.stringify({
              email: concurrentEmail,
              password: 'StrongTestPassword123!',
              firstName: 'Concurrent',
              lastName: 'Tester',
            }),
          });

        const [r1, r2] = await Promise.all([sendReg(), sendReg()]);
        const statuses = [r1.status, r2.status].sort((a, b) => a - b);
        assert.deepStrictEqual(statuses, [201, 409]);

        const conflictRes = r1.status === 409 ? r1 : r2;
        const conflictJson = (await conflictRes.json()) as { code: string };
        assert.strictEqual(conflictJson.code, 'EMAIL_ALREADY_EXISTS');
      } finally {
        await new Promise<void>((r) => server.close(() => r()));
      }
    });

    it('emits dynamic timestamps on each 429 rate-limit response instead of static boot-time timestamps', async () => {
      const app = express();
      const limiter = rateLimit({
        windowMs: 60_000,
        max: 1,
        standardHeaders: true,
        legacyHeaders: false,
        message: createRateLimitMessage('Rate limit exceeded for dynamic timestamp test.'),
      });
      app.get('/limited', limiter, (_req, res) => res.json({ ok: true }));

      const server = http.createServer(app);
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      const port = (server.address() as { port: number }).port;

      try {
        const firstOk = await fetch(`http://127.0.0.1:${port}/limited`);
        assert.strictEqual(firstOk.status, 200);

        const first429 = (await (await fetch(`http://127.0.0.1:${port}/limited`)).json()) as {
          timestamp: string;
        };
        await new Promise((r) => setTimeout(r, 25));
        const second429 = (await (await fetch(`http://127.0.0.1:${port}/limited`)).json()) as {
          timestamp: string;
        };

        assert.notStrictEqual(
          first429.timestamp,
          second429.timestamp,
          'Each 429 payload must compute timestamp dynamically per response'
        );
      } finally {
        await new Promise<void>((r) => server.close(() => r()));
      }
    });

    it('coalesces duplicate shutdown signals and forces connection drain when HTTP close hangs past deadline', async () => {
      let stopCalls = 0;
      let dbDisconnectCalls = 0;
      let closeIdleCalls = 0;
      let closeAllCalls = 0;
      const exitCodes: number[] = [];

      const hangingServer = {
        listening: true,
        closeIdleConnections() {
          closeIdleCalls += 1;
        },
        closeAllConnections() {
          closeAllCalls += 1;
        },
        close(_cb: (err?: Error) => void) {
          // Intentionally never invoke callback to simulate lingering keep-alive socket
        },
      };

      const shutdown = createGracefulShutdown({
        httpServer: hangingServer,
        drainTimeoutMs: 40,
        stopSubsystems: async () => {
          stopCalls += 1;
        },
        disconnectDatabase: async () => {
          dbDisconnectCalls += 1;
        },
        onExit: (code) => {
          exitCodes.push(code);
        },
        log: () => {},
        logError: () => {},
      });

      const [code1, code2] = await Promise.all([shutdown('SIGTERM'), shutdown('SIGINT')]);
      assert.strictEqual(code1, 0);
      assert.strictEqual(code2, 0);
      assert.strictEqual(stopCalls, 1);
      assert.strictEqual(closeIdleCalls, 1);
      assert.strictEqual(closeAllCalls, 1);
      assert.strictEqual(dbDisconnectCalls, 1);
      assert.deepStrictEqual(exitCodes, [0]);
    });

    it('emits backward-compatible success envelope fields on admin and scheduling controllers', async () => {
      const origCount = SecurityAuditEntry.countDocuments;
      const origFind = SecurityAuditEntry.find;
      const origGenInvite = schedulingService.generateInvitation;

      (SecurityAuditEntry as unknown as { countDocuments: () => Promise<number> }).countDocuments = async () => 0;
      (SecurityAuditEntry as unknown as {
        find: () => {
          sort: () => { skip: () => { limit: () => { lean: () => Promise<unknown[]> } } };
        };
      }).find = () => ({
        sort: () => ({
          skip: () => ({
            limit: () => ({
              lean: async () => [],
            }),
          }),
        }),
      });
      schedulingService.generateInvitation = async () => ({
        meetingCode: 'cly-env-123',
        title: 'Envelope Check',
        joinUrl: 'https://connectly.example.com/meeting/cly-env-123',
        scheduledStartAt: null,
        scheduledTimeZone: 'UTC',
        durationMinutes: 30,
        hostName: 'Host',
        formattedText: 'Join',
      });

      try {
        let adminBody: Record<string, unknown> = {};
        const adminRes = {
          status() {
            return this;
          },
          json(payload: Record<string, unknown>) {
            adminBody = payload;
            return this;
          },
        } as unknown as Response;

        await listAuditLogs(
          { id: 'req-admin-1', query: {} } as unknown as Request,
          adminRes,
          () => {}
        );
        assert.strictEqual(adminBody.status, 'success');
        assert.strictEqual(adminBody.success, true);
        assert.ok((adminBody.meta as { requestId?: string })?.requestId === 'req-admin-1');
        assert.ok((adminBody.data as { entries?: unknown[] })?.entries);

        let schedBody: Record<string, unknown> = {};
        const schedRes = {
          status() {
            return this;
          },
          json(payload: Record<string, unknown>) {
            schedBody = payload;
            return this;
          },
        } as unknown as Response;

        await getMeetingInvitationHandler(
          { id: 'req-sched-1', params: { meetingCode: 'cly-env-123' } } as unknown as Request,
          schedRes
        );
        assert.strictEqual(schedBody.status, 200);
        assert.strictEqual(schedBody.success, true);
        assert.ok((schedBody.meta as { requestId?: string })?.requestId === 'req-sched-1');
        assert.strictEqual(
          (schedBody.data as { meetingCode?: string })?.meetingCode,
          'cly-env-123'
        );
      } finally {
        SecurityAuditEntry.countDocuments = origCount;
        SecurityAuditEntry.find = origFind;
        schedulingService.generateInvitation = origGenInvite;
      }
    });
  });
});
