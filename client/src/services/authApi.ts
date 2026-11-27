import type {
  User,
  AuthResponse,
  RegisterData,
  LoginData,
  GoogleAuthData,
  GoogleAuthConfigResponse,
  UpdateProfileData,
  UpdateEmailData,
  UpdatePasswordData,
  ApiProblemDetails,
} from '@/types/auth';

const API_BASE_URL =
  (import.meta.env?.VITE_API_BASE_URL as string) || '/api/v1';

let inMemoryAccessToken: string | null = null;
let activeAuthRefreshPromise: Promise<AuthResponse> | null = null;

export const authStorage = {
  getAccessToken: (): string | null => inMemoryAccessToken,
  setAccessToken: (token: string | null): void => {
    inMemoryAccessToken = token;
  },
};

export class ApiError extends Error {
  status: number;
  code: string;
  errors?: Array<{ field: string; message: string }>;

  constructor(details: ApiProblemDetails) {
    super(details.message);
    this.name = 'ApiError';
    this.status = details.status;
    this.code = details.code;
    this.errors = details.errors;
  }
}

async function parseErrorResponse(res: Response): Promise<ApiError> {
  try {
    const data = await res.json();
    return new ApiError({
      status: data.status || res.status,
      code: data.code || 'UNKNOWN_ERROR',
      message: data.message || 'An unexpected error occurred.',
      errors: data.errors,
      timestamp: data.timestamp || new Date().toISOString(),
    });
  } catch {
    return new ApiError({
      status: res.status,
      code: 'NETWORK_OR_SERVER_ERROR',
      message: `Request failed with status ${res.status}`,
      timestamp: new Date().toISOString(),
    });
  }
}

const csrfHeaders: Record<string, string> = {
  'X-Requested-With': 'XMLHttpRequest',
  'X-CSRF-Protection': '1',
};

async function refreshAccessToken(): Promise<string | null> {
  try {
    const authRes = await authApi.refresh();
    return authRes.accessToken || null;
  } catch {
    return null;
  }
}

export async function fetchWithAuth(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(options.headers || {});
  const token = authStorage.getAccessToken();

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  // Attach anti-CSRF headers
  headers.set('X-Requested-With', 'XMLHttpRequest');
  headers.set('X-CSRF-Protection', '1');

  const mergedOptions: RequestInit = {
    ...options,
    headers,
    credentials: 'include',
  };

  let res = await fetch(url, mergedOptions);

  // If 401 and we have a potential session to refresh (never on password verification failures)
  if (res.status === 401 && !url.includes('/auth/login') && !url.includes('/auth/refresh')) {
    const errPayload = await res
      .clone()
      .json()
      .catch(() => null);
    if (errPayload?.code !== 'INVALID_CREDENTIALS') {
      const newToken = await refreshAccessToken();
      if (newToken) {
        headers.set('Authorization', `Bearer ${newToken}`);
        res = await fetch(url, {
          ...mergedOptions,
          headers,
        });
      }
    }
  }

  return res;
}

export const authApi = {
  async register(data: RegisterData): Promise<{ success: boolean; user: User; message: string }> {
    const res = await fetch(`${API_BASE_URL}/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...csrfHeaders,
      },
      body: JSON.stringify(data),
      credentials: 'include',
    });

    if (!res.ok) {
      throw await parseErrorResponse(res);
    }

    return res.json();
  },

  async login(data: LoginData): Promise<AuthResponse> {
    const res = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...csrfHeaders,
      },
      body: JSON.stringify(data),
      credentials: 'include',
    });

    if (!res.ok) {
      throw await parseErrorResponse(res);
    }

    const authRes: AuthResponse = await res.json();
    authStorage.setAccessToken(authRes.accessToken);
    return authRes;
  },

  async getGoogleConfig(): Promise<GoogleAuthConfigResponse> {
    const res = await fetch(`${API_BASE_URL}/auth/google/config`, {
      method: 'GET',
      credentials: 'include',
    });

    if (!res.ok) {
      throw await parseErrorResponse(res);
    }

    return res.json();
  },

  async googleLogin(data: GoogleAuthData): Promise<AuthResponse> {
    const res = await fetch(`${API_BASE_URL}/auth/google`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...csrfHeaders,
      },
      body: JSON.stringify(data),
      credentials: 'include',
    });

    if (!res.ok) {
      throw await parseErrorResponse(res);
    }

    const authRes: AuthResponse = await res.json();
    authStorage.setAccessToken(authRes.accessToken);
    return authRes;
  },

  async refresh(): Promise<AuthResponse> {
    if (activeAuthRefreshPromise) {
      return activeAuthRefreshPromise;
    }

    const currentPromise: Promise<AuthResponse> = (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...csrfHeaders,
          },
          credentials: 'include',
        });

        if (!res.ok) {
          authStorage.setAccessToken(null);
          throw await parseErrorResponse(res);
        }

        const authRes: AuthResponse = await res.json();
        authStorage.setAccessToken(authRes.accessToken);
        return authRes;
      } catch (err) {
        authStorage.setAccessToken(null);
        throw err;
      }
    })().finally(() => {
      if (activeAuthRefreshPromise === currentPromise) {
        activeAuthRefreshPromise = null;
      }
    });

    activeAuthRefreshPromise = currentPromise;
    return currentPromise;
  },

  async logout(): Promise<void> {
    activeAuthRefreshPromise = null;
    try {
      await fetchWithAuth(`${API_BASE_URL}/auth/logout`, {
        method: 'POST',
        headers: csrfHeaders,
      });
    } finally {
      authStorage.setAccessToken(null);
    }
  },

  async getMe(): Promise<User> {
    const res = await fetchWithAuth(`${API_BASE_URL}/users/me`);
    if (!res.ok) {
      throw await parseErrorResponse(res);
    }
    return res.json();
  },

  async updateProfile(data: UpdateProfileData): Promise<User> {
    const res = await fetchWithAuth(`${API_BASE_URL}/users/me`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      throw await parseErrorResponse(res);
    }
    const payload = await res.json();
    return (payload?.data ?? payload) as User;
  },

  async updateEmail(data: UpdateEmailData): Promise<{ user: User; accessToken: string }> {
    const res = await fetchWithAuth(`${API_BASE_URL}/users/me/email`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      throw await parseErrorResponse(res);
    }
    const payload = await res.json();
    const result = (payload?.data ?? payload) as { user: User; accessToken: string };
    if (result?.accessToken) {
      authStorage.setAccessToken(result.accessToken);
    }
    return result;
  },

  async updatePassword(data: UpdatePasswordData): Promise<{ user: User; accessToken: string }> {
    const res = await fetchWithAuth(`${API_BASE_URL}/users/me/password`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      throw await parseErrorResponse(res);
    }
    const payload = await res.json();
    const result = (payload?.data ?? payload) as { user: User; accessToken: string };
    if (result?.accessToken) {
      authStorage.setAccessToken(result.accessToken);
    }
    return result;
  },
};
