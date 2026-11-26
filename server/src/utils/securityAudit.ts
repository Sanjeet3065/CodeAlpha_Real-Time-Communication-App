import crypto from 'node:crypto';
import mongoose from 'mongoose';
import {
  SecurityAuditEntry,
  type SecurityAuditOutcome,
  type ISecurityAuditEntry,
} from '../models/SecurityAuditEntry.model.js';
import { isDatabaseConnected } from '../config/database.js';
import { isSupabaseActive } from '../config/supabase.js';
import { logger } from './logger.js';

/**
 * Security Audit Logging Architecture (DEF-15-06 & Sprint 06D Hardening):
 * - Primary Persistence: Durable append-only storage in MongoDB `security_audit_entries`
 *   with queryable indexes (eventType, operatorId, jobId, timestamp) and 90-day TTL retention.
 * - Real-Time Observability: Structured JSON logging to stdout/stderr with deep credential redaction.
 * - Test & Diagnostic Cache: In-memory ring buffer (up to 1000 events) for fast query assertions.
 *
 * CRITICAL ARCHITECTURAL CLASSIFICATION:
 * - Application-tier persistence is backed by MongoDB.
 * - Cloud-tier immutability and long-term compliance depend on external infrastructure
 *   (e.g., AWS CloudWatch Log Groups with object lock, Datadog log archive).
 */
export const AUDIT_LOGGER_INTEGRITY_CLASSIFICATION =
  'STRUCTURED_JSON_EXTERNAL_INFRASTRUCTURE_PREREQUISITE' as const;

export const DURABLE_AUDIT_LOGGER_CLASSIFICATION =
  'DURABLE_MONGODB_AND_STRUCTURED_JSON_EXTERNAL_STREAM' as const;

export type SecurityEventType =
  | 'AUTH_LOGIN_SUCCESS'
  | 'AUTH_LOGIN_FAILURE'
  | 'AUTH_ACCOUNT_LOCKED'
  | 'AUTH_TOKEN_ROTATION'
  | 'AUTH_TOKEN_REUSE_DETECTED'
  | 'AUTH_SESSION_REVOKED'
  | 'AUTH_TIMING_DEFENSE_TRIGGERED'
  | 'CRYPTO_AUTH_TAG_FAILED'
  | 'CRYPTO_KEY_ROTATED'
  | 'CRYPTO_TAMPERING_DETECTED'
  | 'MEETING_ACCESS_DENIED'
  | 'MEETING_WAITING_ROOM_ISOLATION'
  | 'MEETING_PARTICIPANT_EVICTED'
  | 'FILE_SECURITY_REJECTION'
  | 'FILE_UNAUTHORIZED_DOWNLOAD'
  | 'LIVEKIT_GATEWAY_BLOCKED'
  | 'RATE_LIMIT_TRIGGERED'
  | 'EVICTION_OPERATOR_RETRY'
  | 'EVICTION_JOB_ESCALATED';

export type SecuritySeverity = 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';

export interface SecurityAuditEvent {
  id: string;
  timestamp: string;
  eventType: SecurityEventType;
  severity: SecuritySeverity;
  userId?: string;
  operatorId?: string;
  jobId?: string;
  meetingId?: string;
  ip?: string;
  userAgent?: string;
  action?: string;
  resourceId?: string;
  outcome?: SecurityAuditOutcome;
  details?: Record<string, unknown>;
  correlationId?: string;
}

export interface SecurityAuditLogParams {
  eventType: SecurityEventType;
  severity?: SecuritySeverity;
  userId?: string;
  operatorId?: string;
  jobId?: string;
  meetingId?: string;
  ip?: string;
  userAgent?: string;
  action?: string;
  resourceId?: string;
  outcome?: SecurityAuditOutcome;
  details?: Record<string, unknown>;
  correlationId?: string;
}

const JWT_PATTERN = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/;
const HEX64_PATTERN = /^[0-9a-fA-F]{64}$/;
const SENSITIVE_VALUE_PATTERN =
  /^(Bearer\s+[A-Za-z0-9._~+/-]+=*|sk_[a-zA-Z0-9_-]+|pk_[a-zA-Z0-9_-]+|ghp_[a-zA-Z0-9]+|secret_[a-zA-Z0-9_-]+|[0-9a-fA-F]{32,63})$/i;

/**
 * Normalizes an object property key across camelCase, snake_case, kebab-case, and dot-notation
 * to lowercase alphanumeric characters.
 */
export function normalizeKey(key: string): string {
  if (!key || typeof key !== 'string') return '';
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Returns true if the key is strictly an exact match for 'jobId', case-insensitively.
 * F-06K-01 / Sprint 06L: Punctuation-stripping normalization (normalizeKey) is deliberately NOT used
 * here so that delimited variants like 'job-id', 'job_id', and 'job.id' are NOT treated as jobId.
 */
export function isExactJobIdKey(key: string): boolean {
  if (!key || typeof key !== 'string') return false;
  return key.toLowerCase() === 'jobid';
}

/**
 * Robust sensitive property name detector (Sprint 06J / F-06I-01).
 * Detects sensitive credential keys regardless of casing, camelCase, snake_case,
 * kebab-case, prefixes, or suffixes.
 *
 * Recognized sensitive property stems include:
 * - password, passwd, pwd, passphrase
 * - secret, clientsecret, apisecret, sharedsecret
 * - token, refreshtoken, accesstoken, jwttoken, authtoken, bearertoken
 * - apikey, privatekey, secretkey, signingkey, encryptionkey, cryptokey, clientkey, accesskey
 * - jwt
 * - cookie, sessioncookie, authcookie
 * - authorization, authorisation, authheader
 * - credential, credentials
 * - session, sessiontoken, sessionsecret, sessionkey, sessiondata
 * - key (standalone 'key', or compound ending in 'key' / key-prefix like keyid, keypair)
 */
export function isSensitiveKey(rawKey: string): boolean {
  if (!rawKey || typeof rawKey !== 'string') return false;
  const normalized = normalizeKey(rawKey);
  if (!normalized) return false;

  // Stems that indicate sensitive credential material anywhere in a compound key name
  const SENSITIVE_SUBSTRINGS = [
    'password',
    'passwd',
    'passphrase',
    'secret',
    'token',
    'apikey',
    'privatekey',
    'jwt',
    'cookie',
    'authorization',
    'authorisation',
    'credential',
    'refreshtoken',
    'accesstoken',
    'authheader',
  ];

  for (const stem of SENSITIVE_SUBSTRINGS) {
    if (normalized.includes(stem)) return true;
  }

  // Auth variations: authheader, authtoken, authkey, authsecret, exact 'auth'
  if (/^auth(header|token|key|secret|cookie|code)?$/i.test(normalized)) {
    return true;
  }

  // Session variations: exact 'session', sessioncookie, sessiontoken, sessionsecret, sessionkey
  if (
    normalized === 'session' ||
    normalized.includes('sessioncookie') ||
    normalized.includes('sessiontoken') ||
    normalized.includes('sessionsecret') ||
    normalized.includes('sessionkey') ||
    normalized.includes('sessiondata')
  ) {
    return true;
  }

  // Key variations: exact 'key', or credential key combinations (e.g. apikey, secretkey, privatekey, clientkey, signingkey, encryptionkey),
  // or compound starting with 'key' (e.g. keyid, keypair, keydata, keysecret)
  if (normalized === 'key') {
    return true;
  }

  const CREDENTIAL_KEY_STEMS = [
    'apikey',
    'secretkey',
    'privatekey',
    'clientkey',
    'signingkey',
    'encryptionkey',
    'cryptokey',
    'accesskey',
    'authkey',
    'sessionkey',
    'consumerkey',
    'masterkey',
    'tokenkey',
  ];

  for (const credStem of CREDENTIAL_KEY_STEMS) {
    if (normalized.includes(credStem)) {
      return true;
    }
  }

  if (/^key(id|pair|data|secret|spec|material)$/i.test(normalized)) {
    return true;
  }

  // Pwd abbreviation: user_pwd, db_pwd, pwd
  if (/(^|[^a-z])pwd($|[^a-z])/i.test(rawKey) || normalized.includes('pwd')) {
    return true;
  }

  return false;
}

/**
 * Deep redaction filter that recursively removes sensitive secrets, keys, and tokens
 * from structured log payloads.
 *
 * Sprint 06J (F-06I-01): Comprehensive compound-key sensitive property redaction.
 * Normalizes property keys across camelCase, snake_case, kebab-case, uppercase/lowercase,
 * and prefixes/suffixes. Sensitive parent objects never expose child values.
 * Legitimate 64-hex jobId is preserved ONLY if the key is exactly 'jobId' after normalization,
 * and sensitive-key checks strictly take priority over the jobId exception.
 */
export function sanitizePayload<T>(input: T, currentKey?: string): T {
  if (input === null || input === undefined) {
    return input;
  }

  // If the current property key is sensitive, the entire value (object, array, or primitive) is redacted immediately.
  // Sensitive-key rules take strict priority over any jobId exception or child content.
  if (currentKey !== undefined && isSensitiveKey(currentKey)) {
    return '[REDACTED]' as unknown as T;
  }

  if (typeof input === 'string') {
    // 1. JWT tokens are strictly redacted regardless of property key
    if (JWT_PATTERN.test(input)) {
      return '[REDACTED]' as unknown as T;
    }

    // 2. Obvious secret-like values (API keys, bearer tokens, 32-63 hex hashes) are redacted
    if (SENSITIVE_VALUE_PATTERN.test(input)) {
      return '[REDACTED]' as unknown as T;
    }

    // 3. F-06G-03 & F-06I-01: Case-insensitive exact 'jobId' property matching.
    // Preserve ONLY when the key is exactly 'jobId' (case-insensitively, after normalization)
    // AND the key itself is NOT sensitive AND the value is valid 64-hex SHA-256.
    const isJobId = currentKey !== undefined && isExactJobIdKey(currentKey);
    if (isJobId) {
      if (HEX64_PATTERN.test(input)) {
        return input;
      }
      return '[REDACTED]' as unknown as T;
    }

    // 4. Any 64-hex string under any other key (or non-jobId key) is strictly redacted
    if (HEX64_PATTERN.test(input)) {
      return '[REDACTED]' as unknown as T;
    }

    return input;
  }

  if (Array.isArray(input)) {
    return input.map((item) => sanitizePayload(item, currentKey)) as unknown as T;
  }

  if (typeof input === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (isSensitiveKey(key)) {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = sanitizePayload(value, key);
      }
    }
    return sanitized as unknown as T;
  }

  return input;
}

export class SecurityAuditLogger {
  private readonly events: SecurityAuditEvent[] = [];
  private readonly maxInMemoryEvents = 1000;

  private formatEvent(params: SecurityAuditLogParams): SecurityAuditEvent {
    const defaultSeverity: Record<SecurityEventType, SecuritySeverity> = {
      AUTH_LOGIN_SUCCESS: 'INFO',
      AUTH_LOGIN_FAILURE: 'WARN',
      AUTH_ACCOUNT_LOCKED: 'CRITICAL',
      AUTH_TOKEN_ROTATION: 'INFO',
      AUTH_TOKEN_REUSE_DETECTED: 'CRITICAL',
      AUTH_SESSION_REVOKED: 'WARN',
      AUTH_TIMING_DEFENSE_TRIGGERED: 'WARN',
      CRYPTO_AUTH_TAG_FAILED: 'CRITICAL',
      CRYPTO_KEY_ROTATED: 'INFO',
      CRYPTO_TAMPERING_DETECTED: 'CRITICAL',
      MEETING_ACCESS_DENIED: 'WARN',
      MEETING_WAITING_ROOM_ISOLATION: 'INFO',
      MEETING_PARTICIPANT_EVICTED: 'WARN',
      FILE_SECURITY_REJECTION: 'ERROR',
      FILE_UNAUTHORIZED_DOWNLOAD: 'WARN',
      LIVEKIT_GATEWAY_BLOCKED: 'WARN',
      RATE_LIMIT_TRIGGERED: 'WARN',
      EVICTION_OPERATOR_RETRY: 'WARN',
      EVICTION_JOB_ESCALATED: 'CRITICAL',
    };

    const sanitizedDetails = params.details ? sanitizePayload(params.details) : undefined;
    const resolvedOperatorId =
      params.operatorId || (params.details?.operatorId as string) || (params.eventType === 'EVICTION_OPERATOR_RETRY' ? params.userId : undefined);
    const resolvedJobId =
      params.jobId || (params.details?.jobId as string) || params.resourceId;

    return {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      eventType: params.eventType,
      severity: params.severity ?? defaultSeverity[params.eventType] ?? 'INFO',
      userId: params.userId,
      operatorId: resolvedOperatorId,
      jobId: resolvedJobId,
      meetingId: params.meetingId,
      ip: params.ip,
      userAgent: params.userAgent,
      action: params.action,
      resourceId: params.resourceId,
      outcome: params.outcome ?? (params.severity === 'CRITICAL' ? 'ESCALATED' : 'SUCCESS'),
      details: sanitizedDetails,
      correlationId: params.correlationId,
    };
  }

  private emitStdout(event: SecurityAuditEvent): void {
    const logOutput = JSON.stringify({
      logType: 'SECURITY_AUDIT',
      ...event,
    });

    if (event.severity === 'CRITICAL' || event.severity === 'ERROR') {
      console.error(logOutput);
    } else if (event.severity === 'WARN') {
      console.warn(logOutput);
    } else {
      console.log(logOutput);
    }
  }

  private async persistToMongo(
    event: SecurityAuditEvent,
    options?: { session?: mongoose.ClientSession }
  ): Promise<void> {
    if (!isDatabaseConnected() && !(isSupabaseActive() || mongoose.connection?.readyState === 1)) {
      throw new Error('Database is not connected');
    }

    try {
      const payload = {
        eventId: event.id,
        timestamp: new Date(event.timestamp),
        eventType: event.eventType,
        severity: event.severity,
        userId: event.userId || null,
        operatorId: event.operatorId || null,
        jobId: event.jobId || null,
        meetingId: event.meetingId || null,
        action: event.action || null,
        outcome: event.outcome || 'INFO',
        ip: event.ip || null,
        userAgent: event.userAgent || null,
        details: event.details || null,
      };

      if (isSupabaseActive()) {
        await SecurityAuditEntry.create(payload);
        return;
      }

      const doc = new SecurityAuditEntry(payload);

      await doc.save(options?.session ? { session: options.session } : undefined);
    } catch (dbErr) {
      logger.error('[SecurityAudit] Failed to persist security audit event to database', {
        metadata: {
          eventId: event.id,
          eventType: event.eventType,
          error: dbErr instanceof Error ? dbErr.message : String(dbErr),
        },
      });
      throw dbErr;
    }
  }

  /**
   * Synchronous log interface: writes to in-memory buffer and stdout,
   * while initiating durable MongoDB persistence asynchronously in the background.
   * Swallows database errors so non-critical diagnostic callers are not disrupted.
   */
  public log(params: SecurityAuditLogParams): SecurityAuditEvent {
    const event = this.formatEvent(params);

    // 1. In-memory ring buffer
    this.events.push(event);
    if (this.events.length > this.maxInMemoryEvents) {
      this.events.shift();
    }

    // 2. Structured JSON stdout output
    this.emitStdout(event);

    // 3. Asynchronous MongoDB persistence (swallowed for background fire-and-forget telemetry)
    this.persistToMongo(event).catch(() => {});

    return event;
  }

  /**
   * Asynchronous log interface: writes to in-memory buffer, stdout,
   * and awaits confirmed MongoDB database persistence.
   *
   * F-06E-02: Failure-aware and transaction-capable. Supports passing a MongoDB
   * ClientSession for atomic commits with job state mutations. Throws if persistence fails.
   */
  public async logAsync(
    params: SecurityAuditLogParams,
    options?: { session?: mongoose.ClientSession }
  ): Promise<SecurityAuditEvent> {
    const event = this.formatEvent(params);

    // 1. In-memory ring buffer
    this.events.push(event);
    if (this.events.length > this.maxInMemoryEvents) {
      this.events.shift();
    }

    // 2. Structured JSON stdout output
    this.emitStdout(event);

    // 3. Await confirmed MongoDB persistence with optional transaction session
    await this.persistToMongo(event, options);

    return event;
  }

  /**
   * Convenience alias for log() complying with audit interface specifications.
   */
  public record(params: SecurityAuditLogParams): SecurityAuditEvent {
    return this.log(params);
  }

  /**
   * Convenience alias for logAsync() complying with audit interface specifications.
   */
  public async recordAsync(
    params: SecurityAuditLogParams,
    options?: { session?: mongoose.ClientSession }
  ): Promise<SecurityAuditEvent> {
    return this.logAsync(params, options);
  }

  /**
   * Synchronous query over in-memory diagnostic buffer.
   */
  public query(filter?: {
    eventType?: SecurityEventType;
    userId?: string;
    operatorId?: string;
    jobId?: string;
    meetingId?: string;
    severity?: SecuritySeverity;
    since?: Date;
  }): SecurityAuditEvent[] {
    return this.events.filter((evt) => {
      if (filter?.eventType && evt.eventType !== filter.eventType) return false;
      if (filter?.userId && evt.userId !== filter.userId) return false;
      if (filter?.operatorId && evt.operatorId !== filter.operatorId) return false;
      if (filter?.jobId && evt.jobId !== filter.jobId) return false;
      if (filter?.meetingId && evt.meetingId !== filter.meetingId) return false;
      if (filter?.severity && evt.severity !== filter.severity) return false;
      if (filter?.since && new Date(evt.timestamp) < filter.since) return false;
      return true;
    });
  }

  /**
   * Asynchronous query over durable MongoDB persistence.
   * Survives server restarts and scales across multiple instances.
   */
  public async queryPersistent(filter?: {
    eventType?: SecurityEventType;
    userId?: string;
    operatorId?: string;
    jobId?: string;
    meetingId?: string;
    severity?: SecuritySeverity;
    since?: Date;
    limit?: number;
    skip?: number;
  }): Promise<ISecurityAuditEntry[]> {
    if (!isDatabaseConnected() && mongoose.connection?.readyState !== 1) {
      return [];
    }

    const query: Record<string, unknown> = {};
    if (filter?.eventType) query.eventType = filter.eventType;
    if (filter?.userId) query.userId = filter.userId;
    if (filter?.operatorId) query.operatorId = filter.operatorId;
    if (filter?.jobId) query.jobId = filter.jobId;
    if (filter?.meetingId) query.meetingId = filter.meetingId;
    if (filter?.severity) query.severity = filter.severity;
    if (filter?.since) query.timestamp = { $gte: filter.since };

    const limit = Math.min(100, Math.max(1, filter?.limit ?? 50));
    const skip = Math.max(0, filter?.skip ?? 0);

    return SecurityAuditEntry.find(query)
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit)
      .lean() as unknown as Promise<ISecurityAuditEntry[]>;
  }

  public clear(): void {
    this.events.length = 0;
  }
}

export const securityAudit = new SecurityAuditLogger();
