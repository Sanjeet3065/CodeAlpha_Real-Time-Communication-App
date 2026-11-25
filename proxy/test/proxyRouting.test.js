import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  routeRequest,
  prepareForwardedHeaders,
  handleProxyRequest,
  isValidOrigin,
  isValidClientIp,
  isValidProxySecret,
} from '../src/worker.js';

describe('Cloudflare Worker Reverse Proxy Routing & Header Suite', () => {
  const env = {
    BACKEND_ORIGIN: 'https://connectly-backend.koyeb.app',
    FRONTEND_ORIGIN: 'https://connectly-frontend.pages.dev',
    PROXY_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  };

  describe('1. Origin Validation & Defensive Configuration Gates', () => {
    it('validates well-formed HTTPS and HTTP origins', () => {
      assert.strictEqual(isValidOrigin('https://connectly-backend.koyeb.app'), true);
      assert.strictEqual(isValidOrigin('http://localhost:5000'), true);
      assert.strictEqual(isValidOrigin('https://sub.domain.com:8443'), true);
    });

    it('rejects invalid or unsafe origins', () => {
      assert.strictEqual(isValidOrigin(''), false);
      assert.strictEqual(isValidOrigin(null), false);
      assert.strictEqual(isValidOrigin(undefined), false);
      assert.strictEqual(isValidOrigin('not-a-url'), false);
      assert.strictEqual(isValidOrigin('ftp://invalid.com'), false);
      assert.strictEqual(isValidOrigin('javascript:alert(1)'), false);
    });

    it('returns HTTP 500 PROXY_CONFIGURATION_ERROR when BACKEND_ORIGIN is malformed', async () => {
      const invalidEnv = {
        BACKEND_ORIGIN: 'invalid-backend-host',
        FRONTEND_ORIGIN: 'https://connectly-frontend.pages.dev',
      };

      const request = new Request('https://connectly-proxy.subdomain.workers.dev/api/v1/health');
      const response = await handleProxyRequest(request, invalidEnv);

      assert.strictEqual(response.status, 500);
      const data = await response.json();
      assert.strictEqual(data.code, 'PROXY_CONFIGURATION_ERROR');
    });

    it('returns HTTP 500 PROXY_CONFIGURATION_ERROR when FRONTEND_ORIGIN is malformed', async () => {
      const invalidEnv = {
        BACKEND_ORIGIN: 'https://connectly-backend.koyeb.app',
        FRONTEND_ORIGIN: 'ftp://bad-scheme',
      };

      const request = new Request('https://connectly-proxy.subdomain.workers.dev/');
      const response = await handleProxyRequest(request, invalidEnv);

      assert.strictEqual(response.status, 500);
      const data = await response.json();
      assert.strictEqual(data.code, 'PROXY_CONFIGURATION_ERROR');
    });
  });

  describe('2. Path Routing Resolution', () => {
    it('routes /api/v1/* to BACKEND_ORIGIN', () => {
      const { targetOrigin, isBackend } = routeRequest('/api/v1/auth/login', env);
      assert.strictEqual(targetOrigin, 'https://connectly-backend.koyeb.app');
      assert.strictEqual(isBackend, true);
    });

    it('routes /socket.io to BACKEND_ORIGIN with isWebSocketCapable=true', () => {
      const { targetOrigin, isBackend, isWebSocketCapable } = routeRequest('/socket.io/', env);
      assert.strictEqual(targetOrigin, 'https://connectly-backend.koyeb.app');
      assert.strictEqual(isBackend, true);
      assert.strictEqual(isWebSocketCapable, true);
    });

    it('routes /livekit-signal to BACKEND_ORIGIN with isWebSocketCapable=true', () => {
      const { targetOrigin, isBackend, isWebSocketCapable } = routeRequest('/livekit-signal/rtc/v1', env);
      assert.strictEqual(targetOrigin, 'https://connectly-backend.koyeb.app');
      assert.strictEqual(isBackend, true);
      assert.strictEqual(isWebSocketCapable, true);
    });

    it('routes static assets (/assets/*) to FRONTEND_ORIGIN', () => {
      const { targetOrigin, isBackend } = routeRequest('/assets/index-B5k.js', env);
      assert.strictEqual(targetOrigin, 'https://connectly-frontend.pages.dev');
      assert.strictEqual(isBackend, false);
    });

    it('routes root / and SPA navigation (/meeting/cly-abc-def) to FRONTEND_ORIGIN', () => {
      const rootRes = routeRequest('/', env);
      assert.strictEqual(rootRes.targetOrigin, 'https://connectly-frontend.pages.dev');
      assert.strictEqual(rootRes.isBackend, false);

      const spaRes = routeRequest('/meeting/cly-abc-def', env);
      assert.strictEqual(spaRes.targetOrigin, 'https://connectly-frontend.pages.dev');
      assert.strictEqual(spaRes.isBackend, false);
    });
  });

  describe('3. Host Header Sanitization & Header Forwarding', () => {
    it('deletes incoming client Host header to ensure upstream receives expected virtual host', () => {
      const incomingHeaders = new Headers({
        host: 'connectly-proxy.subdomain.workers.dev',
        'user-agent': 'Mozilla/5.0 TestBrowser',
        cookie: 'connectly_refresh=test_refresh_token_123',
        'x-csrf-protection': '1',
      });

      const forwarded = prepareForwardedHeaders(incomingHeaders, 'connectly-backend.koyeb.app');

      assert.strictEqual(forwarded.has('host'), false, 'Host header must be deleted from forwarded headers');
      assert.strictEqual(forwarded.get('user-agent'), 'Mozilla/5.0 TestBrowser');
      assert.strictEqual(forwarded.get('cookie'), 'connectly_refresh=test_refresh_token_123');
      assert.strictEqual(forwarded.get('x-csrf-protection'), '1');
    });

    it('preserves Upgrade and Connection headers for WebSocket upgrade requests', () => {
      const wsHeaders = new Headers({
        host: 'connectly-proxy.subdomain.workers.dev',
        upgrade: 'websocket',
        connection: 'Upgrade',
        'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
        'sec-websocket-version': '13',
      });

      const forwarded = prepareForwardedHeaders(wsHeaders, 'connectly-backend.koyeb.app');

      assert.strictEqual(forwarded.has('host'), false);
      assert.strictEqual(forwarded.get('upgrade'), 'websocket');
      assert.strictEqual(forwarded.get('connection'), 'Upgrade');
      assert.strictEqual(forwarded.get('sec-websocket-key'), 'dGhlIHNhbXBsZSBub25jZQ==');
    });

    it('preserves Authorization, CSRF, and custom application headers', () => {
      const appHeaders = new Headers({
        host: 'connectly-proxy.subdomain.workers.dev',
        authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test',
        'x-csrf-token': 'csrf-token-12345',
        'x-request-id': 'req-abc-987',
      });

      const forwarded = prepareForwardedHeaders(appHeaders, 'connectly-backend.koyeb.app');

      assert.strictEqual(forwarded.get('authorization'), 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test');
      assert.strictEqual(forwarded.get('x-csrf-token'), 'csrf-token-12345');
      assert.strictEqual(forwarded.get('x-request-id'), 'req-abc-987');
    });
  });

  describe('4. Request Dispatching, Body Forwarding & Response Handling', () => {
    it('preserves query strings when dispatching to backend', async () => {
      let interceptedUrl = '';
      let interceptedOptions = null;

      const mockFetch = async (url, options) => {
        interceptedUrl = url;
        interceptedOptions = options;
        return new Response(JSON.stringify({ status: 200, ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };

      const request = new Request('https://connectly-proxy.subdomain.workers.dev/api/v1/meetings/validate/cly-xxx-yyy?ref=dashboard&lang=en', {
        method: 'GET',
        headers: {
          host: 'connectly-proxy.subdomain.workers.dev',
          cookie: 'connectly_refresh=abc',
          'cf-connecting-ip': '198.51.100.1',
        },
      });

      const response = await handleProxyRequest(request, env, mockFetch);
      assert.strictEqual(response.status, 200);

      assert.strictEqual(
        interceptedUrl,
        'https://connectly-backend.koyeb.app/api/v1/meetings/validate/cly-xxx-yyy?ref=dashboard&lang=en'
      );
      assert.strictEqual(interceptedOptions.headers.has('host'), false);
      assert.strictEqual(interceptedOptions.headers.get('cookie'), 'connectly_refresh=abc');

      // Verifies backend dynamic routes receive no-store cache headers
      assert.strictEqual(
        response.headers.get('Cache-Control'),
        'no-store, no-cache, must-revalidate, proxy-revalidate'
      );
    });

    it('forwards Socket.IO HTTP long-polling POST requests with payload body intact', async () => {
      let interceptedUrl = '';
      let interceptedOptions = null;

      const mockFetch = async (url, options) => {
        interceptedUrl = url;
        interceptedOptions = options;
        return new Response('ok', {
          status: 200,
          headers: { 'Content-Type': 'text/plain' },
        });
      };

      const pollingPayload = '42["chat:message",{"content":"Hello World"}]';
      const request = new Request('https://connectly-proxy.subdomain.workers.dev/socket.io/?EIO=4&transport=polling&sid=session_abc', {
        method: 'POST',
        headers: {
          host: 'connectly-proxy.subdomain.workers.dev',
          'content-type': 'text/plain;charset=UTF-8',
          'cf-connecting-ip': '198.51.100.1',
        },
        body: pollingPayload,
      });

      const response = await handleProxyRequest(request, env, mockFetch);
      assert.strictEqual(response.status, 200);
      assert.strictEqual(interceptedUrl, 'https://connectly-backend.koyeb.app/socket.io/?EIO=4&transport=polling&sid=session_abc');
      assert.strictEqual(interceptedOptions.method, 'POST');
      assert.ok(interceptedOptions.body, 'Body must be forwarded on POST');
      assert.strictEqual(response.headers.get('Cache-Control'), 'no-store, no-cache, must-revalidate, proxy-revalidate');
    });

    it('returns 101 Switching Protocols directly on WebSocket upgrade response', async () => {
      // In Node.js Fetch standard, Response constructor forbids status < 200.
      // Cloudflare Worker runtime returns real 101 responses from fetch. Here we provide a duck-typed upstream 101 response.
      const mockWsResponse = {
        status: 101,
        statusText: 'Switching Protocols',
        headers: new Headers({
          Upgrade: 'websocket',
          Connection: 'Upgrade',
        }),
      };

      const mockFetch = async () => mockWsResponse;

      const backendEnv = {
        ...env,
        PROXY_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      };

      const request = new Request('https://connectly-proxy.subdomain.workers.dev/socket.io/?EIO=4&transport=websocket', {
        method: 'GET',
        headers: {
          upgrade: 'websocket',
          connection: 'Upgrade',
          host: 'connectly-proxy.subdomain.workers.dev',
          'cf-connecting-ip': '198.51.100.1',
        },
      });

      const response = await handleProxyRequest(request, backendEnv, mockFetch);
      assert.strictEqual(response.status, 101);
      assert.strictEqual(response.headers.get('Upgrade'), 'websocket');
    });

    it('returns 502 with clean JSON error and zero secrets on upstream failure', async () => {
      const mockFailingFetch = async () => {
        throw new Error('Connection refused to https://user:super_secret_credentials@internal-koyeb.app:5000');
      };

      const backendEnv = {
        ...env,
        PROXY_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      };

      const request = new Request('https://connectly-proxy.subdomain.workers.dev/api/v1/auth/refresh', {
        method: 'POST',
        headers: {
          host: 'connectly-proxy.subdomain.workers.dev',
          'cf-connecting-ip': '198.51.100.1',
        },
      });

      const response = await handleProxyRequest(request, backendEnv, mockFailingFetch);
      assert.strictEqual(response.status, 502);

      const body = await response.json();
      assert.strictEqual(body.code, 'UPSTREAM_GATEWAY_ERROR');
      assert.strictEqual(body.path, '/api/v1/auth/refresh');
      assert.ok(!JSON.stringify(body).includes('super_secret_credentials'), 'Must not leak internal credentials');
      assert.ok(!JSON.stringify(body).includes('internal-koyeb.app'), 'Must not leak internal hostname');
    });
  });

  describe('5. Phase 18 Sprint 06R: Worker-to-Backend Origin Authentication & Client IP Integrity (F-06Q-01)', () => {
    it('isValidClientIp validates IPv4 and IPv6 addresses and rejects invalid strings', () => {
      // IPv4
      assert.strictEqual(isValidClientIp('198.51.100.25'), true);
      assert.strictEqual(isValidClientIp('127.0.0.1'), true);
      assert.strictEqual(isValidClientIp('255.255.255.255'), true);
      assert.strictEqual(isValidClientIp('256.0.0.1'), false);
      assert.strictEqual(isValidClientIp('1.2.3'), false);

      // IPv6
      assert.strictEqual(isValidClientIp('2001:db8::1'), true);
      assert.strictEqual(isValidClientIp('::1'), true);
      assert.strictEqual(isValidClientIp('fe80::1ff:fe23:4567:890a'), true);

      // Invalid
      assert.strictEqual(isValidClientIp(''), false);
      assert.strictEqual(isValidClientIp(null), false);
      assert.strictEqual(isValidClientIp(undefined), false);
      assert.strictEqual(isValidClientIp('not-an-ip'), false);
      assert.strictEqual(isValidClientIp('198.51.100.25/24'), false);
    });

    it('strips client-supplied x-proxy-secret and attaches server-to-server secret from env', () => {
      const incoming = new Headers({
        host: 'connectly-proxy.workers.dev',
        'x-proxy-secret': 'client-forged-fake-secret',
      });

      const forwarded = prepareForwardedHeaders(incoming, 'connectly-backend.koyeb.app', {
        PROXY_SECRET: 'authorized-worker-backend-secret-key-32b',
      });

      assert.strictEqual(
        forwarded.get('x-proxy-secret'),
        'authorized-worker-backend-secret-key-32b',
        'Worker must overwrite client-supplied secret with authoritative env.PROXY_SECRET'
      );
    });

    it('strips client-supplied x-verified-client-ip and derives canonical IP from cf-connecting-ip', () => {
      const incoming = new Headers({
        host: 'connectly-proxy.workers.dev',
        'cf-connecting-ip': '203.0.113.195',
        'x-verified-client-ip': '1.2.3.4', // Forged by attacker
      });

      const forwarded = prepareForwardedHeaders(incoming, 'connectly-backend.koyeb.app', {
        PROXY_SECRET: 'test-secret',
      });

      assert.strictEqual(
        forwarded.get('x-verified-client-ip'),
        '203.0.113.195',
        'Must set verified client IP strictly to edge cf-connecting-ip'
      );
    });

    it('overwrites client-supplied x-forwarded-for with canonical edge client IP', () => {
      const incoming = new Headers({
        host: 'connectly-proxy.workers.dev',
        'cf-connecting-ip': '198.51.100.50',
        'x-forwarded-for': '10.0.0.1, 172.16.0.1, 8.8.8.8', // Attacker attempting to inject spoofed chain
      });

      const forwarded = prepareForwardedHeaders(incoming, 'connectly-backend.koyeb.app');

      assert.strictEqual(
        forwarded.get('x-forwarded-for'),
        '198.51.100.50',
        'X-Forwarded-For must be sanitized to contain only the authenticated edge client IP'
      );
    });

    it('handles IPv6 client addresses correctly in forwarding headers', () => {
      const incoming = new Headers({
        host: 'connectly-proxy.workers.dev',
        'cf-connecting-ip': '2001:db8:85a3::8a2e:370:7334',
      });

      const forwarded = prepareForwardedHeaders(incoming, 'connectly-backend.koyeb.app');

      assert.strictEqual(
        forwarded.get('x-verified-client-ip'),
        '2001:db8:85a3::8a2e:370:7334'
      );
      assert.strictEqual(
        forwarded.get('x-forwarded-for'),
        '2001:db8:85a3::8a2e:370:7334'
      );
    });

    it('handleProxyRequest attaches origin authentication and verified client IP to backend requests', async () => {
      let forwardedHeaders = null;
      const mockFetch = async (url, options) => {
        forwardedHeaders = options.headers;
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };

      const request = new Request('https://connectly-proxy.workers.dev/api/v1/meetings', {
        method: 'GET',
        headers: {
          host: 'connectly-proxy.workers.dev',
          'cf-connecting-ip': '192.0.2.99',
          'x-proxy-secret': 'client-spoof-attempt',
          'x-verified-client-ip': '1.1.1.1',
        },
      });

      const proxyEnv = {
        BACKEND_ORIGIN: 'https://connectly-backend.koyeb.app',
        FRONTEND_ORIGIN: 'https://connectly-frontend.pages.dev',
        PROXY_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      };

      const response = await handleProxyRequest(request, proxyEnv, mockFetch);
      assert.strictEqual(response.status, 200);

      assert.strictEqual(
        forwardedHeaders.get('x-proxy-secret'),
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
      );
      assert.strictEqual(
        forwardedHeaders.get('x-verified-client-ip'),
        '192.0.2.99'
      );
      assert.strictEqual(
        forwardedHeaders.get('x-forwarded-for'),
        '192.0.2.99'
      );
    });
  });

  describe('6. Phase 18 Sprint 06T: Worker Origin Authentication Fail-Closed & Client IP Hardening (F-06S-03, F-06S-04)', () => {
    const validSecret = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const validBackendEnv = {
      BACKEND_ORIGIN: 'https://connectly-backend.koyeb.app',
      FRONTEND_ORIGIN: 'https://connectly-frontend.pages.dev',
      PROXY_SECRET: validSecret,
    };

    it('isValidProxySecret enforces 64-hex format and rejects placeholders', () => {
      assert.strictEqual(isValidProxySecret(validSecret), true);
      assert.strictEqual(isValidProxySecret(null), false);
      assert.strictEqual(isValidProxySecret(''), false);
      assert.strictEqual(isValidProxySecret('weak_secret_1234'), false);
      assert.strictEqual(isValidProxySecret('REPLACE_WITH_HIGH_ENTROPY_64_HEX_SECRET_DO_NOT_COMMIT'), false);
      assert.strictEqual(isValidProxySecret('changeme'.padEnd(64, '0')), false);
      assert.strictEqual(isValidProxySecret('dummy'.padEnd(64, '0')), false);
      assert.strictEqual(isValidProxySecret('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcde'), false); // 63 chars
      assert.strictEqual(isValidProxySecret('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef00'), false); // 66 chars
      assert.strictEqual(isValidProxySecret('g'.repeat(64)), false); // non-hex
    });

    it('handleProxyRequest returns HTTP 500 PROXY_CONFIGURATION_ERROR when PROXY_SECRET is missing on backend request', async () => {
      const request = new Request('https://connectly-proxy.workers.dev/api/v1/auth/me', {
        headers: { 'cf-connecting-ip': '198.51.100.1' },
      });
      const response = await handleProxyRequest(request, {
        BACKEND_ORIGIN: 'https://connectly-backend.koyeb.app',
        FRONTEND_ORIGIN: 'https://connectly-frontend.pages.dev',
      });
      assert.strictEqual(response.status, 500);
      const data = await response.json();
      assert.strictEqual(data.code, 'PROXY_CONFIGURATION_ERROR');
    });

    it('handleProxyRequest returns HTTP 500 PROXY_CONFIGURATION_ERROR when PROXY_SECRET is placeholder or weak', async () => {
      const request = new Request('https://connectly-proxy.workers.dev/api/v1/auth/me', {
        headers: { 'cf-connecting-ip': '198.51.100.1' },
      });
      const response = await handleProxyRequest(request, {
        BACKEND_ORIGIN: 'https://connectly-backend.koyeb.app',
        FRONTEND_ORIGIN: 'https://connectly-frontend.pages.dev',
        PROXY_SECRET: 'REPLACE_WITH_HIGH_ENTROPY_64_HEX_SECRET_DO_NOT_COMMIT',
      });
      assert.strictEqual(response.status, 500);
      const data = await response.json();
      assert.strictEqual(data.code, 'PROXY_CONFIGURATION_ERROR');
    });

    it('handleProxyRequest returns HTTP 400 INVALID_CLIENT_IP when CF-Connecting-IP is missing on backend request', async () => {
      const request = new Request('https://connectly-proxy.workers.dev/api/v1/meetings', {
        headers: { host: 'connectly-proxy.workers.dev' },
      });
      const response = await handleProxyRequest(request, validBackendEnv);
      assert.strictEqual(response.status, 400);
      const data = await response.json();
      assert.strictEqual(data.code, 'INVALID_CLIENT_IP');
    });

    it('handleProxyRequest returns HTTP 400 INVALID_CLIENT_IP when CF-Connecting-IP is invalid on backend request', async () => {
      const request = new Request('https://connectly-proxy.workers.dev/api/v1/meetings', {
        headers: {
          host: 'connectly-proxy.workers.dev',
          'cf-connecting-ip': 'not-a-valid-ip',
        },
      });
      const response = await handleProxyRequest(request, validBackendEnv);
      assert.strictEqual(response.status, 400);
      const data = await response.json();
      assert.strictEqual(data.code, 'INVALID_CLIENT_IP');
    });

    it('prepareForwardedHeaders never falls back to X-Real-IP and strips X-Forwarded-For unconditionally', () => {
      const incoming = new Headers({
        'x-real-ip': '203.0.113.88',
        'x-forwarded-for': '192.0.2.1, 10.0.0.1',
      });
      const forwarded = prepareForwardedHeaders(incoming, 'backend.koyeb.app', { PROXY_SECRET: validSecret });
      assert.strictEqual(forwarded.get('x-real-ip'), null, 'X-Real-IP must be deleted');
      assert.strictEqual(forwarded.get('x-forwarded-for'), null, 'X-Forwarded-For must be deleted when CF-Connecting-IP is absent');
      assert.strictEqual(forwarded.get('x-verified-client-ip'), null, 'Verified IP must not be set from X-Real-IP');
    });

    it('static frontend routes (Pages) do not require PROXY_SECRET or CF-Connecting-IP', async () => {
      const mockFetch = async () => new Response('<html>SPA</html>', { status: 200 });
      const request = new Request('https://connectly-proxy.workers.dev/meeting/cly-abc-def');
      const response = await handleProxyRequest(
        request,
        {
          BACKEND_ORIGIN: 'https://connectly-backend.koyeb.app',
          FRONTEND_ORIGIN: 'https://connectly-frontend.pages.dev',
        },
        mockFetch
      );
      assert.strictEqual(response.status, 200);
      const text = await response.text();
      assert.strictEqual(text, '<html>SPA</html>');
    });
  });
});
