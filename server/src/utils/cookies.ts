import type { Response } from 'express';
import { env } from '../config/env.js';

export const REFRESH_COOKIE_NAME = 'connectly_refresh';

export interface RefreshCookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax' | 'strict' | 'none';
  path: string;
  maxAge?: number;
}

export function getRefreshCookieOptions(
  nodeEnv: string = env.NODE_ENV,
  options?: { originAuthMode?: 'proxy' | 'direct'; cookieSameSite?: 'auto' | 'lax' | 'none' }
): RefreshCookieOptions {
  const originMode = options?.originAuthMode ?? env.ORIGIN_AUTH_MODE ?? 'proxy';
  const configuredSameSite = options?.cookieSameSite ?? env.COOKIE_SAME_SITE ?? 'auto';
  const useCrossOriginNone =
    configuredSameSite === 'none' ||
    (configuredSameSite === 'auto' && originMode === 'direct' && nodeEnv === 'production');

  return {
    httpOnly: true,
    secure: nodeEnv === 'production' || useCrossOriginNone,
    sameSite: useCrossOriginNone ? 'none' : 'lax',
    path: '/api',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
  };
}

export function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE_NAME, token, getRefreshCookieOptions());
}

export function clearRefreshCookie(res: Response): void {
  const options = getRefreshCookieOptions();
  delete options.maxAge;
  res.clearCookie(REFRESH_COOKIE_NAME, options);
}
