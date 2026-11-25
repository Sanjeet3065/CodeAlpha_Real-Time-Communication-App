import mongoose, { Schema, Document, Model } from 'mongoose';
import type { SecurityEventType, SecuritySeverity } from '../utils/securityAudit.js';

export type SecurityAuditOutcome = 'SUCCESS' | 'FAILURE' | 'ESCALATED' | 'DENIED' | 'INFO';

export interface ISecurityAuditEntry extends Document {
  eventId: string;
  timestamp: Date;
  eventType: SecurityEventType;
  severity: SecuritySeverity;
  userId?: string | null;
  operatorId?: string | null;
  jobId?: string | null;
  meetingId?: string | null;
  action?: string | null;
  outcome: SecurityAuditOutcome;
  ip?: string | null;
  userAgent?: string | null;
  details?: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

const SecurityAuditEntrySchema = new Schema<ISecurityAuditEntry>(
  {
    eventId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    timestamp: {
      type: Date,
      required: true,
      default: Date.now,
    },
    eventType: {
      type: String,
      required: true,
      trim: true,
    },
    severity: {
      type: String,
      required: true,
      enum: ['INFO', 'WARN', 'ERROR', 'CRITICAL'],
      default: 'INFO',
    },
    userId: {
      type: String,
      default: null,
      trim: true,
    },
    operatorId: {
      type: String,
      default: null,
      trim: true,
    },
    jobId: {
      type: String,
      default: null,
      trim: true,
    },
    meetingId: {
      type: String,
      default: null,
      trim: true,
    },
    action: {
      type: String,
      default: null,
      trim: true,
    },
    outcome: {
      type: String,
      required: true,
      enum: ['SUCCESS', 'FAILURE', 'ESCALATED', 'DENIED', 'INFO'],
      default: 'INFO',
    },
    ip: {
      type: String,
      default: null,
      trim: true,
    },
    userAgent: {
      type: String,
      default: null,
      trim: true,
    },
    details: {
      type: Schema.Types.Mixed,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    collection: 'security_audit_entries',
  }
);

// Compound and single-field indexes for administrative and operational queries
SecurityAuditEntrySchema.index({ eventType: 1, timestamp: -1 });
SecurityAuditEntrySchema.index({ jobId: 1, timestamp: -1 });
SecurityAuditEntrySchema.index({ operatorId: 1, timestamp: -1 });
SecurityAuditEntrySchema.index({ userId: 1, timestamp: -1 });

// Safe 90-day retention policy via TTL index on createdAt
SecurityAuditEntrySchema.index({ createdAt: 1 }, { expireAfterSeconds: 7776000 });

export const SecurityAuditEntry: Model<ISecurityAuditEntry> =
  mongoose.models.SecurityAuditEntry ||
  mongoose.model<ISecurityAuditEntry>('SecurityAuditEntry', SecurityAuditEntrySchema);

export async function ensureSecurityAuditReady(): Promise<void> {
  if (mongoose.connection.readyState === 1) {
    await SecurityAuditEntry.init().catch(() => {});
  }
}
