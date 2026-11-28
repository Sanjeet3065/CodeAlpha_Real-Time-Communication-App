import React, { useState, useEffect, useRef } from 'react';
import { DashboardLayout } from '@/components/dashboard/DashboardLayout';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { StudioSwitch } from '@/components/ui/StudioSwitch';
import { EditProfileModal } from '@/components/dashboard/EditProfileModal';
import { useAuth } from '@/context/AuthContext';
import { preferencesApi, resetClientSession } from '@/services/preferencesApi';
import { cn } from '@/lib/utils';
import { STUDIO_ALERT_WARNING_CLASS } from '@/lib/studioTokens';
import {
  Mic,
  Bell,
  Sun,
  User,
  Check,
  Info,
  RefreshCw,
} from 'lucide-react';

const PREFERENCES_STORAGE_KEY_PREFIX = 'cly_meeting_preferences';

const getUserStorageKey = (userId?: string): string | null => {
  return userId ? `${PREFERENCES_STORAGE_KEY_PREFIX}_${userId}` : null;
};

const readUserScopedCache = (
  userId?: string
): {
  defaultAudioMuted?: boolean;
  defaultVideoOff?: boolean;
  notificationSounds?: boolean;
} | null => {
  const key = getUserStorageKey(userId);
  if (!key || typeof window === 'undefined' || !window.localStorage) {
    return null;
  }
  try {
    const stored = localStorage.getItem(key);
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

export const SettingsPage: React.FC = () => {
  const { user, updateUserPreferences } = useAuth();
  const latestSaveSeqRef = useRef<number>(0);

  // Authoritative precedence: user.preferences (from auth/cloud) -> user-scoped localStorage cache -> defaults.
  // Never read shared unscoped localStorage keys to prevent cross-account leakage.
  const [audioMuted, setAudioMuted] = useState<boolean>(() => {
    if (typeof user?.preferences?.defaultAudioMuted === 'boolean') {
      return user.preferences.defaultAudioMuted;
    }
    const cached = readUserScopedCache(user?.id);
    if (typeof cached?.defaultAudioMuted === 'boolean') {
      return cached.defaultAudioMuted;
    }
    return true;
  });

  const [videoOff, setVideoOff] = useState<boolean>(() => {
    if (typeof user?.preferences?.defaultVideoOff === 'boolean') {
      return user.preferences.defaultVideoOff;
    }
    const cached = readUserScopedCache(user?.id);
    if (typeof cached?.defaultVideoOff === 'boolean') {
      return cached.defaultVideoOff;
    }
    return false;
  });

  const [notificationSounds, setNotificationSounds] = useState<boolean>(() => {
    const cached = readUserScopedCache(user?.id);
    if (typeof cached?.notificationSounds === 'boolean') {
      return cached.notificationSounds;
    }
    return user?.preferences?.notificationSounds ?? true;
  });

  const [isSaved, setIsSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [cloudSyncStatus, setCloudSyncStatus] = useState<'idle' | 'synced' | 'local-only'>('idle');
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [isEditProfileOpen, setIsEditProfileOpen] = useState(false);

  // Synchronize on mount and whenever authenticated account switches
  useEffect(() => {
    let isMounted = true;
    const activeUserId = user?.id;

    // Invalidate any in-flight save responses and cached field versions from a previous account session
    latestSaveSeqRef.current += 1;
    resetClientSession();
    setIsSaved(false);
    setCloudSyncStatus('idle');
    setCloudError(null);

    // Seed from authoritative AuthContext preferences or strictly user-scoped localStorage
    if (activeUserId) {
      const cached = readUserScopedCache(activeUserId);
      setAudioMuted(
        typeof user?.preferences?.defaultAudioMuted === 'boolean'
          ? user.preferences.defaultAudioMuted
          : (cached?.defaultAudioMuted ?? true)
      );
      setVideoOff(
        typeof user?.preferences?.defaultVideoOff === 'boolean'
          ? user.preferences.defaultVideoOff
          : (cached?.defaultVideoOff ?? false)
      );
      setNotificationSounds(
        typeof cached?.notificationSounds === 'boolean'
          ? cached.notificationSounds
          : (user?.preferences?.notificationSounds ?? true)
      );
    }

    const loadCloudPreferences = async () => {
      if (!activeUserId) return;
      try {
        const cloudPrefs = await preferencesApi.getPreferences();
        if (cloudPrefs && isMounted) {
          setAudioMuted(cloudPrefs.defaultAudioMuted);
          setVideoOff(cloudPrefs.defaultVideoOff);
          updateUserPreferences({
            defaultAudioMuted: cloudPrefs.defaultAudioMuted,
            defaultVideoOff: cloudPrefs.defaultVideoOff,
          });
          try {
            const key = getUserStorageKey(activeUserId);
            if (key) {
              const stored = localStorage.getItem(key);
              const parsed = stored ? JSON.parse(stored) : {};
              const payload = JSON.stringify({
                ...parsed,
                defaultAudioMuted: cloudPrefs.defaultAudioMuted,
                defaultVideoOff: cloudPrefs.defaultVideoOff,
                updatedAt: cloudPrefs.updatedAt || new Date().toISOString(),
              });
              localStorage.setItem(key, payload);
            }
          } catch {
            // Local storage access error handled silently
          }
        }
      } catch (err) {
        console.warn('[Settings] Cloud preferences sync failed on mount:', err);
      }
    };

    void loadCloudPreferences();
    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Auto-dismiss transient cloud-sync confirmation after 5s;
  // keep local-only warning visible so the user can explicitly retry sync.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (isSaved && cloudSyncStatus === 'synced') {
      timer = setTimeout(() => setIsSaved(false), 5000);
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [isSaved, cloudSyncStatus]);

  const persistPreferences = async () => {
    const activeUserId = user?.id;
    setIsSaving(true);
    const currentSeq = ++latestSaveSeqRef.current;

    try {
      // 1. Persist strictly to user-scoped localStorage cache (never a shared unscoped key)
      const userKey = getUserStorageKey(activeUserId);
      if (userKey && typeof window !== 'undefined' && window.localStorage) {
        const preferencesPayload = {
          defaultAudioMuted: audioMuted,
          defaultVideoOff: videoOff,
          notificationSounds,
          updatedAt: new Date().toISOString(),
        };
        localStorage.setItem(userKey, JSON.stringify(preferencesPayload));
      }

      // 2. Persist to authoritative Supabase-backed backend with monotonic clientTimestamp
      const cloudRes = await preferencesApi.updatePreferences({
        defaultAudioMuted: audioMuted,
        defaultVideoOff: videoOff,
      });

      // Stale request guard: discard older response if a newer save or account switch occurred
      if (currentSeq !== latestSaveSeqRef.current) {
        return;
      }

      if (cloudRes.success) {
        const committedAudio = cloudRes.data?.defaultAudioMuted ?? audioMuted;
        const committedVideo = cloudRes.data?.defaultVideoOff ?? videoOff;
        setAudioMuted(committedAudio);
        setVideoOff(committedVideo);
        updateUserPreferences({
          defaultAudioMuted: committedAudio,
          defaultVideoOff: committedVideo,
        });
        if (userKey && typeof window !== 'undefined' && window.localStorage) {
          localStorage.setItem(
            userKey,
            JSON.stringify({
              defaultAudioMuted: committedAudio,
              defaultVideoOff: committedVideo,
              notificationSounds,
              updatedAt: cloudRes.data?.updatedAt || new Date().toISOString(),
            })
          );
        }
        setCloudSyncStatus('synced');
        setCloudError(null);
      } else {
        if (cloudRes.status === 409) {
          // Refresh authoritative server fieldVersions so the user's next retry uses fresh server versions
          await preferencesApi.getPreferences();
        }
        setCloudSyncStatus('local-only');
        setCloudError(cloudRes.error || null);
      }
      setIsSaved(true);
    } catch (err) {
      if (currentSeq === latestSaveSeqRef.current) {
        console.error('[Settings] Failed to save preferences to cloud:', err);
        setCloudSyncStatus('local-only');
        setCloudError(err instanceof Error ? err.message : 'Network error');
        setIsSaved(true);
      }
    } finally {
      if (currentSeq === latestSaveSeqRef.current) {
        setIsSaving(false);
      }
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    await persistPreferences();
  };

  return (
    <DashboardLayout
      title="Account Settings"
      subtitle="Configure hardware join defaults, appearance, and notifications"
    >
      {/* Contextual Summary Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <p className="text-xs sm:text-sm text-[#555D66] dark:text-[#A3AAB2]">
          Configure default room behavior, theme, and account identity.
        </p>

        <div className="flex items-center gap-2 shrink-0">
          {user?.isEmailVerified === true ? (
            <Badge variant="success">Verified Email</Badge>
          ) : user?.isEmailVerified === false ? (
            <Badge variant="warning">Email Unverified</Badge>
          ) : (
            <Badge variant="neutral">Session Active</Badge>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Preferences Form */}
        <div className="lg:col-span-8 space-y-6">
          <form onSubmit={handleSave} className="space-y-6">
            {/* Audio & Video Defaults Card */}
            <Card className="p-6 bg-[#FAF9F6] dark:bg-[#1C1F24] border-[#DDDAD0] dark:border-[#2B3038] shadow-cly-sm rounded-2xl">
              <h3 className="font-display text-sm font-bold text-[#1F2428] dark:text-[#EAECEE] mb-1 flex items-center gap-2">
                <Mic className="w-4 h-4 text-[#2F6F68] dark:text-[#5FA399]" aria-hidden="true" />
                Audio & Video Meeting Defaults
              </h3>
              <p className="text-xs text-[#555D66] dark:text-[#A3AAB2] mb-4">
                These settings configure your default audio and camera state when entering pre-join lobbies.
              </p>

              <div className="space-y-4 divide-y divide-[#DDDAD0]/70 dark:divide-[#2B3038]">
                <StudioSwitch
                  mode="checkbox"
                  id="setting-audio-muted"
                  checked={audioMuted}
                  onChange={setAudioMuted}
                  label="Join with Microphone Muted"
                  description="Recommended to prevent background audio disruption upon room admission."
                />

                <StudioSwitch
                  mode="checkbox"
                  id="setting-video-off"
                  checked={videoOff}
                  onChange={setVideoOff}
                  label="Join with Camera Off"
                  description="Keep camera feeds off until manually enabled in the pre-join lobby."
                  className="pt-4"
                />
              </div>
            </Card>

            {/* Notifications Card */}
            <Card className="p-6 bg-[#FAF9F6] dark:bg-[#1C1F24] border-[#DDDAD0] dark:border-[#2B3038] shadow-cly-sm rounded-2xl">
              <h3 className="font-display text-sm font-bold text-[#1F2428] dark:text-[#EAECEE] mb-1 flex items-center gap-2">
                <Bell className="w-4 h-4 text-[#2F6F68] dark:text-[#5FA399]" aria-hidden="true" />
                Notification Audio & Alerts
              </h3>
              <p className="text-xs text-[#555D66] dark:text-[#A3AAB2] mb-4">
                Configure chimes and in-session notifications.
              </p>

              <StudioSwitch
                mode="checkbox"
                id="setting-notification-sounds"
                checked={notificationSounds}
                onChange={setNotificationSounds}
                label="Play Chimes on Participant Join & Leave"
                description="Audible tone when members enter or depart a room."
              />
            </Card>

            {/* Appearance Card */}
            <Card className="p-6 bg-[#FAF9F6] dark:bg-[#1C1F24] border-[#DDDAD0] dark:border-[#2B3038] shadow-cly-sm rounded-2xl">
              <h3 className="font-display text-sm font-bold text-[#1F2428] dark:text-[#EAECEE] mb-1 flex items-center gap-2">
                <Sun className="w-4 h-4 text-[#2F6F68] dark:text-[#5FA399]" aria-hidden="true" />
                Interface Appearance
              </h3>
              <p className="text-xs text-[#555D66] dark:text-[#A3AAB2] mb-4">
                Choose your matte workspace theme across Landing, Dashboard, and Pre-Join Lobby. Meeting theater stays low-glare dark matte for clear video contrast.
              </p>
              <ThemeToggle variant="segmented" />
            </Card>

            {/* Consolidated Save Button & Single Status Indicator */}
            <div className="space-y-3">
              <div className="flex items-center gap-3 flex-wrap">
                <Button type="submit" variant="primary" size="sm" disabled={isSaving}>
                  {isSaving ? 'Saving...' : 'Save Preferences'}
                </Button>

                {isSaving && (
                  <span
                    role="status"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-[#EAE8E1] dark:bg-[#24282E] border border-[#DDDAD0] dark:border-[#2A2F37] text-[#555D66] dark:text-[#A3AAB2]"
                  >
                    <RefreshCw className="w-3 h-3 animate-spin" aria-hidden="true" />
                    <span>Saving...</span>
                  </span>
                )}

                {!isSaving && isSaved && cloudSyncStatus === 'synced' && (
                  <span
                    role="status"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-[#E2ECE9] dark:bg-[#1F302E] border border-[#2F6F68]/25 dark:border-[#5FA399]/30 text-[#2F6F68] dark:text-[#5FA399] cly-animate-fade"
                  >
                    <Check className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Saved</span>
                  </span>
                )}
              </div>

              {!isSaving && isSaved && cloudSyncStatus === 'local-only' && (
                <div
                  role="status"
                  className={cn(
                    'p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs cly-animate-fade',
                    STUDIO_ALERT_WARNING_CLASS
                  )}
                >
                  <div className="flex items-start gap-2.5 min-w-0">
                    <Info className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                    <p className="leading-relaxed">
                      Saved locally — click Retry to sync.
                      {cloudError ? ` (${cloudError})` : ''}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isSaving}
                    onClick={() => {
                      void persistPreferences();
                    }}
                    leftIcon={<RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />}
                    className="whitespace-nowrap shrink-0"
                  >
                    Retry
                  </Button>
                </div>
              )}
            </div>
          </form>
        </div>

        {/* Right Column: Identity Card */}
        <div className="lg:col-span-4 space-y-6">
          <Card className="p-6 bg-[#FAF9F6] dark:bg-[#1C1F24] border-[#DDDAD0] dark:border-[#2B3038] shadow-cly-sm rounded-2xl">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-display text-sm font-bold text-[#1F2428] dark:text-[#EAECEE] flex items-center gap-2">
                <User className="w-4 h-4 text-[#2F6F68] dark:text-[#5FA399]" aria-hidden="true" />
                Account Identity
              </h3>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsEditProfileOpen(true)}
              >
                Edit Profile
              </Button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <span className="text-[#555D66] dark:text-[#A3AAB2] block text-[11px]">
                  Display Name
                </span>
                <span className="font-semibold text-[#1F2428] dark:text-[#EAECEE]">
                  {user?.firstName} {user?.lastName || ''}
                </span>
              </div>

              {user?.jobTitle && (
                <div>
                  <span className="text-[#555D66] dark:text-[#A3AAB2] block text-[11px]">
                    Role / Title
                  </span>
                  <span className="font-medium text-[#1F2428] dark:text-[#EAECEE]">
                    {user.jobTitle}
                  </span>
                </div>
              )}

              <div>
                <span className="text-[#555D66] dark:text-[#A3AAB2] block text-[11px]">
                  Email Address
                </span>
                <span className="font-mono text-[#1F2428] dark:text-[#EAECEE]">
                  {user?.email}
                </span>
              </div>

              {user?.timeZone && (
                <div>
                  <span className="text-[#555D66] dark:text-[#A3AAB2] block text-[11px]">
                    Time Zone
                  </span>
                  <span className="text-[#1F2428] dark:text-[#EAECEE]">{user.timeZone}</span>
                </div>
              )}

              {user?.bio && (
                <div>
                  <span className="text-[#555D66] dark:text-[#A3AAB2] block text-[11px]">
                    Bio
                  </span>
                  <p className="text-[#555D66] dark:text-[#A3AAB2] leading-relaxed">
                    {user.bio}
                  </p>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>

      <EditProfileModal
        isOpen={isEditProfileOpen}
        onClose={() => setIsEditProfileOpen(false)}
      />
    </DashboardLayout>
  );
};

export default SettingsPage;
