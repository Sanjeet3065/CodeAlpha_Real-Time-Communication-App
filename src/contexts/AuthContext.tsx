import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { useThemeStore } from '@/stores/themeStore';
import type { Profile } from '@/types';

const AuthContext = createContext(null);

async function loadProfile(sessionUser: any, setProfile: (profile: any) => void, setLoading: (loading: boolean) => void) {
  try {
    let { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', sessionUser.id)
      .maybeSingle();

    if (!data && sessionUser) {
      const meta = sessionUser.user_metadata || {};
            const newProfile: Profile = {
              id: sessionUser.id,
              email: sessionUser.email || '',
              full_name: meta.full_name || meta.name || sessionUser.email?.split('@')[0] || 'User',
              avatar_url: meta.avatar_url || meta.picture || null,
              bio: '',
              timezone: 'UTC',
              settings: {
                theme: 'system',
                micEnabled: true,
                cameraEnabled: true,
                waitingRoom: false,
                chatEnabled: true,
                screenShareEnabled: true,
                whiteboardPermission: 'everyone',
              },
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
            const { data: created } = await supabase
              .from('profiles')
              .upsert(newProfile)
              .select()
              .maybeSingle();
            data = created || newProfile;

            try {
              await supabase
                .from('user_information')
                .upsert(newProfile);
            } catch {
              // Ignore if user_information table doesn't exist
            }
    }

    setProfile(data);
  } catch (err) {
    console.error('Failed to load profile:', err);
  } finally {
    setLoading(false);
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const setSession = useAuthStore((s) => s.setSession);
  const setProfile = useAuthStore((s) => s.setProfile);
  const setLoading = useAuthStore((s) => s.setLoading);
  const initTheme = useThemeStore((s) => s.init);

  useEffect(() => {
    initTheme();

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) {
        loadProfile(session.user, setProfile, setLoading);
      } else {
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) {
        loadProfile(session.user, setProfile, setLoading);
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, [setSession, setProfile, setLoading, initTheme]);

  return <AuthContext.Provider value={null}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
