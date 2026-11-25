import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { createApp } from '../app.js';
import { User } from '../models/User.model.js';
import { UserPreferences } from '../models/UserPreferences.model.js';
import { UserService, MAX_FUTURE_CLOCK_SKEW_MS } from '../services/user.service.js';
import { generateAccessToken } from '../utils/tokens.js';
import { hashPassword } from '../utils/password.js';
import type { Server } from 'node:http';

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('Phase 07 Atomic MongoDB Cross-Instance Concurrency & Stale-Request Safety Suite', () => {
  let serverA: Server;
  let serverB: Server;
  let urlA: string;
  let urlB: string;

  let userId: string;
  let token: string;

  // Two completely independent UserService instances (no shared in-process queue!)
  const serviceA = new UserService();
  const serviceB = new UserService();

  before(async () => {
    await mongoose.connect('mongodb://127.0.0.1:27017/connectly_atomic_concurrency_test');
    await User.deleteMany({});
    await UserPreferences.deleteMany({});

    const passwordHash = await hashPassword('SecurePassword123!');
    const user = await User.create({
      email: 'atomic.race@connectly.io',
      passwordHash,
      firstName: 'Atomic',
      lastName: 'Tester',
      isEmailVerified: true,
    });
    userId = user._id.toString();
    token = generateAccessToken({
      sub: userId,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
    });

    // Spin up two independent Express API server instances sharing the same MongoDB database
    const appA = createApp();
    const appB = createApp();
    await new Promise<void>((resolve) => {
      serverA = appA.listen(0, () => {
        const addr = serverA.address();
        if (addr && typeof addr === 'object') urlA = `http://localhost:${addr.port}`;
        resolve();
      });
    });
    await new Promise<void>((resolve) => {
      serverB = appB.listen(0, () => {
        const addr = serverB.address();
        if (addr && typeof addr === 'object') urlB = `http://localhost:${addr.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (serverA) await new Promise<void>((resolve) => serverA.close(() => resolve()));
    if (serverB) await new Promise<void>((resolve) => serverB.close(() => resolve()));
    await User.deleteMany({});
    await UserPreferences.deleteMany({});
    await mongoose.disconnect();
  });

  it('1. Two-Instance Deterministic Race (Same Session, Same Field): Instance B commits newer update first, Instance A older update CANNOT overwrite MongoDB', async () => {
    const baseNow = Date.now();
    const sessionId = 'session-same-field-race';

    await UserPreferences.deleteMany({ userId });
    const seed = await serviceA.updatePreferences(userId, {
      defaultAudioMuted: true,
      defaultVideoOff: false,
      clientTimestamp: baseNow - 5000,
      clientSessionId: sessionId,
    });
    assert.strictEqual(seed.version, 1);

    const instanceAReady = createDeferred();
    const instanceBReady = createDeferred();
    const allowBCommit = createDeferred();
    const allowACommit = createDeferred();

    const t1Older = baseNow - 1000;
    const t2Newer = baseNow - 100;

    const opA = serviceA.updatePreferences(
      userId,
      {
        defaultAudioMuted: true,
        clientTimestamp: t1Older,
        clientSessionId: sessionId,
      },
      {
        nowMs: baseNow,
        beforeAtomicWrite: async () => {
          const seen = await UserPreferences.findOne({ userId });
          assert.strictEqual(seen?.version, 1);
          instanceAReady.resolve();
          await allowACommit.promise;
        },
      }
    );

    const opB = serviceB.updatePreferences(
      userId,
      {
        defaultAudioMuted: false,
        clientTimestamp: t2Newer,
        clientSessionId: sessionId,
      },
      {
        nowMs: baseNow,
        beforeAtomicWrite: async () => {
          const seen = await UserPreferences.findOne({ userId });
          assert.strictEqual(seen?.version, 1);
          instanceBReady.resolve();
          await allowBCommit.promise;
        },
      }
    );

    await Promise.all([instanceAReady.promise, instanceBReady.promise]);

    allowBCommit.resolve();
    const resultB = await opB;
    assert.strictEqual(resultB.defaultAudioMuted, false);
    assert.strictEqual(resultB.version, 2);
    assert.strictEqual(resultB.staleIgnored, undefined);

    allowACommit.resolve();
    const resultA = await opA;
    assert.strictEqual(resultA.staleIgnored, true);
    assert.strictEqual(resultA.defaultAudioMuted, false);
    assert.strictEqual(resultA.version, 2);

    const finalDoc = await UserPreferences.findOne({ userId });
    assert.strictEqual(finalDoc?.defaultAudioMuted, false);
    assert.strictEqual(finalDoc?.version, 2);
    assert.strictEqual(finalDoc?.fieldTimestamps?.defaultAudioMuted, t2Newer);
  });

  it('2. Two-Instance Simultaneous Different-Field Updates: neither update overwrites the other', async () => {
    const baseNow = Date.now();
    const sessionId = 'session-diff-field-race';

    await UserPreferences.deleteMany({ userId });
    await serviceA.updatePreferences(userId, {
      defaultAudioMuted: true,
      defaultVideoOff: false,
      clientTimestamp: baseNow - 5000,
      clientSessionId: sessionId,
    });

    const aReady = createDeferred();
    const bReady = createDeferred();
    const releaseBoth = createDeferred();

    const opAudio = serviceA.updatePreferences(
      userId,
      {
        defaultAudioMuted: false,
        clientTimestamp: baseNow - 500,
        clientSessionId: sessionId,
      },
      {
        nowMs: baseNow,
        beforeAtomicWrite: async () => {
          aReady.resolve();
          await releaseBoth.promise;
        },
      }
    );

    const opVideo = serviceB.updatePreferences(
      userId,
      {
        defaultVideoOff: true,
        clientTimestamp: baseNow - 100,
        clientSessionId: sessionId,
      },
      {
        nowMs: baseNow,
        beforeAtomicWrite: async () => {
          bReady.resolve();
          await releaseBoth.promise;
        },
      }
    );

    await Promise.all([aReady.promise, bReady.promise]);
    releaseBoth.resolve();

    const [resA, resB] = await Promise.all([opAudio, opVideo]);
    assert.strictEqual(resA.staleIgnored, undefined);
    assert.strictEqual(resB.staleIgnored, undefined);

    const finalDoc = await UserPreferences.findOne({ userId });
    assert.strictEqual(finalDoc?.defaultAudioMuted, false);
    assert.strictEqual(finalDoc?.defaultVideoOff, true);
    assert.strictEqual(finalDoc?.version, 3);
  });

  it('3. Previous-Session Delayed Request (defaultAudioMuted): Session A paused before DB write CANNOT overwrite Session B newer commit (both versioned and unversioned)', async () => {
    const baseNow = Date.now();

    await UserPreferences.deleteMany({ userId });
    const init = await serviceA.updatePreferences(userId, {
      defaultAudioMuted: true,
      defaultVideoOff: false,
      clientTimestamp: baseNow - 5000,
      clientSessionId: 'session-initial',
    });

    // Subcase A: Session A holds stale expectedFieldVersions from before Session B committed
    const pauseA = createDeferred();
    const readyA = createDeferred();

    const opSessionA = serviceA
      .updatePreferences(
        userId,
        {
          defaultAudioMuted: true,
          clientTimestamp: baseNow - 1000,
          clientSessionId: 'session-A',
          expectedFieldVersions: { defaultAudioMuted: init.fieldVersions.defaultAudioMuted },
        },
        {
          nowMs: baseNow,
          beforeAtomicWrite: async () => {
            readyA.resolve();
            await pauseA.promise;
          },
        }
      )
      .then((res) => ({ ok: true as const, res }))
      .catch((err) => ({ ok: false as const, err }));

    await readyA.promise;

    // Session B commits newer value defaultAudioMuted=false with matching server fieldVersion
    const resSessionB = await serviceB.updatePreferences(
      userId,
      {
        defaultAudioMuted: false,
        clientTimestamp: baseNow - 200,
        clientSessionId: 'session-B',
        expectedFieldVersions: { defaultAudioMuted: init.fieldVersions.defaultAudioMuted },
      },
      { nowMs: baseNow }
    );
    assert.strictEqual(resSessionB.defaultAudioMuted, false);
    assert.strictEqual(resSessionB.fieldVersions.defaultAudioMuted, init.fieldVersions.defaultAudioMuted + 1);

    // Release Session A's delayed request -> MUST be rejected with 409 Conflict!
    pauseA.resolve();
    const outcomeA = await opSessionA;
    assert.strictEqual(outcomeA.ok, false, 'Delayed Session A request must be rejected with conflict');
    assert.strictEqual((outcomeA as any).err.statusCode, 409);
    assert.strictEqual((outcomeA as any).err.code, 'PREFERENCES_VERSION_CONFLICT');

    // Subcase B: Unversioned delayed request from Session A (even with a slightly newer clock!)
    // MUST ALSO be rejected with 409 rather than overwriting Session B merely because sessionId differs
    await assert.rejects(
      () =>
        serviceA.updatePreferences(
          userId,
          {
            defaultAudioMuted: true,
            clientTimestamp: baseNow,
            clientSessionId: 'session-A',
          },
          { nowMs: baseNow }
        ),
      (err: any) => err.statusCode === 409 && err.code === 'PREFERENCES_VERSION_CONFLICT'
    );

    const finalDoc = await UserPreferences.findOne({ userId });
    assert.strictEqual(finalDoc?.defaultAudioMuted, false, 'Session B newer audio value must remain intact');
    assert.strictEqual(finalDoc?.fieldMeta?.defaultAudioMuted?.clientSessionId, 'session-B');
  });

  it('4. Previous-Session Delayed Request (defaultVideoOff): Session A paused before DB write CANNOT overwrite Session B newer commit', async () => {
    const baseNow = Date.now();
    const current = await serviceA.getPreferences(userId);
    const initialVideoVer = current.fieldVersions.defaultVideoOff;

    const pauseA = createDeferred();
    const readyA = createDeferred();

    // Session A attempts to set defaultVideoOff=false, paused before atomic DB write
    const opSessionA = serviceA
      .updatePreferences(
        userId,
        {
          defaultVideoOff: false,
          clientTimestamp: baseNow - 1000,
          clientSessionId: 'session-A-video',
          expectedFieldVersions: { defaultVideoOff: initialVideoVer },
        },
        {
          nowMs: baseNow,
          beforeAtomicWrite: async () => {
            readyA.resolve();
            await pauseA.promise;
          },
        }
      )
      .then((res) => ({ ok: true as const, res }))
      .catch((err) => ({ ok: false as const, err }));

    await readyA.promise;

    // Session B commits newer value defaultVideoOff=true
    const resSessionB = await serviceB.updatePreferences(
      userId,
      {
        defaultVideoOff: true,
        clientTimestamp: baseNow - 200,
        clientSessionId: 'session-B-video',
        expectedFieldVersions: { defaultVideoOff: initialVideoVer },
      },
      { nowMs: baseNow }
    );
    assert.strictEqual(resSessionB.defaultVideoOff, true);
    assert.strictEqual(resSessionB.fieldVersions.defaultVideoOff, initialVideoVer + 1);

    // Release Session A's delayed request -> MUST be rejected with 409 Conflict!
    pauseA.resolve();
    const outcomeA = await opSessionA;
    assert.strictEqual(outcomeA.ok, false);
    assert.strictEqual((outcomeA as any).err.statusCode, 409);
    assert.strictEqual((outcomeA as any).err.code, 'PREFERENCES_VERSION_CONFLICT');

    // Also verify unversioned differing-session write on defaultVideoOff is rejected with 409
    await assert.rejects(
      () =>
        serviceA.updatePreferences(
          userId,
          {
            defaultVideoOff: false,
            clientTimestamp: baseNow,
            clientSessionId: 'session-A-video',
          },
          { nowMs: baseNow }
        ),
      (err: any) => err.statusCode === 409 && err.code === 'PREFERENCES_VERSION_CONFLICT'
    );

    const finalDoc = await UserPreferences.findOne({ userId });
    assert.strictEqual(finalDoc?.defaultVideoOff, true, 'Session B newer camera value must remain intact');
    assert.strictEqual(finalDoc?.fieldMeta?.defaultVideoOff?.clientSessionId, 'session-B-video');
  });

  it('5. Same-Session Delayed Request > 15 Seconds: older request delayed 20s and 60s CANNOT overwrite newer same-session commit', async () => {
    const baseNow = Date.now();
    const sessionId = 'session-long-delay';
    const current = await serviceA.getPreferences(userId);

    // Commit newer Request 2 (T2 = baseNow - 100, defaultAudioMuted=false) at serverNow = baseNow
    const resNewer = await serviceB.updatePreferences(
      userId,
      {
        defaultAudioMuted: false,
        defaultVideoOff: true,
        clientTimestamp: baseNow - 100,
        clientSessionId: sessionId,
        expectedFieldVersions: current.fieldVersions,
      },
      { nowMs: baseNow }
    );
    assert.strictEqual(resNewer.defaultAudioMuted, false);
    assert.strictEqual(resNewer.defaultVideoOff, true);
    const committedVersion = resNewer.version;

    // Older Request 1 (T1 = baseNow - 2000 < T2) arrives 20 SECONDS LATER (exceeding old 15s window!)
    const delayed20s = await serviceA.updatePreferences(
      userId,
      {
        defaultAudioMuted: true,
        defaultVideoOff: false,
        clientTimestamp: baseNow - 2000,
        clientSessionId: sessionId,
        expectedFieldVersions: current.fieldVersions,
      },
      { nowMs: baseNow + 20_000 }
    );
    assert.strictEqual(delayed20s.staleIgnored, true, 'Older request delayed 20s must still be ignored');
    assert.strictEqual(delayed20s.defaultAudioMuted, false);
    assert.strictEqual(delayed20s.defaultVideoOff, true);
    assert.strictEqual(delayed20s.version, committedVersion);

    // Older Request 0 (T0 = baseNow - 5000 < T2) arrives 60 SECONDS LATER (without expectedFieldVersions)
    const delayed60s = await serviceA.updatePreferences(
      userId,
      {
        defaultAudioMuted: true,
        clientTimestamp: baseNow - 5000,
        clientSessionId: sessionId,
      },
      { nowMs: baseNow + 60_000 }
    );
    assert.strictEqual(delayed60s.staleIgnored, true, 'Older request delayed 60s must still be ignored');
    assert.strictEqual(delayed60s.defaultAudioMuted, false);
    assert.strictEqual(delayed60s.version, committedVersion);

    const finalDoc = await UserPreferences.findOne({ userId });
    assert.strictEqual(finalDoc?.defaultAudioMuted, false);
    assert.strictEqual(finalDoc?.defaultVideoOff, true);
    assert.strictEqual(finalDoc?.version, committedVersion);
  });

  it('6. Two Devices Editing Same Field vs Different Fields (Including Clock Skew & Conflict Retry)', async () => {
    const now = Date.now();

    // Both Device 1 (clock +10s ahead) and Device 2 (clock -5 hours behind!) read latest state
    const readDev1 = await fetch(`${urlA}/api/v1/users/me/preferences`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const dev1Initial = ((await readDev1.json()) as any).data;

    const readDev2 = await fetch(`${urlB}/api/v1/users/me/preferences`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const dev2Initial = ((await readDev2.json()) as any).data;

    // A. Two devices editing DIFFERENT fields simultaneously -> BOTH succeed without conflict!
    const [diffAudioRes, diffVideoRes] = await Promise.all([
      fetch(`${urlA}/api/v1/users/me/preferences`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          defaultAudioMuted: true,
          clientTimestamp: now + 10_000,
          clientSessionId: 'device-1-laptop',
          expectedFieldVersions: { defaultAudioMuted: dev1Initial.fieldVersions.defaultAudioMuted },
        }),
      }),
      fetch(`${urlB}/api/v1/users/me/preferences`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          defaultVideoOff: false,
          clientTimestamp: now - 5 * 3_600_000, // 5 hours behind!
          clientSessionId: 'device-2-phone',
          expectedFieldVersions: { defaultVideoOff: dev2Initial.fieldVersions.defaultVideoOff },
        }),
      }),
    ]);

    assert.strictEqual(diffAudioRes.status, 200);
    assert.strictEqual(diffVideoRes.status, 200);
    const afterDiff = await UserPreferences.findOne({ userId });
    assert.strictEqual(afterDiff?.defaultAudioMuted, true);
    assert.strictEqual(afterDiff?.defaultVideoOff, false);

    // B. Two devices editing the SAME field -> first wins, second gets explicit 409, fresh read + retry succeeds!
    const sharedSnap = (
      (await (
        await fetch(`${urlA}/api/v1/users/me/preferences`, {
          headers: { Authorization: `Bearer ${token}` },
        })
      ).json()) as any
    ).data;

    const dev1SameField = await fetch(`${urlA}/api/v1/users/me/preferences`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        defaultAudioMuted: false,
        clientTimestamp: now + 11_000,
        clientSessionId: 'device-1-laptop',
        expectedFieldVersions: { defaultAudioMuted: sharedSnap.fieldVersions.defaultAudioMuted },
      }),
    });
    assert.strictEqual(dev1SameField.status, 200);

    // Device 2 submits stale fieldVersion -> explicit HTTP 409 (never silently overwrites Device 1!)
    const dev2Conflict = await fetch(`${urlB}/api/v1/users/me/preferences`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        defaultAudioMuted: true,
        clientTimestamp: now - 5 * 3_600_000 + 1000,
        clientSessionId: 'device-2-phone',
        expectedFieldVersions: { defaultAudioMuted: sharedSnap.fieldVersions.defaultAudioMuted },
      }),
    });
    assert.strictEqual(dev2Conflict.status, 409);

    // Device 2 reads fresh state and retries with latest server-controlled fieldVersion -> HTTP 200 despite 5h clock lag!
    const dev2Fresh = (
      (await (
        await fetch(`${urlB}/api/v1/users/me/preferences`, {
          headers: { Authorization: `Bearer ${token}` },
        })
      ).json()) as any
    ).data;
    assert.strictEqual(dev2Fresh.defaultAudioMuted, false);

    const dev2Retry = await fetch(`${urlB}/api/v1/users/me/preferences`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        defaultAudioMuted: true,
        clientTimestamp: now - 5 * 3_600_000 + 2000,
        clientSessionId: 'device-2-phone',
        expectedFieldVersions: { defaultAudioMuted: dev2Fresh.fieldVersions.defaultAudioMuted },
      }),
    });
    assert.strictEqual(dev2Retry.status, 200);
    const dev2RetryBody = (await dev2Retry.json()) as any;
    assert.strictEqual(dev2RetryBody.data.defaultAudioMuted, true);
  });

  it('7. Browser Reload During an In-Flight Request: stalled pre-reload request gets 409 and cannot overwrite post-reload update', async () => {
    const now = Date.now();
    const preReloadSnap = await serviceA.getPreferences(userId);

    const stalledReady = createDeferred();
    const releaseStalled = createDeferred();

    // Tab 1 (pre-reload) fires request and stalls in transit before MongoDB write
    const preReloadReq = serviceA
      .updatePreferences(
        userId,
        {
          defaultAudioMuted: true,
          clientTimestamp: now - 500,
          clientSessionId: 'tab-before-reload',
          expectedFieldVersions: {
            defaultAudioMuted: preReloadSnap.fieldVersions.defaultAudioMuted,
          },
        },
        {
          nowMs: now,
          beforeAtomicWrite: async () => {
            stalledReady.resolve();
            await releaseStalled.promise;
          },
        }
      )
      .then((res) => ({ ok: true as const, res }))
      .catch((err) => ({ ok: false as const, err }));

    await stalledReady.promise;

    // User reloads page -> Tab 2 loads fresh preferences and saves defaultAudioMuted=false
    const postReloadSnap = await serviceB.getPreferences(userId);
    const postReloadCommit = await serviceB.updatePreferences(
      userId,
      {
        defaultAudioMuted: false,
        clientTimestamp: now - 100,
        clientSessionId: 'tab-after-reload',
        expectedFieldVersions: {
          defaultAudioMuted: postReloadSnap.fieldVersions.defaultAudioMuted,
        },
      },
      { nowMs: now }
    );
    assert.strictEqual(postReloadCommit.defaultAudioMuted, false);

    // Pre-reload stalled request arrives afterward -> MUST fail with 409 Conflict
    releaseStalled.resolve();
    const preReloadOutcome = await preReloadReq;
    assert.strictEqual(preReloadOutcome.ok, false);
    assert.strictEqual((preReloadOutcome as any).err.statusCode, 409);

    // Post-reload value stays intact in MongoDB
    const finalDoc = await UserPreferences.findOne({ userId });
    assert.strictEqual(finalDoc?.defaultAudioMuted, false);
    assert.strictEqual(finalDoc?.fieldMeta?.defaultAudioMuted?.clientSessionId, 'tab-after-reload');
  });

  it('8. Two-Instance Document-Level Optimistic Concurrency (expectedVersion): simultaneous same-version writes produce one 200 and one 409, fresh read + retry succeeds', async () => {
    const current = await serviceA.getPreferences(userId);
    const sharedVersion = current.version;
    assert.ok(sharedVersion >= 1);

    const aReady = createDeferred();
    const bReady = createDeferred();
    const releaseBoth = createDeferred();

    const opA = serviceA
      .updatePreferences(
        userId,
        { defaultAudioMuted: true, expectedVersion: sharedVersion },
        {
          beforeAtomicWrite: async () => {
            aReady.resolve();
            await releaseBoth.promise;
          },
        }
      )
      .then((res) => ({ ok: true as const, res }))
      .catch((err) => ({ ok: false as const, err }));

    const opB = serviceB
      .updatePreferences(
        userId,
        { defaultAudioMuted: false, expectedVersion: sharedVersion },
        {
          beforeAtomicWrite: async () => {
            bReady.resolve();
            await releaseBoth.promise;
          },
        }
      )
      .then((res) => ({ ok: true as const, res }))
      .catch((err) => ({ ok: false as const, err }));

    await Promise.all([aReady.promise, bReady.promise]);
    releaseBoth.resolve();

    const results = await Promise.all([opA, opB]);
    const successes = results.filter((r) => r.ok);
    const failures = results.filter((r) => !r.ok);

    assert.strictEqual(successes.length, 1);
    assert.strictEqual(failures.length, 1);
    assert.strictEqual((failures[0] as any).err.statusCode, 409);
    assert.strictEqual((failures[0] as any).err.code, 'PREFERENCES_VERSION_CONFLICT');

    // Fresh HTTP read + retry with new version succeeds cleanly
    const freshRes = await fetch(`${urlB}/api/v1/users/me/preferences`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const freshBody = (await freshRes.json()) as any;
    assert.strictEqual(freshBody.data.version, sharedVersion + 1);

    const retryRes = await fetch(`${urlB}/api/v1/users/me/preferences`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        defaultAudioMuted: !freshBody.data.defaultAudioMuted,
        expectedVersion: freshBody.data.version,
      }),
    });
    assert.strictEqual(retryRes.status, 200);
    const retryBody = (await retryRes.json()) as any;
    assert.strictEqual(retryBody.data.version, sharedVersion + 2);
  });

  it('9. Timestamp Safety — future-dated, malformed, negative, non-finite, float, and oversized timestamps are strictly rejected without poisoning MongoDB', async () => {
    const now = Date.now();
    const beforeDoc = await UserPreferences.findOne({ userId });

    // Future-dated timestamps beyond MAX_FUTURE_CLOCK_SKEW_MS
    for (const futureTs of [
      now + MAX_FUTURE_CLOCK_SKEW_MS + 5_000,
      now + 3_600_000,
      now + 365 * 86_400_000,
    ]) {
      const res = await fetch(`${urlA}/api/v1/users/me/preferences`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ defaultAudioMuted: false, clientTimestamp: futureTs }),
      });
      assert.strictEqual(res.status, 400);
      const body = (await res.json()) as any;
      assert.strictEqual(body.code, 'INVALID_CLIENT_TIMESTAMP');
    }

    // Malformed / negative / float / oversized timestamps
    for (const payload of [
      { defaultAudioMuted: true, clientTimestamp: 'not-a-number' },
      { defaultAudioMuted: true, clientTimestamp: -1 },
      { defaultAudioMuted: true, clientTimestamp: 1234.56 },
      { defaultAudioMuted: true, clientTimestamp: 4_102_444_800_001 },
      { defaultAudioMuted: true, clientTimestamp: Number.MAX_SAFE_INTEGER },
      { defaultAudioMuted: true, clientSessionId: 'bad session!' },
    ]) {
      const res = await fetch(`${urlA}/api/v1/users/me/preferences`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      assert.strictEqual(res.status, 400);
    }

    // Non-finite JS values directly to service
    await assert.rejects(
      () => serviceA.updatePreferences(userId, { defaultAudioMuted: true, clientTimestamp: Number.NaN }),
      /INVALID_CLIENT_TIMESTAMP|finite/i
    );
    await assert.rejects(
      () =>
        serviceA.updatePreferences(userId, {
          defaultAudioMuted: true,
          clientTimestamp: Number.POSITIVE_INFINITY,
        }),
      /INVALID_CLIENT_TIMESTAMP|finite/i
    );

    const afterRejected = await UserPreferences.findOne({ userId });
    assert.strictEqual(afterRejected?.version, beforeDoc?.version);

    // Subsequent legitimate versioned update succeeds immediately
    const legit = await serviceB.updatePreferences(userId, {
      defaultAudioMuted: false,
      clientTimestamp: Date.now(),
      clientSessionId: 'legit-after-reject',
      expectedFieldVersions: { defaultAudioMuted: afterRejected!.fieldVersions.defaultAudioMuted },
    });
    assert.strictEqual(legit.defaultAudioMuted, false);
  });

  it('10. Source-of-Truth Legacy Mirror Ordering: delayed older mirror write CANNOT overwrite newer User.preferences', async () => {
    const mirrorPause = createDeferred();
    const mirrorReached = createDeferred();

    const snap = await serviceA.getPreferences(userId);

    const opA = serviceA.updatePreferences(
      userId,
      {
        defaultAudioMuted: false,
        expectedFieldVersions: { defaultAudioMuted: snap.fieldVersions.defaultAudioMuted },
      },
      {
        beforeLegacyMirror: async () => {
          mirrorReached.resolve();
          await mirrorPause.promise;
        },
      }
    );

    await mirrorReached.promise;

    const snapB = await serviceB.getPreferences(userId);
    const resB = await serviceB.updatePreferences(userId, {
      defaultAudioMuted: true,
      expectedFieldVersions: { defaultAudioMuted: snapB.fieldVersions.defaultAudioMuted },
    });
    assert.strictEqual(resB.defaultAudioMuted, true);

    mirrorPause.resolve();
    const resA = await opA;
    assert.ok(resA.version < resB.version);

    const authPref = await UserPreferences.findOne({ userId });
    const userDoc = await User.findById(userId);
    assert.strictEqual(authPref?.defaultAudioMuted, true);
    assert.strictEqual(authPref?.version, resB.version);
    assert.strictEqual(userDoc?.preferences?.defaultAudioMuted, true);
    assert.strictEqual(userDoc?.preferencesVersion, resB.version);
  });
});
