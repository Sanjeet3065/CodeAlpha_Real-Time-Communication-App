import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { createApp } from '../app.js';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import type { Server } from 'node:http';

describe('Health & Readiness Endpoints Suite', () => {
  let server: Server;
  let baseUrl: string;

  before(async () => {
    await connectDatabase('mongodb://127.0.0.1:27017/connectly_health_test');
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
    await disconnectDatabase();
  });

  it('1. GET /health — should return 200 OK and liveness metadata', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.strictEqual(res.status, 200);

    const body = (await res.json()) as any;
    assert.strictEqual(body.status, 'ok');
    assert.strictEqual(body.service, 'connectly-server');
    assert.strictEqual(body.version, '0.1.0');
    assert.ok(body.timestamp);
  });

  it('2. GET /api/v1/health — alias should return 200 OK', async () => {
    const res = await fetch(`${baseUrl}/api/v1/health`);
    assert.strictEqual(res.status, 200);

    const body = (await res.json()) as any;
    assert.strictEqual(body.status, 'ok');
  });

  it('3. GET /ready — should return 200 OK when database is connected', async () => {
    const res = await fetch(`${baseUrl}/ready`);
    assert.strictEqual(res.status, 200);

    const body = (await res.json()) as any;
    assert.strictEqual(body.status, 'ready');
    assert.strictEqual(body.database, 'connected');
    assert.ok(body.timestamp);
    // Credentials and URI must never be leaked
    assert.strictEqual(body.uri, undefined);
    assert.strictEqual(body.password, undefined);
  });

  it('4. GET /api/v1/ready — alias should return 200 OK when database is connected', async () => {
    const res = await fetch(`${baseUrl}/api/v1/ready`);
    assert.strictEqual(res.status, 200);

    const body = (await res.json()) as any;
    assert.strictEqual(body.status, 'ready');
  });

  it('5. GET /ready — should return 503 Service Unavailable when database is disconnected', async () => {
    // Temporarily disconnect to verify unreadiness probe
    await mongoose.disconnect();

    const res = await fetch(`${baseUrl}/ready`);
    assert.strictEqual(res.status, 503);

    const body = (await res.json()) as any;
    assert.strictEqual(body.status, 'down');
    assert.strictEqual(body.database, 'disconnected');
    assert.ok(body.message.includes('not ready'));

    // Reconnect for cleanup
    await connectDatabase('mongodb://127.0.0.1:27017/connectly_health_test');
  });
});
