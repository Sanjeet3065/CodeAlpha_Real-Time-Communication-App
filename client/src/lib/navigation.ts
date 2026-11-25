import { useCallback } from 'react';
import { useNavigate, type NavigateOptions, type To } from 'react-router-dom';

/**
 * Validates and sanitizes navigation paths to prevent Open Redirect attacks (CVE-2025-68470 / GHSA-wrjc-x8rr-h8h6).
 * 
 * Rejects:
 * - Backslash-based bypasses (e.g., `\\attacker.com`, `/\attacker.com`, `/\\attacker.com`)
 * - Protocol-relative URLs (e.g., `//attacker.com`)
 * - Explicit URI schemes (e.g., `javascript:`, `data:`, `http:`, `https:`)
 * - Non-relative paths without a leading `/` (unless purely a hash or query)
 * 
 * Allows:
 * - Legitimate relative paths starting with a single `/` (e.g., `/`, `/dashboard`, `/downloads`)
 * - Paths with query parameters (e.g., `/search?query=test&sort=asc`)
 * - Paths with hash fragments (e.g., `/help#section-2`, `#main-content`)
 */
export function sanitizeNavigationPath(target: string, fallback: string = '/'): string {
  if (typeof target !== 'string') {
    return fallback;
  }

  const trimmed = target.trim();

  // Reject empty strings
  if (!trimmed) {
    return fallback;
  }

  // Reject any string containing backslashes ('\')
  // Browsers normalize backslashes to forward slashes in some contexts, allowing open redirects
  if (trimmed.includes('\\')) {
    return fallback;
  }

  // Reject protocol-relative URLs (starts with '//')
  if (trimmed.startsWith('//')) {
    return fallback;
  }

  // Reject unsafe URI schemes (javascript:, data:, vbscript:, etc.) or absolute URLs (http:, https:)
  // Look for any scheme preceding a colon
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    return fallback;
  }

  // Allow pure hash or pure query relative navigation
  if (trimmed.startsWith('#') || trimmed.startsWith('?')) {
    return trimmed;
  }

  // Ensure internal navigation starts with a single forward slash
  if (!trimmed.startsWith('/')) {
    return `/${trimmed}`;
  }

  return trimmed;
}

/**
 * Hook providing a secure navigate function wrapped with path sanitization.
 */
export function useSafeNavigate() {
  const navigate = useNavigate();

  return useCallback(
    (to: To | number, options?: NavigateOptions) => {
      if (typeof to === 'number') {
        // Safe relative history navigation (e.g., -1)
        navigate(to);
        return;
      }

      if (typeof to === 'string') {
        const sanitized = sanitizeNavigationPath(to);
        navigate(sanitized, options);
        return;
      }

      // If to is a Path object, sanitize its pathname
      if (typeof to === 'object' && to !== null) {
        const sanitizedPath = {
          ...to,
          pathname: to.pathname ? sanitizeNavigationPath(to.pathname) : undefined,
        };
        navigate(sanitizedPath, options);
        return;
      }

      navigate('/', options);
    },
    [navigate]
  );
}
