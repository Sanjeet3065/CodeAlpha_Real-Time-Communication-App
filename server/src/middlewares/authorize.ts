import type { Request, Response, NextFunction } from 'express';
import { ForbiddenError, UnauthorizedError } from '../utils/errors.js';
import { User } from '../models/User.model.js';

export function requireOwnership(paramName = 'userId') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user || !req.user.sub) {
      throw new UnauthorizedError('Authentication required to verify ownership.');
    }

    const targetUserId = req.params[paramName];
    if (targetUserId && targetUserId !== req.user.sub) {
      throw new ForbiddenError(
        'Cross-user resource access denied: You are not authorized to view or mutate another user data.',
        'FORBIDDEN'
      );
    }

    next();
  };
}

export async function requireAdmin(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || !req.user.sub) {
      throw new UnauthorizedError('Authentication required for administrative operations.');
    }

    // Fast path: checked from validated token payload
    if (req.user.role === 'admin') {
      return next();
    }

    // Authoritative fallback: verify in database
    const user = await User.findById(req.user.sub).select('role').lean();
    if (!user || user.role !== 'admin') {
      throw new ForbiddenError(
        'Administrative privileges required for this operation.',
        'FORBIDDEN'
      );
    }

    next();
  } catch (err) {
    next(err);
  }
}
