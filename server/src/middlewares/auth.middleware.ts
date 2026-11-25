import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, type AccessTokenPayload } from '../utils/tokens.js';

declare global {
  namespace Express {
    interface Request {
      user?: AccessTokenPayload;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  try {
    let token: string | undefined;

    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    } else if (req.cookies && req.cookies.connectly_access) {
      token = req.cookies.connectly_access;
    }

    if (!token) {
      res.status(401).json({
        status: 401,
        code: 'UNAUTHORIZED',
        message: 'Authentication required. No authorization token provided.',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const decoded = verifyAccessToken(token);
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'Authentication required. Token is invalid or has expired.',
      timestamp: new Date().toISOString(),
    });
  }
}
