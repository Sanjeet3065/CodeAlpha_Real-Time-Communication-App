/**
 * Pure side-effect-free LiveKit configuration validation and URL conversion helpers.
 * Intentionally avoids importing `env.ts` so preflight tooling can validate synthetic
 * or incomplete configurations without triggering process-level startup throws.
 */

export interface LiveKitConfig {
  url: string;
  publicUrl?: string;
  signalGatewayEnabled?: 'auto' | 'true' | 'false';
  apiKey: string;
  apiSecret: string;
  tokenTtlSeconds: number;
}

const PLACEHOLDER_PREFIXES = ['replace_with_', 'your_livekit_', 'changeme'];

/**
 * Converts ws:// -> http:// and wss:// -> https:// for LiveKit server REST/Twirp calls.
 */
export function toLiveKitHttpUrl(rawUrl: string): string {
  const parsed = new URL(rawUrl);
  if (parsed.protocol === 'ws:') {
    parsed.protocol = 'http:';
  } else if (parsed.protocol === 'wss:') {
    parsed.protocol = 'https:';
  }
  return parsed.toString().replace(/\/+$/, '');
}

/**
 * Converts http:// -> ws:// and https:// -> wss:// for browser WebSocket signaling.
 */
export function toLiveKitWsUrl(rawUrl: string): string {
  const parsed = new URL(rawUrl);
  if (parsed.protocol === 'http:') {
    parsed.protocol = 'ws:';
  } else if (parsed.protocol === 'https:') {
    parsed.protocol = 'wss:';
  }
  return parsed.toString().replace(/\/+$/, '');
}

/**
 * Validates LiveKit configuration strictly without logging secret material.
 */
export function validateLiveKitConfig(
  config: Partial<LiveKitConfig>,
  nodeEnv: string = process.env.NODE_ENV || 'development'
): { valid: true; resolved: LiveKitConfig } | { valid: false; reason: string } {
  const url = (config.url || '').trim();
  const publicUrl = (config.publicUrl || '').trim();
  const rawSignalMode = config.signalGatewayEnabled ?? 'auto';
  if (rawSignalMode !== 'auto' && rawSignalMode !== 'true' && rawSignalMode !== 'false') {
    return {
      valid: false,
      reason: 'LIVEKIT_SIGNAL_GATEWAY_ENABLED must be one of auto, true, or false.',
    };
  }
  const signalGatewayEnabled: 'auto' | 'true' | 'false' = rawSignalMode;
  const apiKey = (config.apiKey || '').trim();
  const apiSecret = (config.apiSecret || '').trim();
  const tokenTtlSeconds =
    typeof config.tokenTtlSeconds === 'number' && Number.isFinite(config.tokenTtlSeconds)
      ? Math.floor(config.tokenTtlSeconds)
      : 600;

  if (!url || !apiKey || !apiSecret) {
    return {
      valid: false,
      reason: 'Missing LIVEKIT_URL, LIVEKIT_API_KEY, or LIVEKIT_API_SECRET.',
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, reason: 'LIVEKIT_URL is not a valid URL.' };
  }

  const hostLower = parsed.hostname.toLowerCase();
  const isCloud = hostLower.endsWith('.livekit.cloud');
  const isLoopback = hostLower === '127.0.0.1' || hostLower === 'localhost' || hostLower === '::1';

  if (publicUrl) {
    let parsedPub: URL;
    try {
      parsedPub = new URL(publicUrl);
    } catch {
      return { valid: false, reason: 'LIVEKIT_PUBLIC_URL is not a valid URL.' };
    }
    const allowedPubProtocols =
      nodeEnv === 'production' ? ['wss:', 'https:'] : ['ws:', 'wss:', 'http:', 'https:'];
    if (!allowedPubProtocols.includes(parsedPub.protocol)) {
      return {
        valid: false,
        reason:
          nodeEnv === 'production'
            ? 'Production LIVEKIT_PUBLIC_URL must use a secure wss:// or https:// scheme.'
            : 'LIVEKIT_PUBLIC_URL must use ws://, wss://, http://, or https://.',
      };
    }
  }

  if (nodeEnv === 'production' && !isCloud && signalGatewayEnabled === 'false') {
    return {
      valid: false,
      reason:
        'Production self-hosted LiveKit cannot disable LIVEKIT_SIGNAL_GATEWAY_ENABLED (would bypass authoritative JWT revocation).',
    };
  }

  const allowedProtocols =
    nodeEnv === 'production'
      ? publicUrl && isLoopback
        ? ['ws:', 'wss:', 'http:', 'https:']
        : ['wss:', 'https:']
      : ['ws:', 'wss:', 'http:', 'https:'];
  if (!allowedProtocols.includes(parsed.protocol)) {
    return {
      valid: false,
      reason:
        nodeEnv === 'production'
          ? 'Production LIVEKIT_URL must use a secure wss:// or https:// scheme (or private loopback paired with a wss:// LIVEKIT_PUBLIC_URL).'
          : 'LIVEKIT_URL must use ws://, wss://, http://, or https://.',
    };
  }

  const keyLower = apiKey.toLowerCase();
  const secretLower = apiSecret.toLowerCase();
  if (
    PLACEHOLDER_PREFIXES.some(
      (prefix) => keyLower.startsWith(prefix) || secretLower.startsWith(prefix)
    )
  ) {
    return {
      valid: false,
      reason: 'LiveKit credentials contain unconfigured placeholder values.',
    };
  }

  if (nodeEnv === 'production' && (keyLower === 'devkey' || secretLower === 'secret')) {
    return {
      valid: false,
      reason: 'Production deployment cannot use default LiveKit dev credentials.',
    };
  }

  if (tokenTtlSeconds < 60 || tokenTtlSeconds > 3600) {
    return {
      valid: false,
      reason: 'LIVEKIT_TOKEN_TTL_SECONDS must be between 60 and 3600 seconds.',
    };
  }

  return {
    valid: true,
    resolved: {
      url: toLiveKitWsUrl(url),
      publicUrl: publicUrl ? toLiveKitWsUrl(publicUrl) : undefined,
      signalGatewayEnabled,
      apiKey,
      apiSecret,
      tokenTtlSeconds,
    },
  };
}
