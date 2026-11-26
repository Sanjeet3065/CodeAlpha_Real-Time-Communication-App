import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { createApp } from '../app.js';
import { User } from '../models/User.model.js';
import { UserPreferences } from '../models/UserPreferences.model.js';
import { generateAccessToken } from '../utils/tokens.js';
import { hashPassword } from '../utils/password.js';
import type { Server } from 'node:http';

describe('User Preferences Persistence & Data Isolation Suite', () => {
  let server: Server;
  let baseUrl: string;

  let userAId: string;
  let userBId: string;
  let tokenA: string;
  let tokenB: string;

  before(async () => {
    await mongoose.connect('mongodb://127.0.0.1:27017/connectly_preferences_test');
    await User.deleteMany({});
    await UserPreferences.deleteMany({});

    const passwordHash = await hashPassword('SecurePassword123!');

    const userA = await User.create({
      email: 'userA@connectly.io',
      passwordHash,
      firstName: 'Alice',
      lastName: 'Smith',
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
      email: 'userB@connectly.io',
      passwordHash,
      firstName: 'Bob',
      lastName: 'Jones',
      isEmailVerified: true,
    });
    userBId = userB._id.toString();
    tokenB = generateAccessToken({
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
    await UserPreferences.deleteMany({});
    await mongoose.disconnect();
  });

  it('1. GET /api/v1/users/me/preferences — should reject unauthenticated request with 401', async () => {
    const res = await fetch(`${baseUrl}/api/v1/users/me/preferences`);
    assert.strictEqual(res.status, 401);
  });

  it('2. GET /api/v1/users/me/preferences — should return sensible defaults for user with no record', async () => {
    const res = await fetch(`${baseUrl}/api/v1/users/me/preferences`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert.strictEqual(res.status, 200);

    const body = (await res.json()) as any;
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.defaultAudioMuted, true);
    assert.strictEqual(body.data.defaultVideoOff, false);
    assert.ok(body.data.updatedAt);
  });

  it('3. PUT /api/v1/users/me/preferences — should reject unauthenticated update with 401', async () => {
    const res = await fetch(`${baseUrl}/api/v1/users/me/preferences`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultAudioMuted: false, defaultVideoOff: true }),
    });
    assert.strictEqual(res.status, 401);
  });

  it('4. PUT /api/v1/users/me/preferences — should create and persist preference record', async () => {
    const res = await fetch(`${baseUrl}/api/v1/users/me/preferences`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        defaultAudioMuted: false,
        defaultVideoOff: true,
      }),
    });

    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as any;
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.defaultAudioMuted, false);
    assert.strictEqual(body.data.defaultVideoOff, true);

    // Verify database document
    const persisted = await UserPreferences.findOne({ userId: userAId });
    assert.ok(persisted);
    assert.strictEqual(persisted.defaultAudioMuted, false);
    assert.strictEqual(persisted.defaultVideoOff, true);
  });

  it('5. PUT /api/v1/users/me/preferences — independent microphone update leaves camera setting intact', async () => {
    // Only mutate defaultAudioMuted
    const res = await fetch(`${baseUrl}/api/v1/users/me/preferences`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        defaultAudioMuted: true,
      }),
    });

    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as any;
    assert.strictEqual(body.data.defaultAudioMuted, true);
    // Camera setting must remain true (from test 4)
    assert.strictEqual(body.data.defaultVideoOff, true);

    const persisted = await UserPreferences.findOne({ userId: userAId });
    assert.strictEqual(persisted?.defaultAudioMuted, true);
    assert.strictEqual(persisted?.defaultVideoOff, true);
  });

  it('6. PUT /api/v1/users/me/preferences — independent camera update leaves microphone setting intact', async () => {
    // Only mutate defaultVideoOff
    const res = await fetch(`${baseUrl}/api/v1/users/me/preferences`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        defaultVideoOff: false,
      }),
    });

    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as any;
    // Microphone setting must remain true (from test 5)
    assert.strictEqual(body.data.defaultAudioMuted, true);
    assert.strictEqual(body.data.defaultVideoOff, false);

    const persisted = await UserPreferences.findOne({ userId: userAId });
    assert.strictEqual(persisted?.defaultAudioMuted, true);
    assert.strictEqual(persisted?.defaultVideoOff, false);
  });

  it('7. PUT /api/v1/users/me/preferences — should reject non-boolean inputs with 400', async () => {
    const res = await fetch(`${baseUrl}/api/v1/users/me/preferences`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        defaultAudioMuted: 'not-a-boolean',
      }),
    });

    assert.strictEqual(res.status, 400);
    const body = (await res.json()) as any;
    assert.strictEqual(body.code, 'VALIDATION_ERROR');
  });

  it('8. PUT /api/v1/users/me/preferences — should reject unknown/speculative properties', async () => {
    const res = await fetch(`${baseUrl}/api/v1/users/me/preferences`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        defaultAudioMuted: true,
        speculativeThemeSync: 'dark-neon',
        speculativeCalendarAutoAccept: true,
      }),
    });

    assert.strictEqual(res.status, 400);
    const body = (await res.json()) as any;
    assert.strictEqual(body.code, 'VALIDATION_ERROR');
  });

  it('9. Cross-User Data Isolation — User A mutations must never modify User B preferences', async () => {
    // User B sets preferences
    await fetch(`${baseUrl}/api/v1/users/me/preferences`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenB}`,
      },
      body: JSON.stringify({
        defaultAudioMuted: false,
        defaultVideoOff: false,
      }),
    });

    // User A mutates preferences
    await fetch(`${baseUrl}/api/v1/users/me/preferences`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        defaultAudioMuted: true,
        defaultVideoOff: true,
      }),
    });

    // Verify User B's settings remain intact
    const userBPref = await UserPreferences.findOne({ userId: userBId });
    assert.strictEqual(userBPref?.defaultAudioMuted, false);
    assert.strictEqual(userBPref?.defaultVideoOff, false);
  });

  it('10. Database 1:1 Guarantee — exactly 1 document per user exists in user_preferences', async () => {
    const countA = await UserPreferences.countDocuments({ userId: userAId });
    assert.strictEqual(countA, 1, 'User A must have exactly 1 preferences document');

    const countB = await UserPreferences.countDocuments({ userId: userBId });
    assert.strictEqual(countB, 1, 'User B must have exactly 1 preferences document');
  });

  it('11. Concurrent Preference Creation Race — simultaneous upserts must resolve cleanly to 1 document', async () => {
    const freshUser = await User.create({
      email: `concurrent_${Date.now()}@connectly.io`,
      passwordHash: 'hash',
      firstName: 'Concurrent',
      lastName: 'Tester',
    });
    const freshToken = generateAccessToken({
      sub: freshUser._id.toString(),
      email: freshUser.email,
      firstName: freshUser.firstName,
      lastName: freshUser.lastName,
    });

    // Fire 6 simultaneous concurrent upserts on a new user with no preferences record
    const promises = Array.from({ length: 6 }).map((_, idx) =>
      fetch(`${baseUrl}/api/v1/users/me/preferences`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${freshToken}`,
        },
        body: JSON.stringify({
          defaultAudioMuted: idx % 2 === 0,
        }),
      })
    );

    const responses = await Promise.all(promises);
    for (const res of responses) {
      assert.strictEqual(res.status, 200, 'Every concurrent upsert must succeed');
    }

    const docCount = await UserPreferences.countDocuments({ userId: freshUser._id });
    assert.strictEqual(docCount, 1, 'Exactly 1 document must exist despite race condition');
  });

  it('12. Rapid Successive Updates — partial updates must preserve unrelated fields', async () => {
    // 1. Update microphone to false
    const res1 = await fetch(`${baseUrl}/api/v1/users/me/preferences`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({ defaultAudioMuted: false }),
    });
    assert.strictEqual(res1.status, 200);

    // 2. Immediately update camera to true without sending defaultAudioMuted
    const res2 = await fetch(`${baseUrl}/api/v1/users/me/preferences`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({ defaultVideoOff: true }),
    });
    assert.strictEqual(res2.status, 200);

    // 3. Fetch preferences to confirm both updates were preserved
    const res3 = await fetch(`${baseUrl}/api/v1/users/me/preferences`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${tokenA}`,
      },
    });
    const body3 = (await res3.json()) as any;
    assert.strictEqual(body3.data.defaultAudioMuted, false);
    assert.strictEqual(body3.data.defaultVideoOff, true);
  });

  it('13. X-Request-Id Security — validates safe IDs and sanitizes malicious/excessive values', async () => {
    // Case A: Valid custom request ID
    const resA = await fetch(`${baseUrl}/health`, {
      headers: { 'X-Request-Id': 'client-trace-12345' },
    });
    assert.strictEqual(resA.headers.get('x-request-id'), 'client-trace-12345');

    // Case B: Malicious Log Injection attempt with disallowed characters / spaces
    const resB = await fetch(`${baseUrl}/health`, {
      headers: { 'X-Request-Id': 'evil-id<script>alert(1)</script>' },
    });
    const headerB = resB.headers.get('x-request-id');
    assert.ok(headerB);
    assert.notStrictEqual(headerB, 'evil-id<script>alert(1)</script>');
    assert.match(headerB!, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

    // Case C: Excessively long ID (> 64 characters)
    const longId = 'a'.repeat(200);
    const resC = await fetch(`${baseUrl}/health`, {
      headers: { 'X-Request-Id': longId },
    });
    const headerC = resC.headers.get('x-request-id');
    assert.ok(headerC);
    assert.notStrictEqual(headerC, longId);
    assert.match(headerC!, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('14. Scenario A — Rapid microphone toggle (true -> false -> true) persists newest intent cleanly', async () => {
    const baseTs = Date.now() - 4000;
    const req1 = fetch(`${baseUrl}/api/v1/users/me/preferences`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({ defaultAudioMuted: false, clientTimestamp: baseTs + 1 }),
    });
    const req2 = fetch(`${baseUrl}/api/v1/users/me/preferences`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({ defaultAudioMuted: true, clientTimestamp: baseTs + 2 }),
    });

    const [r1, r2] = await Promise.all([req1, req2]);
    assert.strictEqual(r1.status, 200);
    assert.strictEqual(r2.status, 200);

    const persisted = await UserPreferences.findOne({ userId: userAId });
    assert.strictEqual(persisted?.defaultAudioMuted, true);
    assert.strictEqual(persisted?.fieldTimestamps?.defaultAudioMuted, baseTs + 2);
  });

  it('15. Scenario B — Repeated concurrent camera updates retain highest timestamp intent', async () => {
    const baseTs = Date.now() - 3000;
    // Fire 5 camera toggles simultaneously with strictly increasing clientTimestamps;
    // final intended value at idx=4 is false
    const requests = [false, true, false, true, false].map((val, idx) =>
      fetch(`${baseUrl}/api/v1/users/me/preferences`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenA}`,
        },
        body: JSON.stringify({
          defaultVideoOff: val,
          clientTimestamp: baseTs + idx + 1,
        }),
      })
    );

    const responses = await Promise.all(requests);
    for (const res of responses) {
      assert.strictEqual(res.status, 200);
    }

    const persisted = await UserPreferences.findOne({ userId: userAId });
    assert.strictEqual(persisted?.defaultVideoOff, false);
    assert.strictEqual(persisted?.fieldTimestamps?.defaultVideoOff, baseTs + 5);
  });

  it('16. Scenario D — Reverse-order network arrival at server cannot overwrite newer MongoDB state', async () => {
    const newerTs = Date.now() - 2000;
    const olderTs = newerTs - 500;

    // Newer request (T2) arrives at server FIRST and commits defaultAudioMuted=false
    const newerRes = await fetch(`${baseUrl}/api/v1/users/me/preferences`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        defaultAudioMuted: false,
        clientTimestamp: newerTs,
      }),
    });
    assert.strictEqual(newerRes.status, 200);
    const newerBody = (await newerRes.json()) as any;
    assert.strictEqual(newerBody.data.defaultAudioMuted, false);
    const committedVersion = newerBody.data.version;

    // Older delayed request (T1 < T2) arrives SECOND trying to write defaultAudioMuted=true
    const olderRes = await fetch(`${baseUrl}/api/v1/users/me/preferences`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        defaultAudioMuted: true,
        clientTimestamp: olderTs,
      }),
    });
    assert.strictEqual(olderRes.status, 200);
    const olderBody = (await olderRes.json()) as any;
    assert.strictEqual(olderBody.data.staleIgnored, true);
    assert.strictEqual(olderBody.data.defaultAudioMuted, false);
    assert.strictEqual(olderBody.data.version, committedVersion);

    // Confirm MongoDB document and mirrored User.preferences both preserve newer value (false)
    const persisted = await UserPreferences.findOne({ userId: userAId });
    assert.strictEqual(persisted?.defaultAudioMuted, false);
    const mirroredUser = await User.findById(userAId);
    assert.strictEqual(mirroredUser?.preferences?.defaultAudioMuted, false);
  });

  it('17. Scenario E — Simultaneous independent microphone and camera updates arriving out of order both persist', async () => {
    const t1 = Date.now() - 1000;
    const t2 = t1 + 100;

    // Camera update (T2) arrives FIRST
    const camRes = await fetch(`${baseUrl}/api/v1/users/me/preferences`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        defaultVideoOff: true,
        clientTimestamp: t2,
      }),
    });
    assert.strictEqual(camRes.status, 200);

    // Microphone update (T1 < T2, independent field!) arrives SECOND
    const micRes = await fetch(`${baseUrl}/api/v1/users/me/preferences`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        defaultAudioMuted: true,
        clientTimestamp: t1,
      }),
    });
    assert.strictEqual(micRes.status, 200);

    // Final MongoDB document must preserve BOTH independent updates
    const persisted = await UserPreferences.findOne({ userId: userAId });
    assert.strictEqual(persisted?.defaultAudioMuted, true);
    assert.strictEqual(persisted?.defaultVideoOff, true);
  });

  it('18. Optimistic Concurrency — expectedVersion rejects stale concurrent writes with 409', async () => {
    const currentRes = await fetch(`${baseUrl}/api/v1/users/me/preferences`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    const currentBody = (await currentRes.json()) as any;
    const currentVersion: number = currentBody.data.version;
    assert.ok(currentVersion >= 1);

    // Update with matching expectedVersion succeeds and increments version
    const okRes = await fetch(`${baseUrl}/api/v1/users/me/preferences`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        defaultAudioMuted: false,
        expectedVersion: currentVersion,
      }),
    });
    assert.strictEqual(okRes.status, 200);
    const okBody = (await okRes.json()) as any;
    assert.strictEqual(okBody.data.version, currentVersion + 1);

    // Stale expectedVersion fails with 409 PREFERENCES_VERSION_CONFLICT and leaves DB intact
    const conflictRes = await fetch(`${baseUrl}/api/v1/users/me/preferences`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        defaultAudioMuted: true,
        expectedVersion: currentVersion,
      }),
    });
    assert.strictEqual(conflictRes.status, 409);
    const conflictBody = (await conflictRes.json()) as any;
    assert.strictEqual(conflictBody.code, 'PREFERENCES_VERSION_CONFLICT');

    const persisted = await UserPreferences.findOne({ userId: userAId });
    assert.strictEqual(persisted?.defaultAudioMuted, false);
  });

  it('19. Single Source of Truth — stale embedded User.preferences never overwrites authoritative user_preferences across all endpoints', async () => {
    // 1. Write authoritative cloud preferences: audio=false, video=true
    const putRes = await fetch(`${baseUrl}/api/v1/users/me/preferences`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        defaultAudioMuted: false,
        defaultVideoOff: true,
        clientTimestamp: Date.now(),
      }),
    });
    assert.strictEqual(putRes.status, 200);

    // 2. Deliberately poison legacy embedded User.preferences with opposite stale values
    await User.findByIdAndUpdate(userAId, {
      $set: {
        'preferences.defaultAudioMuted': true,
        'preferences.defaultVideoOff': false,
      },
    });

    // 3. Verify GET /api/v1/users/me/preferences returns authoritative user_preferences
    const prefRes = await fetch(`${baseUrl}/api/v1/users/me/preferences`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    const prefBody = (await prefRes.json()) as any;
    assert.strictEqual(prefBody.data.defaultAudioMuted, false);
    assert.strictEqual(prefBody.data.defaultVideoOff, true);

    // 4. Verify GET /api/v1/users/me returns authoritative user_preferences
    const usersMeRes = await fetch(`${baseUrl}/api/v1/users/me`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    const usersMeBody = (await usersMeRes.json()) as any;
    assert.strictEqual(usersMeBody.preferences.defaultAudioMuted, false);
    assert.strictEqual(usersMeBody.preferences.defaultVideoOff, true);

    // 5. Verify GET /api/v1/auth/me returns authoritative user_preferences (never raw stale User.preferences)
    const authMeRes = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    const authMeBody = (await authMeRes.json()) as any;
    assert.strictEqual(authMeBody.preferences.defaultAudioMuted, false);
    assert.strictEqual(authMeBody.preferences.defaultVideoOff, true);

    // 6. Verify POST /api/v1/auth/login returns authoritative user_preferences
    const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'userA@connectly.io',
        password: 'SecurePassword123!',
      }),
    });
    assert.strictEqual(loginRes.status, 200);
    const loginBody = (await loginRes.json()) as any;
    assert.strictEqual(loginBody.user.preferences.defaultAudioMuted, false);
    assert.strictEqual(loginBody.user.preferences.defaultVideoOff, true);

    // 7. Verify POST /api/v1/auth/refresh returns authoritative user_preferences
    const setCookie = loginRes.headers.get('set-cookie');
    assert.ok(setCookie, 'Login must issue refresh cookie');
    const cookieHeader = setCookie.split(';')[0];
    const refreshRes = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Protection': '1',
        Cookie: cookieHeader,
      },
    });
    assert.strictEqual(refreshRes.status, 200);
    const refreshBody = (await refreshRes.json()) as any;
    assert.strictEqual(refreshBody.user.preferences.defaultAudioMuted, false);
    assert.strictEqual(refreshBody.user.preferences.defaultVideoOff, true);

    // 8. Verify PATCH /api/v1/users/me (profile update) preserves authoritative user_preferences
    const patchRes = await fetch(`${baseUrl}/api/v1/users/me`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({ firstName: 'Alice Updated' }),
    });
    assert.strictEqual(patchRes.status, 200);
    const patchBody = (await patchRes.json()) as any;
    assert.strictEqual(patchBody.data.preferences.defaultAudioMuted, false);
    assert.strictEqual(patchBody.data.preferences.defaultVideoOff, true);
  });

  it('20. Legacy Compatibility — user with only embedded User.preferences falls back cleanly and preserves legacy values on partial upsert', async () => {
    const legacyPasswordHash = await hashPassword('SecurePassword123!');
    const legacyUser = await User.create({
      email: `legacy_${Date.now()}@connectly.io`,
      passwordHash: legacyPasswordHash,
      firstName: 'Legacy',
      lastName: 'Account',
      preferences: {
        defaultAudioMuted: false,
        defaultVideoOff: true,
        enableVirtualBackground: true,
        theme: 'editorial-light',
        notificationSounds: false,
      },
    });
    const legacyToken = generateAccessToken({
      sub: legacyUser._id.toString(),
      email: legacyUser.email,
      firstName: legacyUser.firstName,
      lastName: legacyUser.lastName,
    });

    // No document exists in user_preferences yet -> read falls back to legacy embedded preferences
    const initialGet = await fetch(`${baseUrl}/api/v1/users/me/preferences`, {
      headers: { Authorization: `Bearer ${legacyToken}` },
    });
    assert.strictEqual(initialGet.status, 200);
    const initialBody = (await initialGet.json()) as any;
    assert.strictEqual(initialBody.data.defaultAudioMuted, false);
    assert.strictEqual(initialBody.data.defaultVideoOff, true);

    // Partial update to ONLY defaultAudioMuted must seed and preserve legacy defaultVideoOff=true
    const partialPut = await fetch(`${baseUrl}/api/v1/users/me/preferences`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${legacyToken}`,
      },
      body: JSON.stringify({ defaultAudioMuted: true }),
    });
    assert.strictEqual(partialPut.status, 200);
    const partialBody = (await partialPut.json()) as any;
    assert.strictEqual(partialBody.data.defaultAudioMuted, true);
    assert.strictEqual(partialBody.data.defaultVideoOff, true);
  });
});
