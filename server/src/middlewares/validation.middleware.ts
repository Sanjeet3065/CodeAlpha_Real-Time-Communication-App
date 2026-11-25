import type { Request, Response, NextFunction } from 'express';
import { ZodError, type ZodType } from 'zod';

export function validateBody(schema: ZodType) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      req.body = await schema.parseAsync(req.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const formattedErrors = error.issues.map((issue) => ({
          field: issue.path.map(String).join('.'),
          message: issue.message,
        }));

        res.status(400).json({
          status: 400,
          code: 'VALIDATION_ERROR',
          message: 'The request body failed schema validation.',
          errors: formattedErrors,
          requestId: req.id,
          timestamp: new Date().toISOString(),
        });
        return;
      }
      next(error);
    }
  };
}

export function validateRequest(schemas: {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (schemas.body) {
        req.body = await schemas.body.parseAsync(req.body);
      }
      if (schemas.query) {
        req.query = (await schemas.query.parseAsync(req.query)) as Request['query'];
      }
      if (schemas.params) {
        req.params = (await schemas.params.parseAsync(req.params)) as Request['params'];
      }
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const formattedErrors = error.issues.map((issue) => ({
          field: issue.path.map(String).join('.'),
          message: issue.message,
        }));

        res.status(400).json({
          status: 400,
          code: 'VALIDATION_ERROR',
          message: 'Validation failed for request parameters.',
          errors: formattedErrors,
          requestId: req.id,
          timestamp: new Date().toISOString(),
        });
        return;
      }
      next(error);
    }
  };
}
