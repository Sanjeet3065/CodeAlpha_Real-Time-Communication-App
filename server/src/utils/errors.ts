export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly isOperational: boolean;
  public readonly errors?: Array<{ field: string; message: string }>;

  constructor(
    message: string,
    statusCode = 500,
    code = 'INTERNAL_SERVER_ERROR',
    isOperational = true,
    errors?: Array<{ field: string; message: string }>
  ) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;
    this.errors = errors;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad Request', code = 'BAD_REQUEST', errors?: Array<{ field: string; message: string }>) {
    super(message, 400, code, true, errors);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed', errors?: Array<{ field: string; message: string }>) {
    super(message, 400, 'VALIDATION_ERROR', true, errors);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required', code = 'UNAUTHORIZED') {
    super(message, 401, code, true);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Access forbidden', code = 'FORBIDDEN') {
    super(message, 403, code, true);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'The requested resource was not found', code = 'NOT_FOUND') {
    super(message, 404, code, true);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Resource conflict', code = 'CONFLICT') {
    super(message, 409, code, true);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service unavailable', code = 'SERVICE_UNAVAILABLE') {
    super(message, 503, code, true);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = 'Too many requests, please try again later', code = 'RATE_LIMIT_EXCEEDED') {
    super(message, 429, code, true);
  }
}
