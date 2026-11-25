/**
 * CONNECTLY — Single-Origin Cloudflare Worker Reverse Proxy
 *
 * Architecture:
 * - /api/*            -> BACKEND_ORIGIN (Koyeb Node.js API)
 * - /socket.io/*      -> BACKEND_ORIGIN (Socket.IO polling and WebSocket upgrade)
 * - /livekit-signal/* -> BACKEND_ORIGIN (LiveKit Signaling Admission Gateway)
 * - /* (all others)   -> FRONTEND_ORIGIN (Cloudflare Pages SPA)
 *
 * Host-Header Correctness Invariant:
 * When proxying subrequests via fetch(), we must NOT forward the incoming client
 * Host header (e.g. connectly-proxy.subdomain.workers.dev).
 * We delete 'host' from forwarded headers so fetch() derives the Host header
 * authoritatively from targetUrl.hostname (e.g. connectly-backend.koyeb.app).
 */

/**
 * Validates that an origin string is well-formed with an http:// or https:// scheme.
 *
 * @param {string | undefined | null} origin
 * @returns {boolean}
 */
export function isValidOrigin(origin) {
  if (typeof origin !== 'string') return false;
  const trimmed = origin.trim();
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    return false;
  }
  try {
    const parsed = new URL(trimmed);
    return Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * Determines target upstream origin and route type based on URL pathname.
 *
 * @param {string} pathname
 * @param {{ BACKEND_ORIGIN?: string; FRONTEND_ORIGIN?: string }} env
 * @returns {{ targetOrigin: string; isBackend: boolean; isWebSocketCapable: boolean }}
 */
export function routeRequest(pathname, env) {
  const backendOrigin = (env?.BACKEND_ORIGIN || 'https://connectly-backend.koyeb.app').replace(/\/+$/, '');
  const frontendOrigin = (env?.FRONTEND_ORIGIN || 'https://connectly-frontend.pages.dev').replace(/\/+$/, '');

  if (
    pathname.startsWith('/api/') ||
    pathname === '/api' ||
    pathname.startsWith('/socket.io') ||
    pathname.startsWith('/livekit-signal')
  ) {
    const isWebSocketCapable = pathname.startsWith('/socket.io') || pathname.startsWith('/livekit-signal');
    return { targetOrigin: backendOrigin, isBackend: true, isWebSocketCapable };
  }

  return { targetOrigin: frontendOrigin, isBackend: false, isWebSocketCapable: false };
}

/**
 * Validates whether an IP address is a syntactically valid IPv4 or IPv6 address.
 *
 * @param {string | undefined | null} ip
 * @returns {boolean}
 */
export function isValidClientIp(ip) {
  if (typeof ip !== 'string') return false;
  const trimmed = ip.trim();
  // IPv4 regex (0.0.0.0 to 255.255.255.255)
  const ipv4Regex = /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d|\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d|\d)){3}$/;
  if (ipv4Regex.test(trimmed)) return true;

  // IPv6 regex
  const ipv6Regex =
    /^(?:[a-fA-F0-9]{1,4}:){7}[a-fA-F0-9]{1,4}$|^::(?:[a-fA-F0-9]{1,4}:){0,6}[a-fA-F0-9]{1,4}$|^(?:[a-fA-F0-9]{1,4}:){1,7}:$|^(?:[a-fA-F0-9]{1,4}:){1,6}:[a-fA-F0-9]{1,4}$|^(?:[a-fA-F0-9]{1,4}:){1,5}(?::[a-fA-F0-9]{1,4}){1,2}$|^(?:[a-fA-F0-9]{1,4}:){1,4}(?::[a-fA-F0-9]{1,4}){1,3}$|^(?:[a-fA-F0-9]{1,4}:){1,3}(?::[a-fA-F0-9]{1,4}){1,4}$|^(?:[a-fA-F0-9]{1,4}:){1,2}(?::[a-fA-F0-9]{1,4}){1,5}$|^[a-fA-F0-9]{1,4}:(?::[a-fA-F0-9]{1,4}){1,6}$|^::$/;
  return ipv6Regex.test(trimmed);
}

export const KNOWN_PROXY_SECRET_PLACEHOLDERS = [
  'replace_with_',
  'your_proxy_secret',
  'changeme',
  'dummy',
  'example',
  'dev_proxy_secret',
];

/**
 * Validates that PROXY_SECRET is an exact 64-hex character string without known placeholders.
 *
 * @param {string | undefined | null} secret
 * @returns {boolean}
 */
export function isValidProxySecret(secret) {
  if (typeof secret !== 'string') return false;
  const trimmed = secret.trim();
  if (trimmed.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return false;
  }
  const lower = trimmed.toLowerCase();
  for (const placeholder of KNOWN_PROXY_SECRET_PLACEHOLDERS) {
    if (lower.includes(placeholder)) {
      return false;
    }
  }
  return true;
}

/**
 * Prepares forwarded headers ensuring the client Host header is removed,
 * client-supplied internal security headers are stripped, and server-to-server
 * origin authentication and verified client IP are attached.
 *
 * @param {Headers} originalHeaders
 * @param {string} targetHostname
 * @param {{ PROXY_SECRET?: string }} [env]
 * @returns {Headers}
 */
export function prepareForwardedHeaders(originalHeaders, targetHostname, env = {}) {
  const headers = new Headers(originalHeaders);

  // CRITICAL: Strip the client's Host header so Koyeb and Pages receive their expected vhost
  headers.delete('host');

  // F-06S-03: Unconditionally delete all incoming client-controlled internal trust headers
  headers.delete('x-proxy-secret');
  headers.delete('x-verified-client-ip');
  headers.delete('x-forwarded-for');
  headers.delete('x-real-ip');

  // Strip hop-by-hop headers that should not be forwarded except for WebSocket upgrades
  const isWebSocket = originalHeaders.get('upgrade')?.toLowerCase() === 'websocket';
  if (!isWebSocket) {
    const connection = originalHeaders.get('connection')?.toLowerCase();
    if (connection && connection !== 'keep-alive') {
      headers.delete('connection');
    }
  }

  // Attach server-to-server origin authentication secret if configured
  if (env?.PROXY_SECRET) {
    headers.set('x-proxy-secret', env.PROXY_SECRET);
  }

  // F-06S-03: Derive canonical client IP EXCLUSIVELY from trusted Cloudflare edge header (cf-connecting-ip)
  const cfConnectingIp = originalHeaders.get('cf-connecting-ip')?.trim();

  if (cfConnectingIp && isValidClientIp(cfConnectingIp)) {
    headers.set('x-verified-client-ip', cfConnectingIp);
    headers.set('x-forwarded-for', cfConnectingIp);
  }

  return headers;
}

/**
 * Core proxy dispatch handler.
 *
 * @param {Request} request
 * @param {{ BACKEND_ORIGIN?: string; FRONTEND_ORIGIN?: string }} env
 * @param {typeof fetch} [fetchFn] - Injected fetch function for testability
 * @returns {Promise<Response>}
 */
export async function handleProxyRequest(request, env = {}, fetchFn = fetch) {
  const url = new URL(request.url);

  // Validate upstream origins
  const backendOrigin = env?.BACKEND_ORIGIN || 'https://connectly-backend.koyeb.app';
  const frontendOrigin = env?.FRONTEND_ORIGIN || 'https://connectly-frontend.pages.dev';

  if (!isValidOrigin(backendOrigin) || !isValidOrigin(frontendOrigin)) {
    return new Response(
      JSON.stringify({
        status: 500,
        code: 'PROXY_CONFIGURATION_ERROR',
        message: 'The proxy gateway origin configuration is missing or malformed.',
        path: url.pathname,
        timestamp: new Date().toISOString(),
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
      }
    );
  }

  const { targetOrigin, isBackend, isWebSocketCapable } = routeRequest(url.pathname, env);

  if (isBackend) {
    // F-06S-04: Worker must fail closed without valid 64-hex PROXY_SECRET on backend routes
    if (!isValidProxySecret(env?.PROXY_SECRET)) {
      return new Response(
        JSON.stringify({
          status: 500,
          code: 'PROXY_CONFIGURATION_ERROR',
          message: 'The proxy gateway origin credential configuration is missing or invalid.',
          path: url.pathname,
          timestamp: new Date().toISOString(),
        }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
          },
        }
      );
    }

    // F-06S-03: Cloudflare client IP hardening — require valid CF-Connecting-IP
    const cfConnectingIp = request.headers.get('cf-connecting-ip')?.trim();
    if (!cfConnectingIp || !isValidClientIp(cfConnectingIp)) {
      return new Response(
        JSON.stringify({
          status: 400,
          code: 'INVALID_CLIENT_IP',
          message: 'The request could not be authenticated due to missing or invalid client edge IP.',
          path: url.pathname,
          timestamp: new Date().toISOString(),
        }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
          },
        }
      );
    }
  }

  // Construct upstream target URL preserving full pathname and query parameters
  const targetUrl = new URL(url.pathname + url.search, targetOrigin);

  // Prepare sanitized forwarded headers
  const headers = prepareForwardedHeaders(request.headers, targetUrl.hostname, env);

  // Configure fetch options
  const isWebSocketUpgrade = isWebSocketCapable && request.headers.get('upgrade')?.toLowerCase() === 'websocket';
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';

  const fetchOptions = {
    method: request.method,
    headers,
    redirect: 'manual',
  };

  if (hasBody) {
    // Body forwarding for POST / PUT / PATCH / DELETE (e.g. Socket.IO polling POST or REST API)
    fetchOptions.body = request.body;
    fetchOptions.duplex = 'half';
  }

  try {
    const upstreamResponse = await fetchFn(targetUrl.toString(), fetchOptions);

    // If this is a WebSocket upgrade response (101 Switching Protocols), return directly
    // Cloudflare Workers runtime automatically binds the upstream WebSocket to the client.
    if (upstreamResponse.status === 101) {
      return upstreamResponse;
    }

    // For backend API and signaling routes, ensure dynamic content is never cached by edge or browser
    const responseHeaders = new Headers(upstreamResponse.headers);
    if (isBackend) {
      responseHeaders.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      responseHeaders.set('Pragma', 'no-cache');
      responseHeaders.set('Expires', '0');
    }

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  } catch (err) {
    // Return clean 502 Bad Gateway without leaking internal secrets, IPs, or stack traces
    return new Response(
      JSON.stringify({
        status: 502,
        code: 'UPSTREAM_GATEWAY_ERROR',
        message: 'The proxy gateway could not reach the requested upstream service.',
        path: url.pathname,
        timestamp: new Date().toISOString(),
      }),
      {
        status: 502,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
      }
    );
  }
}

export default {
  async fetch(request, env, ctx) {
    return handleProxyRequest(request, env);
  },
};
