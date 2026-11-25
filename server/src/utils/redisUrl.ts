const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/**
 * Returns true strictly for explicitly recognized loopback hostnames.
 */
export function isLoopbackRedisHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.trim().toLowerCase());
}

/**
 * Validates `REDIS_URL` syntax, protocol, hostname, and production TLS policy.
 *
 * Policy:
 * - Only `redis://` and `rediss://` schemes are permitted.
 * - Hostname must be non-empty.
 * - In `NODE_ENV=production`, non-loopback Redis endpoints MUST use `rediss://`.
 *   Plaintext `redis://` in production is permitted ONLY for explicitly recognized
 *   loopback endpoints (`127.0.0.1`, `localhost`, `::1`, `[::1]`).
 * - Never echoes the raw URL in error messages so embedded Redis passwords cannot leak.
 */
export function validateRedisUrl(
  rawUrl: string,
  nodeEnv: 'development' | 'production' | 'test'
): URL {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new Error('CRITICAL: REDIS_URL must not be empty.');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('CRITICAL: REDIS_URL is not a valid URL.');
  }

  if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
    throw new Error('CRITICAL: REDIS_URL must use redis:// or rediss:// scheme.');
  }

  const hostname = parsed.hostname.trim();
  if (!hostname) {
    throw new Error('CRITICAL: REDIS_URL must include a valid hostname.');
  }

  if (nodeEnv === 'production' && parsed.protocol === 'redis:' && !isLoopbackRedisHost(hostname)) {
    throw new Error(
      'CRITICAL: Production REDIS_URL for non-loopback hosts must use TLS (rediss://). Plaintext redis:// in production is permitted only for loopback hosts (127.0.0.1, localhost, ::1).'
    );
  }

  return parsed;
}
