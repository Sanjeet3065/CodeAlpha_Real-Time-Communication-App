import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveGoogleClientId,
  resetGoogleOAuthCacheForTesting,
  GoogleAuthCancelledError,
} from './googleOAuth.ts';

describe('Google OAuth Client Helper Suite', () => {
  beforeEach(() => {
    resetGoogleOAuthCacheForTesting();
  });

  it('1. Prefers build-time VITE_GOOGLE_CLIENT_ID over server lookup', async () => {
    let fetchCalled = false;
    const clientId = await resolveGoogleClientId('build-id.apps.googleusercontent.com', async () => {
      fetchCalled = true;
      return { enabled: true, clientId: 'server-id.apps.googleusercontent.com' };
    });

    assert.strictEqual(clientId, 'build-id.apps.googleusercontent.com');
    assert.strictEqual(fetchCalled, false);
  });

  it('2. Falls back to server /auth/google/config when build env ID is empty', async () => {
    let calls = 0;
    const first = await resolveGoogleClientId('', async () => {
      calls += 1;
      return { enabled: true, clientId: 'server-id.apps.googleusercontent.com' };
    });
    const second = await resolveGoogleClientId('', async () => {
      calls += 1;
      return { enabled: true, clientId: 'other-id.apps.googleusercontent.com' };
    });

    assert.strictEqual(first, 'server-id.apps.googleusercontent.com');
    assert.strictEqual(second, 'server-id.apps.googleusercontent.com');
    assert.strictEqual(calls, 1, 'Should cache valid runtime client ID after first fetch');
  });

  it('3. Returns null safely when Google auth is unconfigured or server lookup fails', async () => {
    const disabled = await resolveGoogleClientId('  ', async () => ({
      enabled: false,
      clientId: null,
    }));
    const failed = await resolveGoogleClientId('', async () => {
      throw new Error('Network unavailable');
    });

    assert.strictEqual(disabled, null);
    assert.strictEqual(failed, null);
    const err = new GoogleAuthCancelledError();
    assert.strictEqual(err.name, 'GoogleAuthCancelledError');
  });
});
