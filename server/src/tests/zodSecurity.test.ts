import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { z } from 'zod';
import { createApp } from '../app.js';
import { User } from '../models/User.model.js';
import { UserPreferences } from '../models/UserPreferences.model.js';
import { generateAccessToken } from '../utils/tokens.js';
import { hashPassword } from '../utils/password.js';
import { registerSchema, loginSchema } from '../schemas/auth.schema.js';
import { updateProfileSchema, updatePreferencesSchema } from '../schemas/user.schema.js';
import type { Server } from 'node:http';

describe('Zod 4.6.7 Security & GHSA-mrhx-c7xc-m3w5 Protection Suite', () => {
  let server: Server;
  let baseUrl: string;
  let token: string;

  before(async () => {
    await mongoose.connect('mongodb://127.0.0.1:27017/connectly_zod_security_test');
    await User.deleteMany({});
    await UserPreferences.deleteMany({});

    const passwordHash = await hashPassword('SecurePassword123!');
    const user = await User.create({
      email: 'zod.security@connectly.io',
      passwordHash,
      firstName: 'Zod',
      lastName: 'Tester',
      isEmailVerified: true,
    });

    token = generateAccessToken({
      sub: user._id.toString(),
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
    });

    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const address = server.address();
        if (address && typeof address === 'object') {
          baseUrl = `http://localhost:${address.port}`;
        }
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await User.deleteMany({});
    await UserPreferences.deleteMany({});
    await mongoose.disconnect();
  });

  it('1. Rejects oversized >100KB JSON body on /api/v1/auth/register with HTTP 413 before Zod parsing', async () => {
    const oversizedPayload = JSON.stringify({
      email: 'large@connectly.io',
      password: 'SecurePassword123!',
      firstName: 'A'.repeat(120 * 1024),
      lastName: 'User',
    });

    const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: oversizedPayload,
    });

    assert.strictEqual(res.status, 413);
    const body = (await res.json()) as any;
    assert.strictEqual(body.code, 'PAYLOAD_TOO_LARGE');
  });

  it('2. Rejects oversized >100KB JSON collection on /api/v1/users/me/preferences with HTTP 413 before Zod parsing', async () => {
    const oversizedArray = Array.from({ length: 30000 }, () => 'x');
    const res = await fetch(`${baseUrl}/api/v1/users/me/preferences`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        defaultAudioMuted: true,
        maliciousCollection: oversizedArray,
      }),
    });

    assert.strictEqual(res.status, 413);
    const body = (await res.json()) as any;
    assert.strictEqual(body.code, 'PAYLOAD_TOO_LARGE');
  });

  it('3. Rapidly rejects array/collection inputs passed to all reachable API endpoints', async () => {
    const largeArrayWithinBodyLimit = Array.from({ length: 2000 }, (_, i) => i);
    const start = performance.now();

    const [resReg, resLogin, resProfile, resPref] = await Promise.all([
      fetch(`${baseUrl}/api/v1/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: largeArrayWithinBodyLimit,
          password: 'SecurePassword123!',
          firstName: 'Test',
          lastName: 'User',
        }),
      }),
      fetch(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'zod.security@connectly.io',
          password: largeArrayWithinBodyLimit,
        }),
      }),
      fetch(`${baseUrl}/api/v1/users/me`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          firstName: largeArrayWithinBodyLimit,
        }),
      }),
      fetch(`${baseUrl}/api/v1/users/me/preferences`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          defaultAudioMuted: largeArrayWithinBodyLimit,
        }),
      }),
    ]);

    const elapsedMs = performance.now() - start;
    assert.strictEqual(resReg.status, 400);
    assert.strictEqual(resLogin.status, 400);
    assert.strictEqual(resProfile.status, 400);
    assert.strictEqual(resPref.status, 400);
    assert.ok(elapsedMs < 1500, `Expected rapid rejection, took ${elapsedMs.toFixed(1)}ms`);
  });

  it('4. Patched Zod 4.6.7 rejects oversized constrained collections (Array, Set, Map) instantaneously (GHSA-mrhx-c7xc-m3w5)', () => {
    const boundedArraySchema = z.array(z.string()).max(10);
    const boundedSetSchema = z.set(z.string()).max(10);
    const boundedMapSchema = z.map(z.string(), z.string()).max(10);

    const hugeArray = Array.from({ length: 100_000 }, (_, i) => `item-${i}`);
    const hugeSet = new Set(hugeArray);
    const hugeMap = new Map(hugeArray.map((v, i) => [`k-${i}`, v]));

    const start = performance.now();
    const arrayResult = boundedArraySchema.safeParse(hugeArray);
    const setResult = boundedSetSchema.safeParse(hugeSet);
    const mapResult = boundedMapSchema.safeParse(hugeMap);
    const elapsedMs = performance.now() - start;

    assert.strictEqual(arrayResult.success, false);
    assert.strictEqual(setResult.success, false);
    assert.strictEqual(mapResult.success, false);
    assert.ok(
      elapsedMs < 500,
      `Patched Zod 4.6.7 should short-circuit oversized constrained collections rapidly; took ${elapsedMs.toFixed(1)}ms`
    );
  });

  it('5. Strict schemas reject nested objects and unknown keys on profile and preferences', () => {
    const nestedProfile = updateProfileSchema.safeParse({
      firstName: 'Valid',
      nested: { admin: true },
    });
    assert.strictEqual(nestedProfile.success, false);

    const nestedPref = updatePreferencesSchema.safeParse({
      defaultAudioMuted: true,
      nestedArray: [1, 2, 3],
    });
    assert.strictEqual(nestedPref.success, false);
  });

  it('6. Auth schemas enforce explicit upper length bounds on email and password inputs', () => {
    const overlongEmail = `${'a'.repeat(250)}@example.com`;
    const regEmailRes = registerSchema.safeParse({
      email: overlongEmail,
      password: 'SecurePassword123!',
      firstName: 'Alice',
      lastName: 'Smith',
    });
    assert.strictEqual(regEmailRes.success, false);

    const loginEmailRes = loginSchema.safeParse({
      email: overlongEmail,
      password: 'SecurePassword123!',
    });
    assert.strictEqual(loginEmailRes.success, false);

    const loginPwdRes = loginSchema.safeParse({
      email: 'alice@connectly.io',
      password: 'P'.repeat(129),
    });
    assert.strictEqual(loginPwdRes.success, false);
  });
});
