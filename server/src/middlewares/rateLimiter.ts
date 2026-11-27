import type { Request, Response } from 'express';
import rateLimit from 'express-rate-limit';

export function createRateLimitMessage(message: string) {
  return (_req: Request, _res: Response) => ({
    status: 429,
    code: 'RATE_LIMIT_EXCEEDED',
    message,
    timestamp: new Date().toISOString(),
  });
}

export const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // 30 registrations per 15 min per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: createRateLimitMessage(
    'Too many registration requests from this IP. Please try again after 15 minutes.'
  ),
});

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 login attempts per 15 min per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: createRateLimitMessage(
    'Too many login attempts from this IP. Please try again after 15 minutes.'
  ),
});

export const credentialUpdateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 sensitive credential changes per 15 min per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: createRateLimitMessage(
    'Too many credential update attempts. Please try again after 15 minutes.'
  ),
});

export function resetLoginRateLimit(ip = '::ffff:127.0.0.1'): void {
  if (typeof (loginLimiter as any).resetKey === 'function') {
    (loginLimiter as any).resetKey(ip);
    (loginLimiter as any).resetKey('127.0.0.1');
    (loginLimiter as any).resetKey('::1');
  }
}

export const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 60, // 60 refresh attempts per 15 min per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: createRateLimitMessage(
    'Too many token refresh requests from this IP. Please try again after 15 minutes.'
  ),
});

export const meetingCreateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 meeting creations per 15 min per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: createRateLimitMessage('Too many meeting creation requests. Please try again shortly.'),
});

export const meetingActionLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 180, // 180 room management actions per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: createRateLimitMessage('Too many meeting actions in a short period. Please slow down.'),
});

export const livekitTokenLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 60, // 60 LiveKit token requests per 5 min per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: createRateLimitMessage('Too many media token requests. Please wait a moment and try again.'),
});
