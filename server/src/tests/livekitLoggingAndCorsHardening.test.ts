import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { requestIdMiddleware } from '../middlewares/requestId.js';
import { requestLogger } from '../middlewares/requestLogger.js';
import { notFoundHandler } from '../middlewares/notFound.js';
import { errorHandler } from '../middlewares/errorHandler.js';
import {
  LiveKitSignalGateway,
  LIVEKIT_SIGNAL_GATEWAY_PATH,
  resolveSignalGatewayAllowedOrigins,
} from '../realtime/livekitSignalGateway.js';
import { LiveKitService } from '../services/livekit.service.js';
import { LiveKitRevocationCoordinator } from '../realtime/livekitRevocationCoordinator.js';
import { envSchema } from '../config/env.js';

// Clearly synthetic dummy JWTs (RFC-style test payloads, NOT real secrets)
const DUMMY_JWT_A =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c3JfZHVtbXlfdGVzdF8xIiwidmlkZW8iOnsicm9vbUpvaW4iOnRydWV9fQ.dummySigAlpha123456';
const DUMMY_JWT_B =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c3JfZHVtbXlfdGVzdF8yIn0.dummySigBeta789012';
const DUMMY_JOIN_REQ = 'dummy_join_request_secret_payload_987654';

function buildValidProdEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    NODE_ENV: 'production',
    PORT: '5000',
    MONGODB_URI: 'mongodb://127.0.0.1:27017/connectly_prod_test',
    JWT_ACCESS_SECRET: 'prod_access_secret_9876543210_abcdefghijklmnopqrstuvwxyz',
    JWT_REFRESH_SECRET: 'prod_refresh_secret_9876543210_abcdefghijklmnopqrstuvwxyz',
    CONNECTLY_ENCRYPTION_KEY_V1: '9f8e7d6c5b4a392817161514131211100f0e0d0c0b0a090807060504030201f0',
    PROXY_SECRET: '9f8e7d6c5b4a392817161514131211100f0e0d0c0b0a090807060504030201f0',
    CLIENT_ORIGIN: 'https://app.connectly.example',
    LIVEKIT_URL: 'wss://connectly.livekit.cloud',
    LIVEKIT_API_KEY: 'APIprodkey1234567890',
    LIVEKIT_API_SECRET: 'prodLiveKitSecretKey_9876543210_secure',
    LIVEKIT_SIGNAL_GATEWAY_ENABLED: 'auto',
    SOCKET_IO_ADAPTER: 'redis',
    SOCKET_IO_MULTI_INSTANCE: 'true',
    REDIS_URL: 'rediss://redis.prod.internal:6379',
    ...overrides,
  };
}

function captureConsoleLogs(): {
  logs: { error: string[]; warn: string[]; log: string[] };
  restore: () => void;
} {
  const logs = { error: [] as string[], warn: [] as string[], log: [] as string[] };
  const origError = console.error;
  const origWarn = console.warn;
  const origLog = console.log;

  console.error = (...args: unknown[]) => {
    logs.error.push(args.map((a) => String(a)).join(' '));
  };
  console.warn = (...args: unknown[]) => {
    logs.warn.push(args.map((a) => String(a)).join(' '));
  };
  console.log = (...args: unknown[]) => {
    logs.log.push(args.map((a) => String(a)).join(' '));
  };

  return {
    logs,
    restore: () => {
      console.error = origError;
      console.warn = origWarn;
      console.log = origLog;
    },
  };
}

describe('Phase 09 — Error/404 JWT Redaction & Signaling Gateway CORS Hardening', () => {
  let server: http.Server;
  let baseUrl = '';
  let gateway: LiveKitSignalGateway;
  let coordinator: LiveKitRevocationCoordinator;

  before(async () => {
    const app = express();
    app.use(requestIdMiddleware);
    app.use(requestLogger);

    // Deterministic throwing route to test real Express errorHandler logging
    app.get('/test-error', (_req, _res, next) => {
      next(new Error('Simulated signaling route failure'));
    });

    const mockLiveKit = new LiveKitService({
      nodeEnv: 'production',
      config: {
        url: 'ws://127.0.0.1:7880',
        publicUrl: 'wss://api.connectly.example/livekit-signal',
        signalGatewayEnabled: 'true',
        apiKey: 'APIprodkey1234567890',
        apiSecret: 'prodLiveKitSecretKey_9876543210_secure',
        tokenTtlSeconds: 600,
      },
    });
    coordinator = new LiveKitRevocationCoordinator({
      enableChangeStream: false,
      pollIntervalMs: 60_000,
      requireTransactions: false,
    });
    gateway = new LiveKitSignalGateway(mockLiveKit, {}, coordinator, {
      activeSocketRevalidationIntervalMs: 0,
      clientOrigin: 'https://app.connectly.example',
      nodeEnv: 'production',
    });

    app.use(LIVEKIT_SIGNAL_GATEWAY_PATH, gateway.createRouter());
    app.use(notFoundHandler);
    app.use(errorHandler);

    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address();
    if (!addr || typeof addr === 'string') {
      throw new Error('Unable to resolve test server address');
    }
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    gateway.close();
    await coordinator.stop();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('1. Redacts access_token from errorHandler and requestLogger logs while preserving non-sensitive diagnostics', async () => {
    const capture = captureConsoleLogs();
    try {
      const res = await fetch(
        `${baseUrl}/test-error?access_token=${encodeURIComponent(DUMMY_JWT_A)}&protocol=15&sdk=js`
      );
      assert.strictEqual(res.status, 500);
      const body = (await res.json()) as { status: number; code: string; message: string };
      assert.strictEqual(body.status, 500);
      assert.ok(!JSON.stringify(body).includes(DUMMY_JWT_A));

      const allErrors = capture.logs.error.join('\n');
      assert.ok(allErrors.includes('Simulated signaling route failure'));
      assert.ok(!allErrors.includes(DUMMY_JWT_A), 'errorHandler log must NEVER contain raw access_token JWT');
      assert.ok(
        allErrors.includes('/test-error?access_token=[REDACTED]&protocol=15&sdk=js'),
        `Expected sanitized path with diagnostic params preserved, got: ${allErrors}`
      );
    } finally {
      capture.restore();
    }
  });

  it('2. Redacts token query parameter from errorHandler and requestLogger logs', async () => {
    const capture = captureConsoleLogs();
    try {
      const res = await fetch(
        `${baseUrl}/test-error?token=${encodeURIComponent(DUMMY_JWT_B)}&roomVersion=2`
      );
      assert.strictEqual(res.status, 500);

      const allErrors = capture.logs.error.join('\n');
      assert.ok(!allErrors.includes(DUMMY_JWT_B), 'errorHandler log must NEVER contain raw token JWT');
      assert.ok(allErrors.includes('/test-error?token=[REDACTED]&roomVersion=2'));
    } finally {
      capture.restore();
    }
  });

  it('3. Redacts join_request query parameter from errorHandler and requestLogger logs', async () => {
    const capture = captureConsoleLogs();
    try {
      const res = await fetch(
        `${baseUrl}/test-error?join_request=${encodeURIComponent(DUMMY_JOIN_REQ)}&auto_subscribe=0`
      );
      assert.strictEqual(res.status, 500);

      const allErrors = capture.logs.error.join('\n');
      assert.ok(!allErrors.includes(DUMMY_JOIN_REQ), 'errorHandler log must NEVER contain raw join_request');
      assert.ok(allErrors.includes('/test-error?join_request=[REDACTED]&auto_subscribe=0'));
    } finally {
      capture.restore();
    }
  });

  it('4. Redacts multiple and repeated sensitive parameters while keeping ordinary query parameters intact', async () => {
    const capture = captureConsoleLogs();
    try {
      const res = await fetch(
        `${baseUrl}/test-error?sdk=js&access_token=${encodeURIComponent(DUMMY_JWT_A)}&version=2.24.1&token=${encodeURIComponent(DUMMY_JWT_B)}&join_request=${encodeURIComponent(DUMMY_JOIN_REQ)}&ACCESS_TOKEN=second_secret&protocol=15`
      );
      assert.strictEqual(res.status, 500);

      const allErrors = capture.logs.error.join('\n');
      assert.ok(!allErrors.includes(DUMMY_JWT_A));
      assert.ok(!allErrors.includes(DUMMY_JWT_B));
      assert.ok(!allErrors.includes(DUMMY_JOIN_REQ));
      assert.ok(!allErrors.includes('second_secret'));
      assert.ok(
        allErrors.includes(
          '/test-error?sdk=js&access_token=[REDACTED]&version=2.24.1&token=[REDACTED]&join_request=[REDACTED]&ACCESS_TOKEN=[REDACTED]&protocol=15'
        ),
        `Unexpected sanitized log output: ${allErrors}`
      );
    } finally {
      capture.restore();
    }
  });

  it('5. Sanitizes fallback req.url when req.originalUrl is unavailable in both errorHandler and notFoundHandler', () => {
    const capture = captureConsoleLogs();
    try {
      // A. Direct errorHandler invocation with missing originalUrl
      let capturedErrorStatus = 0;
      let capturedErrorBody: unknown = null;
      const errReq = {
        id: 'req-fallback-err',
        method: 'GET',
        originalUrl: undefined,
        url: `/livekit-signal/rtc/v1/validate?access_token=${DUMMY_JWT_A}&protocol=15`,
        ip: '127.0.0.1',
      } as unknown as express.Request;
      const errRes = {
        status(code: number) {
          capturedErrorStatus = code;
          return this;
        },
        json(payload: unknown) {
          capturedErrorBody = payload;
          return this;
        },
      } as unknown as express.Response;

      errorHandler(new Error('Upstream lookup error'), errReq, errRes, () => {});
      assert.strictEqual(capturedErrorStatus, 500);
      assert.ok(capturedErrorBody !== null);
      const errLog = capture.logs.error.join('\n');
      assert.ok(!errLog.includes(DUMMY_JWT_A), 'Fallback req.url must redact access_token in errorHandler');
      assert.ok(errLog.includes('/livekit-signal/rtc/v1/validate?access_token=[REDACTED]&protocol=15'));

      // B. Direct notFoundHandler invocation with missing originalUrl
      let captured404Status = 0;
      let captured404Body: { message?: string } = {};
      const nfReq = {
        id: 'req-fallback-404',
        method: 'GET',
        originalUrl: '',
        url: `/rtc/v1?token=${DUMMY_JWT_B}&join_request=${DUMMY_JOIN_REQ}&sdk=js`,
      } as unknown as express.Request;
      const nfRes = {
        status(code: number) {
          captured404Status = code;
          return this;
        },
        json(payload: { message?: string }) {
          captured404Body = payload;
          return this;
        },
      } as unknown as express.Response;

      notFoundHandler(nfReq, nfRes);
      assert.strictEqual(captured404Status, 404);
      assert.ok(captured404Body.message);
      assert.ok(!captured404Body.message.includes(DUMMY_JWT_B));
      assert.ok(!captured404Body.message.includes(DUMMY_JOIN_REQ));
      assert.ok(
        captured404Body.message.includes(
          "GET /rtc/v1?token=[REDACTED]&join_request=[REDACTED]&sdk=js"
        )
      );
    } finally {
      capture.restore();
    }
  });

  it('6. 404 responses do not expose JWTs while preserving useful route diagnostics and ordinary query params', async () => {
    const capture = captureConsoleLogs();
    try {
      const res = await fetch(
        `${baseUrl}/rtc/unknown-path?access_token=${encodeURIComponent(DUMMY_JWT_A)}&token=${encodeURIComponent(DUMMY_JWT_B)}&join_request=${encodeURIComponent(DUMMY_JOIN_REQ)}&sdk=js&protocol=15`
      );
      assert.strictEqual(res.status, 404);
      const body = (await res.json()) as { status: number; code: string; message: string };
      assert.strictEqual(body.status, 404);
      assert.strictEqual(body.code, 'NOT_FOUND');
      assert.ok(!body.message.includes(DUMMY_JWT_A), '404 body must NEVER echo access_token');
      assert.ok(!body.message.includes(DUMMY_JWT_B), '404 body must NEVER echo token');
      assert.ok(!body.message.includes(DUMMY_JOIN_REQ), '404 body must NEVER echo join_request');
      assert.strictEqual(
        body.message,
        "The requested resource 'GET /rtc/unknown-path?access_token=[REDACTED]&token=[REDACTED]&join_request=[REDACTED]&sdk=js&protocol=15' was not found."
      );

      // Verify requestLogger also sanitized the 404 access log
      const allAccessLogs = [...capture.logs.warn, ...capture.logs.log].join('\n');
      assert.ok(!allAccessLogs.includes(DUMMY_JWT_A));
      assert.ok(!allAccessLogs.includes(DUMMY_JWT_B));
      assert.ok(!allAccessLogs.includes(DUMMY_JOIN_REQ));
      assert.ok(
        allAccessLogs.includes(
          '/rtc/unknown-path?access_token=[REDACTED]&token=[REDACTED]&join_request=[REDACTED]&sdk=js&protocol=15'
        )
      );
    } finally {
      capture.restore();
    }
  });

  it('7. Handles malformed URLs and invalid percent-encoding safely without crashing errorHandler or notFoundHandler', () => {
    const capture = captureConsoleLogs();
    try {
      const malformedUrls = [
        `http://[::1:broken/%E0%A4%A?%ZZ=1&access_token=${DUMMY_JWT_A}&bad=%E0%A4%A&ok=yes`,
        `///weird%%path?join_request=${DUMMY_JOIN_REQ}\r\nINJECTED_LINE#token=${DUMMY_JWT_B}`,
        `/malformed-raw-jwt?${DUMMY_JWT_A}&safe=1`,
      ];

      for (const badUrl of malformedUrls) {
        let statusErr = 0;
        const errReq = {
          id: 'req-malformed',
          method: 'GET',
          originalUrl: badUrl,
          url: badUrl,
          ip: '127.0.0.1',
        } as unknown as express.Request;
        const errRes = {
          status(code: number) {
            statusErr = code;
            return this;
          },
          json() {
            return this;
          },
        } as unknown as express.Response;

        assert.doesNotThrow(() => errorHandler(new Error('Malformed test error'), errReq, errRes, () => {}));
        assert.strictEqual(statusErr, 500);

        let body404 = '';
        const nfRes = {
          status() {
            return this;
          },
          json(p: { message?: string }) {
            body404 = p.message || '';
            return this;
          },
        } as unknown as express.Response;

        assert.doesNotThrow(() => notFoundHandler(errReq, nfRes));
        assert.ok(!body404.includes(DUMMY_JWT_A));
        assert.ok(!body404.includes(DUMMY_JWT_B));
        assert.ok(!body404.includes(DUMMY_JOIN_REQ));
        assert.ok(!body404.includes('\r') && !body404.includes('\n'));
      }

      const allErrors = capture.logs.error.join('\n');
      assert.ok(!allErrors.includes(DUMMY_JWT_A));
      assert.ok(!allErrors.includes(DUMMY_JWT_B));
      assert.ok(!allErrors.includes(DUMMY_JOIN_REQ));
      assert.ok(allErrors.includes('ok=yes'));
      assert.ok(allErrors.includes('safe=1'));
    } finally {
      capture.restore();
    }
  });

  it('8. Signaling Gateway CORS permits configured trusted CLIENT_ORIGIN for GET, HEAD, and OPTIONS without credentials', async () => {
    const trustedOrigin = 'https://app.connectly.example';

    // Preflight OPTIONS
    const optRes = await fetch(`${baseUrl}${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1/validate`, {
      method: 'OPTIONS',
      headers: {
        Origin: trustedOrigin,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'Authorization',
      },
    });
    assert.strictEqual(optRes.status, 204);
    assert.strictEqual(optRes.headers.get('access-control-allow-origin'), trustedOrigin);
    assert.strictEqual(optRes.headers.get('access-control-allow-methods'), 'GET, HEAD, OPTIONS');
    assert.strictEqual(optRes.headers.get('access-control-allow-headers'), 'Authorization, Content-Type');
    assert.strictEqual(optRes.headers.get('access-control-allow-credentials'), null);
    assert.strictEqual(optRes.headers.get('vary'), 'Origin');

    // HEAD health probe
    const headRes = await fetch(`${baseUrl}${LIVEKIT_SIGNAL_GATEWAY_PATH}`, {
      method: 'HEAD',
      headers: { Origin: trustedOrigin },
    });
    assert.strictEqual(headRes.status, 200);
    assert.strictEqual(headRes.headers.get('access-control-allow-origin'), trustedOrigin);
    assert.strictEqual(headRes.headers.get('access-control-allow-credentials'), null);

    // GET health probe
    const getRes = await fetch(`${baseUrl}${LIVEKIT_SIGNAL_GATEWAY_PATH}`, {
      method: 'GET',
      headers: { Origin: trustedOrigin },
    });
    assert.strictEqual(getRes.status, 200);
    assert.strictEqual(await getRes.text(), 'OK');
    assert.strictEqual(getRes.headers.get('access-control-allow-origin'), trustedOrigin);
    assert.strictEqual(getRes.headers.get('access-control-allow-credentials'), null);

    // GET validate with trusted origin (missing token -> 401 still includes trusted CORS header)
    const valRes = await fetch(`${baseUrl}${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1/validate`, {
      method: 'GET',
      headers: { Origin: trustedOrigin },
    });
    assert.strictEqual(valRes.status, 401);
    assert.strictEqual(valRes.headers.get('access-control-allow-origin'), trustedOrigin);
    assert.strictEqual(valRes.headers.get('access-control-allow-credentials'), null);
  });

  it('9. Signaling Gateway CORS blocks untrusted origins from reading health or validation responses and rejects untrusted preflight', async () => {
    const untrustedOrigins = [
      'https://evil.attacker.example',
      'http://localhost:5173', // Excluded in production mode!
      'https://app.connectly.example.evil.com',
    ];

    for (const evilOrigin of untrustedOrigins) {
      // Untrusted preflight -> 403 and zero CORS grant headers
      const optRes = await fetch(`${baseUrl}${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1/validate`, {
        method: 'OPTIONS',
        headers: {
          Origin: evilOrigin,
          'Access-Control-Request-Method': 'GET',
          'Access-Control-Request-Headers': 'Authorization',
        },
      });
      assert.strictEqual(optRes.status, 403, `Untrusted preflight must return 403 for ${evilOrigin}`);
      assert.strictEqual(optRes.headers.get('access-control-allow-origin'), null);
      assert.strictEqual(optRes.headers.get('access-control-allow-methods'), null);
      assert.strictEqual(optRes.headers.get('access-control-allow-headers'), null);
      assert.strictEqual(optRes.headers.get('access-control-allow-credentials'), null);
      assert.strictEqual(optRes.headers.get('vary'), 'Origin');

      // Untrusted GET health -> no Access-Control-Allow-Origin (never *)
      const healthRes = await fetch(`${baseUrl}${LIVEKIT_SIGNAL_GATEWAY_PATH}`, {
        method: 'GET',
        headers: { Origin: evilOrigin },
      });
      assert.strictEqual(healthRes.headers.get('access-control-allow-origin'), null);
      assert.strictEqual(healthRes.headers.get('access-control-allow-credentials'), null);
      assert.strictEqual(healthRes.headers.get('vary'), 'Origin');

      // Untrusted HEAD health -> no Access-Control-Allow-Origin
      const headRes = await fetch(`${baseUrl}${LIVEKIT_SIGNAL_GATEWAY_PATH}`, {
        method: 'HEAD',
        headers: { Origin: evilOrigin },
      });
      assert.strictEqual(headRes.headers.get('access-control-allow-origin'), null);
      assert.strictEqual(headRes.headers.get('access-control-allow-credentials'), null);

      // Untrusted GET validate -> no Access-Control-Allow-Origin
      const valRes = await fetch(`${baseUrl}${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1/validate`, {
        method: 'GET',
        headers: { Origin: evilOrigin },
      });
      assert.strictEqual(valRes.headers.get('access-control-allow-origin'), null);
      assert.strictEqual(valRes.headers.get('access-control-allow-credentials'), null);
    }
  });

  it('10. Fails safely when CLIENT_ORIGIN is missing, wildcard, malformed, or non-HTTPS in production', () => {
    for (const invalidProdOrigin of [
      '',
      '   ',
      '*',
      'not-a-url',
      'ftp://app.connectly.example',
      'http://app.connectly.example',
    ]) {
      assert.throws(
        () =>
          resolveSignalGatewayAllowedOrigins({
            clientOrigin: invalidProdOrigin,
            nodeEnv: 'production',
          }),
        /CRITICAL:/,
        `resolveSignalGatewayAllowedOrigins must fail closed in production for '${invalidProdOrigin}'`
      );

      const badGateway = new LiveKitSignalGateway(undefined, {}, coordinator, {
        activeSocketRevalidationIntervalMs: 0,
        clientOrigin: invalidProdOrigin,
        nodeEnv: 'production',
      });
      try {
        assert.throws(
          () => badGateway.createRouter(),
          /CRITICAL:/,
          `gateway.createRouter() must fail closed in production for '${invalidProdOrigin}'`
        );
      } finally {
        badGateway.close();
      }

      const envRes = envSchema.safeParse(buildValidProdEnv({ CLIENT_ORIGIN: invalidProdOrigin }));
      assert.strictEqual(
        envRes.success,
        false,
        `envSchema must reject production CLIENT_ORIGIN='${invalidProdOrigin}'`
      );
    }

    // Valid production https:// CLIENT_ORIGIN succeeds and returns ONLY that exact origin
    const prodOrigins = resolveSignalGatewayAllowedOrigins({
      clientOrigin: 'https://app.connectly.example/some/path',
      nodeEnv: 'production',
    });
    assert.deepStrictEqual(prodOrigins, ['https://app.connectly.example']);

    // Non-production permits http://localhost:5173 and rejects wildcard *
    const devOrigins = resolveSignalGatewayAllowedOrigins({
      clientOrigin: 'http://localhost:5173',
      nodeEnv: 'development',
    });
    assert.ok(devOrigins.includes('http://localhost:5173'));
    assert.ok(devOrigins.includes('http://127.0.0.1:5173'));
    assert.throws(
      () =>
        resolveSignalGatewayAllowedOrigins({
          clientOrigin: '*',
          nodeEnv: 'development',
        }),
      /CRITICAL:/
    );
  });
});
