import type { Response } from 'express';

export interface ApiResponseSuccess<T> {
  success: true;
  data: T;
  meta?: {
    requestId?: string;
    timestamp: string;
    [key: string]: any;
  };
}

export interface ApiResponseError {
  status: number;
  code: string;
  message: string;
  errors?: Array<{ field: string; message: string }>;
  requestId?: string;
  timestamp: string;
}

export function sendSuccess<T>(
  res: Response,
  data: T,
  statusCode = 200,
  meta?: Record<string, any>
): Response {
  const req = (res as any).req;
  const requestId = req?.id;

  const payload: ApiResponseSuccess<T> = {
    success: true,
    data,
    meta: {
      ...(requestId ? { requestId } : {}),
      timestamp: new Date().toISOString(),
      ...(meta || {}),
    },
  };

  return res.status(statusCode).json(payload);
}
