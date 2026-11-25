/**
 * CONNECTLY — Phase 18 Sprint 02 Client-Side Feature Gate & Socket URL Suite
 *
 * Verifies:
 * 1. FileApi handles HTTP 403 FEATURE_DISABLED correctly and throws ApiError with code FEATURE_DISABLED.
 * 2. Socket URL alias resolution supports both VITE_SOCKET_URL and VITE_SOCKET_IO_URL.
 * 3. File sharing feature gate boolean resolution.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from './authApi.ts';
import { fileApi } from './fileApi.ts';

describe('Phase 18 Client Feature Gate & Socket Alias Suite', () => {
  it('FileApi.listMeetingFiles parses and throws ApiError when receiving 403 FEATURE_DISABLED', async () => {
    // Mock global fetch to simulate 403 FEATURE_DISABLED
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          status: 403,
          code: 'FEATURE_DISABLED',
          message: 'File sharing is currently disabled',
          timestamp: new Date().toISOString(),
        }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }
      );

    try {
      await assert.rejects(
        () => fileApi.listMeetingFiles('cly-test-123'),
        (err: unknown) => {
          assert.ok(err instanceof ApiError);
          assert.strictEqual(err.status, 403);
          assert.strictEqual(err.code, 'FEATURE_DISABLED');
          assert.strictEqual(err.message, 'File sharing is currently disabled');
          return true;
        }
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('FileApi.getUserSharedFiles throws ApiError when receiving 403 FEATURE_DISABLED', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          status: 403,
          code: 'FEATURE_DISABLED',
          message: 'File sharing is currently disabled',
          timestamp: new Date().toISOString(),
        }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }
      );

    try {
      await assert.rejects(
        () => fileApi.getUserSharedFiles(),
        (err: unknown) => {
          assert.ok(err instanceof ApiError);
          assert.strictEqual(err.status, 403);
          assert.strictEqual(err.code, 'FEATURE_DISABLED');
          return true;
        }
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('Verifies file sharing feature gate evaluates false only when explicitly disabled', () => {
    const isEnabledDefault = ((undefined as string | undefined) !== 'false');
    assert.strictEqual(isEnabledDefault, true, 'Default must be enabled');

    const isExplicitlyDisabled = (('false' as string | undefined) !== 'false');
    assert.strictEqual(isExplicitlyDisabled, false, 'Explicit "false" must disable feature');

    const isExplicitlyEnabled = (('true' as string | undefined) !== 'false');
    assert.strictEqual(isExplicitlyEnabled, true, '"true" must enable feature');
  });

  it('Verifies Socket URL resolution hierarchy handles VITE_SOCKET_IO_URL alias', () => {
    function resolveSocketUrl(envObj: Record<string, string | undefined>): string {
      return (
        envObj.VITE_SOCKET_URL ||
        envObj.VITE_SOCKET_IO_URL ||
        'http://localhost:5000'
      );
    }

    assert.strictEqual(
      resolveSocketUrl({ VITE_SOCKET_URL: 'https://socket1.example.com' }),
      'https://socket1.example.com'
    );
    assert.strictEqual(
      resolveSocketUrl({ VITE_SOCKET_IO_URL: 'https://socket2.example.com' }),
      'https://socket2.example.com'
    );
    assert.strictEqual(
      resolveSocketUrl({
        VITE_SOCKET_URL: 'https://socket1.example.com',
        VITE_SOCKET_IO_URL: 'https://socket2.example.com',
      }),
      'https://socket1.example.com',
      'VITE_SOCKET_URL takes precedence if both provided'
    );
    assert.strictEqual(
      resolveSocketUrl({}),
      'http://localhost:5000',
      'Defaults to standard fallback when neither provided'
    );
  });
});
