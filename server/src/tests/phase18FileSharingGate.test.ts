/**
 * CONNECTLY — Phase 18 Sprint 02 File Sharing Feature Gate & Storage Invariant Test Suite
 *
 * Verifies:
 * 1. Environment schema validation:
 *    - Rejects invalid combinations (e.g. ENABLE_FILE_SHARING=true with STORAGE_PROVIDER=disabled).
 *    - Accepts valid combinations (ENABLE_FILE_SHARING=false with STORAGE_PROVIDER=disabled).
 *    - Preserves strict S3 configuration requirements whenever S3 is enabled.
 * 2. HTTP Route-level and Service-level Feature Gating:
 *    - When disabled, all 6 meeting file routes return HTTP 403 with code FEATURE_DISABLED.
 *    - When disabled, GET /api/v1/users/me/shared-files returns HTTP 403 with code FEATURE_DISABLED.
 *    - When disabled, FileService methods throw ForbiddenError with FEATURE_DISABLED.
 * 3. Startup and Storage Provider Behavior:
 *    - getStorageProvider() throws STORAGE_DISABLED when STORAGE_PROVIDER=disabled.
 *    - FileCleanupWorker skips sweeps and stays inactive when file sharing is disabled.
 * 4. Non-regression:
 *    - Unrelated meeting routes (instant meeting, state, chat, etc.) remain completely functional.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import mongoose from 'mongoose';
import { createApp } from '../app.js';
import { env, envSchema } from '../config/env.js';
import { resetReadinessHealthCacheForTesting } from '../routes/health.routes.js';
import { chatRedisService } from '../services/chatRedis.service.js';
import { User } from '../models/User.model.js';
import { Meeting } from '../models/Meeting.model.js';
import { MeetingParticipant } from '../models/MeetingParticipant.model.js';
import { hashPassword } from '../utils/password.js';
import { generateAccessToken } from '../utils/tokens.js';
import { getStorageProvider, setStorageProvider } from '../storage/storageFactory.js';
import { FileCleanupWorker } from '../services/fileCleanupWorker.service.js';
import { fileService } from '../services/file.service.js';

describe('Phase 18 Sprint 02 File-Sharing Feature Gate Suite', () => {
  let server: http.Server;
  let baseUrl: string;
  let authToken: string;
  let testUserId: string;
  let testMeetingCode: string;

  before(async () => {
    if (mongoose.connection.readyState !== 1) {
      await mongoose.connect(env.MONGODB_URI);
    }

    const app = createApp();
    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as { port: number };
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });

    // Create test user and auth token
    const unique = Date.now();
    const user = await User.create({
      email: `gate_test_${unique}@connectly.test`,
      passwordHash: await hashPassword('Password123!'),
      firstName: 'Gate',
      lastName: 'Tester',
      isEmailVerified: true,
    });
    testUserId = user._id.toString();
    authToken = generateAccessToken({ sub: testUserId, role: 'USER' });

    // Create test meeting with admitted participant
    const meeting = await Meeting.create({
      meetingCode: `cly-gat-${String(unique).slice(-3)}`,
      title: 'Gate Test Meeting',
      hostId: user._id,
      originalHostId: user._id,
      status: 'ACTIVE',
      maxParticipants: 60,
      activeParticipantCount: 1,
      expiresAt: new Date(Date.now() + 86400_000),
    });
    testMeetingCode = meeting.meetingCode;

    await MeetingParticipant.create({
      meetingId: meeting._id,
      userId: user._id,
      email: user.email,
      displayName: 'Gate Tester',
      role: 'host',
      admissionStatus: 'ADMITTED',
      joinedAt: new Date(),
    });
  });

  after(async () => {
    await MeetingParticipant.deleteMany({ userId: new mongoose.Types.ObjectId(testUserId) });
    await Meeting.deleteMany({ hostId: new mongoose.Types.ObjectId(testUserId) });
    await User.deleteMany({ _id: new mongoose.Types.ObjectId(testUserId) });
    setStorageProvider(null);

    if (server) {
      if (typeof (server as any).closeAllConnections === 'function') {
        (server as any).closeAllConnections();
      }
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }

    await chatRedisService.close();
    resetReadinessHealthCacheForTesting();

    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  });

  describe('1. Environment Schema Configuration Validation', () => {
    it('should reject ENABLE_FILE_SHARING=true with STORAGE_PROVIDER=disabled', () => {
      const result = envSchema.safeParse({
        ...process.env,
        ENABLE_FILE_SHARING: 'true',
        STORAGE_PROVIDER: 'disabled',
      });
      assert.strictEqual(result.success, false);
      const errors = result.error?.issues || [];
      const hasStorageError = errors.some(
        (issue) =>
          issue.path.includes('STORAGE_PROVIDER') &&
          issue.message.includes('STORAGE_PROVIDER=disabled is permitted only when ENABLE_FILE_SHARING=false')
      );
      assert.strictEqual(hasStorageError, true, 'Must reject disabled storage when file sharing is enabled');
    });

    it('should accept ENABLE_FILE_SHARING=false with STORAGE_PROVIDER=disabled', () => {
      const result = envSchema.safeParse({
        ...process.env,
        ENABLE_FILE_SHARING: 'false',
        STORAGE_PROVIDER: 'disabled',
      });
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data.ENABLE_FILE_SHARING, false);
      assert.strictEqual(result.data.STORAGE_PROVIDER, 'disabled');
    });

    it('should reject production local/memory storage even when file sharing is configured', () => {
      const localResult = envSchema.safeParse({
        ...process.env,
        NODE_ENV: 'production',
        STORAGE_PROVIDER: 'local',
        JWT_ACCESS_SECRET: 'a_very_long_non_default_access_secret_for_prod_min_32',
        JWT_REFRESH_SECRET: 'a_very_long_non_default_refresh_secret_for_prod_min_32',
        CONNECTLY_ENCRYPTION_KEY_V1: '9f8e7d6c5b4a392817161514131211100f0e0d0c0b0a090807060504030201f0',
        CLIENT_ORIGIN: 'https://connectly.test',
      });
      assert.strictEqual(localResult.success, false);
      assert.ok(
        localResult.error?.issues.some(
          (i) => i.path.includes('STORAGE_PROVIDER') && i.message.includes('Local disk storage')
        )
      );
    });

    it('should accept production STORAGE_PROVIDER=disabled when ENABLE_FILE_SHARING=false without requiring S3 bucket', () => {
      const prodDisabledResult = envSchema.safeParse({
        ...process.env,
        NODE_ENV: 'production',
        ENABLE_FILE_SHARING: 'false',
        STORAGE_PROVIDER: 'disabled',
        STORAGE_S3_BUCKET: 'replace_with_bucket_name', // Placeholder should NOT trigger error when disabled
        SOCKET_IO_ADAPTER: 'mongo',
        JWT_ACCESS_SECRET: 'a_very_long_non_default_access_secret_for_prod_min_32',
        JWT_REFRESH_SECRET: 'a_very_long_non_default_refresh_secret_for_prod_min_32',
        CONNECTLY_ENCRYPTION_KEY_V1: '9f8e7d6c5b4a392817161514131211100f0e0d0c0b0a090807060504030201f0',
        CLIENT_ORIGIN: 'https://connectly.test',
        LIVEKIT_URL: 'wss://connectly.livekit.cloud',
        LIVEKIT_API_KEY: 'APInonplaceholderkey12345678',
        LIVEKIT_API_SECRET: 'SECnonplaceholdersupersecretkey12345678',
        PROXY_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      });
      if (!prodDisabledResult.success) {
        console.error('PROD DISABLED PARSE ERROR:', JSON.stringify(prodDisabledResult.error.issues, null, 2));
      }
      assert.strictEqual(prodDisabledResult.success, true);
      assert.strictEqual(prodDisabledResult.data.STORAGE_PROVIDER, 'disabled');
      assert.strictEqual(prodDisabledResult.data.ENABLE_FILE_SHARING, false);
    });
  });

  describe('2. Server Route Gating Under Disabled Mode', () => {
    let originalFileSharing: boolean;
    let originalStorageProvider: any;

    before(() => {
      originalFileSharing = env.ENABLE_FILE_SHARING;
      originalStorageProvider = env.STORAGE_PROVIDER;
      (env as any).ENABLE_FILE_SHARING = false;
      (env as any).STORAGE_PROVIDER = 'disabled';
    });

    after(() => {
      (env as any).ENABLE_FILE_SHARING = originalFileSharing;
      (env as any).STORAGE_PROVIDER = originalStorageProvider;
    });

    it('POST /:meetingCode/files/upload returns 403 FEATURE_DISABLED', async () => {
      const res = await fetch(`${baseUrl}/api/v1/meetings/${testMeetingCode}/files/upload`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          Origin: 'http://localhost:5173',
        },
      });
      assert.strictEqual(res.status, 403);
      const body = await res.json();
      assert.strictEqual(body.code, 'FEATURE_DISABLED');
      assert.strictEqual(body.message, 'File sharing is currently disabled');
    });

    it('POST /:meetingCode/files/init-upload returns 403 FEATURE_DISABLED', async () => {
      const res = await fetch(`${baseUrl}/api/v1/meetings/${testMeetingCode}/files/init-upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
          Origin: 'http://localhost:5173',
        },
        body: JSON.stringify({
          filename: 'test.pdf',
          fileSize: 1024,
          mimeType: 'application/pdf',
        }),
      });
      assert.strictEqual(res.status, 403);
      const body = await res.json();
      assert.strictEqual(body.code, 'FEATURE_DISABLED');
    });

    it('POST /:meetingCode/files/:fileId/complete returns 403 FEATURE_DISABLED', async () => {
      const dummyFileId = new mongoose.Types.ObjectId().toString();
      const res = await fetch(`${baseUrl}/api/v1/meetings/${testMeetingCode}/files/${dummyFileId}/complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
          Origin: 'http://localhost:5173',
        },
        body: JSON.stringify({}),
      });
      assert.strictEqual(res.status, 403);
      const body = await res.json();
      assert.strictEqual(body.code, 'FEATURE_DISABLED');
    });

    it('GET /:meetingCode/files returns 403 FEATURE_DISABLED', async () => {
      const res = await fetch(`${baseUrl}/api/v1/meetings/${testMeetingCode}/files`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });
      assert.strictEqual(res.status, 403);
      const body = await res.json();
      assert.strictEqual(body.code, 'FEATURE_DISABLED');
    });

    it('GET /:meetingCode/files/:fileId/download returns 403 FEATURE_DISABLED', async () => {
      const dummyFileId = new mongoose.Types.ObjectId().toString();
      const res = await fetch(`${baseUrl}/api/v1/meetings/${testMeetingCode}/files/${dummyFileId}/download`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });
      assert.strictEqual(res.status, 403);
      const body = await res.json();
      assert.strictEqual(body.code, 'FEATURE_DISABLED');
    });

    it('DELETE /:meetingCode/files/:fileId returns 403 FEATURE_DISABLED', async () => {
      const dummyFileId = new mongoose.Types.ObjectId().toString();
      const res = await fetch(`${baseUrl}/api/v1/meetings/${testMeetingCode}/files/${dummyFileId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${authToken}`,
          Origin: 'http://localhost:5173',
        },
      });
      assert.strictEqual(res.status, 403);
      const body = await res.json();
      assert.strictEqual(body.code, 'FEATURE_DISABLED');
    });

    it('GET /users/me/shared-files returns 403 FEATURE_DISABLED', async () => {
      const res = await fetch(`${baseUrl}/api/v1/users/me/shared-files`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });
      assert.strictEqual(res.status, 403);
      const body = await res.json();
      assert.strictEqual(body.code, 'FEATURE_DISABLED');
    });

    it('Direct FileService method invocations throw ForbiddenError FEATURE_DISABLED', async () => {
      await assert.rejects(
        () => fileService.getUserSharedFiles(testUserId),
        (err: any) => err.statusCode === 403 && err.code === 'FEATURE_DISABLED'
      );
      await assert.rejects(
        () => fileService.listMeetingFiles(testMeetingCode, testUserId, {}),
        (err: any) => err.statusCode === 403 && err.code === 'FEATURE_DISABLED'
      );
      await assert.rejects(
        () => fileService.getFileForDownload(testMeetingCode, testUserId, new mongoose.Types.ObjectId().toString()),
        (err: any) => err.statusCode === 403 && err.code === 'FEATURE_DISABLED'
      );
      await assert.rejects(
        () => fileService.deleteFile(testMeetingCode, testUserId, new mongoose.Types.ObjectId().toString()),
        (err: any) => err.statusCode === 403 && err.code === 'FEATURE_DISABLED'
      );
    });

    it('Non-file meeting routes remain completely functional and unaffected', async () => {
      const res = await fetch(`${baseUrl}/api/v1/meetings/${testMeetingCode}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });
      const body = await res.json();
      if (res.status !== 200 || !body.success) {
        console.error('MEETING ROUTE ERROR:', res.status, body);
      }
      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data?.meeting?.meetingCode || body.data?.meetingCode, testMeetingCode);
    });
  });

  describe('3. Storage Factory and Worker Lifecycle Under Disabled Mode', () => {
    let originalFileSharing: boolean;
    let originalStorageProvider: any;

    before(() => {
      originalFileSharing = env.ENABLE_FILE_SHARING;
      originalStorageProvider = env.STORAGE_PROVIDER;
      (env as any).ENABLE_FILE_SHARING = false;
      (env as any).STORAGE_PROVIDER = 'disabled';
      setStorageProvider(null);
    });

    after(() => {
      (env as any).ENABLE_FILE_SHARING = originalFileSharing;
      (env as any).STORAGE_PROVIDER = originalStorageProvider;
      setStorageProvider(null);
    });

    it('getStorageProvider() throws STORAGE_DISABLED (HTTP 503) when disabled', () => {
      assert.throws(
        () => getStorageProvider(),
        (err: any) => err.statusCode === 503 && err.code === 'STORAGE_DISABLED'
      );
    });

    it('FileCleanupWorker does not start active sweeps when file sharing is disabled', async () => {
      const worker = new FileCleanupWorker();
      await worker.start();
      assert.strictEqual(worker.isActive(), false, 'Worker must remain inactive when storage is disabled');
      await worker.stop();
    });
  });

  describe('4. Readiness Probe Response in Disabled Mode', () => {
    let originalFileSharing: boolean;
    let originalStorageProvider: any;

    before(() => {
      originalFileSharing = env.ENABLE_FILE_SHARING;
      originalStorageProvider = env.STORAGE_PROVIDER;
      (env as any).ENABLE_FILE_SHARING = false;
      (env as any).STORAGE_PROVIDER = 'disabled';
    });

    after(() => {
      (env as any).ENABLE_FILE_SHARING = originalFileSharing;
      (env as any).STORAGE_PROVIDER = originalStorageProvider;
    });

    it('GET /api/v1/health/ready returns ready status with storage: disabled and does not fail', async () => {
      const res = await fetch(`${baseUrl}/api/v1/health/ready`);
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.status, 'ready');
      assert.strictEqual(body.checks.storage.status, 'disabled');
      assert.strictEqual(body.checks.storage.fileSharing, false);
    });
  });
});
