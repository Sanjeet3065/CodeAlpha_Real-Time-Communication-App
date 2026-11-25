import crypto from 'node:crypto';
import { IKeyProvider, keyManager } from '../services/keyManagement.service.js';
import { securityAudit } from './securityAudit.js';

export const GCM_ALGORITHM = 'aes-256-gcm';
export const GCM_IV_LENGTH = 12; // 96 bits recommended by NIST SP 800-38D
export const GCM_AUTH_TAG_LENGTH = 16; // 128 bits

export class CryptoVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CryptoVerificationError';
  }
}

export class CryptoKeyNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CryptoKeyNotFoundError';
  }
}

export interface EncryptionOptions {
  aad?: string | Buffer;
  keyVersion?: string;
}

export interface DecryptionOptions {
  aad?: string | Buffer;
}

/**
 * Enterprise Application-Level Authenticated Envelope Encryption Engine (AES-256-GCM).
 */
export class EnvelopeEncryptionEngine {
  constructor(private readonly keys: IKeyProvider = keyManager) {}

  /**
   * Encrypts plaintext data into a versioned, authenticated ciphertext string.
   * Format: <version>:<iv_hex>:<auth_tag_hex>:<ciphertext_hex>
   */
  public encrypt(plaintext: string | Buffer, options?: EncryptionOptions): string {
    const active = options?.keyVersion
      ? { version: options.keyVersion, key: this.keys.getKey(options.keyVersion) }
      : this.keys.getActiveKey();

    if (!active.key) {
      throw new CryptoKeyNotFoundError(
        `Encryption key for version '${active.version}' could not be resolved.`
      );
    }

    const plaintextBuf = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext, 'utf8');

    // Generate cryptographically secure unique 12-byte IV/nonce
    const iv = crypto.randomBytes(GCM_IV_LENGTH);

    const cipher = crypto.createCipheriv(GCM_ALGORITHM, active.key, iv, {
      authTagLength: GCM_AUTH_TAG_LENGTH,
    });

    if (options?.aad) {
      const aadBuf = Buffer.isBuffer(options.aad) ? options.aad : Buffer.from(options.aad, 'utf8');
      cipher.setAAD(aadBuf);
    }

    const encrypted = Buffer.concat([cipher.update(plaintextBuf), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const ivHex = iv.toString('hex');
    const tagHex = authTag.toString('hex');
    const ciphertextHex = encrypted.toString('hex');

    return `${active.version}:${ivHex}:${tagHex}:${ciphertextHex}`;
  }

  /**
   * Decrypts an authenticated ciphertext string back into raw Buffer.
   * Throws CryptoVerificationError if authentication tag verification fails (tampering detected).
   */
  public decrypt(serializedCiphertext: string, options?: DecryptionOptions): Buffer {
    if (!serializedCiphertext || typeof serializedCiphertext !== 'string') {
      throw new CryptoVerificationError('Invalid ciphertext: input must be a non-empty string.');
    }

    const parts = serializedCiphertext.split(':');
    if (parts.length !== 4) {
      securityAudit.log({
        eventType: 'CRYPTO_TAMPERING_DETECTED',
        details: { reason: 'Malformed ciphertext format: expected 4 segments.' },
      });
      throw new CryptoVerificationError(
        'Malformed ciphertext: must contain version:iv:tag:ciphertext components.'
      );
    }

    const [version, ivHex, tagHex, ciphertextHex] = parts;

    if (ivHex.length !== GCM_IV_LENGTH * 2) {
      throw new CryptoVerificationError(
        `Invalid IV length: expected ${GCM_IV_LENGTH * 2} hex characters.`
      );
    }

    if (tagHex.length !== GCM_AUTH_TAG_LENGTH * 2) {
      throw new CryptoVerificationError(
        `Invalid auth tag length: expected ${GCM_AUTH_TAG_LENGTH * 2} hex characters.`
      );
    }

    const key = this.keys.getKey(version);
    if (!key) {
      securityAudit.log({
        eventType: 'CRYPTO_AUTH_TAG_FAILED',
        details: { reason: `Key version '${version}' not found in key provider.` },
      });
      throw new CryptoKeyNotFoundError(
        `Decryption failed: encryption key for version '${version}' is not available.`
      );
    }

    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(tagHex, 'hex');
    const ciphertext = Buffer.from(ciphertextHex, 'hex');

    try {
      const decipher = crypto.createDecipheriv(GCM_ALGORITHM, key, iv, {
        authTagLength: GCM_AUTH_TAG_LENGTH,
      });

      decipher.setAuthTag(authTag);

      if (options?.aad) {
        const aadBuf = Buffer.isBuffer(options.aad) ? options.aad : Buffer.from(options.aad, 'utf8');
        decipher.setAAD(aadBuf);
      }

      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return decrypted;
    } catch (err: unknown) {
      securityAudit.log({
        eventType: 'CRYPTO_AUTH_TAG_FAILED',
        details: {
          keyVersion: version,
          error: err instanceof Error ? err.message : String(err),
        },
      });
      throw new CryptoVerificationError(
        'Decryption failed: ciphertext tampering, invalid authentication tag, or corrupted data.'
      );
    }
  }

  /**
   * Decrypts ciphertext and decodes as a UTF-8 string.
   */
  public decryptString(serializedCiphertext: string, options?: DecryptionOptions): string {
    const buf = this.decrypt(serializedCiphertext, options);
    return buf.toString('utf8');
  }

  /**
   * Checks whether a value matches the versioned ciphertext format.
   */
  public isEncrypted(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    // Format: <version>:<24-hex-iv>:<32-hex-tag>:<hex-ciphertext>
    return /^v[0-9]+:[0-9a-fA-F]{24}:[0-9a-fA-F]{32}:[0-9a-fA-F]+$/.test(value);
  }

  /**
   * Migrates a ciphertext record from an older key version to the active key version.
   * If already encrypted with target version, returns without re-encrypting.
   */
  public migrateCiphertext(
    ciphertext: string,
    options?: { aad?: string | Buffer; targetVersion?: string }
  ): string {
    const targetVer = options?.targetVersion ?? this.keys.getActiveKey().version;
    const currentVersion = ciphertext.split(':')[0];

    if (currentVersion === targetVer) {
      return ciphertext;
    }

    const plaintext = this.decrypt(ciphertext, { aad: options?.aad });
    return this.encrypt(plaintext, { aad: options?.aad, keyVersion: targetVer });
  }
}

/**
 * Constant-time comparison of two strings or buffers to prevent timing side-channels.
 */
export function constantTimeCompare(a: string | Buffer, b: string | Buffer): boolean {
  const bufA = Buffer.isBuffer(a) ? a : Buffer.from(a, 'utf8');
  const bufB = Buffer.isBuffer(b) ? b : Buffer.from(b, 'utf8');

  if (bufA.length !== bufB.length) {
    return false;
  }

  return crypto.timingSafeEqual(bufA, bufB);
}

export const cryptoEngine = new EnvelopeEncryptionEngine();
