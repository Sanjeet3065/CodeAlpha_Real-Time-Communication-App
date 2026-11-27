import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { authApi, authStorage, fetchWithAuth } from './authApi.ts';

describe('AuthApi In-Flight Refresh Deduplication & Failure Recovery Suite', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    authStorage.setAccessToken(null);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    authStorage.setAccessToken(null);
  });

  it('1. deduplicates concurrent in-flight authApi.refresh() calls into a single network request', async () => {
    let fetchCount = 0;
    let resolveFetch!: (res: Response) => void;

    globalThis.fetch = (async () => {
      fetchCount += 1;
      return new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      });
    }) as typeof fetch;

    const p1 = authApi.refresh();
    const p2 = authApi.refresh();
    const p3 = authApi.refresh();

    assert.strictEqual(fetchCount, 1, 'Concurrent calls must share a single in-flight fetch');

    resolveFetch(
      new Response(
        JSON.stringify({
          success: true,
          accessToken: 'token-dedup-1',
          user: {
            id: 'u1',
            email: 'u1@connectly.io',
            firstName: 'Alex',
            lastName: 'Morgan',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    assert.strictEqual(r1.accessToken, 'token-dedup-1');
    assert.strictEqual(r2.accessToken, 'token-dedup-1');
    assert.strictEqual(r3.accessToken, 'token-dedup-1');
    assert.strictEqual(authStorage.getAccessToken(), 'token-dedup-1');
  });

  it('2. clears in-flight refresh promise immediately after success so subsequent refresh triggers a new request', async () => {
    let fetchCount = 0;

    globalThis.fetch = (async () => {
      fetchCount += 1;
      return new Response(
        JSON.stringify({
          success: true,
          accessToken: `token-seq-${fetchCount}`,
          user: {
            id: 'u1',
            email: 'u1@connectly.io',
            firstName: 'Alex',
            lastName: 'Morgan',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    const first = await authApi.refresh();
    assert.strictEqual(first.accessToken, 'token-seq-1');
    assert.strictEqual(fetchCount, 1);

    // Immediately call refresh() again without waiting — must NOT return stale cached promise
    const second = await authApi.refresh();
    assert.strictEqual(second.accessToken, 'token-seq-2');
    assert.strictEqual(fetchCount, 2);
  });

  it('3. clears in-flight refresh promise immediately after HTTP 401 failure (never caches rejected promise)', async () => {
    let fetchCount = 0;

    globalThis.fetch = (async () => {
      fetchCount += 1;
      if (fetchCount === 1) {
        return new Response(
          JSON.stringify({
            status: 401,
            code: 'CONCURRENT_REFRESH',
            message: 'Temporary failure',
          }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify({
          success: true,
          accessToken: 'recovered-token',
          user: {
            id: 'u1',
            email: 'u1@connectly.io',
            firstName: 'Alex',
            lastName: 'Morgan',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    await assert.rejects(() => authApi.refresh(), /Temporary failure/);
    assert.strictEqual(authStorage.getAccessToken(), null);
    assert.strictEqual(fetchCount, 1);

    // Immediate retry must issue a brand-new fetch and succeed cleanly
    const recovered = await authApi.refresh();
    assert.strictEqual(recovered.accessToken, 'recovered-token');
    assert.strictEqual(authStorage.getAccessToken(), 'recovered-token');
    assert.strictEqual(fetchCount, 2);
  });

  it('4. clears in-flight refresh promise immediately after network error rejection', async () => {
    let fetchCount = 0;

    globalThis.fetch = (async () => {
      fetchCount += 1;
      if (fetchCount === 1) {
        throw new TypeError('Failed to fetch');
      }
      return new Response(
        JSON.stringify({
          success: true,
          accessToken: 'post-network-recovery',
          user: {
            id: 'u1',
            email: 'u1@connectly.io',
            firstName: 'Alex',
            lastName: 'Morgan',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    await assert.rejects(() => authApi.refresh(), /Failed to fetch/);
    assert.strictEqual(fetchCount, 1);

    const recovered = await authApi.refresh();
    assert.strictEqual(recovered.accessToken, 'post-network-recovery');
    assert.strictEqual(fetchCount, 2);
  });

  it('5. shares one in-flight /auth/refresh request across concurrent authApi.refresh() and fetchWithAuth() 401 retry', async () => {
    let refreshFetchCount = 0;
    let releaseRefresh!: (res: Response) => void;
    let protectedAttempt = 0;

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/auth/refresh')) {
        refreshFetchCount += 1;
        return new Promise<Response>((resolve) => {
          releaseRefresh = resolve;
        });
      }

      if (url.includes('/users/me')) {
        protectedAttempt += 1;
        if (protectedAttempt === 1) {
          return new Response(JSON.stringify({ status: 401, code: 'UNAUTHORIZED', message: 'Expired' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        const headers = new Headers(init?.headers);
        assert.strictEqual(headers.get('Authorization'), 'Bearer shared-consolidated-token');
        return new Response(JSON.stringify({ id: 'u1', email: 'u1@connectly.io' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      throw new Error(`Unexpected URL: ${url}`);
    }) as typeof fetch;

    const pDirect = authApi.refresh();
    const pRetry = fetchWithAuth('/api/v1/users/me');

    // Allow pRetry initial 401 fetch to reach refreshAccessToken()
    await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(refreshFetchCount, 1, 'authApi.refresh() and fetchWithAuth() must share a single /auth/refresh flight');

    releaseRefresh(
      new Response(
        JSON.stringify({
          success: true,
          accessToken: 'shared-consolidated-token',
          user: {
            id: 'u1',
            email: 'u1@connectly.io',
            firstName: 'Alex',
            lastName: 'Morgan',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const [directRes, protectedRes] = await Promise.all([pDirect, pRetry]);
    assert.strictEqual(directRes.accessToken, 'shared-consolidated-token');
    assert.strictEqual(protectedRes.status, 200);
    assert.strictEqual(refreshFetchCount, 1);
  });

  it('4. does NOT call /auth/refresh or clear accessToken on 401 INVALID_CREDENTIALS from password-verified endpoint', async () => {
    authStorage.setAccessToken('active-user-jwt');
    let refreshFetchCount = 0;

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/auth/refresh')) {
        refreshFetchCount += 1;
        throw new Error('Should not trigger /auth/refresh on INVALID_CREDENTIALS');
      }
      if (url.includes('/users/me/email')) {
        return new Response(
          JSON.stringify({
            status: 401,
            code: 'INVALID_CREDENTIALS',
            message: 'Current password is incorrect.',
          }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        );
      }
      throw new Error(`Unexpected URL: ${url}`);
    }) as typeof fetch;

    await assert.rejects(
      () => authApi.updateEmail({ email: 'new@connectly.io', currentPassword: 'WrongPassword!' }),
      (err: unknown) =>
        typeof err === 'object' &&
        err !== null &&
        (err as { status?: number; code?: string }).status === 401 &&
        (err as { status?: number; code?: string }).code === 'INVALID_CREDENTIALS'
    );

    assert.strictEqual(refreshFetchCount, 0);
    assert.strictEqual(authStorage.getAccessToken(), 'active-user-jwt');
  });
});
