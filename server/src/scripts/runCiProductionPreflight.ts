import http from 'node:http';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { TokenVerifier } from 'livekit-server-sdk';

const execFileAsync = promisify(execFile);

export interface CiPreflightResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Starts a local deterministic LiveKit Twirp mock server on 127.0.0.1 that
 * authenticates signed Bearer tokens for RoomService.ListRooms without making
 * any external LiveKit Cloud API calls.
 */
export async function startDeterministicLiveKitTwirpMock(
  apiKey: string,
  apiSecret: string
): Promise<{ url: string; close: () => Promise<void> }> {
  const verifier = new TokenVerifier(apiKey, apiSecret);

  const server = http.createServer(async (req, res) => {
    const reqUrl = req.url || '';
    if (req.method === 'POST' && reqUrl.includes('/twirp/livekit.RoomService/ListRooms')) {
      const authHeader = req.headers.authorization || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
      if (!token) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code: 'unauthenticated', msg: 'Missing LiveKit authorization token' }));
        return;
      }

      try {
        await verifier.verify(token);
      } catch {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code: 'unauthenticated', msg: 'Invalid LiveKit authorization token' }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ rooms: [] }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ code: 'not_found', msg: 'Unsupported mock Twirp endpoint' }));
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const addr = server.address();
  if (!addr || typeof addr === 'string') {
    throw new Error('Failed to bind deterministic LiveKit mock server address.');
  }

  return {
    url: `ws://127.0.0.1:${addr.port}`,
    close: async () => {
      server.closeAllConnections?.();
      if (server.listening) {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
  };
}

/**
 * Runs the real `verifyProductionReadiness.ts --mode=production` CLI against an
 * ephemeral deterministic LiveKit Twirp mock so CI exercises full strict schema,
 * secret, MongoDB Replica Set, and Redis validation with zero external cloud calls.
 */
export async function runCiPreflightWithMockLiveKit(
  envOverrides: Record<string, string | undefined> = {}
): Promise<CiPreflightResult> {
  const mergedEnv: Record<string, string | undefined> = {
    ...process.env,
    ...envOverrides,
  };

  const apiKey = (mergedEnv.LIVEKIT_API_KEY || '').trim();
  const apiSecret = (mergedEnv.LIVEKIT_API_SECRET || '').trim();

  // Only start the deterministic LiveKit mock when credentials are present;
  // missing/invalid secrets will still be strictly rejected by verifyProductionReadiness.ts.
  const mockLiveKit =
    apiKey && apiSecret
      ? await startDeterministicLiveKitTwirpMock(apiKey, apiSecret)
      : null;

  try {
    const childEnv: Record<string, string | undefined> = {
      ...mergedEnv,
      NODE_ENV: 'production',
      ...(mockLiveKit ? { LIVEKIT_URL: mockLiveKit.url } : {}),
      LIVEKIT_PUBLIC_URL:
        mergedEnv.LIVEKIT_PUBLIC_URL || 'wss://connectly.example.com/livekit-signal',
      LIVEKIT_SIGNAL_GATEWAY_ENABLED:
        mergedEnv.LIVEKIT_SIGNAL_GATEWAY_ENABLED || 'true',
    };

    const __filename = fileURLToPath(import.meta.url);
    const serverRoot = path.resolve(path.dirname(__filename), '../..');
    const scriptPath = path.resolve(serverRoot, 'src/scripts/verifyProductionReadiness.ts');

    try {
      const { stdout, stderr } = await execFileAsync(
        process.execPath,
        ['--import', 'tsx', scriptPath, '--mode=production'],
        {
          cwd: serverRoot,
          env: childEnv as NodeJS.ProcessEnv,
          timeout: 30_000,
        }
      );
      return { exitCode: 0, stdout, stderr };
    } catch (err: unknown) {
      const execErr = err as { code?: number | string; stdout?: string; stderr?: string };
      return {
        exitCode: typeof execErr.code === 'number' ? execErr.code : 1,
        stdout: String(execErr.stdout || ''),
        stderr: String(execErr.stderr || ''),
      };
    }
  } finally {
    await mockLiveKit?.close();
  }
}

const isMain =
  process.argv[1] &&
  (path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) ||
    process.argv[1].endsWith('runCiProductionPreflight.ts') ||
    process.argv[1].endsWith('runCiProductionPreflight.js'));

if (isMain) {
  runCiPreflightWithMockLiveKit()
    .then((result) => {
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
      process.exit(result.exitCode);
    })
    .catch((err) => {
      console.error('Fatal CI preflight harness error:', err);
      process.exit(1);
    });
}
