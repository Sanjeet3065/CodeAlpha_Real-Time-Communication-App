import type { CspConfigInput } from './csp.types.js';

export type { CspConfigInput };

/**
 * Builds the explicit allowlist for Content Security Policy (CSP) connect-src (DEF-15-07).
 *
 * In production:
 * - Strictly disallows generic scheme allowances ('https:', 'ws:', 'wss:').
 * - Strictly excludes loopback/localhost origins ('localhost', '127.0.0.1').
 * - Grants connection rights only to explicitly configured, trusted service origins:
 *   1. 'self' (Backend API, Socket.IO, LiveKit Signaling Admission Gateway)
 *   2. CLIENT_ORIGIN (Frontend origin, HTTP & WSS)
 *   3. LIVEKIT_URL / LIVEKIT_PUBLIC_URL (Authorized WebRTC signaling & cloud SFU endpoints)
 *   4. S3 Storage Provider endpoints (Authorized presigned upload & download targets)
 *
 * In development / test:
 * - Grants connection rights to Vite dev servers (localhost:5173 / 127.0.0.1:5173)
 *   and backend dev servers (localhost:5000 / 127.0.0.1:5000).
 */
export function buildConnectSrcAllowlist(envConfig: CspConfigInput): string[] {
  const sources = new Set<string>();
  sources.add("'self'");

  const isProduction = envConfig.NODE_ENV === 'production';

  // In development and test environments, allow local development servers
  if (!isProduction) {
    sources.add('http://localhost:5173');
    sources.add('ws://localhost:5173');
    sources.add('http://127.0.0.1:5173');
    sources.add('ws://127.0.0.1:5173');
    sources.add('http://localhost:5000');
    sources.add('ws://localhost:5000');
    sources.add('http://127.0.0.1:5000');
    sources.add('ws://127.0.0.1:5000');
  }

  // Parse and add CLIENT_ORIGIN (both HTTP and WS variants)
  if (envConfig.CLIENT_ORIGIN) {
    try {
      const url = new URL(envConfig.CLIENT_ORIGIN.trim());
      const isLoopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
      if (!isProduction || !isLoopback) {
        sources.add(url.origin);
        const wsScheme = url.protocol === 'https:' ? 'wss:' : 'ws:';
        sources.add(`${wsScheme}//${url.host}`);
      }
    } catch {
      if (!isProduction && envConfig.CLIENT_ORIGIN.trim()) {
        sources.add(envConfig.CLIENT_ORIGIN.trim());
      }
    }
  }

  // Helper to extract and add trusted external service endpoints (e.g. LiveKit)
  const addServiceOrigins = (rawUrl?: string) => {
    if (!rawUrl || !rawUrl.trim()) return;
    try {
      const url = new URL(rawUrl.trim());
      const isLoopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
      if (isProduction && isLoopback) return;

      const host = url.host;
      if (!host) return;

      // LiveKit clients require both HTTPS (REST/discovery) and WSS (WebRTC signaling)
      sources.add(`https://${host}`);
      sources.add(`wss://${host}`);
    } catch {
      // Ignore invalid or empty URL strings
    }
  };

  addServiceOrigins(envConfig.LIVEKIT_PUBLIC_URL);
  addServiceOrigins(envConfig.LIVEKIT_URL);

  // Supabase Storage origins for direct signed uploads & downloads
  if (
    envConfig.SUPABASE_URL &&
    (envConfig.STORAGE_PROVIDER === 'supabase' || envConfig.STORAGE_PROVIDER === 'auto' || !envConfig.STORAGE_PROVIDER)
  ) {
    try {
      const sbUrl = new URL(envConfig.SUPABASE_URL.trim());
      const isLoopback = sbUrl.hostname === 'localhost' || sbUrl.hostname === '127.0.0.1';
      if (!isProduction || !isLoopback) {
        sources.add(sbUrl.origin);
      }
    } catch {
      /* Ignore malformed SUPABASE_URL */
    }
  }

  // S3 Storage provider endpoints for direct presigned client uploads
  if (envConfig.STORAGE_PROVIDER === 's3') {
    if (envConfig.STORAGE_S3_ENDPOINT) {
      try {
        const url = new URL(envConfig.STORAGE_S3_ENDPOINT.trim());
        const isLoopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
        if (!isProduction || !isLoopback) {
          sources.add(url.origin);
        }
      } catch {
        /* Ignore malformed optional S3 endpoint */
      }
    } else if (envConfig.STORAGE_S3_BUCKET) {
      const bucket = envConfig.STORAGE_S3_BUCKET.trim();
      const region = (envConfig.STORAGE_S3_REGION || 'us-east-1').trim();
      sources.add(`https://${bucket}.s3.${region}.amazonaws.com`);
      sources.add(`https://${bucket}.s3.amazonaws.com`);
    }
  }

  return Array.from(sources);
}

/**
 * Returns the hardened Helmet CSP configuration directives.
 */
export function getCspDirectives(envConfig: CspConfigInput) {
  // Storage origins for images (Supabase Storage or S3)
  const storageImageSources: string[] = [];
  if (
    envConfig.SUPABASE_URL &&
    (envConfig.STORAGE_PROVIDER === 'supabase' || envConfig.STORAGE_PROVIDER === 'auto' || !envConfig.STORAGE_PROVIDER)
  ) {
    try {
      const sbUrl = new URL(envConfig.SUPABASE_URL.trim());
      if (envConfig.NODE_ENV !== 'production' || (sbUrl.hostname !== 'localhost' && sbUrl.hostname !== '127.0.0.1')) {
        storageImageSources.push(sbUrl.origin);
      }
    } catch {
      /* Ignore malformed SUPABASE_URL */
    }
  }
  if (envConfig.STORAGE_PROVIDER === 's3') {
    if (envConfig.STORAGE_S3_ENDPOINT) {
      try {
        const url = new URL(envConfig.STORAGE_S3_ENDPOINT.trim());
        storageImageSources.push(url.origin);
      } catch {
        /* Ignore malformed optional S3 endpoint */
      }
    } else if (envConfig.STORAGE_S3_BUCKET) {
      const bucket = envConfig.STORAGE_S3_BUCKET.trim();
      const region = (envConfig.STORAGE_S3_REGION || 'us-east-1').trim();
      storageImageSources.push(`https://${bucket}.s3.${region}.amazonaws.com`);
      storageImageSources.push(`https://${bucket}.s3.amazonaws.com`);
    }
  }

  return {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    // NOTE: 'unsafe-inline' is required for style-src because React, Tailwind CSS,
    // and interactive canvas components (such as WhiteboardStage and VideoConferenceGrid)
    // inject dynamic inline style attributes (e.g., dynamic CSS variables, matrix transforms).
    // In pre-built static client single-page applications without server-side templating,
    // request-bound nonce injection is not possible. 'unsafe-eval' is strictly forbidden.
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:', 'blob:', ...storageImageSources],
    fontSrc: ["'self'", 'data:'],
    connectSrc: buildConnectSrcAllowlist(envConfig),
    mediaSrc: ["'self'", 'blob:', 'mediastream:'],
    workerSrc: ["'self'", 'blob:'],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    frameAncestors: ["'none'"],
  };
}
