/**
 * CONNECTLY Meeting Code Sanitization & Validation Utility
 * Format standard: cly-xxx-xxx (10 characters: 'cly-' + 3 alphanumeric + '-' + 3 alphanumeric)
 */

export interface MeetingCodeValidationResult {
  isValid: boolean;
  normalizedCode: string;
  error?: string;
}

const MAX_INPUT_LENGTH = 300;
const CANONICAL_CLY_REGEX = /^cly-([a-z0-9]{3})-([a-z0-9]{3})$/;

/**
 * Validates and normalizes meeting room codes according to the CONNECTLY specification.
 * - Enforces max input length defense against excessive input payloads
 * - Rejects HTML tags and script-like injections
 * - Extracts meeting code from full URLs, including protocol, host, port, paths, query strings, and fragments
 * - Normalizes to canonical lowercase cly-xxx-xxx format
 * - Prevents open redirects and false-positive validations
 */
export function validateMeetingCode(input: string | null | undefined): MeetingCodeValidationResult {
  if (!input || typeof input !== 'string') {
    return {
      isValid: false,
      normalizedCode: '',
      error: 'Please enter a meeting code.',
    };
  }

  // Guard against excessively long input payloads
  if (input.length > MAX_INPUT_LENGTH) {
    return {
      isValid: false,
      normalizedCode: '',
      error: 'Meeting code or URL is too long.',
    };
  }

  // Reject HTML tags, script tags, or dangerous syntax
  if (/[<>]|javascript:|data:/i.test(input)) {
    return {
      isValid: false,
      normalizedCode: '',
      error: 'Invalid characters or unsafe input detected.',
    };
  }

  // Trim whitespace
  const trimmed = input.trim();
  if (!trimmed) {
    return {
      isValid: false,
      normalizedCode: '',
      error: 'Please enter a meeting code.',
    };
  }

  let candidate = trimmed;

  // Handle URL parsing if pasted as a web link
  // e.g. https://connectly.io/meeting/cly-789-qwa?ref=invite#lobby
  // e.g. http://localhost:5173/join/cly-789-qwa
  // e.g. /join/cly-789-qwa?tab=audio
  try {
    if (/^https?:\/\//i.test(candidate)) {
      const parsedUrl = new URL(candidate);
      // Strip query parameters and hash, focus on path segments
      const segments = parsedUrl.pathname.split('/').filter(Boolean);
      if (segments.length > 0) {
        // Last segment is typically the meeting code
        candidate = segments[segments.length - 1];
      }
    } else if (candidate.startsWith('/')) {
      // Relative path: strip query/hash and get last segment
      const cleanPath = candidate.split('?')[0].split('#')[0];
      const segments = cleanPath.split('/').filter(Boolean);
      if (segments.length > 0) {
        candidate = segments[segments.length - 1];
      }
    } else {
      // Strip any accidental trailing query string or hash fragment from raw text
      candidate = candidate.split('?')[0].split('#')[0].replace(/\/+$/, '');
    }
  } catch {
    // If URL parsing fails, continue with candidate string
  }

  const normalized = candidate.trim().toLowerCase();

  // Case 1: Canonical cly-xxx-xxx format (10 characters: cly-789-qwa)
  const matchCanonical = normalized.match(CANONICAL_CLY_REGEX);
  if (matchCanonical) {
    return {
      isValid: true,
      normalizedCode: `cly-${matchCanonical[1]}-${matchCanonical[2]}`,
    };
  }

  // Case 2: 6 alphanumeric characters without prefix (e.g. '789qwa' or '789-qwa')
  const matchHyphenated6 = normalized.match(/^([a-z0-9]{3})-([a-z0-9]{3})$/);
  if (matchHyphenated6) {
    return {
      isValid: true,
      normalizedCode: `cly-${matchHyphenated6[1]}-${matchHyphenated6[2]}`,
    };
  }

  const rawAlphanumeric = normalized.replace(/[^a-z0-9]/g, '');

  // Case 3: Raw 6 characters without hyphens (e.g. '789qwa')
  if (rawAlphanumeric.length === 6) {
    return {
      isValid: true,
      normalizedCode: `cly-${rawAlphanumeric.slice(0, 3)}-${rawAlphanumeric.slice(3, 6)}`,
    };
  }

  // Case 4: Raw 9 characters starting with 'cly' (e.g. 'cly789qwa')
  if (rawAlphanumeric.length === 9 && rawAlphanumeric.startsWith('cly')) {
    return {
      isValid: true,
      normalizedCode: `cly-${rawAlphanumeric.slice(3, 6)}-${rawAlphanumeric.slice(6, 9)}`,
    };
  }

  return {
    isValid: false,
    normalizedCode: normalized,
    error: 'Invalid meeting code. Format should be cly-xxx-xxx (e.g. cly-789-qwa).',
  };
}

/**
 * Formats user input as they type into the meeting code input field.
 * Restricts to max 11 characters (cly-xxx-xxx) and allows only valid characters.
 */
export function formatMeetingCodeInput(value: string): string {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9-]/g, '');
  return cleaned.slice(0, 11);
}
