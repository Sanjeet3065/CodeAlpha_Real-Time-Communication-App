/**
 * Side-effect-free cryptographic secret & key validation helpers shared across
 * env schema validation, key management, and production readiness preflight.
 */

export const DEV_FALLBACK_ENCRYPTION_KEY_HEX =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

export const ENCRYPTION_KEY_PLACEHOLDER_PATTERNS = [
  'replace_with_',
  'your_encryption_key',
  'dev_encryption_key',
  'dummy',
  'example',
  'changeme',
  'secret',
] as const;

export const JWT_PLACEHOLDER_PATTERNS = [
  'dev_access_secret',
  'dev_refresh_secret',
  'connectly_dev_',
  'replace_with_',
  'your_jwt_',
  'your_access_secret',
  'your_refresh_secret',
  'changeme',
  'dummy',
  'example',
] as const;

export interface SecretValidationResult {
  valid: boolean;
  reason?: string;
}

export interface EncryptionKeyValidationResult extends SecretValidationResult {
  keyBuffer?: Buffer;
}

function decodeStrict256BitKey(rawKey: string): Buffer | null {
  const trimmed = rawKey.trim();

  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }

  if (/^(?:[A-Za-z0-9+/]{43}=|[A-Za-z0-9+/]{42}==)$/.test(trimmed)) {
    const decoded = Buffer.from(trimmed, 'base64');
    if (decoded.length === 32) {
      return decoded;
    }
  }

  return null;
}

/**
 * Validates CONNECTLY_ENCRYPTION_KEY_V1 format, placeholders, dev-default exclusion,
 * and minimum byte diversity for 256-bit AES-GCM envelope encryption.
 */
export function validateEncryptionKey(
  rawKey: string | undefined,
  options: { required: boolean; allowDevDefault?: boolean }
): EncryptionKeyValidationResult {
  const trimmed = (rawKey || '').trim();
  if (!trimmed) {
    if (options.required) {
      return {
        valid: false,
        reason:
          'CONNECTLY_ENCRYPTION_KEY_V1 is mandatory in production and must be a valid 256-bit hex (64 chars) or base64 (44 chars) key.',
      };
    }
    return { valid: true };
  }

  const lowerRaw = trimmed.toLowerCase();
  for (const pattern of ENCRYPTION_KEY_PLACEHOLDER_PATTERNS) {
    if (lowerRaw.includes(pattern)) {
      return {
        valid: false,
        reason: `CONNECTLY_ENCRYPTION_KEY_V1 contains insecure placeholder pattern "${pattern}".`,
      };
    }
  }

  const keyBuffer = decodeStrict256BitKey(trimmed);
  if (!keyBuffer) {
    return {
      valid: false,
      reason:
        'CONNECTLY_ENCRYPTION_KEY_V1 must be a valid 256-bit hex (64 hex chars) or base64 (44 chars) key.',
    };
  }

  const normalizedHex = keyBuffer.toString('hex').toLowerCase();
  for (const pattern of ENCRYPTION_KEY_PLACEHOLDER_PATTERNS) {
    if (normalizedHex.includes(pattern)) {
      return {
        valid: false,
        reason: `Decoded CONNECTLY_ENCRYPTION_KEY_V1 matches insecure placeholder pattern "${pattern}".`,
      };
    }
  }

  if (!options.allowDevDefault) {
    if (normalizedHex === DEV_FALLBACK_ENCRYPTION_KEY_HEX) {
      return {
        valid: false,
        reason:
          'Production deployment cannot use the deterministic development fallback encryption key (0123456789abcdef...).',
      };
    }

    if (new Set(keyBuffer).size < 4) {
      return {
        valid: false,
        reason:
          'CONNECTLY_ENCRYPTION_KEY_V1 fails minimum byte entropy requirements (trivial or repeated bytes detected).',
      };
    }
  }

  return { valid: true, keyBuffer };
}

/**
 * Validates JWT_ACCESS_SECRET and JWT_REFRESH_SECRET independently.
 * Strict mode rejects short (< 32 chars), low-entropy, default, and placeholder secrets.
 */
export function validateJwtSecret(
  rawSecret: string | undefined,
  varName: 'JWT_ACCESS_SECRET' | 'JWT_REFRESH_SECRET',
  isStrict: boolean
): SecretValidationResult {
  const trimmed = (rawSecret || '').trim();
  const minLen = isStrict ? 32 : 16;

  if (!trimmed || trimmed.length < minLen) {
    return {
      valid: false,
      reason: `${varName} must be at least ${minLen} characters${isStrict ? ' in production' : ''}.`,
    };
  }

  if (isStrict) {
    const lower = trimmed.toLowerCase();
    for (const pattern of JWT_PLACEHOLDER_PATTERNS) {
      if (lower.includes(pattern)) {
        return {
          valid: false,
          reason: `${varName} contains insecure default or placeholder pattern "${pattern}".`,
        };
      }
    }

    if (new Set(trimmed).size < 8) {
      return {
        valid: false,
        reason: `${varName} lacks sufficient character diversity / entropy for production.`,
      };
    }
  }

  return { valid: true };
}
