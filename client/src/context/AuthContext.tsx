import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import type { User, LoginData, RegisterData } from '@/types/auth';
import { authApi } from '@/services/authApi';

export interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (data: LoginData) => Promise<void>;
  register: (data: RegisterData) => Promise<{ success: boolean; user: User }>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  updateUserPreferences: (prefs: {
    defaultAudioMuted?: boolean;
    defaultVideoOff?: boolean;
  }) => void;
}

// eslint-disable-next-line react-refresh/only-export-components
export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const initAuth = useCallback(async () => {
    try {
      const response = await authApi.refresh();
      if (response && response.user) {
        setUser(response.user);
      }
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    initAuth();
  }, [initAuth]);

  const login = async (data: LoginData): Promise<void> => {
    const response = await authApi.login(data);
    setUser(response.user);
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
      setUser(null);
    }
  };

  const refreshUser = async (): Promise<void> => {
    try {
      const profile = await authApi.getMe();
      setUser(profile);
    } catch (err) {
      console.error('[AuthContext] Failed to refresh profile:', err);
    }
  };

  const updateUserPreferences = useCallback(
    (prefs: { defaultAudioMuted?: boolean; defaultVideoOff?: boolean }): void => {
      setUser((prev) => {
        if (!prev) return prev;
        return {
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
        register,
        logout,
        refreshUser,
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
