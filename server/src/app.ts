import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { getCspDirectives, type CspConfigInput } from './config/csp.js';
import { authRouter } from './routes/auth.routes.js';
import { usersRouter } from './routes/users.routes.js';
import { meetingsRouter } from './routes/meetings.routes.js';
import { healthRouter } from './routes/health.routes.js';
import { adminRouter } from './routes/admin.routes.js';
import {
  livekitSignalGateway,
  LIVEKIT_SIGNAL_GATEWAY_PATH,
  type LiveKitSignalGateway,
} from './realtime/livekitSignalGateway.js';
import { requestIdMiddleware } from './middlewares/requestId.js';
import { requestLogger } from './middlewares/requestLogger.js';
import { notFoundHandler } from './middlewares/notFound.js';
import { errorHandler } from './middlewares/errorHandler.js';
import { resolveTrustProxy } from './config/proxy.js';
import { createOriginAuthMiddleware } from './middlewares/originAuth.js';

export function createApp(options?: {
  signalGateway?: LiveKitSignalGateway;
  cspConfigOverride?: CspConfigInput;
  trustProxyOverride?: boolean | number | string;
  proxySecretOverride?: string;
}): Express {
  const app = express();
  const gateway = options?.signalGateway ?? livekitSignalGateway;
  const cspDirectives = getCspDirectives(options?.cspConfigOverride ?? env);

  // Reverse Proxy Trust Configuration (Phase 18 Sprint 06P: F-06O-03)
  const trustProxySetting =
    options?.trustProxyOverride !== undefined
      ? options.trustProxyOverride
      : resolveTrustProxy(env.TRUST_PROXY);
  app.set('trust proxy', trustProxySetting);

  // Request ID Tracking (earliest middleware in pipeline)
  app.use(requestIdMiddleware);

  // Structured HTTP Request Logging
  app.use(requestLogger);

  // Security Headers via Helmet (HSTS, CSP, Frameguard, NoSniff)
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      frameguard: { action: 'deny' },
      hsts:
        env.NODE_ENV === 'production'
          ? {
              maxAge: 31536000,
              includeSubDomains: true,
              preload: true,
            }
          : false,
      noSniff: true,
      contentSecurityPolicy: {
        directives: cspDirectives,
      },
    })
  );

  // CORS Configuration (Production restricts strictly to configured CLIENT_ORIGIN)
  const allowedOrigins =
    env.NODE_ENV === 'production'
      ? [env.CLIENT_ORIGIN]
      : [env.CLIENT_ORIGIN, 'http://localhost:5173', 'http://127.0.0.1:5173'];
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(null, false);
        }
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-CSRF-Protection', 'X-CSRF-Token', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id'],
    })
  );

  // Request Parsers with defensive size limit (100kb payload limit protects against DOS)
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  // Worker-to-Backend Origin Authentication & Client IP Integrity (Phase 18 Sprint 06R & 06T: F-06S-01)
  // ALWAYS mounted unconditionally to ensure fail-closed defense in production
  app.use(createOriginAuthMiddleware({ proxySecretOverride: options?.proxySecretOverride }));

  // Health and Readiness Endpoints
  app.use('/', healthRouter);
  app.use('/api/v1', healthRouter);

  // Mount API Subsystems
  app.use('/api/v1/auth', authRouter);
  app.use('/api/auth', authRouter); // Backward compatibility alias
  app.use('/api/v1/users', usersRouter);
  app.use('/api/users', usersRouter); // Backward compatibility alias
  app.use('/api/v1/meetings', meetingsRouter);
  app.use('/api/meetings', meetingsRouter); // Backward compatibility alias
  app.use('/api/v1/admin', adminRouter);

  // Phase 09 — Authoritative LiveKit Signaling Admission Gateway (HTTP validate/HEAD)
  app.use(LIVEKIT_SIGNAL_GATEWAY_PATH, gateway.createRouter());

  // 404 Route Not Found Handler
  app.use(notFoundHandler);

  // Centralized Global Error Handler
  app.use(errorHandler);

  return app;
}
