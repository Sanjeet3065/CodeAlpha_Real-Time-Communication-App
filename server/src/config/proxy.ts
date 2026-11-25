import net from 'node:net';

/**
 * CONNECTLY — Express Reverse Proxy Trust Resolver
 * Phase 18 Sprint 06P & Sprint 06R (F-06O-03, F-06Q-02)
 *
 * Determines the exact trusted proxy configuration for Express and rate-limiting.
 *
 * Topology Context:
 * - Direct / Local: Browser -> Node.js (trust proxy: 'loopback' or false)
 * - Single Ingress: Browser -> Koyeb/Render Ingress -> Node.js (trust proxy: 1)
 * - Two-Hop Proxy: Browser -> Cloudflare Worker -> Koyeb Ingress -> Node.js (trust proxy: 2)
 *
 * Security Invariants:
 * - NEVER allow boolean 'true' (trusts all proxies, accepts leftmost spoofed client IP).
 * - Integer N (0..10) trusts N hops from the front-facing proxy, preventing IP spoofing.
 * - Named presets ('loopback', 'uniquelocal', 'linklocal') trust private internal networks.
 * - Strictly validates CIDRs and IP lists; arbitrary strings like 'random_text' are rejected at startup.
 */

export interface TrustProxyValidationResult {
  valid: boolean;
  normalized?: boolean | number | string;
  error?: string;
}

export function validateTrustProxySetting(rawSetting?: string): TrustProxyValidationResult {
  if (!rawSetting || !rawSetting.trim()) {
    return { valid: true, normalized: 'loopback' };
  }

  const trimmed = rawSetting.trim();
  const lower = trimmed.toLowerCase();

  if (lower === 'true') {
    return {
      valid: false,
      error:
        'CRITICAL SECURITY ERROR: Setting TRUST_PROXY to "true" is strictly prohibited because it permits arbitrary client IP spoofing. Configure explicit hop count (e.g. "1" or "2"), subnet preset ("loopback", "uniquelocal"), or "false".',
    };
  }

  if (lower === 'false' || lower === 'none' || lower === '0') {
    return { valid: true, normalized: false };
  }

  // Integer hop count between 0 and 10
  if (/^-?\d+$/.test(trimmed)) {
    const hop = parseInt(trimmed, 10);
    if (hop < 0) {
      return {
        valid: false,
        error: `CRITICAL SECURITY ERROR: Invalid TRUST_PROXY hop count "${trimmed}". Negative hop counts are not permitted.`,
      };
    }
    if (hop > 10) {
      return {
        valid: false,
        error: `CRITICAL SECURITY ERROR: Invalid TRUST_PROXY hop count "${trimmed}". Maximum supported hop count is 10.`,
      };
    }
    return { valid: true, normalized: hop };
  }

  const KNOWN_PRESETS = ['loopback', 'linklocal', 'uniquelocal'];

  // Standard named presets supported by proxy-addr (single preset)
  if (KNOWN_PRESETS.includes(lower)) {
    return { valid: true, normalized: lower };
  }

  // IP address, CIDR, or comma-separated list (can combine presets, IPs, and CIDRs)
  const segments = trimmed.split(',').map((s) => s.trim());
  if (segments.length === 0 || segments.some((s) => s === '')) {
    return {
      valid: false,
      error: `CRITICAL SECURITY ERROR: Malformed TRUST_PROXY CIDR list "${trimmed}". Empty entries or trailing commas are prohibited.`,
    };
  }

  for (const seg of segments) {
    const segLower = seg.toLowerCase();
    if (KNOWN_PRESETS.includes(segLower)) {
      continue;
    }

    const slashIdx = seg.indexOf('/');
    if (slashIdx === -1) {
      // Must be a valid single IP address
      if (net.isIP(seg) === 0) {
        return {
          valid: false,
          error: `CRITICAL SECURITY ERROR: Invalid TRUST_PROXY configuration "${seg}". Must be a valid IP, CIDR subnet, hop count (0-10), or preset ("loopback", "uniquelocal", "linklocal"). Arbitrary strings are strictly prohibited.`,
        };
      }
    } else {
      // Must be a valid CIDR: <ip>/<maskBits>
      const ipPart = seg.slice(0, slashIdx).trim();
      const maskPart = seg.slice(slashIdx + 1).trim();
      const ipVersion = net.isIP(ipPart);

      if (ipVersion === 0) {
        return {
          valid: false,
          error: `CRITICAL SECURITY ERROR: Malformed IP "${ipPart}" in TRUST_PROXY CIDR "${seg}".`,
        };
      }
      if (!/^\d+$/.test(maskPart)) {
        return {
          valid: false,
          error: `CRITICAL SECURITY ERROR: Malformed prefix length in TRUST_PROXY CIDR "${seg}". Prefix must be an integer.`,
        };
      }

      const mask = parseInt(maskPart, 10);
      if (ipVersion === 4 && (mask < 0 || mask > 32)) {
        return {
          valid: false,
          error: `CRITICAL SECURITY ERROR: Invalid IPv4 CIDR prefix "/${maskPart}" in "${seg}". Prefix must be between 0 and 32.`,
        };
      }
      if (ipVersion === 6 && (mask < 0 || mask > 128)) {
        return {
          valid: false,
          error: `CRITICAL SECURITY ERROR: Invalid IPv6 CIDR prefix "/${maskPart}" in "${seg}". Prefix must be between 0 and 128.`,
        };
      }
    }
  }

  return { valid: true, normalized: segments.join(', ') };
}

export function resolveTrustProxy(rawSetting?: string): boolean | number | string {
  const result = validateTrustProxySetting(rawSetting);
  if (!result.valid) {
    throw new Error(result.error!);
  }
  return result.normalized!;
}

// =============================================================================
// PROXY ORIGIN SECRET VALIDATION (Phase 18 Sprint 06R & 06T: F-06S-01, F-06S-02)
// =============================================================================

export interface ProxySecretValidationResult {
  valid: boolean;
  error?: string;
}

export const KNOWN_PROXY_SECRET_PLACEHOLDERS = [
  'replace_with_',
  'your_proxy_secret',
  'changeme',
  'dummy',
  'example',
  'secret',
  'dev_proxy_secret',
];

/**
 * Validates the PROXY_SECRET configuration for Cloudflare Worker to backend origin authentication.
 *
 * Requirements:
 * - Mandatory in production mode (NODE_ENV=production).
 * - Must be non-empty after trimming.
 * - Must be exactly 64 hexadecimal characters representing 256 bits of entropy.
 * - Cannot match known example or template placeholder patterns (case-insensitive).
 *
 * @param secret The configured PROXY_SECRET string.
 * @param isProduction Whether production enforcement is required.
 */
export function validateProxySecret(
  secret?: string,
  isProduction = false
): ProxySecretValidationResult {
  if (!secret || !secret.trim()) {
    if (isProduction) {
      return {
        valid: false,
        error:
          'CRITICAL SECURITY ERROR: PROXY_SECRET is mandatory in production mode. Direct access to backend origin must be blocked.',
      };
    }
    return { valid: true };
  }

  const trimmed = secret.trim();

  // Check known placeholder patterns case-insensitively
  const lower = trimmed.toLowerCase();
  for (const placeholder of KNOWN_PROXY_SECRET_PLACEHOLDERS) {
    if (lower.includes(placeholder)) {
      return {
        valid: false,
        error: `CRITICAL SECURITY ERROR: PROXY_SECRET contains known placeholder pattern "${placeholder}". Production deployment requires a cryptographically random 64-hex secret (generate with: openssl rand -hex 32).`,
      };
    }
  }

  // Exact 64-character hexadecimal check
  if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return {
      valid: false,
      error: `CRITICAL SECURITY ERROR: PROXY_SECRET must be exactly 64 hexadecimal characters representing 256 bits of entropy (received ${trimmed.length} characters). Generate with: openssl rand -hex 32.`,
    };
  }

  return { valid: true };
}
