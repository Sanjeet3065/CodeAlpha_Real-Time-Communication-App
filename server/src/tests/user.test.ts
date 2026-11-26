import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { createApp } from '../app.js';
import { User } from '../models/User.model.js';
import { generateAccessToken } from '../utils/tokens.js';
import { hashPassword } from '../utils/password.js';
import type { Server } from 'node:http';

describe('User Profile API & Security Suite', () => {
  let server: Server;
  let baseUrl: string;

  let userAId: string;
  let userBId: string;
  let tokenA: string;

  before(async () => {
    await mongoose.connect('mongodb://127.0.0.1:27017/connectly_user_profile_test');
    await User.deleteMany({});

    const passwordHash = await hashPassword('SecurePassword123!');

    const userA = await User.create({
      email: 'sarah.chen@connectly.io',
      passwordHash,
      firstName: 'Sarah',
      lastName: 'Chen',
      isEmailVerified: true,
    });
    userAId = userA._id.toString();
    tokenA = generateAccessToken({
      sub: userAId,
      email: userA.email,
      firstName: userA.firstName,
      lastName: userA.lastName,
    });

    const userB = await User.create({
      email: 'marcus.vance@connectly.io',
      passwordHash,
      firstName: 'Marcus',
      lastName: 'Vance',
      isEmailVerified: false,
    });
    userBId = userB._id.toString();
    generateAccessToken({
      sub: userBId,
      email: userB.email,
      firstName: userB.firstName,
      lastName: userB.lastName,
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
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await User.deleteMany({});
    await mongoose.disconnect();
  });

  it('1. GET /api/v1/users/me — should reject unauthenticated request with 401', async () => {
    const res = await fetch(`${baseUrl}/api/v1/users/me`);
    assert.strictEqual(res.status, 401);
    const body = (await res.json()) as any;
    assert.strictEqual(body.code, 'UNAUTHORIZED');
  });

  it('2. GET /api/v1/users/me — should return authenticated user profile', async () => {
    const res = await fetch(`${baseUrl}/api/v1/users/me`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert.strictEqual(res.status, 200);

    const body = (await res.json()) as any;
    assert.strictEqual(body.id, userAId);
    assert.strictEqual(body.email, 'sarah.chen@connectly.io');
    assert.strictEqual(body.firstName, 'Sarah');
    assert.strictEqual(body.lastName, 'Chen');
    assert.strictEqual(body.name, 'Sarah Chen');
    assert.strictEqual(body.isEmailVerified, true);
    assert.ok(body.preferences);
    assert.ok(body.createdAt);
    assert.ok(body.updatedAt);
    // Security check: Never expose password hashes or sensitive secrets
    assert.strictEqual(body.passwordHash, undefined);
    assert.strictEqual(body.password, undefined);
  });

  it('3. PATCH /api/v1/users/me — should reject unauthenticated request with 401', async () => {
    const res = await fetch(`${baseUrl}/api/v1/users/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName: 'Dr. Sarah' }),
    });
    assert.strictEqual(res.status, 401);
  });

  it('4. PATCH /api/v1/users/me — should update allowed profile fields', async () => {
    const res = await fetch(`${baseUrl}/api/v1/users/me`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        firstName: 'Dr. Sarah',
        lastName: 'Chen-Audit',
      }),
    });

    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as any;
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.firstName, 'Dr. Sarah');
    assert.strictEqual(body.data.lastName, 'Chen-Audit');
    assert.strictEqual(body.data.name, 'Dr. Sarah Chen-Audit');

    // Verify database persistence
    const persisted = await User.findById(userAId);
    assert.strictEqual(persisted?.firstName, 'Dr. Sarah');
    assert.strictEqual(persisted?.lastName, 'Chen-Audit');
  });

  it('5. PATCH /api/v1/users/me — should reject empty update payload with 400', async () => {
    const res = await fetch(`${baseUrl}/api/v1/users/me`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({}),
    });

    assert.strictEqual(res.status, 400);
    const body = (await res.json()) as any;
    assert.strictEqual(body.code, 'VALIDATION_ERROR');
  });

  it('6. PATCH /api/v1/users/me — should reject names exceeding 50 characters', async () => {
    const longName = 'A'.repeat(51);
    const res = await fetch(`${baseUrl}/api/v1/users/me`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({ firstName: longName }),
    });

    assert.strictEqual(res.status, 400);
    const body = (await res.json()) as any;
    assert.strictEqual(body.code, 'VALIDATION_ERROR');
  });

  it('7. PATCH /api/v1/users/me — Mass Assignment Defense: should reject unauthorized properties', async () => {
    const res = await fetch(`${baseUrl}/api/v1/users/me`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        firstName: 'Sarah',
        isEmailVerified: false, // Attempt to tamper with verification status
        role: 'admin',          // Attempt to escalate privileges
        isAdmin: true,
        email: 'hacked@evil.com',
        passwordHash: '$fakehash',
      }),
    });

    assert.strictEqual(res.status, 400);
    const body = (await res.json()) as any;
    assert.strictEqual(body.code, 'VALIDATION_ERROR');

    // Confirm that User A in database was not mutated by the mass assignment attempt
    const persisted = await User.findById(userAId);
    assert.strictEqual(persisted?.isEmailVerified, true);
    assert.strictEqual(persisted?.email, 'sarah.chen@connectly.io');
  });

  it('8. User Isolation — mutations from User A must never alter User B', async () => {
    const res = await fetch(`${baseUrl}/api/v1/users/me`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({ firstName: 'Dr. Sarah Modified' }),
    });

    assert.strictEqual(res.status, 200);

    // Verify User B remains completely untouched
    const userBRecord = await User.findById(userBId);
    assert.strictEqual(userBRecord?.firstName, 'Marcus');
    assert.strictEqual(userBRecord?.lastName, 'Vance');
  });
});
