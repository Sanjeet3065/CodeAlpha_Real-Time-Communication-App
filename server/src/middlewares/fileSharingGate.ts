import type { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';
import { ForbiddenError } from '../utils/errors.js';

/**
 * CONNECTLY Phase 18 Sprint 02 — File Sharing Feature Gate Middleware
 *
 * Server-side enforcement for the file-sharing feature gate.
 * When file sharing is disabled (ENABLE_FILE_SHARING=false or STORAGE_PROVIDER=disabled),
 * this middleware rejects all incoming requests immediately with HTTP 403 and
 * error code 'FEATURE_DISABLED'.
 *
 * Placing this middleware before Multer upload handlers guarantees that zero disk
 * writes or storage operations occur when file sharing is disabled.
 */
export function requireFileSharingEnabled(
  _req: Request,
  _res: Response,
  next: NextFunction
): void {
  if (!env.ENABLE_FILE_SHARING || env.STORAGE_PROVIDER === 'disabled') {
    throw new ForbiddenError('File sharing is currently disabled', 'FEATURE_DISABLED');
  }
  next();
}
