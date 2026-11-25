export interface ShutdownHttpServerLike {
  listening?: boolean;
  close: (callback: (err?: Error) => void) => void;
  closeIdleConnections?: () => void;
  closeAllConnections?: () => void;
}

export interface GracefulShutdownOptions {
  httpServer: ShutdownHttpServerLike;
  drainTimeoutMs?: number;
  stopSubsystems: () => Promise<void>;
  disconnectDatabase: () => Promise<void>;
  onExit?: (code: number) => void;
  log?: (message: string) => void;
  logError?: (message: string, err?: unknown) => void;
}

/**
 * Creates an idempotent, bounded graceful shutdown handler that stops background
 * subsystems, drains idle/active HTTP connections within `drainTimeoutMs`, closes
 * the database connection cleanly, and invokes `onExit`.
 */
export function createGracefulShutdown(options: GracefulShutdownOptions) {
  const drainTimeoutMs = options.drainTimeoutMs ?? 10_000;
  const onExit = options.onExit ?? ((code: number) => process.exit(code));
  const log = options.log ?? ((msg: string) => console.log(msg));
  const logError = options.logError ?? ((msg: string, err?: unknown) => console.error(msg, err));

  let shutdownPromise: Promise<number> | null = null;

  return function shutdown(signal: string): Promise<number> {
    if (shutdownPromise) {
      return shutdownPromise;
    }

    shutdownPromise = (async () => {
      log(`[Server] Received ${signal}. Gracefully terminating server...`);
      let exitCode = 0;

      try {
        await options.stopSubsystems();
      } catch (err) {
        exitCode = 1;
        logError('[Server] Error while stopping background subsystems:', err);
      }

      try {
        await new Promise<void>((resolve) => {
          let settled = false;
          const finish = () => {
            if (!settled) {
              settled = true;
              resolve();
            }
          };

          const drainTimer = setTimeout(() => {
            log(`[Server] Graceful HTTP drain timed out after ${drainTimeoutMs}ms; closing remaining connections.`);
            try {
              options.httpServer.closeAllConnections?.();
            } catch {
              // Ignore connection close error during forced drain
            }
            finish();
          }, drainTimeoutMs);
          drainTimer.unref?.();

          try {
            options.httpServer.closeIdleConnections?.();
            options.httpServer.close((err?: Error) => {
              clearTimeout(drainTimer);
              if (err && (err as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') {
                exitCode = 1;
                logError('[Server] Error closing HTTP server:', err);
              }
              finish();
            });
          } catch (err) {
            clearTimeout(drainTimer);
            exitCode = 1;
            logError('[Server] Failed to initiate HTTP server close:', err);
            finish();
          }
        });
      } finally {
        try {
          await options.disconnectDatabase();
        } catch (err) {
          exitCode = 1;
          logError('[Server] Error disconnecting database during shutdown:', err);
        }
      }

      log(`[Server] Process exiting with status ${exitCode}.`);
      onExit(exitCode);
      return exitCode;
    })();

    return shutdownPromise;
  };
}
