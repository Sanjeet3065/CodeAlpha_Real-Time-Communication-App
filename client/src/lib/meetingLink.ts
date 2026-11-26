function normalizeHttpOrigin(raw?: string | null): string {
  const trimmed = (raw || '').trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '';
    }
    return parsed.origin.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

function getRuntimeWindowOrigin(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return '';
}

function getConfiguredAppUrl(): string {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env;
  return env?.VITE_APP_URL || '';
}

/**
 * Resolves the authoritative frontend origin for shareable meeting URLs.
 * Prefers the live browser origin over configured build-time fallbacks.
 */
export function resolveAppOrigin(
  windowOrigin: string = getRuntimeWindowOrigin(),
  configuredAppUrl: string = getConfiguredAppUrl()
): string {
  const fromWindow = normalizeHttpOrigin(windowOrigin);
  if (fromWindow) return fromWindow;

  const fromEnv = normalizeHttpOrigin(configuredAppUrl);
  if (fromEnv) return fromEnv;

  return '';
}

/**
 * Builds the canonical live `/join/:meetingCode` link.
 */
export function buildMeetingJoinUrl(
  meetingCode: string,
  fallbackJoinUrl = '',
  windowOrigin: string = getRuntimeWindowOrigin(),
  configuredAppUrl: string = getConfiguredAppUrl()
): string {
  const cleanCode = meetingCode.trim();
  const origin = resolveAppOrigin(windowOrigin, configuredAppUrl);
  if (origin && cleanCode) {
    return `${origin}/join/${cleanCode}`;
  }
  if (fallbackJoinUrl.trim()) {
    return fallbackJoinUrl.trim();
  }
  return cleanCode ? `/join/${cleanCode}` : '';
}

/**
 * Rewrites backend-supplied joinUrl and multi-line invitationText so embedded
 * links always match the active live frontend origin and `/join/:code` route.
 */
export function normalizeInvitationUrls(
  invitationText: string,
  joinUrl: string,
  meetingCode: string,
  windowOrigin: string = getRuntimeWindowOrigin(),
  configuredAppUrl: string = getConfiguredAppUrl()
): { joinUrl: string; invitationText: string } {
  const canonicalUrl = buildMeetingJoinUrl(meetingCode, joinUrl, windowOrigin, configuredAppUrl);
  const cleanCode = meetingCode.trim();
  if (!canonicalUrl || !cleanCode) {
    return { joinUrl: canonicalUrl || joinUrl, invitationText };
  }

  const escapedCode = cleanCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const legacyUrlPattern = new RegExp(
    `https?:\\/\\/[^\\s/]+\\/(?:join|lobby|meeting)\\/${escapedCode}`,
    'gi'
  );

  let nextText = invitationText.replace(legacyUrlPattern, canonicalUrl);
  if (joinUrl.trim() && nextText.includes(joinUrl.trim())) {
    nextText = nextText.split(joinUrl.trim()).join(canonicalUrl);
  }

  return {
    joinUrl: canonicalUrl,
    invitationText: nextText,
  };
}
