import type { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';

export function getAllowedCsrfOrigins(
  clientOrigin: string = env.CLIENT_ORIGIN,
  nodeEnv: string = env.NODE_ENV
): string[] {
  return nodeEnv === 'production'
    ? [clientOrigin]
    : [clientOrigin, 'http://localhost:5173', 'http://127.0.0.1:5173'];
}

function isOriginAllowed(originHeader: string | undefined, allowedOrigins: string[]): boolean {
  if (!originHeader) return false;
  try {
    const parsed = new URL(originHeader);
    const originNormalized = `${parsed.protocol}//${parsed.host}`;
    return allowedOrigins.some((allowed) => {
      try {
        const allowedParsed = new URL(allowed);
        return originNormalized === `${allowedParsed.protocol}//${allowedParsed.host}`;
      } catch {
        return originNormalized === allowed;
      }
    });
  } catch {
    return false;
  }
}

/**
 * Validates Origin and Referer headers on all state-changing HTTP requests.
 * In production, strictly allows only the configured CLIENT_ORIGIN.
 * Localhost development origins are allowed only outside production.
 */
export function createValidateRequestOrigin(options?: {
  clientOrigin?: string;
  nodeEnv?: string;
}) {
  return function validateRequestOriginMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    const method = req.method.toUpperCase();
    const stateChangingMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];

    if (!stateChangingMethods.includes(method)) {
      return next();
    }

    const allowedOrigins = getAllowedCsrfOrigins(
      options?.clientOrigin ?? env.CLIENT_ORIGIN,
      options?.nodeEnv ?? env.NODE_ENV
    );

    const origin = req.headers.origin;
    const referer = req.headers.referer;

    // 1. If Origin header is present, it MUST match allowed origins
    if (origin) {
      if (!isOriginAllowed(origin, allowedOrigins)) {
        res.status(403).json({
          status: 403,
          code: 'CSRF_INVALID_ORIGIN',
          message: 'Request blocked: Untrusted Origin header rejected by CSRF policy.',
          timestamp: new Date().toISOString(),
        });
        return;
      }
      return next();
    }

    // 2. If Origin is absent, inspect Referer header
    if (referer) {
      try {
        const refererUrl = new URL(referer);
        const refererOrigin = `${refererUrl.protocol}//${refererUrl.host}`;
        if (!isOriginAllowed(refererOrigin, allowedOrigins)) {
          res.status(403).json({
            status: 403,
            code: 'CSRF_INVALID_REFERER',
            message: 'Request blocked: Untrusted Referer header rejected by CSRF policy.',
            timestamp: new Date().toISOString(),
          });
          return;
        }
      } catch {
        res.status(403).json({
          status: 403,
          code: 'CSRF_MALFORMED_REFERER',
          message: 'Request blocked: Malformed Referer header.',
          timestamp: new Date().toISOString(),
        });
        return;
      }
    }

    next();
  };
}

export const validateRequestOrigin = createValidateRequestOrigin();

/**
 * Enforces custom anti-CSRF request header validation on cookie-authenticated state-changing endpoints.
 * Modern browsers disallow setting custom headers across origins without a preflight.
 */
export function requireCsrfHeader(req: Request, res: Response, next: NextFunction): void {
  const requestedWith = req.headers['x-requested-with'];
  const csrfProtection = req.headers['x-csrf-protection'];
  const csrfToken = req.headers['x-csrf-token'];

  const isValidHeader =
    requestedWith === 'XMLHttpRequest' ||
    csrfProtection === '1' ||
    Boolean(csrfToken && typeof csrfToken === 'string' && csrfToken.length >= 8);

  if (!isValidHeader) {
    res.status(403).json({
      status: 403,
      code: 'CSRF_VERIFICATION_FAILED',
      message: 'Missing or invalid anti-CSRF request header (X-Requested-With or X-CSRF-Protection required).',
      timestamp: new Date().toISOString(),
    });
    return;
  }

  next();
}
