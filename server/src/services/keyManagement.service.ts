import { logger } from '../utils/logger.js';
import {
  DEV_FALLBACK_ENCRYPTION_KEY_HEX,
  ENCRYPTION_KEY_PLACEHOLDER_PATTERNS,
} from '../config/secretValidation.js';

export interface KeyRecord {
  version: string;
  key: Buffer;
  createdAt: Date;
}

export interface IKeyProvider {
  getActiveKey(): { version: string; key: Buffer };
  getKey(version: string): Buffer | null;
  hasKey(version: string): boolean;
  getAllVersions(): string[];
  rotateKey(newVersion: string, rawKey: string | Buffer): void;
  assertValid(): void;
}

export class SecurityConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecurityConfigurationError';
  }
}

const PLACEHOLDER_PATTERNS = ENCRYPTION_KEY_PLACEHOLDER_PATTERNS;

/**
 * Normalizes a raw string or buffer into a 32-byte (256-bit) Buffer.
 * Supports 64-character hex strings, 44-character base64 strings, or raw 32-byte buffers.
 */
export function normalizeKey(rawKey: string | Buffer): Buffer {
  if (Buffer.isBuffer(rawKey)) {
    if (rawKey.length !== 32) {
      throw new SecurityConfigurationError(
        `Invalid key length: expected 32 bytes (256 bits), received ${rawKey.length} bytes.`
      );
    }
    return rawKey;
  }

  const trimmed = rawKey.trim();

  // Try 64-char Hex format (32 bytes)
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }

  // Try Base64 format (44 chars for 32 bytes)
  if (/^[A-Za-z0-9+/]{43}=$/.test(trimmed) || /^[A-Za-z0-9+/]{42}==$/.test(trimmed)) {
    const buf = Buffer.from(trimmed, 'base64');
    if (buf.length === 32) return buf;
  }

  // If utf-8 string has exactly 32 bytes
  const utf8Buf = Buffer.from(trimmed, 'utf8');
  if (utf8Buf.length === 32) {
    return utf8Buf;
  }

  throw new SecurityConfigurationError(
    `Invalid key format: expected 256-bit key as 64-char hex, 44-char base64, or 32 raw bytes. Provided length: ${trimmed.length} chars.`
  );
}

/**
 * Environment-based Key Provider supporting versioning, rotation, and production validation.
 */
export class EnvKeyProvider implements IKeyProvider {
  private readonly keys = new Map<string, KeyRecord>();
  private activeVersion: string = 'v1';
  private readonly nodeEnv: string;

  constructor(options?: {
    nodeEnv?: string;
    keys?: Record<string, string | Buffer>;
    activeVersion?: string;
  }) {
    this.nodeEnv = options?.nodeEnv ?? process.env.NODE_ENV ?? 'development';

    if (options?.keys) {
      for (const [ver, val] of Object.entries(options.keys)) {
        this.registerKey(ver, val);
      }
      if (options.activeVersion) {
        const normActive = options.activeVersion.toLowerCase().trim();
        if (!this.keys.has(normActive)) {
          throw new SecurityConfigurationError(
            `Configured active key version '${options.activeVersion}' has no matching key loaded.`
          );
        }
        this.activeVersion = normActive;
      }
    } else {
      this.loadFromEnvironment();
    }
  }

  private registerKey(version: string, rawKey: string | Buffer): void {
    const norm = normalizeKey(rawKey);
    this.keys.set(version, {
      version,
      key: norm,
      createdAt: new Date(),
    });
  }

  private loadFromEnvironment(): void {
    // Scan environment for keys: CONNECTLY_ENCRYPTION_KEY_V1, _V2, etc.
    let foundAny = false;

    // Check specific primary key
    const primaryKey = process.env.CONNECTLY_ENCRYPTION_KEY_V1 || process.env.ENCRYPTION_KEY_V1;
    if (primaryKey) {
      this.registerKey('v1', primaryKey);
      foundAny = true;
    }

    // Check additional versioned keys
    for (const [envVar, value] of Object.entries(process.env)) {
      if (!value) continue;
      const match = /^CONNECTLY_ENCRYPTION_KEY_(V[0-9]+)$/i.exec(envVar);
      if (match) {
        const ver = match[1].toLowerCase();
        this.registerKey(ver, value);
        foundAny = true;
      }
    }

    // Active key override
    const activeEnv = process.env.CONNECTLY_ACTIVE_KEY_VERSION;
    if (activeEnv) {
      const normActive = activeEnv.toLowerCase().trim();
      if (!this.keys.has(normActive)) {
        throw new SecurityConfigurationError(
          `Configured CONNECTLY_ACTIVE_KEY_VERSION '${activeEnv}' has no matching key loaded. Expected CONNECTLY_ENCRYPTION_KEY_${activeEnv.toUpperCase()}.`
        );
      }
      this.activeVersion = normActive;
    } else if (this.keys.size > 0) {
      // Pick highest version
      const sorted = Array.from(this.keys.keys()).sort();
      this.activeVersion = sorted[sorted.length - 1];
    }

    // In development or test, provide a deterministic fallback if no keys configured
    if (!foundAny) {
      if (this.nodeEnv === 'production') {
        throw new SecurityConfigurationError(
          'CRITICAL: Production deployment requires a cryptographically secure 256-bit CONNECTLY_ENCRYPTION_KEY_V1 environment variable.'
        );
      } else {
        // Deterministic development fallback key (never used in production)
        this.registerKey('v1', DEV_FALLBACK_ENCRYPTION_KEY_HEX);
        this.activeVersion = 'v1';
      }
    }
  }

  public assertValid(): void {
    if (this.nodeEnv === 'production') {
      if (this.keys.size === 0) {
        throw new SecurityConfigurationError(
          'CRITICAL: No encryption keys configured in production. CONNECTLY_ENCRYPTION_KEY_V1 is required.'
        );
      }

      for (const [ver, record] of this.keys.entries()) {
        const hex = record.key.toString('hex').toLowerCase();
        const isPlaceholder = PLACEHOLDER_PATTERNS.some((p) => hex.includes(p));
        if (isPlaceholder || hex === DEV_FALLBACK_ENCRYPTION_KEY_HEX || new Set(record.key).size < 4) {
          throw new SecurityConfigurationError(
            `CRITICAL: Production encryption key '${ver}' uses an insecure default, low-entropy, or placeholder value.`
          );
        }
      }
    }
  }

  public getActiveKey(): { version: string; key: Buffer } {
    const record = this.keys.get(this.activeVersion);
    if (!record) {
      throw new SecurityConfigurationError(
        `Active encryption key version '${this.activeVersion}' is not loaded in key provider.`
      );
    }
    return { version: record.version, key: record.key };
  }

  public getKey(version: string): Buffer | null {
    const record = this.keys.get(version);
    return record ? record.key : null;
  }

  public hasKey(version: string): boolean {
    return this.keys.has(version);
  }

  public getAllVersions(): string[] {
    return Array.from(this.keys.keys());
  }

  public rotateKey(newVersion: string, rawKey: string | Buffer): void {
    const normVersion = newVersion.toLowerCase().trim();
    this.registerKey(normVersion, rawKey);
    this.activeVersion = normVersion;
    logger.warn(
      `[KeyManagement] Runtime in-memory key rotation to '${normVersion}'. ` +
        `NOTE: Runtime rotation is transient and will NOT persist across server restarts until ` +
        `CONNECTLY_ENCRYPTION_KEY_${normVersion.toUpperCase()} and CONNECTLY_ACTIVE_KEY_VERSION=${normVersion} are provisioned in persistent configuration.`
    );
  }

  /**
   * Exports loaded keys and active version as environment configuration dictionary
   * for restart-safe persistence in container environment or secrets vault.
   */
  public exportPersistentConfig(): Record<string, string> {
    const config: Record<string, string> = {
      CONNECTLY_ACTIVE_KEY_VERSION: this.activeVersion,
    };
    for (const [ver, record] of this.keys.entries()) {
      config[`CONNECTLY_ENCRYPTION_KEY_${ver.toUpperCase()}`] = record.key.toString('hex');
    }
    return config;
  }
}

/**
 * Cloud KMS Integration Status: NOT IMPLEMENTED (PRODUCTION PREREQUISITE).
 * CONNECTLY currently uses application-level envelope encryption via EnvKeyProvider.
 * Native integration with AWS KMS (GenerateDataKey) or GCP Cloud KMS is a production
 * deployment prerequisite.
 */
export const CLOUD_KMS_STATUS = 'NOT_IMPLEMENTED_PRODUCTION_PREREQUISITE' as const;

/**
 * Cloud KMS Provider Placeholder / Reference Architecture.
 * Explicitly classified as NOT IMPLEMENTED for Phase 15.
 * Fails closed if asserted in production without genuine KMS hardware integration.
 */
export class UnimplementedKmsKeyProvider implements IKeyProvider {
  constructor(
    private readonly kmsKeyArnOrId: string,
    private readonly fallbackProvider: IKeyProvider = keyManager
  ) {}

  public getActiveKey(): { version: string; key: Buffer } {
    return this.fallbackProvider.getActiveKey();
  }

  public getKey(version: string): Buffer | null {
    return this.fallbackProvider.getKey(version);
  }

  public hasKey(version: string): boolean {
    return this.fallbackProvider.hasKey(version);
  }

  public getAllVersions(): string[] {
    return this.fallbackProvider.getAllVersions();
  }

  public rotateKey(newVersion: string, rawKey: string | Buffer): void {
    this.fallbackProvider.rotateKey(newVersion, rawKey);
  }

  public assertValid(): void {
    throw new SecurityConfigurationError(
      `Native Cloud KMS integration (ARN: '${this.kmsKeyArnOrId}') is classified as NOT IMPLEMENTED (PRODUCTION PREREQUISITE). For Phase 15, use EnvKeyProvider with securely provisioned environment secrets.`
    );
  }
}

export const KmsKeyProvider = UnimplementedKmsKeyProvider;

export const keyManager: IKeyProvider = new EnvKeyProvider();
