import type { Request, Response, NextFunction } from 'express';
import { LiveKitEvictionJob } from '../models/LiveKitEvictionJob.model.js';
import { SecurityAuditEntry } from '../models/SecurityAuditEntry.model.js';
import { livekitEvictionWorker } from '../workers/livekitEvictionWorker.js';
import { BadRequestError, NotFoundError } from '../utils/errors.js';

function sendAdminSuccess<T>(req: Request, res: Response, data: T): void {
  res.status(200).json({
    success: true,
    status: 'success',
    data,
    meta: {
      ...(req.id ? { requestId: req.id } : {}),
      timestamp: new Date().toISOString(),
    },
  });
}

export async function retryEvictionJob(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { jobId } = req.params;
    if (!jobId || !/^[a-f0-9]{64}$/i.test(jobId.trim())) {
      throw new BadRequestError('Invalid eviction job identifier.', 'INVALID_JOB_ID');
    }

    const operatorId = req.user?.sub || 'system_admin';
    const result = await livekitEvictionWorker.operatorRetryJob(jobId.trim().toLowerCase(), operatorId);

    if (!result.success) {
      const existing = await LiveKitEvictionJob.findOne({ jobId: jobId.trim().toLowerCase() }).lean();
      if (!existing) {
        throw new NotFoundError('Eviction job not found.', 'JOB_NOT_FOUND');
      }
      throw new BadRequestError(result.message, 'JOB_NOT_RETRYABLE');
    }

    sendAdminSuccess(req, res, {
      jobId: jobId.trim().toLowerCase(),
      message: result.message,
    });
  } catch (err) {
    next(err);
  }
}

export async function listEscalatedJobs(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
    const skip = (page - 1) * limit;

    const [total, jobs] = await Promise.all([
      LiveKitEvictionJob.countDocuments({ status: 'ESCALATED' }),
      LiveKitEvictionJob.find({ status: 'ESCALATED' })
        .sort({ escalatedAt: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    sendAdminSuccess(req, res, {
      total,
      page,
      limit,
      jobs,
    });
  } catch (err) {
    next(err);
  }
}

export async function listAuditLogs(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
    const skip = (page - 1) * limit;

    const query: Record<string, unknown> = {};
    if (req.query.eventType && typeof req.query.eventType === 'string') {
      query.eventType = req.query.eventType.trim();
    }
    if (req.query.jobId && typeof req.query.jobId === 'string') {
      query.jobId = req.query.jobId.trim();
    }
    if (req.query.operatorId && typeof req.query.operatorId === 'string') {
      query.operatorId = req.query.operatorId.trim();
    }

    const [total, entries] = await Promise.all([
      SecurityAuditEntry.countDocuments(query),
      SecurityAuditEntry.find(query)
        .sort({ timestamp: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    sendAdminSuccess(req, res, {
      total,
      page,
      limit,
      entries,
    });
  } catch (err) {
    next(err);
  }
}
