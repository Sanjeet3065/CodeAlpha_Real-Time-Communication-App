export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

const SENSITIVE_KEYS = new Set([
  'password',
  'passwordhash',
  'token',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'cookie',
  'secret',
  'jwt_access_secret',
  'jwt_refresh_secret',
  'credentials',
]);

function sanitizeData(data: any): any {
  if (data === null || data === undefined) return data;
  if (typeof data !== 'object') return data;

  if (Array.isArray(data)) {
    return data.map(sanitizeData);
  }

  const sanitized: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeData(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

export interface StructuredLogEntry {
  timestamp: string;
  level: LogLevel;
  requestId?: string;
  message: string;
  method?: string;
  path?: string;
  statusCode?: number;
  durationMs?: number;
  metadata?: any;
}

function formatLog(entry: StructuredLogEntry): string {
  // eslint-disable-next-line no-control-regex
  const safeReqId = entry.requestId ? entry.requestId.replace(/[\r\n\x00-\x1f\x7f]/g, '') : '';
  const safeMessage = entry.message ? entry.message.replace(/[\r\n]/g, ' ') : '';
  const metaStr = entry.metadata ? ` ${JSON.stringify(sanitizeData(entry.metadata))}` : '';
  const reqStr = safeReqId ? ` [req:${safeReqId}]` : '';
  const httpStr = entry.method && entry.path ? ` ${entry.method} ${entry.path}` : '';
  const statusStr = entry.statusCode ? ` -> ${entry.statusCode}` : '';
  const durStr = entry.durationMs !== undefined ? ` (${entry.durationMs.toFixed(2)}ms)` : '';

  return `[${entry.timestamp}] [${entry.level.toUpperCase()}]${reqStr}${httpStr}${statusStr} ${safeMessage}${durStr}${metaStr}`;
}

export const logger = {
  info(message: string, context?: { requestId?: string; metadata?: any; [key: string]: any }): void {
    const entry: StructuredLogEntry = {
      timestamp: new Date().toISOString(),
      level: 'info',
      requestId: context?.requestId,
      message,
      metadata: context?.metadata,
    };
    console.log(formatLog(entry));
  },

  warn(message: string, context?: { requestId?: string; metadata?: any; [key: string]: any }): void {
    const entry: StructuredLogEntry = {
      timestamp: new Date().toISOString(),
      level: 'warn',
      requestId: context?.requestId,
      message,
      metadata: context?.metadata,
    };
    console.warn(formatLog(entry));
  },

  error(message: string, context?: { requestId?: string; metadata?: any; error?: any; [key: string]: any }): void {
    const safeError = context?.error
      ? {
          name: context.error.name,
          message: context.error.message,
          code: context.error.code,
        }
      : undefined;

    const entry: StructuredLogEntry = {
      timestamp: new Date().toISOString(),
      level: 'error',
      requestId: context?.requestId,
      message,
      metadata: { ...(context?.metadata || {}), ...(safeError ? { error: safeError } : {}) },
    };
    console.error(formatLog(entry));
  },

  debug(message: string, context?: { requestId?: string; metadata?: any; [key: string]: any }): void {
    if (process.env.NODE_ENV !== 'production') {
      const entry: StructuredLogEntry = {
        timestamp: new Date().toISOString(),
        level: 'debug',
        requestId: context?.requestId,
        message,
        metadata: context?.metadata,
      };
      console.debug(formatLog(entry));
    }
  },

  http(req: { id?: string; method: string; originalUrl: string }, res: { statusCode: number }, durationMs: number): void {
    const entry: StructuredLogEntry = {
      timestamp: new Date().toISOString(),
      level: res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
      requestId: req.id,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs,
      message: 'HTTP Request completed',
    };
    if (entry.level === 'error') {
      console.error(formatLog(entry));
    } else if (entry.level === 'warn') {
      console.warn(formatLog(entry));
    } else {
      console.log(formatLog(entry));
    }
  },
};
