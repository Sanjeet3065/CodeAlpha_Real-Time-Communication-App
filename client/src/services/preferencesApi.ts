import { fetchWithAuth } from './authApi.ts';

const API_BASE_URL = (import.meta.env?.VITE_API_BASE_URL as string) || '/api/v1';

// Per-tab/per-load session identifier pairs with server-controlled fieldVersions
// so rapid same-session clicks stay strictly ordered while delayed requests from
// previous sessions (e.g. before a reload or from another device) cannot overwrite
// newer committed server state.
function generateClientSessionId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

export interface PreferenceFieldVersions {
  defaultAudioMuted: number;
  defaultVideoOff: number;
}

let activeClientSessionId = generateClientSessionId();
let serverClockOffsetMs = 0;
let lastIssuedClientTimestamp = 0;
let knownFieldVersions: PreferenceFieldVersions | null = null;

export function getClientSessionId(): string {
  return activeClientSessionId;
}

export function getKnownFieldVersions(): PreferenceFieldVersions | null {
  return knownFieldVersions ? { ...knownFieldVersions } : null;
}

/**
 * Resets the client session identifier, monotonic timestamp watermark, and cached
 * server fieldVersions (used on account switch / logout and in tests to simulate
 * a page reload, browser restart, or second device).
 */
export function resetClientSession(customSessionId?: string): string {
  activeClientSessionId = customSessionId || generateClientSessionId();
  lastIssuedClientTimestamp = 0;
  serverClockOffsetMs = 0;
  knownFieldVersions = null;
  return activeClientSessionId;
}

function calibrateServerClock(serverTimestampIso?: string): void {
  if (!serverTimestampIso) return;
  const serverMs = Date.parse(serverTimestampIso);
  if (Number.isFinite(serverMs)) {
    serverClockOffsetMs = serverMs - Date.now();
  }
}

function recordServerFieldVersions(fieldVersions?: Partial<PreferenceFieldVersions>): void {
  if (!fieldVersions) return;
  const nextAudio =
    typeof fieldVersions.defaultAudioMuted === 'number'
      ? fieldVersions.defaultAudioMuted
      : (knownFieldVersions?.defaultAudioMuted ?? 0);
  const nextVideo =
    typeof fieldVersions.defaultVideoOff === 'number'
      ? fieldVersions.defaultVideoOff
      : (knownFieldVersions?.defaultVideoOff ?? 0);
  knownFieldVersions = {
    defaultAudioMuted: nextAudio,
    defaultVideoOff: nextVideo,
  };
}

/**
 * Produces strictly monotonically increasing integer timestamps aligned to
 * calibrated server UTC time so even clients with skewed OS clocks stay
 * within the server's future-drift safety bound.
 */
export function nextClientTimestamp(nowOverrideMs?: number): number {
  const calibratedNow = Math.max(0, Math.trunc((nowOverrideMs ?? Date.now()) + serverClockOffsetMs));
  lastIssuedClientTimestamp =
    calibratedNow > lastIssuedClientTimestamp ? calibratedNow : lastIssuedClientTimestamp + 1;
  return lastIssuedClientTimestamp;
}

export interface UserPreferencesData {
  userId?: string;
  defaultAudioMuted: boolean;
  defaultVideoOff: boolean;
  version?: number;
  fieldVersions?: PreferenceFieldVersions;
  staleIgnored?: boolean;
  updatedAt?: string;
}

export interface PreferencesApiResponse {
  success: boolean;
  data: UserPreferencesData;
  meta?: {
    requestId: string;
    timestamp: string;
  };
}

export const preferencesApi = {
  /**
   * Fetches persisted user preferences and authoritative server fieldVersions
   * from the MongoDB backend.
   */
  async getPreferences(): Promise<UserPreferencesData | null> {
    try {
      const response = await fetchWithAuth(`${API_BASE_URL}/users/me/preferences`, {
        method: 'GET',
      });

      if (!response.ok) {
        return null;
      }

      const body: PreferencesApiResponse = await response.json();
      calibrateServerClock(body?.meta?.timestamp);
      if (body && body.success && body.data) {
        recordServerFieldVersions(body.data.fieldVersions);
        return body.data;
      }
      return null;
    } catch (err) {
      console.warn('[PreferencesApi] Failed to fetch cloud preferences:', err);
      return null;
    }
  },

  /**
   * Persists updated user preferences to the MongoDB backend with monotonic clientTimestamp,
   * per-session clientSessionId, and server-controlled expectedFieldVersions so delayed
   * requests from previous sessions or other devices receive explicit HTTP 409 conflicts
   * instead of silently overwriting newer committed preferences.
   */
  async updatePreferences(data: {
    defaultAudioMuted?: boolean;
    defaultVideoOff?: boolean;
    clientTimestamp?: number;
    clientSessionId?: string;
    expectedVersion?: number;
    expectedFieldVersions?: Partial<PreferenceFieldVersions>;
  }): Promise<{
    success: boolean;
    data?: UserPreferencesData;
    error?: string;
    status?: number;
    code?: string;
  }> {
    try {
      const payload: {
        defaultAudioMuted?: boolean;
        defaultVideoOff?: boolean;
        clientTimestamp: number;
        clientSessionId: string;
        expectedVersion?: number;
        expectedFieldVersions?: Partial<PreferenceFieldVersions>;
      } = {
        clientTimestamp:
          typeof data.clientTimestamp === 'number'
            ? data.clientTimestamp
            : nextClientTimestamp(),
        clientSessionId: data.clientSessionId || activeClientSessionId,
      };

      const inferredFieldVersions: Partial<PreferenceFieldVersions> = {};
      if (typeof data.defaultAudioMuted === 'boolean') {
        payload.defaultAudioMuted = data.defaultAudioMuted;
        if (knownFieldVersions) {
          inferredFieldVersions.defaultAudioMuted = knownFieldVersions.defaultAudioMuted;
        }
      }
      if (typeof data.defaultVideoOff === 'boolean') {
        payload.defaultVideoOff = data.defaultVideoOff;
        if (knownFieldVersions) {
          inferredFieldVersions.defaultVideoOff = knownFieldVersions.defaultVideoOff;
        }
      }

      if (typeof data.expectedVersion === 'number') {
        payload.expectedVersion = data.expectedVersion;
      } else if (data.expectedFieldVersions) {
        payload.expectedFieldVersions = data.expectedFieldVersions;
      } else if (Object.keys(inferredFieldVersions).length > 0) {
        payload.expectedFieldVersions = inferredFieldVersions;
      }

      const response = await fetchWithAuth(`${API_BASE_URL}/users/me/preferences`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return {
          success: false,
          status: response.status,
          code: errorData.code,
          error: errorData.message || `Failed with status ${response.status}`,
        };
      }

      const body: PreferencesApiResponse = await response.json();
      calibrateServerClock(body?.meta?.timestamp);
      recordServerFieldVersions(body?.data?.fieldVersions);
      return {
        success: true,
        status: response.status,
        data: body.data,
      };
    } catch (err) {
      console.warn('[PreferencesApi] Failed to update cloud preferences:', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Network error updating preferences',
      };
    }
  },
};
