import type { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';
import { sanitizeLoggedUrl } from '../utils/urlSanitizer.js';

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = performance.now();

  res.on('finish', () => {
    const durationMs = performance.now() - start;
    logger.http(
      {
        id: req.id,
        method: req.method,
        originalUrl: sanitizeLoggedUrl(req.originalUrl || req.url),
      },
      {
        statusCode: res.statusCode,
      },
      durationMs
    );
  });

  next();
}
