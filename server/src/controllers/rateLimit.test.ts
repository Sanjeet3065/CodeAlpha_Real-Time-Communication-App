import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { createApp } from '../app.js';
import type { Server } from 'node:http';

describe('Rate Limiting & Abuse Prevention Suite', () => {
  let server: Server;
  let baseUrl: string;

  before(async () => {
    await mongoose.connect('mongodb://127.0.0.1:27017/connectly_ratelimit_test');
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
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await mongoose.disconnect();
  });

  it('should enforce rate limits on /api/v1/auth/login and return 429 when threshold exceeded', async () => {
    const headers = {
      'Content-Type': 'application/json',
      'Origin': 'http://localhost:5173',
      'X-Requested-With': 'XMLHttpRequest',
    };

    let rateLimited = false;
    let rateLimitResponse: any = null;

    // Login limiter threshold is 20 requests per 15 minutes.
    // Send 22 requests to trigger the rate limiter
    for (let i = 0; i < 22; i++) {
      const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          email: 'ratelimit.test@connectly.io',
          password: 'SomePassword123!',
        }),
      });

      if (res.status === 429) {
        rateLimited = true;
        rateLimitResponse = await res.json();
        break;
      }
    }

    assert.strictEqual(rateLimited, true, 'Rate limiter must return 429 status code');
    assert.strictEqual(rateLimitResponse.code, 'RATE_LIMIT_EXCEEDED');
    assert.ok(rateLimitResponse.message.includes('Too many login attempts'));
  });
});
