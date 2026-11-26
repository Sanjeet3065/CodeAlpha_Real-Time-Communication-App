import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ChatRedisService } from '../services/chatRedis.service.js';
import { env } from '../config/env.js';

function startLightweightRespServer(): Promise<{
  port: number;
  activeSocketCount: () => number;
  close: () => Promise<void>;
}> {
  return new Promise((resolve, reject) => {
    const sockets = new Set<net.Socket>();
    const server = net.createServer((sock) => {
      sockets.add(sock);
      sock.on('close', () => sockets.delete(sock));
      sock.on('error', () => sockets.delete(sock));

      let buf = '';
      sock.on('data', (chunk) => {
        buf += chunk.toString('utf8');
        while (buf.length > 0 && buf.startsWith('*')) {
          const lines = buf.split('\r\n');
          const count = Number.parseInt(lines[0].slice(1), 10);
          if (Number.isNaN(count) || lines.length < 1 + count * 2 + 1) {
            break;
          }
          const args: string[] = [];
          let idx = 1;
          for (let i = 0; i < count; i += 1) {
            idx += 1;
            args.push(lines[idx] ?? '');
            idx += 1;
          }
          buf = lines.slice(idx).join('\r\n');
          const cmd = (args[0] || '').toUpperCase();
          if (cmd === 'HELLO') {
            sock.write("-ERR unknown command 'HELLO'\r\n");
          } else if (cmd === 'INFO') {
            const payload = '# Server\r\nredis_version:7.2.0\r\nredis_mode:standalone\r\nloading:0\r\n';
            sock.write(`$${Buffer.byteLength(payload)}\r\n${payload}\r\n`);
          } else if (cmd === 'PING') {
            sock.write('+PONG\r\n');
          } else if (cmd === 'SCAN') {
            sock.write('*2\r\n$1\r\n0\r\n*0\r\n');
          } else if (cmd === 'QUIT') {
            sock.write('+OK\r\n');
            sock.end();
          } else {
            sock.write('+OK\r\n');
          }
        }
      });
    });

    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to bind local RESP mock server'));
        return;
      }
      resolve({
        port: addr.port,
        activeSocketCount: () => sockets.size,
        close: async () => {
          for (const sock of sockets) {
            sock.destroy();
          }
          await new Promise<void>((res) => server.close(() => res()));
        },
      });
    });
  });
}

describe('ChatRedisService Lifecycle & CI Socket Teardown Suite', () => {
  it('closes owned ioredis TCP socket cleanly and deduplicates concurrent connections', async () => {
    const respServer = await startLightweightRespServer();
    const originalRedisUrl = env.REDIS_URL;
    const originalNodeEnv = env.NODE_ENV;

    try {
      (env as { REDIS_URL: string }).REDIS_URL = `redis://127.0.0.1:${respServer.port}`;
      (env as { NODE_ENV: string }).NODE_ENV = 'test';
      const svc = new ChatRedisService();

      const results = await Promise.all([svc.ping(), svc.ping(), svc.ping()]);
      assert.deepStrictEqual(results, [true, true, true]);
      assert.strictEqual(
        respServer.activeSocketCount(),
        1,
        'Concurrent cold-start pings MUST share a single ioredis TCP connection'
      );

      await svc.clearTestState();
      await svc.close();
      await new Promise((r) => setTimeout(r, 30));

      assert.strictEqual(
        respServer.activeSocketCount(),
        0,
        'close() MUST close managed Redis TCP sockets so node --test exits immediately'
      );
    } finally {
      (env as { REDIS_URL: string }).REDIS_URL = originalRedisUrl;
      (env as { NODE_ENV: string }).NODE_ENV = originalNodeEnv;
      await respServer.close();
    }
  });

  it('ensures every server entrypoint and Redis-backed test suite invokes chatRedisService.close()', () => {
    const testsDir = path.dirname(fileURLToPath(import.meta.url));
    const serverSrcDir = path.resolve(testsDir, '..');

    const targets = [
      path.join(serverSrcDir, 'server.ts'),
      path.join(testsDir, 'health.test.ts'),
      path.join(testsDir, 'phase12ChatAndReactions.test.ts'),
      path.join(testsDir, 'phase13FileSharing.test.ts'),
      path.join(testsDir, 'phase14Whiteboard.test.ts'),
      path.join(testsDir, 'phase15Security.test.ts'),
      path.join(testsDir, 'phase17LoadAndPerformance.test.ts'),
      path.join(testsDir, 'phase18FileSharingGate.test.ts'),
      path.join(testsDir, 'whiteboardConcurrencyAudit.test.ts'),
      path.join(testsDir, 'whiteboardTransactionIntegrity.test.ts'),
    ];

    for (const filePath of targets) {
      const content = fs.readFileSync(filePath, 'utf8');
      assert.match(
        content,
        /chatRedisService\.close\(/,
        `${path.basename(filePath)} must close chatRedisService in teardown`
      );
    }
  });
});
