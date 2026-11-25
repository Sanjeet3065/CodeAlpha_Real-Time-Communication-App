import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { resolveTrustProxy, validateProxySecret } from '../config/proxy.js';
import { envSchema } from '../config/env.js';
import { createApp } from '../app.js';
import { createOriginAuthMiddleware, isHealthRoute } from '../middlewares/originAuth.js';

describe('Phase 18 Sprint 06P: Express Reverse Proxy Trust & Rate Limiting Security (F-06O-03)', () => {
  // =========================================================================
  // 1. UNIT TESTS: resolveTrustProxy parser
  // =========================================================================
  describe('1. resolveTrustProxy Parser & Safety Rules', () => {
    it('defaults to "loopback" when undefined or empty', () => {
      assert.strictEqual(resolveTrustProxy(undefined), 'loopback');
      assert.strictEqual(resolveTrustProxy(''), 'loopback');
    });

    it('returns false for "false", "none", or "0"', () => {
      assert.strictEqual(resolveTrustProxy('false'), false);
      assert.strictEqual(resolveTrustProxy('FALSE'), false);
      assert.strictEqual(resolveTrustProxy('none'), false);
      assert.strictEqual(resolveTrustProxy('0'), false);
    });

    it('parses valid numeric hop counts into numbers', () => {
      assert.strictEqual(resolveTrustProxy('1'), 1);
      assert.strictEqual(resolveTrustProxy('2'), 2);
      assert.strictEqual(resolveTrustProxy('5'), 5);
    });

    it('preserves named presets and CIDR lists as strings', () => {
      assert.strictEqual(resolveTrustProxy('loopback'), 'loopback');
      assert.strictEqual(resolveTrustProxy('uniquelocal'), 'uniquelocal');
      assert.strictEqual(resolveTrustProxy('loopback, uniquelocal'), 'loopback, uniquelocal');
      assert.strictEqual(resolveTrustProxy('10.0.0.0/8, 172.16.0.0/12'), '10.0.0.0/8, 172.16.0.0/12');
    });

    it('strictly throws on "true" to prevent arbitrary IP spoofing', () => {
      assert.throws(
        () => resolveTrustProxy('true'),
        /CRITICAL SECURITY ERROR: Setting (?:trust proxy|TRUST_PROXY) to "true" is strictly prohibited/
      );
      assert.throws(
        () => resolveTrustProxy('TRUE'),
        /CRITICAL SECURITY ERROR: Setting (?:trust proxy|TRUST_PROXY) to "true" is strictly prohibited/
      );
    });

    it('rejects arbitrary strings, negative numbers, oversized hop counts, and malformed CIDRs (F-06Q-02)', () => {
      // Arbitrary strings
      assert.throws(() => resolveTrustProxy('random_text'), /CRITICAL SECURITY ERROR: Invalid TRUST_PROXY/);
      assert.throws(() => resolveTrustProxy('production'), /CRITICAL SECURITY ERROR: Invalid TRUST_PROXY/);
      assert.throws(() => resolveTrustProxy('foo/bar'), /CRITICAL SECURITY ERROR: Malformed IP/);

      // Negative numbers & oversized hop counts
      assert.throws(() => resolveTrustProxy('-1'), /Negative hop counts are not permitted/);
      assert.throws(() => resolveTrustProxy('-5'), /Negative hop counts are not permitted/);
      assert.throws(() => resolveTrustProxy('11'), /Maximum supported hop count is 10/);
      assert.throws(() => resolveTrustProxy('999'), /Maximum supported hop count is 10/);

      // Malformed CIDRs
      assert.throws(() => resolveTrustProxy('10.0.0.1/99'), /Invalid IPv4 CIDR prefix "\/99"/);
      assert.throws(() => resolveTrustProxy('999.999.999.999/24'), /Malformed IP "999.999.999.999"/);
      assert.throws(() => resolveTrustProxy('10.0.0.0/abc'), /Prefix must be an integer/);
      assert.throws(() => resolveTrustProxy('10.0.0.0/8,,'), /Empty entries or trailing commas are prohibited/);
    });

    it('accepts valid IP addresses and well-formed CIDR subnets (IPv4 and IPv6)', () => {
      assert.strictEqual(resolveTrustProxy('127.0.0.1'), '127.0.0.1');
      assert.strictEqual(resolveTrustProxy('::1'), '::1');
      assert.strictEqual(resolveTrustProxy('10.0.0.0/8'), '10.0.0.0/8');
      assert.strictEqual(resolveTrustProxy('172.16.0.0/12, 192.168.0.0/16'), '172.16.0.0/12, 192.168.0.0/16');
      assert.strictEqual(resolveTrustProxy('fc00::/7'), 'fc00::/7');
      assert.strictEqual(resolveTrustProxy(' 1 '), 1);
      assert.strictEqual(resolveTrustProxy(' Uniquelocal '), 'uniquelocal');
    });
  });

  // =========================================================================
  // 2. SCHEMA VALIDATION: envSchema TRUST_PROXY rule
  // =========================================================================
  describe('2. Environment Schema TRUST_PROXY Defense', () => {
    it('rejects TRUST_PROXY="true" in environment validation', () => {
      const res = envSchema.safeParse({ TRUST_PROXY: 'true' });
      assert.strictEqual(res.success, false);
      if (!res.success) {
        const trustProxyIssue = res.error.issues.find((i) => i.path.includes('TRUST_PROXY'));
        assert.ok(trustProxyIssue, 'Must flag TRUST_PROXY issue');
        assert.ok(
          trustProxyIssue.message.includes('Setting TRUST_PROXY to "true" is strictly prohibited'),
          'Must reject with informative anti-spoofing warning'
        );
      }
    });

    it('accepts valid TRUST_PROXY values ("1", "2", "loopback", "uniquelocal", "false")', () => {
      const validCases = ['1', '2', 'loopback', 'uniquelocal', 'false', '0', 'none', '10.0.0.0/8', '127.0.0.1'];
      for (const val of validCases) {
        const res = envSchema.safeParse({ TRUST_PROXY: val });
        assert.strictEqual(res.success, true, `Must accept TRUST_PROXY="${val}"`);
      }
    });

    it('rejects invalid TRUST_PROXY inputs in envSchema validation (F-06Q-02)', () => {
      const invalidCases = ['random_text', 'production', '-1', '15', '10.0.0.1/99', '999.999.999.999', '10.0.0.0/8,,'];
      for (const val of invalidCases) {
        const res = envSchema.safeParse({ TRUST_PROXY: val });
        assert.strictEqual(res.success, false, `envSchema must reject invalid TRUST_PROXY="${val}"`);
      }
    });
  });

  // =========================================================================
  // 3. EXPRESS REQUEST IP EXTRACTION & SPOOFING DEFENSE
  // =========================================================================
  describe('3. Express IP Extraction Across Proxy Topologies', () => {
    it('Single Hop (trust proxy: 1): Trusts immediate ingress and ignores client-supplied spoofed IPs', () => {
      const app = express();
      app.set('trust proxy', resolveTrustProxy('1'));

      // Attacker sends: X-Forwarded-For: 203.0.113.199 (spoofed)
      // PaaS Ingress appends real client IP: 198.51.100.50
      // Socket connects from PaaS internal router: 10.0.0.1
      const req = {
        headers: { 'x-forwarded-for': '203.0.113.199, 198.51.100.50' },
        connection: { remoteAddress: '10.0.0.1' },
      };
      Object.setPrototypeOf(req, app.request);

      assert.strictEqual(req.ip, '198.51.100.50', 'Must resolve to real client IP, ignoring leftmost spoofed IP');
    });

    it('Two Hops (trust proxy: 2): Trusts Cloudflare Worker + Ingress and ignores spoofed IPs', () => {
      const app = express();
      app.set('trust proxy', resolveTrustProxy('2'));

      // Attacker sends: X-Forwarded-For: 203.0.113.199 (spoofed)
      // Cloudflare Worker appends real client IP: 198.51.100.50
      // PaaS Ingress appends Cloudflare egress IP: 172.70.1.1
      // Socket connects from internal container router: 10.0.0.1
      const req = {
        headers: { 'x-forwarded-for': '203.0.113.199, 198.51.100.50, 172.70.1.1' },
        connection: { remoteAddress: '10.0.0.1' },
      };
      Object.setPrototypeOf(req, app.request);

      assert.strictEqual(req.ip, '198.51.100.50', 'Must peel 2 hops and resolve to real client IP');
    });

    it('No Trust (trust proxy: false): Completely ignores X-Forwarded-For and uses socket remote address', () => {
      const app = express();
      app.set('trust proxy', resolveTrustProxy('false'));

      const req = {
        headers: { 'x-forwarded-for': '203.0.113.199, 198.51.100.50' },
        connection: { remoteAddress: '192.0.2.1' },
      };
      Object.setPrototypeOf(req, app.request);

      assert.strictEqual(req.ip, '192.0.2.1', 'Must strictly use socket IP when trust proxy is disabled');
    });

    it('Private Subnet Preset ("uniquelocal"): Trusts private subnets and extracts first public IP', () => {
      const app = express();
      app.set('trust proxy', resolveTrustProxy('loopback, uniquelocal'));

      const req = {
        headers: { 'x-forwarded-for': '8.8.8.8, 198.51.100.22, 10.244.0.5' },
        connection: { remoteAddress: '10.0.0.1' },
      };
      Object.setPrototypeOf(req, app.request);

      assert.strictEqual(req.ip, '198.51.100.22', 'Must trust private IPs and stop at public client IP');
    });
  });

  // =========================================================================
  // 4. RATE LIMITER INTEGRATION TEST OVER HTTP
  // =========================================================================
  describe('4. Rate Limiter IP Attribution Under Reverse Proxy', () => {
    it('aggregates requests by true client IP and prevents rate-limit bypass via spoofed headers', async () => {
      const testApp = express();
      testApp.set('trust proxy', resolveTrustProxy('1'));

      const limiter = rateLimit({
        windowMs: 60 * 1000,
        max: 2,
        standardHeaders: true,
        legacyHeaders: false,
      });

      testApp.use('/rate-test', limiter, (_req, res) => {
        res.status(200).json({ ok: true });
      });

      const server = http.createServer(testApp);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      const port = (server.address() as any).port;
      const url = `http://127.0.0.1:${port}/rate-test`;

      try {
        // Request 1: Client 198.51.100.1 attempts spoofing with header "1.1.1.1"
        const res1 = await fetch(url, {
          headers: { 'X-Forwarded-For': '1.1.1.1, 198.51.100.1' },
        });
        assert.strictEqual(res1.status, 200);

        // Request 2: Same real client attempts spoofing with header "2.2.2.2"
        const res2 = await fetch(url, {
          headers: { 'X-Forwarded-For': '2.2.2.2, 198.51.100.1' },
        });
        assert.strictEqual(res2.status, 200);

        // Request 3: Same real client attempts spoofing with header "3.3.3.3" -> Must be rate-limited (HTTP 429)!
        const res3 = await fetch(url, {
          headers: { 'X-Forwarded-For': '3.3.3.3, 198.51.100.1' },
        });
        assert.strictEqual(res3.status, 429, 'Spoofed header MUST NOT bypass rate limit bucket for true client IP');

        // Request 4: Different real client (198.51.100.2) must succeed (separate bucket)
        const res4 = await fetch(url, {
          headers: { 'X-Forwarded-For': '1.1.1.1, 198.51.100.2' },
        });
        assert.strictEqual(res4.status, 200, 'Different client IP must have independent rate limit bucket');
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  });

  // =========================================================================
  // 5. ORIGIN AUTHENTICATION & CLIENT IP INTEGRITY (SPRINT 06R / F-06Q-01)
  // =========================================================================
  describe('5. Origin Authentication & Client IP Integrity (F-06Q-01)', () => {
    const TEST_SECRET = 'a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0';

    it('rejects direct requests when PROXY_SECRET is set but X-Proxy-Secret header is missing', async () => {
      const app = express();
      app.use(createOriginAuthMiddleware({ proxySecretOverride: TEST_SECRET }));
      app.get('/api/test', (_req, res) => res.json({ ok: true }));

      const server = http.createServer(app);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      const port = (server.address() as any).port;

      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/test`);
        assert.strictEqual(res.status, 403);
        const body = (await res.json()) as any;
        assert.strictEqual(body.code, 'ORIGIN_AUTHENTICATION_REQUIRED');
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    it('rejects requests with invalid X-Proxy-Secret header (timing-safe check)', async () => {
      const app = express();
      app.use(createOriginAuthMiddleware({ proxySecretOverride: TEST_SECRET }));
      app.get('/api/test', (_req, res) => res.json({ ok: true }));

      const server = http.createServer(app);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      const port = (server.address() as any).port;

      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/test`, {
          headers: { 'X-Proxy-Secret': 'wrong-secret-value-1234567890' },
        });
        assert.strictEqual(res.status, 403);
        const body = (await res.json()) as any;
        assert.strictEqual(body.code, 'ORIGIN_AUTHENTICATION_FAILED');
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    it('allows health check routes with and without trailing slashes (F-06S-05)', async () => {
      const app = express();
      app.use(createOriginAuthMiddleware({ proxySecretOverride: TEST_SECRET }));
      app.get(['/health', '/health/'], (_req, res) => res.json({ status: 'ok' }));
      app.get(['/api/v1/health', '/api/v1/health/'], (_req, res) => res.json({ status: 'ok' }));

      const server = http.createServer(app);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      const port = (server.address() as any).port;

      try {
        const res1 = await fetch(`http://127.0.0.1:${port}/health`);
        assert.strictEqual(res1.status, 200);

        const res1Slash = await fetch(`http://127.0.0.1:${port}/health/`);
        assert.strictEqual(res1Slash.status, 200, 'Trailing slash /health/ must be exempt');

        const res2 = await fetch(`http://127.0.0.1:${port}/api/v1/health`);
        assert.strictEqual(res2.status, 200);

        const res2Slash = await fetch(`http://127.0.0.1:${port}/api/v1/health/`);
        assert.strictEqual(res2Slash.status, 200, 'Trailing slash /api/v1/health/ must be exempt');
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    it('attributes verified client IP to req.ip when X-Proxy-Secret and X-Verified-Client-IP are valid', async () => {
      const app = express();
      app.use(createOriginAuthMiddleware({ proxySecretOverride: TEST_SECRET }));
      let observedIp = '';
      app.get('/api/whoami', (req, res) => {
        observedIp = req.ip || '';
        res.json({ ip: req.ip });
      });

      const server = http.createServer(app);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      const port = (server.address() as any).port;

      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/whoami`, {
          headers: {
            'X-Proxy-Secret': TEST_SECRET,
            'X-Verified-Client-IP': '198.51.100.77',
          },
        });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(observedIp, '198.51.100.77', 'req.ip must be overridden with verified client IP');
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    it('ignores malformed X-Verified-Client-IP and does not override req.ip', async () => {
      const app = express();
      app.use(createOriginAuthMiddleware({ proxySecretOverride: TEST_SECRET }));
      let observedIp = '';
      app.get('/api/whoami', (req, res) => {
        observedIp = req.ip || '';
        res.json({ ip: req.ip });
      });

      const server = http.createServer(app);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      const port = (server.address() as any).port;

      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/whoami`, {
          headers: {
            'X-Proxy-Secret': TEST_SECRET,
            'X-Verified-Client-IP': 'not-a-valid-ip-address',
          },
        });
        assert.strictEqual(res.status, 200);
        assert.notStrictEqual(observedIp, 'not-a-valid-ip-address');
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    it('enforces rate limits based on verified client IP under proxy authentication', async () => {
      const app = express();
      app.use(createOriginAuthMiddleware({ proxySecretOverride: TEST_SECRET }));

      const limiter = rateLimit({
        windowMs: 60 * 1000,
        max: 2,
        standardHeaders: true,
        legacyHeaders: false,
      });

      app.use('/api/limited', limiter, (_req, res) => res.json({ ok: true }));

      const server = http.createServer(app);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      const port = (server.address() as any).port;
      const url = `http://127.0.0.1:${port}/api/limited`;

      try {
        // Client A makes 2 requests
        const r1 = await fetch(url, {
          headers: { 'X-Proxy-Secret': TEST_SECRET, 'X-Verified-Client-IP': '203.0.113.10' },
        });
        assert.strictEqual(r1.status, 200);

        const r2 = await fetch(url, {
          headers: { 'X-Proxy-Secret': TEST_SECRET, 'X-Verified-Client-IP': '203.0.113.10' },
        });
        assert.strictEqual(r2.status, 200);

        // Client A 3rd request -> 429
        const r3 = await fetch(url, {
          headers: { 'X-Proxy-Secret': TEST_SECRET, 'X-Verified-Client-IP': '203.0.113.10' },
        });
        assert.strictEqual(r3.status, 429, 'Client A must be rate-limited on 3rd request');

        // Client B with distinct verified IP must succeed
        const rB = await fetch(url, {
          headers: { 'X-Proxy-Secret': TEST_SECRET, 'X-Verified-Client-IP': '203.0.113.20' },
        });
        assert.strictEqual(rB.status, 200, 'Client B must have independent rate limit bucket');
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    it('allows passthrough when PROXY_SECRET is not configured (local dev mode)', async () => {
      const app = express();
      // No secret provided in development
      app.use(createOriginAuthMiddleware({ proxySecretOverride: '' }));
      app.get('/api/test', (_req, res) => res.json({ ok: true }));

      const server = http.createServer(app);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      const port = (server.address() as any).port;

      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/test`);
        assert.strictEqual(res.status, 200);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  });

  // =========================================================================
  // 6. PRODUCTION STRICT SECRET VALIDATION & ORIGIN INTEGRITY (SPRINT 06T)
  // =========================================================================
  describe('6. Production Strict Secret Validation & Origin Integrity (Sprint 06T)', () => {
    const valid64Hex = 'a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0';
    const prodEnvBase = {
      NODE_ENV: 'production',
      PORT: '5000',
      CLIENT_ORIGIN: 'https://connectly.example.com',
      JWT_ACCESS_SECRET: 'prod_synthetic_access_secret_9876543210_abcdef',
      JWT_REFRESH_SECRET: 'prod_synthetic_refresh_secret_9876543210_abcdef',
      CONNECTLY_ENCRYPTION_KEY_V1: '9f8e7d6c5b4a392817161514131211100f0e0d0c0b0a090807060504030201f0',
      LIVEKIT_URL: 'wss://example.livekit.cloud',
      LIVEKIT_API_KEY: 'valid_api_key_12345',
      LIVEKIT_API_SECRET: 'c'.repeat(32),
      REQUIRE_TRANSACTIONS: 'true',
      ENABLE_FILE_SHARING: 'false',
      STORAGE_PROVIDER: 'disabled',
      TRUST_PROXY: '1',
      REDIS_URL: 'rediss://default:upstash_password_12345@example.upstash.io:6379',
      SOCKET_IO_ADAPTER: 'redis',
    };

    it('validateProxySecret strictly rejects missing, weak, placeholder, and non-64-hex secrets', () => {
      // Missing / empty in production
      assert.strictEqual(validateProxySecret(undefined, true).valid, false);
      assert.strictEqual(validateProxySecret('', true).valid, false);
      assert.strictEqual(validateProxySecret('   ', true).valid, false);

      // Weak length (<64)
      assert.strictEqual(validateProxySecret('weak_secret_1234', true).valid, false);
      assert.strictEqual(validateProxySecret('1234567890123456', true).valid, false);
      assert.strictEqual(validateProxySecret('a'.repeat(63), true).valid, false);
      assert.strictEqual(validateProxySecret('a'.repeat(65), true).valid, false);

      // Known placeholder patterns
      assert.strictEqual(validateProxySecret('REPLACE_WITH_HIGH_ENTROPY_64_HEX_SECRET_DO_NOT_COMMIT', true).valid, false);
      assert.strictEqual(validateProxySecret('your_proxy_secret'.padEnd(64, '0'), true).valid, false);
      assert.strictEqual(validateProxySecret('changeme'.padEnd(64, '0'), true).valid, false);
      assert.strictEqual(validateProxySecret('dummy'.padEnd(64, '0'), true).valid, false);

      // Non-hexadecimal characters
      assert.strictEqual(validateProxySecret('z'.repeat(64), true).valid, false);
    });

    it('validateProxySecret accepts valid 64-character hexadecimal secrets', () => {
      assert.strictEqual(validateProxySecret(valid64Hex, true).valid, true);
      assert.strictEqual(validateProxySecret(valid64Hex.toUpperCase(), true).valid, true);
      assert.strictEqual(validateProxySecret(undefined, false).valid, true, 'Optional in development');
    });

    it('envSchema in production mode strictly rejects missing PROXY_SECRET (F-06S-01)', () => {
      const res = envSchema.safeParse({
        ...prodEnvBase,
        PROXY_SECRET: undefined,
      });
      assert.strictEqual(res.success, false);
      if (!res.success) {
        const issue = res.error.issues.find((i) => i.path.includes('PROXY_SECRET'));
        assert.ok(issue, 'Must report PROXY_SECRET issue');
        assert.ok(issue.message.includes('PROXY_SECRET is mandatory in production mode'));
      }
    });

    it('envSchema in production mode rejects placeholders and weak secrets (F-06S-02)', () => {
      const rejectedCases = [
        'REPLACE_WITH_HIGH_ENTROPY_64_HEX_SECRET_DO_NOT_COMMIT',
        'weak_secret_1234',
        'changeme'.padEnd(64, 'a'),
        'dummy'.padEnd(64, 'b'),
        '1234567890abcdef'.repeat(3), // 48 chars
        'g'.repeat(64),
      ];

      for (const val of rejectedCases) {
        const res = envSchema.safeParse({
          ...prodEnvBase,
          PROXY_SECRET: val,
        });
        assert.strictEqual(res.success, false, `envSchema must reject PROXY_SECRET="${val}"`);
      }
    });

    it('envSchema in production mode accepts valid 64-hex PROXY_SECRET', () => {
      const res = envSchema.safeParse({
        ...prodEnvBase,
        PROXY_SECRET: valid64Hex,
      });
      assert.strictEqual(res.success, true, 'Must accept valid 64-hex PROXY_SECRET');
    });

    it('isHealthRoute accurately classifies supported health endpoints with and without trailing slash', () => {
      assert.strictEqual(isHealthRoute('/health'), true);
      assert.strictEqual(isHealthRoute('/health/'), true);
      assert.strictEqual(isHealthRoute('/health/ready'), true);
      assert.strictEqual(isHealthRoute('/health/ready/'), true);
      assert.strictEqual(isHealthRoute('/api/v1/health'), true);
      assert.strictEqual(isHealthRoute('/api/v1/health/'), true);
      assert.strictEqual(isHealthRoute('/api/v1/health/live'), true);

      // Negative cases: protected routes must NEVER match
      assert.strictEqual(isHealthRoute('/api/v1/auth/login'), false);
      assert.strictEqual(isHealthRoute('/api/v1/meetings'), false);
      assert.strictEqual(isHealthRoute('/health/admin'), false);
      assert.strictEqual(isHealthRoute('/api/v1/health/admin'), false);
      assert.strictEqual(isHealthRoute('/'), false);
    });

    it('createApp unconditionally mounts origin authentication without silent bypass (F-06S-01)', () => {
      const app = createApp({ proxySecretOverride: valid64Hex });
      // Verify middleware is present in express stack
      const hasOriginAuth = app._router.stack.some(
        (layer: any) => layer.name === 'originAuthMiddleware'
      );
      assert.strictEqual(hasOriginAuth, true, 'createOriginAuthMiddleware must be unconditionally mounted');
    });
  });
});
