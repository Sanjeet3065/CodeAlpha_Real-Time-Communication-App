import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  preferencesApi,
  nextClientTimestamp,
  getClientSessionId,
  resetClientSession,
} from './preferencesApi.ts';
import { authStorage } from './authApi.ts';

describe('PreferencesApi Ordering, Failed Writes & Concurrency Suite', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    authStorage.setAccessToken('valid-test-access-token');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    authStorage.setAccessToken(null);
  });

  it('1. nextClientTimestamp() produces strictly monotonically increasing timestamps', () => {
    const timestamps: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      timestamps.push(nextClientTimestamp());
    }
    for (let i = 1; i < timestamps.length; i += 1) {
      assert.ok(
        timestamps[i] > timestamps[i - 1],
        `Timestamp ${timestamps[i]} must be strictly greater than ${timestamps[i - 1]}`
      );
    }
  });

  it('2. updatePreferences() attaches strictly increasing clientTimestamp on rapid mic toggles (true -> false -> true)', async () => {
    const sentPayloads: Array<{ defaultAudioMuted?: boolean; clientTimestamp?: number }> = [];

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const parsed = JSON.parse(String(init?.body || '{}'));
      sentPayloads.push(parsed);
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            defaultAudioMuted: parsed.defaultAudioMuted ?? true,
            defaultVideoOff: false,
            version: sentPayloads.length,
            updatedAt: new Date().toISOString(),
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    const [r1, r2, r3] = await Promise.all([
      preferencesApi.updatePreferences({ defaultAudioMuted: true }),
      preferencesApi.updatePreferences({ defaultAudioMuted: false }),
      preferencesApi.updatePreferences({ defaultAudioMuted: true }),
    ]);

    assert.strictEqual(r1.success, true);
    assert.strictEqual(r2.success, true);
    assert.strictEqual(r3.success, true);
    assert.strictEqual(sentPayloads.length, 3);
    assert.ok(sentPayloads[0].clientTimestamp! < sentPayloads[1].clientTimestamp!);
    assert.ok(sentPayloads[1].clientTimestamp! < sentPayloads[2].clientTimestamp!);
  });

  it('3. Scenario C — reverse-order responses do not overwrite newer state when guarded by sequence counter', async () => {
    let resolveFirst!: (res: Response) => void;
    let resolveSecond!: (res: Response) => void;
    let callIdx = 0;

    globalThis.fetch = (async () => {
      callIdx += 1;
      if (callIdx === 1) {
        return new Promise<Response>((resolve) => {
          resolveFirst = resolve;
        });
      }
      return new Promise<Response>((resolve) => {
        resolveSecond = resolve;
      });
    }) as typeof fetch;

    // Simulate SettingsPage sequence-guarded UI state
    let latestSeq = 0;
    let uiAudioMuted = true;
    let uiSyncStatus: 'idle' | 'synced' | 'local-only' = 'idle';

    const runSave = async (desiredAudio: boolean) => {
      const seq = ++latestSeq;
      const res = await preferencesApi.updatePreferences({ defaultAudioMuted: desiredAudio });
      if (seq !== latestSeq) return; // stale response discarded
      if (res.success && res.data) {
        uiAudioMuted = res.data.defaultAudioMuted;
        uiSyncStatus = 'synced';
      } else {
        uiSyncStatus = 'local-only';
      }
    };

    const save1 = runSave(false);
    const save2 = runSave(true);

    // Second (newer) request finishes FIRST
    resolveSecond(
      new Response(
        JSON.stringify({
          success: true,
          data: { defaultAudioMuted: true, defaultVideoOff: false, version: 2 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    await save2;
    assert.strictEqual(uiAudioMuted, true);
    assert.strictEqual(uiSyncStatus, 'synced');

    // First (older) request finishes SECOND with stale false value
    resolveFirst(
      new Response(
        JSON.stringify({
          success: true,
          data: { defaultAudioMuted: false, defaultVideoOff: false, version: 1 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    await save1;

    // UI state must still reflect newer save2 (true)
    assert.strictEqual(uiAudioMuted, true);
    assert.strictEqual(uiSyncStatus, 'synced');
  });

  it('4. Scenario F — failed cloud write returns success=false (never false cloud-success) while later succeeding write wins', async () => {
    let callIdx = 0;
    globalThis.fetch = (async () => {
      callIdx += 1;
      if (callIdx === 1) {
        return new Response(
          JSON.stringify({ status: 503, code: 'SERVICE_UNAVAILABLE', message: 'Backend offline' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify({
          success: true,
          data: { defaultAudioMuted: false, defaultVideoOff: true, version: 3 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    const failed = await preferencesApi.updatePreferences({ defaultAudioMuted: true });
    assert.strictEqual(failed.success, false);
    assert.match(failed.error || '', /Backend offline/);

    const succeeded = await preferencesApi.updatePreferences({
      defaultAudioMuted: false,
      defaultVideoOff: true,
    });
    assert.strictEqual(succeeded.success, true);
    assert.strictEqual(succeeded.data?.defaultAudioMuted, false);
    assert.strictEqual(succeeded.data?.defaultVideoOff, true);
  });

  it('5. Network disconnection produces local-only failure response cleanly without throwing', async () => {
    globalThis.fetch = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;

    const res = await preferencesApi.updatePreferences({ defaultAudioMuted: false });
    assert.strictEqual(res.success, false);
    assert.match(res.error || '', /Failed to fetch/);
  });

  it('6. Page reload / browser restart / second device generates distinct clientSessionId and calibrates server clock offset', async () => {
    const sessionBeforeReload = getClientSessionId();
    assert.ok(sessionBeforeReload.length > 0);

    // Simulate page reload -> distinct clientSessionId
    const sessionAfterReload = resetClientSession();
    assert.notStrictEqual(sessionAfterReload, sessionBeforeReload);

    // Simulate server UTC clock being 2 hours behind a skewed local clock via meta.timestamp
    const serverIso = new Date(Date.now() - 2 * 3_600_000).toISOString();
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          success: true,
          data: { defaultAudioMuted: true, defaultVideoOff: false, version: 1 },
          meta: { requestId: 'req-clock-cal', timestamp: serverIso },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )) as typeof fetch;

    await preferencesApi.getPreferences();

    const calibratedTs = nextClientTimestamp();
    const expectedServerMs = Date.parse(serverIso);
    assert.ok(
      Math.abs(calibratedTs - expectedServerMs) < 5_000,
      `Calibrated timestamp (${calibratedTs}) should align closely with server time (${expectedServerMs})`
    );
  });

  it('7. Automatically sends cached server fieldVersions on PUT and handles HTTP 409 conflict explicitly', async () => {
    resetClientSession('tab-versioned-test');
    const capturedBodies: Array<Record<string, unknown>> = [];

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'GET') {
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              defaultAudioMuted: true,
              defaultVideoOff: false,
              version: 3,
              fieldVersions: { defaultAudioMuted: 2, defaultVideoOff: 1 },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      capturedBodies.push(JSON.parse(String(init?.body || '{}')));
      return new Response(
        JSON.stringify({
          status: 409,
          code: 'PREFERENCES_VERSION_CONFLICT',
          message: 'Newer session modified preferences',
        }),
        { status: 409, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    await preferencesApi.getPreferences();
    const res = await preferencesApi.updatePreferences({ defaultAudioMuted: false });

    assert.strictEqual(capturedBodies.length, 1);
    assert.deepStrictEqual(capturedBodies[0].expectedFieldVersions, { defaultAudioMuted: 2 });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.code, 'PREFERENCES_VERSION_CONFLICT');
  });
});
