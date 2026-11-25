import crypto from 'node:crypto';

/**
 * Unambiguous lowercase alphanumeric alphabet (32 characters, omitting 0/o and 1/l/i
 * for human legibility over voice/chat while preserving high entropy: 32^6 = 1,073,741,824
 * unique combinations per active code space).
 */
const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const CANONICAL_MEETING_CODE_REGEX = /^cly-[a-z0-9]{3}-[a-z0-9]{3}$/;

/**
 * Generates a cryptographically unpredictable meeting code in canonical `cly-xxx-xxx` format
 * using Node's CSPRNG (`crypto.randomInt`). Never uses sequential IDs or `Math.random()`.
 */
export function generateSecureMeetingCode(): string {
  const chars: string[] = [];
  for (let i = 0; i < 6; i += 1) {
    const idx = crypto.randomInt(0, CODE_ALPHABET.length);
    chars.push(CODE_ALPHABET[idx]);
  }
  return `cly-${chars.slice(0, 3).join('')}-${chars.slice(3, 6).join('')}`;
}

/**
 * Normalizes and validates an incoming meeting code or invitation link segment.
 * Returns null if the input fails strict canonical validation.
 */
export function normalizeMeetingCode(rawInput: string | null | undefined): string | null {
  if (!rawInput || typeof rawInput !== 'string') {
    return null;
  }

  const trimmed = rawInput.trim();
  if (!trimmed || trimmed.length > 300) {
    return null;
  }

  // Reject HTML / script injection payloads defensively
  if (/[<>]|javascript:|data:/i.test(trimmed)) {
    return null;
  }

  let candidate = trimmed;

  // Support extracting canonical code from invitation URLs or paths
  try {
    if (/^https?:\/\//i.test(candidate)) {
      const parsed = new URL(candidate);
      const segments = parsed.pathname.split('/').filter(Boolean);
      if (segments.length > 0) {
        candidate = segments[segments.length - 1];
      }
    } else if (candidate.startsWith('/')) {
      const cleanPath = candidate.split('?')[0].split('#')[0];
      const segments = cleanPath.split('/').filter(Boolean);
      if (segments.length > 0) {
        candidate = segments[segments.length - 1];
      }
    } else {
      candidate = candidate.split('?')[0].split('#')[0].replace(/\/+$/, '');
    }
  } catch {
    return null;
  }

  const lower = candidate.trim().toLowerCase();

  // Case 1: Canonical cly-xxx-xxx
  if (CANONICAL_MEETING_CODE_REGEX.test(lower)) {
    return lower;
  }

  // Case 2: xxx-xxx (6 alphanumeric with hyphen)
  const hyphen6 = lower.match(/^([a-z0-9]{3})-([a-z0-9]{3})$/);
  if (hyphen6) {
    return `cly-${hyphen6[1]}-${hyphen6[2]}`;
  }

  // Case 3: Raw 6 alphanumeric chars
  const alnum = lower.replace(/[^a-z0-9]/g, '');
  if (alnum.length === 6 && /^[a-z0-9]{6}$/.test(alnum) && lower === alnum) {
    return `cly-${alnum.slice(0, 3)}-${alnum.slice(3, 6)}`;
  }

  // Case 4: Raw 9 alphanumeric chars starting with 'cly'
  if (alnum.length === 9 && alnum.startsWith('cly') && lower === alnum) {
    return `cly-${alnum.slice(3, 6)}-${alnum.slice(6, 9)}`;
  }

  return null;
}

export function isCanonicalMeetingCode(code: string): boolean {
  return CANONICAL_MEETING_CODE_REGEX.test(code);
}
