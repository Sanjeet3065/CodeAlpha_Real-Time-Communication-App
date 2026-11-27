export interface GoogleConfigPayload {
  enabled: boolean;
  clientId: string | null;
}

export class GoogleAuthCancelledError extends Error {
  constructor(message = 'Google sign-in was cancelled.') {
    super(message);
    this.name = 'GoogleAuthCancelledError';
  }
}

interface GoogleOAuthCodeClient {
  requestCode: () => void;
}

interface GoogleIdentityWindow extends Window {
  google?: {
    accounts?: {
      oauth2?: {
        initCodeClient: (config: {
          client_id: string;
          scope: string;
          ux_mode: 'popup';
          callback: (response: { code?: string; error?: string }) => void;
          error_callback?: (err: { type?: string; message?: string }) => void;
        }) => GoogleOAuthCodeClient;
      };
    };
  };
}

const GSI_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';
let scriptLoadPromise: Promise<void> | null = null;
let cachedRuntimeClientId: string | null = null;

export async function resolveGoogleClientId(
  envClientId?: string,
  fetchServerConfig?: () => Promise<GoogleConfigPayload>
): Promise<string | null> {
  const fromEnv = (envClientId ?? '').trim();
  if (fromEnv) {
    cachedRuntimeClientId = fromEnv;
    return fromEnv;
  }

  if (cachedRuntimeClientId) {
    return cachedRuntimeClientId;
  }

  if (!fetchServerConfig) {
    return null;
  }

  try {
    const cfg = await fetchServerConfig();
    const serverId = cfg?.enabled && cfg?.clientId ? cfg.clientId.trim() : '';
    if (serverId) {
      cachedRuntimeClientId = serverId;
      return serverId;
    }
    return null;
  } catch {
    return null;
  }
}

export function resetGoogleOAuthCacheForTesting(): void {
  cachedRuntimeClientId = null;
  scriptLoadPromise = null;
}

export function preloadGoogleIdentityScript(): Promise<void> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(new Error('Google Identity Services requires a browser environment.'));
  }

  const gsiWindow = window as GoogleIdentityWindow;
  if (gsiWindow.google?.accounts?.oauth2?.initCodeClient) {
    return Promise.resolve();
  }

  if (scriptLoadPromise) {
    return scriptLoadPromise;
  }

  scriptLoadPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector(`script[src="${GSI_SCRIPT_SRC}"]`) as HTMLScriptElement | null;
    if (existing) {
      if (gsiWindow.google?.accounts?.oauth2?.initCodeClient) {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener(
        'error',
        () => {
          scriptLoadPromise = null;
          reject(new Error('Failed to load Google Identity Services script.'));
        },
        { once: true }
      );
      return;
    }

    const script = document.createElement('script');
    script.src = GSI_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptLoadPromise = null;
      reject(new Error('Unable to load Google Sign-In. Please check your network or ad blocker.'));
    };
    document.head.appendChild(script);
  });

  return scriptLoadPromise;
}

export async function requestGoogleAuthCode(clientId: string): Promise<string> {
  const trimmedId = clientId.trim();
  if (!trimmedId) {
    throw new Error('Google OAuth Client ID is missing.');
  }

  await preloadGoogleIdentityScript();

  const gsiWindow = window as GoogleIdentityWindow;
  const oauth2 = gsiWindow.google?.accounts?.oauth2;
  if (!oauth2?.initCodeClient) {
    throw new Error('Google Sign-In client failed to initialize in this browser.');
  }

  return new Promise<string>((resolve, reject) => {
    const codeClient = oauth2.initCodeClient({
      client_id: trimmedId,
      scope: 'openid email profile',
      ux_mode: 'popup',
      callback: (response) => {
        if (response.error) {
          if (response.error === 'access_denied') {
            reject(new GoogleAuthCancelledError());
            return;
          }
          reject(new Error(`Google sign-in failed (${response.error}).`));
          return;
        }
        if (!response.code) {
          reject(new Error('Google sign-in did not return an authorization code.'));
          return;
        }
        resolve(response.code);
      },
      error_callback: (err) => {
        if (err?.type === 'popup_closed') {
          reject(new GoogleAuthCancelledError());
          return;
        }
        if (err?.type === 'popup_failed_to_open') {
          reject(new Error('Google popup was blocked by your browser. Please allow popups and try again.'));
          return;
        }
        reject(new Error(err?.message || 'Unable to open Google sign-in window.'));
      },
    });

    codeClient.requestCode();
  });
}
