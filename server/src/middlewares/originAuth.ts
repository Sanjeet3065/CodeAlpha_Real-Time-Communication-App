import crypto from 'node:crypto';
import net from 'node:net';
import type { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

/**
 * CONNECTLY — Worker-to-Backend Origin Authentication & Client IP Integrity Middleware
 * Phase 18 Sprint 06R (F-06Q-01)
 *
 * Security Invariants:
 * 1. Prohibits direct unauthorized access to the backend origin when PROXY_SECRET is configured.
 * 2. Compares incoming X-Proxy-Secret against PROXY_SECRET using constant-time crypto.timingSafeEqual.
 * 3. Never discloses credential values in audit logs or HTTP error responses.
 * 4. Extracts X-Verified-Client-IP only after successful origin authentication, validating its format.
 * 5. Overrides req.ip on the verified request so Express rate limiters, auth audits, and error handlers
 *    attribute traffic strictly to the verified client IP rather than arbitrary X-Forwarded-For headers.
 * 6. Exempts public health check probes (/health, /api/v1/health) so PaaS container lifecycle probes succeed.
 */

export function isValidIp(ip: string): boolean {
  return typeof ip === 'string' && net.isIP(ip.trim()) !== 0;
}

export function getVerifiedClientIp(req: Request): string {
  if (typeof (req as any).verifiedClientIp === 'string' && (req as any).verifiedClientIp) {
    return (req as any).verifiedClientIp;
  }
  if (typeof req.ip === 'string' && req.ip) {
    return req.ip;
  }
  if (typeof req.socket?.remoteAddress === 'string' && req.socket.remoteAddress) {
    return req.socket.remoteAddress;
  }
  return '127.0.0.1';
}

/**
 * Checks whether an incoming request path matches an exact legitimate health or readiness probe.
 * Supports exact paths and their trailing-slash variants (F-06S-05).
 * Does NOT permit broad prefix matching or traversal.
 */
export function isHealthRoute(rawPath: string): boolean {
  if (typeof rawPath !== 'string') return false;
  // Normalize trailing slash while preserving single-slash root
  const normalized = rawPath.length > 1 ? rawPath.replace(/\/+$/, '') : rawPath;

  const EXACT_HEALTH_PATHS = new Set([
    '/health',
    '/ready',
    '/health/ready',
    '/health/live',
    '/api/v1/health',
    '/api/v1/ready',
    '/api/v1/health/ready',
    '/api/v1/health/live',
    '/api/health',
    '/api/ready',
    '/api/health/ready',
    '/api/health/live',
  ]);

  return EXACT_HEALTH_PATHS.has(normalized);
}

export function createOriginAuthMiddleware(options?: {
  proxySecretOverride?: string;
  enforceInTest?: boolean;
}) {
  return function originAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
    const isProduction = env.NODE_ENV === 'production';
    const isDirectMode =
      options?.proxySecretOverride === undefined && env.ORIGIN_AUTH_MODE === 'direct';
    const activeSecret =
      options?.proxySecretOverride !== undefined ? options.proxySecretOverride : env.PROXY_SECRET;

    // F-06S-01: Defensive fail-closed in production proxy mode if PROXY_SECRET is missing or empty.
    // Split-origin direct mode (ORIGIN_AUTH_MODE=direct, e.g. Vercel + Render without Cloudflare Worker)
    // enforces strict HTTPS CORS + Origin/Referer CSRF + JWT authentication without a proxy secret.
    if (isProduction && !isDirectMode && (!activeSecret || !activeSecret.trim())) {
      logger.error('[OriginAuth] CRITICAL CONFIGURATION ERROR: PROXY_SECRET is missing in production mode.');
      res.status(500).json({
        status: 500,
        code: 'ORIGIN_AUTH_MISCONFIGURED',
        message: 'Origin authentication is misconfigured on backend.',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // If no secret is configured (local dev/test OR explicit ORIGIN_AUTH_MODE=direct), proceed
    if (!activeSecret) {
      return next();
    }

    // Health and readiness probes are exempt so PaaS container orchestration can assess liveness (F-06S-05)
    const path = req.path || '';
    if (isHealthRoute(path)) {
      return next();
    }

    // Check incoming X-Proxy-Secret header
    const rawProvidedSecret = req.headers['x-proxy-secret'];
    if (typeof rawProvidedSecret !== 'string' || !rawProvidedSecret) {
      logger.warn('[OriginAuth] Blocked direct request to backend origin: missing X-Proxy-Secret', {
        path: req.originalUrl || req.url,
        method: req.method,
        remoteIp: req.socket?.remoteAddress,
      });

      res.status(403).json({
        status: 403,
        code: 'ORIGIN_AUTHENTICATION_REQUIRED',
        message: 'Direct access to backend origin is forbidden. Requests must route through authorized reverse proxy.',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Constant-time comparison to prevent timing side-channel attacks
    const expectedBuf = Buffer.from(activeSecret, 'utf-8');
    const providedBuf = Buffer.from(rawProvidedSecret, 'utf-8');
    const isSecretValid =
      expectedBuf.length === providedBuf.length &&
      crypto.timingSafeEqual(expectedBuf, providedBuf);

    if (!isSecretValid) {
      logger.warn('[OriginAuth] Blocked request to backend origin: invalid X-Proxy-Secret', {
        path: req.originalUrl || req.url,
        method: req.method,
        remoteIp: req.socket?.remoteAddress,
      });

      res.status(403).json({
        status: 403,
        code: 'ORIGIN_AUTHENTICATION_FAILED',
        message: 'Invalid reverse proxy origin credential.',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Origin authenticated: verify and attribute trusted client IP if supplied by Worker
    const rawVerifiedIp = req.headers['x-verified-client-ip'];
    if (typeof rawVerifiedIp === 'string') {
      const trimmedIp = rawVerifiedIp.trim();
      if (isValidIp(trimmedIp)) {
        (req as any).verifiedClientIp = trimmedIp;
        // Override Express req.ip property for rate limiters, auth logging, and error handling
        Object.defineProperty(req, 'ip', {
          value: trimmedIp,
          configurable: true,
          writable: true,
        });
      }
    }

    return next();
  };
}
