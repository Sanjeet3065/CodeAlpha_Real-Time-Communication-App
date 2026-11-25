import type { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';
import { sanitizeLoggedUrl } from '../utils/urlSanitizer.js';

export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Extract or default status code and code
  let statusCode = err.statusCode || err.status || 500;
  let code = err.code || 'INTERNAL_SERVER_ERROR';
  let message = err.message || 'An unexpected internal server error occurred.';
  const errors = err.errors;

  // Handle Multer upload errors
  if (err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      statusCode = 413;
      code = 'FILE_TOO_LARGE';
      message = `Uploaded file exceeds maximum allowed limit of ${(env.STORAGE_MAX_FILE_SIZE_BYTES / (1024 * 1024)).toFixed(0)} MB.`;
    } else {
      statusCode = 400;
      code = err.code || 'UPLOAD_ERROR';
      message = err.message || 'File upload error occurred.';
    }
  }

  // Handle oversized request payload errors from express.json body-parser limit
  if (err.type === 'entity.too.large' || statusCode === 413) {
    statusCode = 413;
    code = 'PAYLOAD_TOO_LARGE';
    message = 'Request payload exceeds the maximum allowed size limit (100 KB).';
  }

  // Handle MongoDB / Mongoose CastError (e.g. invalid ObjectId format)
  if (err.name === 'CastError') {
    statusCode = 400;
    code = 'INVALID_IDENTIFIER';
    message = `Invalid identifier format for field '${err.path}'.`;
  }

  // Handle MongoDB duplicate key error (code 11000)
  if (err.code === 11000) {
    statusCode = 409;
    code = 'DUPLICATE_RESOURCE';
    const field = Object.keys(err.keyPattern || {})[0] || 'resource';
    message = `A resource with the specified '${field}' already exists.`;
  }

  // Handle JSON parse errors from body-parser
  if (err instanceof SyntaxError && 'body' in err) {
    statusCode = 400;
    code = 'MALFORMED_JSON';
    message = 'The request payload contains malformed JSON syntax.';
  }

  // Structured server-side logging (safe metadata, no credentials)
  logger.error(message, {
    requestId: req.id,
    error: {
      name: err.name,
      message: err.message,
      code,
      statusCode,
    },
    metadata: {
      path: sanitizeLoggedUrl(req.originalUrl || req.url),
      method: req.method,
      ip: req.ip,
    },
  });

  // Safe client response (never leak stack trace)
  res.status(statusCode).json({
    status: statusCode,
    code,
    message,
    ...(errors && errors.length > 0 ? { errors } : {}),
    ...(req.id ? { requestId: req.id } : {}),
    timestamp: new Date().toISOString(),
    ...(env.NODE_ENV === 'development' && statusCode === 500 ? { stack: err.stack } : {}),
  });
}
