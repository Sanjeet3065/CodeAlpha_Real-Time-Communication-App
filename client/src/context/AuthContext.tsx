import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import type { User, LoginData, RegisterData, GoogleAuthData } from '@/types/auth';
import { authApi } from '@/services/authApi';

export interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (data: LoginData) => Promise<void>;
  loginWithGoogle: (data: GoogleAuthData) => Promise<void>;
  register: (data: RegisterData) => Promise<{ success: boolean; user: User }>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  updateUser: (updated: User) => void;
  updateUserPreferences: (prefs: {
    defaultAudioMuted?: boolean;
    defaultVideoOff?: boolean;
  }) => void;
}

// eslint-disable-next-line react-refresh/only-export-components
export const AuthContext = createContext<AuthContextType | undefined>(undefined);

const UI_USER_CACHE_KEY = 'cly_ui_user_cache';

function readCachedUiUser(): User | null {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return null;
    const raw = window.sessionStorage.getItem(UI_USER_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as User;
    if (!parsed || typeof parsed.id !== 'string' || typeof parsed.email !== 'string') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeCachedUiUser(user: User | null): void {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return;
    if (!user) {
      window.sessionStorage.removeItem(UI_USER_CACHE_KEY);
      return;
    }
    const safeSummary: User = {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      avatarUrl: user.avatarUrl ?? null,
      avatarColor: user.avatarColor,
      isEmailVerified: user.isEmailVerified,
      preferences: user.preferences,
    };
    window.sessionStorage.setItem(UI_USER_CACHE_KEY, JSON.stringify(safeSummary));
  } catch {
    // Ignore storage errors
  }
}

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(() => readCachedUiUser());
  const [isLoading, setIsLoading] = useState<boolean>(() => readCachedUiUser() === null);

  const setUserAndCache = useCallback((nextUser: User | null) => {
    setUser(nextUser);
    writeCachedUiUser(nextUser);
  }, []);

  const initAuth = useCallback(async () => {
    try {
      const response = await authApi.refresh();
      if (response && response.user) {
        setUserAndCache(response.user);
      } else {
        setUserAndCache(null);
      }
    } catch {
      setUserAndCache(null);
    } finally {
      setIsLoading(false);
    }
  }, [setUserAndCache]);

  useEffect(() => {
    initAuth();
  }, [initAuth]);

  const login = async (data: LoginData): Promise<void> => {
    const response = await authApi.login(data);
    setUserAndCache(response.user);
  };

  const loginWithGoogle = async (data: GoogleAuthData): Promise<void> => {
    const response = await authApi.googleLogin(data);
    setUserAndCache(response.user);
  };

  const register = async (
    data: RegisterData
  ): Promise<{ success: boolean; user: User }> => {
    const response = await authApi.register(data);
    return response;
  };

  const logout = async (): Promise<void> => {
    try {
      await authApi.logout();
    } finally {
      // Remove any legacy unscoped preference cache key to prevent cross-account bleed
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          localStorage.removeItem('cly_meeting_preferences');
        }
      } catch {
        // Ignore storage errors
      }
      setUserAndCache(null);
    }
  };

  const refreshUser = async (): Promise<void> => {
    try {
      const profile = await authApi.getMe();
      setUserAndCache(profile);
    } catch (err) {
      console.error('[AuthContext] Failed to refresh profile:', err);
    }
  };

  const updateUser = useCallback(
    (updated: User): void => {
      setUserAndCache(updated);
    },
    [setUserAndCache]
  );

  const updateUserPreferences = useCallback(
    (prefs: { defaultAudioMuted?: boolean; defaultVideoOff?: boolean }): void => {
      setUser((prev) => {
        if (!prev) return prev;
        const next: User = {
          ...prev,
          preferences: {
            defaultAudioMuted:
              prefs.defaultAudioMuted ?? prev.preferences?.defaultAudioMuted ?? true,
            defaultVideoOff:
              prefs.defaultVideoOff ?? prev.preferences?.defaultVideoOff ?? false,
            enableVirtualBackground: prev.preferences?.enableVirtualBackground ?? false,
            theme: prev.preferences?.theme ?? 'editorial-light',
            notificationSounds: prev.preferences?.notificationSounds ?? true,
          },
        };
        writeCachedUiUser(next);
        return next;
      });
    },
    []
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: Boolean(user),
        isLoading,
        login,
        loginWithGoogle,
        register,
        logout,
        refreshUser,
        updateUser,
        updateUserPreferences,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
