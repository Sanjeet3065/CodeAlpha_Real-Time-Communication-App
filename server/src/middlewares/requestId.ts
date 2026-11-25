import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';

declare global {
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}

// Strictly allow alphanumeric, hyphen, underscore, and dot, 1 to 64 chars.
// Prevents log injection (CRLF), control character injection, and header memory bloat.
const SAFE_REQUEST_ID_REGEX = /^[a-zA-Z0-9_\-.]{1,64}$/;

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incomingId = req.headers['x-request-id'];
  let requestId: string;

  if (typeof incomingId === 'string') {
    const trimmed = incomingId.trim();
    if (SAFE_REQUEST_ID_REGEX.test(trimmed)) {
      requestId = trimmed;
    } else {
      // Discard invalid / malicious / excessive client ID and replace with secure UUID
      requestId = randomUUID();
    }
  } else {
    requestId = randomUUID();
  }

  req.id = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
}
