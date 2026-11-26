import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { envSchema } from '../config/envSchema.js';
import { getCspDirectives } from '../config/csp.js';
import { getStorageProvider, setStorageProvider } from '../storage/storageFactory.js';
import { SupabaseStorageProvider } from '../storage/supabaseStorageProvider.js';
import { resolveFileSharingConfig } from '../scripts/verifyProductionReadiness.js';
import { createMemoryAdapter } from '../repositories/supabaseMappers.js';
import { toPgUuid, fromPgUuid, isHex24 } from '../config/supabase.js';
import { getRefreshCookieOptions } from '../utils/cookies.js';

describe('Supabase-First Architecture Unit Suite', () => {
  afterEach(() => {
    setStorageProvider(null);
  });

  const validProdBase = {
    NODE_ENV: 'production',
    PORT: '5000',
    DB_PROVIDER: 'supabase',
    SUPABASE_URL: 'https://example-project.supabase.co',
    SUPABASE_ANON_KEY: 'sb_publishable_test_key_valid',
    SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test_key_valid',
    SUPABASE_STORAGE_BUCKET: 'connectly-files',
    STORAGE_PROVIDER: 'supabase',
    ENABLE_FILE_SHARING: 'true',
    SOCKET_IO_MULTI_INSTANCE: 'false',
    CLIENT_ORIGIN: 'https://connectly.example.com',
    TRUST_PROXY: '2',
    PROXY_SECRET: crypto.randomBytes(32).toString('hex'),
    JWT_ACCESS_SECRET: crypto.randomBytes(32).toString('hex'),
    JWT_REFRESH_SECRET: crypto.randomBytes(32).toString('hex'),
    CONNECTLY_ENCRYPTION_KEY_V1: crypto.randomBytes(32).toString('hex'),
    LIVEKIT_URL: 'wss://connectly.livekit.cloud',
    LIVEKIT_API_KEY: 'APIKeyLiveKit123456',
    LIVEKIT_API_SECRET: 'LiveKitSecretKeyValueLongEnough123456',
  };

  it('1. validates production config with DB_PROVIDER=supabase and STORAGE_PROVIDER=supabase without MongoDB or S3', () => {
    const parsed = envSchema.safeParse(validProdBase);
    assert.strictEqual(
      parsed.success,
      true,
      parsed.success ? '' : JSON.stringify(parsed.error.issues)
    );
  });

  it('2. rejects production DB_PROVIDER=supabase when SUPABASE_URL or keys are missing', () => {
    const parsed = envSchema.safeParse({
      ...validProdBase,
      SUPABASE_URL: '',
      SUPABASE_ANON_KEY: '',
      SUPABASE_SERVICE_ROLE_KEY: '',
    });
    assert.strictEqual(parsed.success, false);
  });

  it('3. resolves STORAGE_PROVIDER=auto to supabase whenever Supabase DB is configured without S3', () => {
    const cfg = resolveFileSharingConfig(
      {
        DB_PROVIDER: 'supabase',
        SUPABASE_URL: 'https://example-project.supabase.co',
        ENABLE_FILE_SHARING: 'true',
        STORAGE_PROVIDER: 'auto',
      },
      true
    );
    assert.strictEqual(cfg.effectiveProvider, 'supabase');
  });

  it('4. includes SUPABASE_URL in CSP connectSrc and imgSrc when Supabase Storage is active', () => {
    const directives = getCspDirectives({
      NODE_ENV: 'production',
      CLIENT_ORIGIN: 'https://connectly.example.com',
      LIVEKIT_URL: 'wss://connectly.livekit.cloud',
      SUPABASE_URL: 'https://example-project.supabase.co',
      STORAGE_PROVIDER: 'supabase',
    });

    assert.ok(directives.connectSrc.includes('https://example-project.supabase.co'));
    assert.ok(directives.imgSrc.includes('https://example-project.supabase.co'));
  });

  it('5. instantiates SupabaseStorageProvider cleanly via storage factory', () => {
    const sbProvider = new SupabaseStorageProvider({ bucket: 'connectly-files' });
    setStorageProvider(sbProvider);
    const active = getStorageProvider();
    assert.strictEqual(active.name, 'supabase');
  });

  it('6. round-trips 24-hex ObjectId strings deterministically with PostgreSQL UUIDs', () => {
    const hex = '67a1b2c3d4e5f60718293a4b';
    const pgUuid = toPgUuid(hex);
    assert.match(pgUuid, /^c0000000-67a1-b2c3-d4e5-f60718293a4b$/);
    const back = fromPgUuid(pgUuid);
    assert.strictEqual(back, hex);
    assert.strictEqual(isHex24(back), true);
  });

  it('7. operational fallback adapter supports insert, loadAll, replace, and remove cleanly', async () => {
    const mem = createMemoryAdapter({ status: 'PENDING' });
    const inserted = await mem.insert({ eventId: 'evt-1' });
    assert.strictEqual(inserted.status, 'PENDING');
    const list1 = await mem.loadAll();
    assert.strictEqual(list1.length, 1);
    await mem.replace({ ...inserted, status: 'DISPATCHED' });
    const list2 = await mem.loadAll();
    assert.strictEqual(list2[0].status, 'DISPATCHED');
    await mem.remove(inserted._id);
    const list3 = await mem.loadAll();
    assert.strictEqual(list3.length, 0);
  });

  it('8. allows production ORIGIN_AUTH_MODE=direct without PROXY_SECRET for Vercel + Render split-origin deploy', () => {
    const { PROXY_SECRET: _omitted, ...withoutProxySecret } = validProdBase;
    const parsed = envSchema.safeParse({
      ...withoutProxySecret,
      ORIGIN_AUTH_MODE: 'direct',
      COOKIE_SAME_SITE: 'auto',
      TRUST_PROXY: '1',
    });
    assert.strictEqual(
      parsed.success,
      true,
      parsed.success ? '' : JSON.stringify(parsed.error.issues)
    );
  });

  it('9. selects SameSite=None with Secure in production direct mode and SameSite=Lax in proxy mode', () => {
    const directCookies = getRefreshCookieOptions('production', {
      originAuthMode: 'direct',
      cookieSameSite: 'auto',
    });
    assert.strictEqual(directCookies.sameSite, 'none');
    assert.strictEqual(directCookies.secure, true);
    assert.strictEqual(directCookies.httpOnly, true);

    const proxyCookies = getRefreshCookieOptions('production', {
      originAuthMode: 'proxy',
      cookieSameSite: 'auto',
    });
    assert.strictEqual(proxyCookies.sameSite, 'lax');
    assert.strictEqual(proxyCookies.secure, true);
  });
});
