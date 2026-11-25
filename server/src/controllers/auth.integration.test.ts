import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { createApp } from '../app.js';
import { User } from '../models/User.model.js';
import { AuthSession } from '../models/Session.model.js';
import { hashToken } from '../utils/tokens.js';
import { env } from '../config/env.js';
import type { Server } from 'node:http';

describe('Authentication API — End-to-End Security & Integration Suite', () => {
  let server: Server;
  let baseUrl: string;

  const validHeaders = {
    'Content-Type': 'application/json',
    'Origin': 'http://localhost:5173',
    'X-Requested-With': 'XMLHttpRequest',
    'X-CSRF-Protection': '1',
  };

  before(async () => {
    // Connect to isolated integration test database
    await mongoose.connect('mongodb://127.0.0.1:27017/connectly_security_test');
    await User.deleteMany({});
    await AuthSession.deleteMany({});

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
    await AuthSession.deleteMany({});
    await mongoose.disconnect();
  });

  const testUser = {
    email: 'sarah.security@connectly.io',
    password: 'SuperSecurePassword999!',
    firstName: 'Sarah',
    lastName: 'Security',
  };

  // --------------------------------------------------------------------------
  // REGISTRATION TESTS
  // --------------------------------------------------------------------------
  it('1. POST /api/v1/auth/register — should register a new user with Argon2id hash', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: validHeaders,
      body: JSON.stringify(testUser),
    });

    assert.strictEqual(res.status, 201);
    const data = (await res.json()) as any;
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.user.email, testUser.email.toLowerCase());
    assert.strictEqual(data.user.firstName, testUser.firstName);
    assert.strictEqual(data.user.lastName, testUser.lastName);
    assert.ok(data.user.id);
    assert.strictEqual(data.user.passwordHash, undefined, 'Password hash must never be returned in API response');

    // Verify stored user in MongoDB
    const dbUser = await User.findById(data.user.id);
    assert.ok(dbUser);
    assert.ok(dbUser.passwordHash.startsWith('$argon2id$v=19$m=65536,t=3,p=1$'));
  });

  it('2. POST /api/v1/auth/register — should reject duplicate email with 409 Conflict', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: validHeaders,
      body: JSON.stringify(testUser),
    });

    assert.strictEqual(res.status, 409);
    const data = (await res.json()) as any;
    assert.strictEqual(data.code, 'EMAIL_ALREADY_EXISTS');
  });

  it('3. POST /api/v1/auth/register — should reject weak password with 400 Bad Request', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: validHeaders,
      body: JSON.stringify({
        email: 'another@connectly.io',
        password: 'weak',
        firstName: 'Jane',
        lastName: 'Doe',
      }),
    });

    assert.strictEqual(res.status, 400);
    const data = (await res.json()) as any;
    assert.strictEqual(data.code, 'VALIDATION_ERROR');
    assert.ok(Array.isArray(data.errors));
  });

  // --------------------------------------------------------------------------
  // LOGIN & CREDENTIAL VERIFICATION TESTS
  // --------------------------------------------------------------------------
  it('4. POST /api/v1/auth/login — should fail with invalid password', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: validHeaders,
      body: JSON.stringify({
        email: testUser.email,
        password: 'WrongPassword!',
      }),
    });

    assert.strictEqual(res.status, 401);
    const data = (await res.json()) as any;
    assert.strictEqual(data.code, 'INVALID_CREDENTIALS');
  });

  let validAccessTokenDeviceA: string;
  let refreshCookieDeviceA: string;
  let refreshTokenValueDeviceA: string;
  let sessionDocDeviceA: any;

  it('5. POST /api/v1/auth/login — should login Device A, issue tokens & set secure cookie', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: validHeaders,
      body: JSON.stringify({
        email: testUser.email,
        password: testUser.password,
      }),
    });

    assert.strictEqual(res.status, 200);
    const data = (await res.json()) as any;
    assert.strictEqual(data.success, true);
    assert.ok(data.accessToken);
    assert.strictEqual(data.user.email, testUser.email.toLowerCase());

    validAccessTokenDeviceA = data.accessToken;

    const cookieHeader = res.headers.get('set-cookie');
    assert.ok(cookieHeader, 'Must set cookie header');
    assert.ok(cookieHeader.includes('connectly_refresh='), 'Must set connectly_refresh cookie');
    assert.ok(cookieHeader.includes('HttpOnly'), 'Cookie must be HttpOnly');
    assert.ok(cookieHeader.includes('SameSite=Lax'), 'Cookie must be SameSite=Lax');
    assert.ok(cookieHeader.includes('Path=/api'), 'Cookie must be scoped to /api');

    refreshCookieDeviceA = cookieHeader.split(';')[0];
    refreshTokenValueDeviceA = refreshCookieDeviceA.replace('connectly_refresh=', '');

    // Verify session in MongoDB has familyId
    sessionDocDeviceA = await AuthSession.findOne({ isValid: true });
    assert.ok(sessionDocDeviceA);
    assert.ok(sessionDocDeviceA.familyId, 'Session must have a familyId');
    assert.strictEqual(sessionDocDeviceA.userId.toString(), data.user.id);
  });

  let refreshCookieDeviceB: string;
  let sessionDocDeviceB: any;

  it('6. POST /api/v1/auth/login — should login Device B with distinct familyId', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: validHeaders,
      body: JSON.stringify({
        email: testUser.email,
        password: testUser.password,
      }),
    });

    assert.strictEqual(res.status, 200);
    const cookieHeader = res.headers.get('set-cookie')!;
    refreshCookieDeviceB = cookieHeader.split(';')[0];
    const tokenValB = refreshCookieDeviceB.replace('connectly_refresh=', '');
    const hashB = hashToken(tokenValB);

    sessionDocDeviceB = await AuthSession.findOne({ refreshTokenHash: hashB, isValid: true });
    assert.ok(sessionDocDeviceB);
    assert.notStrictEqual(
      sessionDocDeviceB.familyId,
      sessionDocDeviceA.familyId,
      'Independent devices must possess distinct familyIds'
    );
  });

  // --------------------------------------------------------------------------
  // CSRF PROTECTION TESTS
  // --------------------------------------------------------------------------
  it('7. CSRF Defense — should reject state-changing requests from untrusted origins', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'https://malicious-attacker.evil.com',
      },
      body: JSON.stringify({
        email: testUser.email,
        password: testUser.password,
      }),
    });

    assert.strictEqual(res.status, 403);
    const data = (await res.json()) as any;
    assert.strictEqual(data.code, 'CSRF_INVALID_ORIGIN');
  });

  it('8. CSRF Defense — should reject state-changing requests with untrusted referer', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Referer': 'https://malicious-attacker.evil.com/phishing-page',
      },
      body: JSON.stringify({
        email: testUser.email,
        password: testUser.password,
      }),
    });

    assert.strictEqual(res.status, 403);
    const data = (await res.json()) as any;
    assert.strictEqual(data.code, 'CSRF_INVALID_REFERER');
  });

  it('9. CSRF Defense — should reject /refresh when anti-CSRF custom header is missing', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'http://localhost:5173',
        'Cookie': refreshCookieDeviceA,
        // Omit X-Requested-With and X-CSRF-Protection
      },
    });

    assert.strictEqual(res.status, 403);
    const data = (await res.json()) as any;
    assert.strictEqual(data.code, 'CSRF_VERIFICATION_FAILED');
  });

  it('10. CSRF Defense — should reject /logout when anti-CSRF custom header is missing', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'http://localhost:5173',
        'Cookie': refreshCookieDeviceA,
        // Omit X-Requested-With and X-CSRF-Protection
      },
    });

    assert.strictEqual(res.status, 403);
    const data = (await res.json()) as any;
    assert.strictEqual(data.code, 'CSRF_VERIFICATION_FAILED');
  });

  // --------------------------------------------------------------------------
  // CORS VERIFICATION TESTS
  // --------------------------------------------------------------------------
  it('11. CORS — should return correct Access-Control headers for allowed origin', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'OPTIONS',
      headers: {
        'Origin': 'http://localhost:5173',
        'Access-Control-Request-Method': 'POST',
      },
    });

    assert.strictEqual(res.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    assert.strictEqual(res.headers.get('access-control-allow-credentials'), 'true');
  });

  it('12. CORS — should not reflect origin header for unauthorized origin', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'OPTIONS',
      headers: {
        'Origin': 'https://unauthorized-domain.com',
        'Access-Control-Request-Method': 'POST',
      },
    });

    assert.notStrictEqual(res.headers.get('access-control-allow-origin'), 'https://unauthorized-domain.com');
  });

  // --------------------------------------------------------------------------
  // TOKEN VALIDATION & AUTHORIZATION TESTS
  // --------------------------------------------------------------------------
  it('13. GET /api/v1/users/me — should access protected route with valid Bearer token', async () => {
    const res = await fetch(`${baseUrl}/api/v1/users/me`, {
      headers: {
        Authorization: `Bearer ${validAccessTokenDeviceA}`,
      },
    });

    assert.strictEqual(res.status, 200);
    const data = (await res.json()) as any;
    assert.strictEqual(data.email, testUser.email.toLowerCase());
    assert.ok(data.preferences);
  });

  it('14. GET /api/v1/users/me — should reject unauthorized request without token', async () => {
    const res = await fetch(`${baseUrl}/api/v1/users/me`);
    assert.strictEqual(res.status, 401);
    const data = (await res.json()) as any;
    assert.strictEqual(data.code, 'UNAUTHORIZED');
  });

  it('15. Token Security — should reject expired access token', async () => {
    const expiredToken = jwt.sign(
      { sub: sessionDocDeviceA.userId.toString(), email: testUser.email },
      env.JWT_ACCESS_SECRET,
      { expiresIn: '-1s' }
    );

    const res = await fetch(`${baseUrl}/api/v1/users/me`, {
      headers: { Authorization: `Bearer ${expiredToken}` },
    });

    assert.strictEqual(res.status, 401);
    const data = (await res.json()) as any;
    assert.strictEqual(data.code, 'UNAUTHORIZED');
  });

  it('16. Token Security — should reject malformed access token', async () => {
    const res = await fetch(`${baseUrl}/api/v1/users/me`, {
      headers: { Authorization: 'Bearer this.is.not.a.valid.jwt' },
    });

    assert.strictEqual(res.status, 401);
    const data = (await res.json()) as any;
    assert.strictEqual(data.code, 'UNAUTHORIZED');
  });

  // --------------------------------------------------------------------------
  // TOKEN ROTATION, CONCURRENCY & REUSE DETECTION TESTS
  // --------------------------------------------------------------------------
  let rotatedRefreshCookieDeviceA: string;
  let rotatedRefreshTokenValueDeviceA: string;

  it('17. POST /api/v1/auth/refresh — should rotate refresh token within the same family', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: {
        ...validHeaders,
        Cookie: refreshCookieDeviceA,
      },
    });

    assert.strictEqual(res.status, 200);
    const data = (await res.json()) as any;
    assert.strictEqual(data.success, true);
    assert.ok(data.accessToken);

    const cookieHeader = res.headers.get('set-cookie');
    assert.ok(cookieHeader);
    rotatedRefreshCookieDeviceA = cookieHeader.split(';')[0];
    rotatedRefreshTokenValueDeviceA = rotatedRefreshCookieDeviceA.replace('connectly_refresh=', '');

    assert.notStrictEqual(
      rotatedRefreshTokenValueDeviceA,
      refreshTokenValueDeviceA,
      'Refresh token must be rotated to a new secret'
    );

    // Verify old session document is marked isValid: false with rotatedAt timestamp
    const oldHash = hashToken(refreshTokenValueDeviceA);
    const oldSession = await AuthSession.findOne({ refreshTokenHash: oldHash });
    assert.ok(oldSession);
    assert.strictEqual(oldSession.isValid, false);
    assert.ok(oldSession.rotatedAt);

    // Verify new session document inherited the SAME familyId
    const newHash = hashToken(rotatedRefreshTokenValueDeviceA);
    const newSession = await AuthSession.findOne({ refreshTokenHash: newHash });
    assert.ok(newSession);
    assert.strictEqual(newSession.isValid, true);
    assert.strictEqual(newSession.familyId, sessionDocDeviceA.familyId);
  });

  it('18. Concurrent Refresh Race — should handle concurrent race within grace window gracefully', async () => {
    // Replay the old token immediately (simulating two tabs refreshing within milliseconds)
    const res = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: {
        ...validHeaders,
        Cookie: refreshCookieDeviceA, // old token just rotated ~100ms ago
      },
    });

    assert.strictEqual(res.status, 401);
    const data = (await res.json()) as any;
    assert.strictEqual(data.code, 'CONCURRENT_REFRESH');
    assert.strictEqual(data.accessToken, undefined, 'Must not issue access token to rotated token during grace period');
    assert.strictEqual(res.headers.get('set-cookie'), null, 'Must not issue new cookie to rotated token during grace period');

    // Verify family was NOT nuked by the race window
    const newHash = hashToken(rotatedRefreshTokenValueDeviceA);
    const activeSession = await AuthSession.findOne({ refreshTokenHash: newHash });
    assert.ok(activeSession);
    assert.strictEqual(activeSession.isValid, true, 'Active session must remain valid during concurrent race window');
  });

  it('18b. Simultaneous Concurrent Requests — should handle two simultaneous refresh calls without breaking session', async () => {
    // Login Device C with a separate fresh session
    const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: validHeaders,
      body: JSON.stringify({ email: testUser.email, password: testUser.password }),
    });
    assert.strictEqual(loginRes.status, 200);
    const cookieDeviceC = loginRes.headers.get('set-cookie')!.split(';')[0];
    const initialTokenValueC = cookieDeviceC.replace('connectly_refresh=', '');
    const initialSessionC = await AuthSession.findOne({ refreshTokenHash: hashToken(initialTokenValueC) });
    assert.ok(initialSessionC);

    // Launch two simultaneous refresh requests with the exact same initial cookie via Promise.all
    const [res1, res2] = await Promise.all([
      fetch(`${baseUrl}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { ...validHeaders, Cookie: cookieDeviceC },
      }),
      fetch(`${baseUrl}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { ...validHeaders, Cookie: cookieDeviceC },
      }),
    ]);

    const statuses = [res1.status, res2.status].sort();
    assert.deepStrictEqual(statuses, [200, 401], 'Exactly one request succeeds (200) and one receives concurrent race notice (401)');

    const successRes = res1.status === 200 ? res1 : res2;
    const concurrentRes = res1.status === 401 ? res1 : res2;

    const successData = (await successRes.json()) as any;
    assert.strictEqual(successData.success, true);
    assert.ok(successData.accessToken, 'Successful request receives new access token');
    const newCookieHeader = successRes.headers.get('set-cookie');
    assert.ok(newCookieHeader, 'Successful request receives new refresh cookie');

    const concurrentData = (await concurrentRes.json()) as any;
    assert.strictEqual(concurrentData.code, 'CONCURRENT_REFRESH');
    assert.strictEqual(concurrentData.accessToken, undefined, 'Concurrent duplicate request must not receive access token');
    assert.strictEqual(concurrentRes.headers.get('set-cookie'), null, 'Concurrent duplicate request must not receive cookie');

    // Verify the newly rotated session remains active in DB with the same familyId
    const rotatedTokenValueC = newCookieHeader.split(';')[0].replace('connectly_refresh=', '');
    const activeSessionC = await AuthSession.findOne({ refreshTokenHash: hashToken(rotatedTokenValueC) });
    assert.ok(activeSessionC, 'Newly rotated session must exist');
    assert.strictEqual(activeSessionC.isValid, true, 'Active session must remain valid');
    assert.strictEqual(activeSessionC.familyId, initialSessionC.familyId, 'Must inherit identical familyId');
  });

  it('19. Token Reuse Attack — should detect reuse outside grace window & revoke ONLY affected family', async () => {
    // Manually push the old token's rotatedAt back beyond the 5-second grace window
    const oldHash = hashToken(refreshTokenValueDeviceA);
    await AuthSession.updateOne(
      { refreshTokenHash: oldHash },
      { rotatedAt: new Date(Date.now() - 10000) }
    );

    // Replay the old token
    const res = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: {
        ...validHeaders,
        Cookie: refreshCookieDeviceA,
      },
    });

    assert.strictEqual(res.status, 401);
    const data = (await res.json()) as any;
    assert.strictEqual(data.code, 'TOKEN_REUSE_DETECTED');

    // Verify ALL sessions in Device A's family are now revoked
    const deviceAFamilySessions = await AuthSession.find({ familyId: sessionDocDeviceA.familyId, isValid: true });
    assert.strictEqual(deviceAFamilySessions.length, 0, 'All sessions in compromised family must be revoked');

    // CRITICAL: Verify Device B's session remains completely valid and operational!
    const deviceBSessions = await AuthSession.find({ familyId: sessionDocDeviceB.familyId, isValid: true });
    assert.strictEqual(deviceBSessions.length, 1, 'Unrelated Device B session must remain valid');

    // Test that Device B can still refresh successfully
    const deviceBRefreshRes = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: {
        ...validHeaders,
        Cookie: refreshCookieDeviceB,
      },
    });
    assert.strictEqual(deviceBRefreshRes.status, 200, 'Device B must continue to operate without disruption');
  });

  it('20. Token Security — should reject expired refresh token', async () => {
    // Insert an expired session
    const expiredTokenVal = 'expired_refresh_token_value_64_characters_long_for_test_purposes';
    const expiredHash = hashToken(expiredTokenVal);
    await AuthSession.create({
      userId: sessionDocDeviceA.userId,
      familyId: 'expired_family',
      refreshTokenHash: expiredHash,
      isValid: true,
      expiresAt: new Date(Date.now() - 1000), // expired 1s ago
    });

    const res = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: {
        ...validHeaders,
        Cookie: `connectly_refresh=${expiredTokenVal}`,
      },
    });

    assert.strictEqual(res.status, 401);
    const data = (await res.json()) as any;
    assert.strictEqual(data.code, 'TOKEN_EXPIRED');
  });

  // --------------------------------------------------------------------------
  // LOGOUT & TERMINATION TESTS
  // --------------------------------------------------------------------------
  it('21. POST /api/v1/auth/logout — should revoke session family and clear cookie', async () => {
    // Log in Device C
    const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: validHeaders,
      body: JSON.stringify({
        email: testUser.email,
        password: testUser.password,
      }),
    });
    const loginCookie = loginRes.headers.get('set-cookie')!.split(';')[0];
    const tokenVal = loginCookie.replace('connectly_refresh=', '');
    const tokenHash = hashToken(tokenVal);

    const logoutRes = await fetch(`${baseUrl}/api/v1/auth/logout`, {
      method: 'POST',
      headers: {
        ...validHeaders,
        Cookie: loginCookie,
      },
    });

    assert.strictEqual(logoutRes.status, 200);
    const logoutData = (await logoutRes.json()) as any;
    assert.strictEqual(logoutData.success, true);

    // Verify cookie clearing headers
    const logoutCookieHeader = logoutRes.headers.get('set-cookie');
    assert.ok(logoutCookieHeader);
    assert.ok(
      logoutCookieHeader.includes('connectly_refresh=;') ||
        logoutCookieHeader.includes('Expires=Thu, 01 Jan 1970')
    );

    // Verify session revoked in MongoDB
    const session = await AuthSession.findOne({ refreshTokenHash: tokenHash });
    assert.ok(session);
    assert.strictEqual(session.isValid, false, 'Session must be marked invalid after logout');
  });
});
