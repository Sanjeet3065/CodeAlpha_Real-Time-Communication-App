import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { createApp } from '../app.js';
import { User } from '../models/User.model.js';
import { AuthSession } from '../models/Session.model.js';
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

  it('9. PATCH /api/v1/users/me — updates jobTitle, bio, timeZone, avatarColor while rejecting restricted keys', async () => {
    const res = await fetch(`${baseUrl}/api/v1/users/me`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        jobTitle: 'Principal Architect',
        bio: 'Leading crystal-clear WebRTC meetings',
        timeZone: 'Asia/Kolkata',
        avatarColor: 'indigo',
      }),
    });

    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as any;
    assert.strictEqual(body.data.jobTitle, 'Principal Architect');
    assert.strictEqual(body.data.bio, 'Leading crystal-clear WebRTC meetings');
    assert.strictEqual(body.data.timeZone, 'Asia/Kolkata');
    assert.strictEqual(body.data.avatarColor, 'indigo');

    const badTz = await fetch(`${baseUrl}/api/v1/users/me`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({ timeZone: 'Invalid/Zone_XYZ' }),
    });
    assert.strictEqual(badTz.status, 400);
  });

  it('10. PATCH /api/v1/users/me/email — enforces password verification, uniqueness, and updates DB', async () => {
    const badPwd = await fetch(`${baseUrl}/api/v1/users/me/email`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        email: 'sarah.new@connectly.io',
        currentPassword: 'WrongPassword999!',
      }),
    });
    assert.strictEqual(badPwd.status, 401);

    const dupEmail = await fetch(`${baseUrl}/api/v1/users/me/email`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        email: 'marcus.vance@connectly.io',
        currentPassword: 'SecurePassword123!',
      }),
    });
    assert.strictEqual(dupEmail.status, 409);

    const okRes = await fetch(`${baseUrl}/api/v1/users/me/email`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        email: 'sarah.updated@connectly.io',
        currentPassword: 'SecurePassword123!',
      }),
    });
    assert.strictEqual(okRes.status, 200);
    const okBody = (await okRes.json()) as any;
    assert.strictEqual(okBody.data.user.email, 'sarah.updated@connectly.io');
    assert.strictEqual(okBody.data.user.isEmailVerified, true);
    assert.ok(okBody.data.accessToken);
    tokenA = okBody.data.accessToken;

    const persisted = await User.findById(userAId);
    assert.strictEqual(persisted?.email, 'sarah.updated@connectly.io');
  });

  it('11. PATCH /api/v1/users/me/password — verifies current password, revokes sibling sessions, and allows new login', async () => {
    await AuthSession.deleteMany({});
    const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'sarah.updated@connectly.io',
        password: 'SecurePassword123!',
      }),
    });
    assert.strictEqual(loginRes.status, 200);
    const loginBody = (await loginRes.json()) as any;
    const callerCookie = (loginRes.headers.get('set-cookie') || '').split(';')[0];
    const callerToken = loginBody.accessToken;

    const siblingSession = await AuthSession.create({
      userId: userAId,
      familyId: 'sibling-family-999',
      refreshTokenHash: 'sibling-hash-999',
      userAgent: 'OtherBrowser',
      ipAddress: '127.0.0.2',
      isValid: true,
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    const weakPwd = await fetch(`${baseUrl}/api/v1/users/me/password`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${callerToken}`,
      },
      body: JSON.stringify({
        currentPassword: 'SecurePassword123!',
        newPassword: 'weak',
      }),
    });
    assert.strictEqual(weakPwd.status, 400);

    const wrongCur = await fetch(`${baseUrl}/api/v1/users/me/password`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${callerToken}`,
      },
      body: JSON.stringify({
        currentPassword: 'WrongPassword123!',
        newPassword: 'BrandNewStrongPassword99!',
      }),
    });
    assert.strictEqual(wrongCur.status, 401);

    const okPwd = await fetch(`${baseUrl}/api/v1/users/me/password`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${callerToken}`,
        Cookie: callerCookie,
      },
      body: JSON.stringify({
        currentPassword: 'SecurePassword123!',
        newPassword: 'BrandNewStrongPassword99!',
      }),
    });
    assert.strictEqual(okPwd.status, 200);
    const okPwdBody = (await okPwd.json()) as any;
    assert.strictEqual(okPwdBody.data.user.hasLocalPassword, true);

    const updatedSibling = await AuthSession.findById(siblingSession._id);
    assert.strictEqual(updatedSibling?.isValid, false);

    const newLoginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'sarah.updated@connectly.io',
        password: 'BrandNewStrongPassword99!',
      }),
    });
    assert.strictEqual(newLoginRes.status, 200);
  });

  it('12. Google-only user (hasLocalPassword: false) must set initial password before changing email', async () => {
    const sentinelHash = await hashPassword('RandomGoogleSentinel!234');
    const googleUser = await User.create({
      email: 'google.only@connectly.io',
      passwordHash: sentinelHash,
      firstName: 'Google',
      lastName: 'Member',
      isEmailVerified: true,
      hasLocalPassword: false,
      googleSub: 'google-sub-12345',
    });
    const gToken = generateAccessToken({
      sub: googleUser._id.toString(),
      email: googleUser.email,
      firstName: googleUser.firstName,
      lastName: googleUser.lastName,
    });

    const blockedEmail = await fetch(`${baseUrl}/api/v1/users/me/email`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${gToken}`,
      },
      body: JSON.stringify({ email: 'newgoogle@connectly.io' }),
    });
    assert.strictEqual(blockedEmail.status, 403);
    const blockedBody = (await blockedEmail.json()) as any;
    assert.strictEqual(blockedBody.code, 'LOCAL_PASSWORD_REQUIRED');

    const setPwd = await fetch(`${baseUrl}/api/v1/users/me/password`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${gToken}`,
      },
      body: JSON.stringify({ newPassword: 'MyFirstLocalPass2026!' }),
    });
    assert.strictEqual(setPwd.status, 200);
    const setPwdBody = (await setPwd.json()) as any;
    assert.strictEqual(setPwdBody.data.user.hasLocalPassword, true);

    const emailAfter = await fetch(`${baseUrl}/api/v1/users/me/email`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${gToken}`,
      },
      body: JSON.stringify({
        email: 'newgoogle@connectly.io',
        currentPassword: 'MyFirstLocalPass2026!',
      }),
    });
    assert.strictEqual(emailAfter.status, 200);
  });
});
