const SENSITIVE_QUERY_KEYS = new Set(['access_token', 'token', 'join_request']);

function sanitizeQuerySegments(rawQuery: string): string {
  if (!rawQuery) return '';
  return rawQuery
    .split('&')
    .map((segment) => {
      if (!segment) return segment;
      const eqIdx = segment.indexOf('=');
      if (eqIdx === -1) {
        return segment;
      }
      const rawKey = segment.slice(0, eqIdx);
      let decodedKey = rawKey;
      try {
        decodedKey = decodeURIComponent(rawKey);
      } catch {
        // Malformed percent-encoding in key: fall back to raw key without throwing
      }
      if (SENSITIVE_QUERY_KEYS.has(decodedKey.trim().toLowerCase())) {
        return `${rawKey}=[REDACTED]`;
      }
      return segment;
    })
    .join('&');
}

/**
 * Safely sanitizes HTTP request URLs (`req.originalUrl` or fallback `req.url`)
 * before logging or echoing in diagnostic responses.
 *
 * Guarantees:
 * - Redacts `access_token`, `token`, and `join_request` query parameters
 *   (case-insensitive, multiple occurrences, and fragment occurrences).
 * - Preserves route path and ordinary non-sensitive query parameters for diagnostics.
 * - Strips CR/LF/NUL control characters to prevent log forging.
 * - Handles malformed URLs and invalid percent-encoding safely without ever throwing.
 */
export function sanitizeLoggedUrl(rawUrl: string | undefined | null): string {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return '';
  }

  // eslint-disable-next-line no-control-regex
  const singleLine = rawUrl.replace(/[\r\n\x00]/g, '');
  const hashIdx = singleLine.indexOf('#');
  const beforeHash = hashIdx === -1 ? singleLine : singleLine.slice(0, hashIdx);
  const rawHash = hashIdx === -1 ? '' : singleLine.slice(hashIdx + 1);

  const qIdx = beforeHash.indexOf('?');
  let sanitizedBeforeHash: string;
  if (qIdx === -1) {
    sanitizedBeforeHash = beforeHash;
  } else {
    const pathPart = beforeHash.slice(0, qIdx);
    const queryPart = beforeHash.slice(qIdx + 1);
    sanitizedBeforeHash = `${pathPart}?${sanitizeQuerySegments(queryPart)}`;
  }

  let result =
    hashIdx === -1
      ? sanitizedBeforeHash
      : `${sanitizedBeforeHash}#${sanitizeQuerySegments(rawHash)}`;

  // Defense-in-depth: redact any raw JWT-shaped token embedded outside standard key=value pairs
  result = result.replace(
    /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\b/g,
    '[REDACTED]'
  );

  return result;
}
