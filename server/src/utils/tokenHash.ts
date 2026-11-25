import crypto from 'node:crypto';

/**
 * Creates a deterministic SHA-256 hash of a bearer token for safe storage at rest.
 * Prevents bearer token leakage if database records are read or compromised.
 */
export function hashBearerToken(rawToken: string): string {
  if (!rawToken || typeof rawToken !== 'string') {
    throw new Error('hashBearerToken requires a non-empty string token.');
  }
  return crypto.createHash('sha256').update(rawToken.trim()).digest('hex');
}

/**
 * Constant-time comparison between a candidate raw token and a stored token hash or token.
 */
export function verifyBearerToken(rawToken: string, storedHashOrToken: string): boolean {
  if (!rawToken || !storedHashOrToken) return false;
  const candidateHash = hashBearerToken(rawToken);

  // If stored value is already a 64-char hex string (SHA-256 hash)
  if (/^[0-9a-fA-F]{64}$/.test(storedHashOrToken)) {
    const candidateBuf = Buffer.from(candidateHash, 'hex');
    const storedBuf = Buffer.from(storedHashOrToken, 'hex');
    return crypto.timingSafeEqual(candidateBuf, storedBuf);
  }

  // Backward-compatibility: if stored value is legacy plaintext
  const rawBuf = Buffer.from(rawToken, 'utf8');
  const storedBuf = Buffer.from(storedHashOrToken, 'utf8');
  if (rawBuf.length !== storedBuf.length) return false;
  return crypto.timingSafeEqual(rawBuf, storedBuf);
}
