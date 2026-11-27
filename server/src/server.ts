import http from 'node:http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { isSupabaseActive } from './config/supabase.js';
import { ensureSecurityAuditReady } from './models/SecurityAuditEntry.model.js';
import { isReplicaSetTransactionsSupported } from './models/LiveKitRevocationEvent.model.js';
import { meetingRealtime } from './realtime/meetingSocket.js';
import { meetingOutboxDispatcher } from './realtime/meetingOutboxDispatcher.js';
import {
  livekitSignalGateway,
  LIVEKIT_SIGNAL_GATEWAY_PATH,
} from './realtime/livekitSignalGateway.js';
import { livekitRevocationCoordinator } from './realtime/livekitRevocationCoordinator.js';
import { chatRedisService } from './services/chatRedis.service.js';
import { fileCleanupWorker } from './services/fileCleanupWorker.service.js';
import { meetingHistoryRetentionWorker } from './services/meetingHistoryRetentionWorker.service.js';
import { reminderWorker } from './services/reminderWorker.service.js';
import { livekitEvictionWorker } from './workers/livekitEvictionWorker.js';
import { keyManager } from './services/keyManagement.service.js';
import { getStorageProvider } from './storage/storageFactory.js';
import { S3StorageProvider } from './storage/s3StorageProvider.js';
import { SupabaseStorageProvider } from './storage/supabaseStorageProvider.js';
import { validateProxySecret } from './config/proxy.js';
import { createGracefulShutdown } from './utils/gracefulShutdown.js';

async function bootstrap() {
  try {
    await connectDatabase();
    await ensureSecurityAuditReady();

    // Phase 18 Sprint 06H: Fail closed on startup if production or REQUIRE_TRANSACTIONS=true without Replica Set / Sharded Cluster (MongoDB mode only)
    if (!isSupabaseActive() && (env.NODE_ENV === 'production' || env.REQUIRE_TRANSACTIONS === 'true')) {
      const txSupported = await isReplicaSetTransactionsSupported();
      if (!txSupported) {
        throw new Error(
          'CRITICAL: Production deployment requires a MongoDB deployment that supports multi-document transactions (Replica Set or Sharded Cluster). Standalone MongoDB is strictly prohibited in production.'
        );
      }
    }

    // Phase 18 Sprint 06T: Fail closed on startup in production proxy mode if PROXY_SECRET is missing/weak.
    // In ORIGIN_AUTH_MODE=direct (Vercel + Render split-origin without Worker), validate PROXY_SECRET only if supplied.
    if (env.NODE_ENV === 'production') {
      const requireProxySecret = env.ORIGIN_AUTH_MODE !== 'direct';
      if (requireProxySecret || env.PROXY_SECRET) {
        const proxySecretResult = validateProxySecret(env.PROXY_SECRET, requireProxySecret);
        if (!proxySecretResult.valid) {
          throw new Error(proxySecretResult.error);
        }
      }
    }

    keyManager.assertValid();
    await livekitRevocationCoordinator.start();
    const unsubMeetingEndSync = livekitRevocationCoordinator.subscribe((event) => {
      if (event.kind === 'MEETING_ENDED') {
        meetingRealtime.markMeetingEnded(event.meetingId);
      }
    });

    const app = createApp();
    const httpServer = http.createServer(app);
    meetingRealtime.attach(httpServer);
    const socketAdapterMode = await meetingRealtime.attachSharedAdapter();
    livekitSignalGateway.attach(httpServer);
    await meetingOutboxDispatcher.start();

    // Startup storage verification (Supabase Storage bucket or S3 Bucket Versioning).
    // Skip ONLY when storage is explicitly disabled and file sharing is disabled.
    if (env.STORAGE_PROVIDER === 'disabled' && !env.ENABLE_FILE_SHARING) {
      console.log(
        '[Server] File sharing is disabled (STORAGE_PROVIDER=disabled, ENABLE_FILE_SHARING=false); skipping storage verification.'
      );
    } else {
      const storageProvider = getStorageProvider();
      if (storageProvider.name === 'supabase') {
        await (storageProvider as SupabaseStorageProvider).verifyBucketExists();
        console.log(
          `[Server] Supabase Storage bucket verified (${env.SUPABASE_STORAGE_BUCKET})`
        );
      } else if (storageProvider.name === 's3') {
        await (storageProvider as S3StorageProvider).verifyBucketVersioning();
      }
    }

    await fileCleanupWorker.start();
    await meetingHistoryRetentionWorker.start();
    reminderWorker.start();
    await livekitEvictionWorker.start();

    httpServer.listen(env.PORT, () => {
      console.log(`[Server] CONNECTLY API Server running on port ${env.PORT} in ${env.NODE_ENV} mode`);
      console.log(`[Server] Health check available at http://localhost:${env.PORT}/api/v1/health`);
      console.log(
        `[Server] Socket.IO meeting management attached on port ${env.PORT} (adapter: ${socketAdapterMode})`
      );
      console.log(
        `[Server] LiveKit Signaling Admission Gateway attached at ${LIVEKIT_SIGNAL_GATEWAY_PATH} (revocation transport: ${livekitRevocationCoordinator.getTransportMode()})`
      );
    });

    const shutdown = createGracefulShutdown({
      httpServer,
      drainTimeoutMs: 10_000,
      stopSubsystems: async () => {
        unsubMeetingEndSync();
        reminderWorker.stop();
        await livekitEvictionWorker.stop();
        await meetingHistoryRetentionWorker.stop();
        await fileCleanupWorker.stop();
        await meetingOutboxDispatcher.stop();
        livekitSignalGateway.close();
        await livekitRevocationCoordinator.stop();
        await chatRedisService.close();
        await meetingRealtime.closeAsync();
      },
      disconnectDatabase,
    });

    process.on('SIGTERM', () => {
      void shutdown('SIGTERM');
    });
    process.on('SIGINT', () => {
      void shutdown('SIGINT');
    });
  } catch (error) {
    console.error('[Server] Fatal startup error:', error);
    process.exit(1);
  }
}

bootstrap();
