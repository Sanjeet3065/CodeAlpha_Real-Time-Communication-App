import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.middleware.js';
import { requireAdmin } from '../middlewares/authorize.js';
import {
  retryEvictionJob,
  listEscalatedJobs,
  listAuditLogs,
} from '../controllers/admin.controller.js';

const router = Router();

// Administrative Eviction & Recovery Management
router.post('/eviction-jobs/:jobId/retry', requireAuth, requireAdmin, retryEvictionJob);
router.get('/eviction-jobs/escalated', requireAuth, requireAdmin, listEscalatedJobs);
router.get('/audit-logs', requireAuth, requireAdmin, listAuditLogs);

export { router as adminRouter };
