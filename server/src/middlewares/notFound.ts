import type { Request, Response } from 'express';
import { sanitizeLoggedUrl } from '../utils/urlSanitizer.js';

export function notFoundHandler(req: Request, res: Response): void {
  const safePath = sanitizeLoggedUrl(req.originalUrl || req.url);
  res.status(404).json({
    status: 404,
    code: 'NOT_FOUND',
    message: `The requested resource '${req.method} ${safePath}' was not found.`,
    ...(req.id ? { requestId: req.id } : {}),
    timestamp: new Date().toISOString(),
  });
}
