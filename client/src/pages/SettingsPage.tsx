import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { DashboardLayout } from '@/components/dashboard/DashboardLayout';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useAuth } from '@/context/AuthContext';
import { preferencesApi, resetClientSession } from '@/services/preferencesApi';
import {
  Mic,
  Bell,
  Sun,
  ShieldCheck,
  User,
  ArrowLeft,
  Check,
  Info,
  Cloud,
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

    loadCloudPreferences();
    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Auto-dismiss transient green cloud-sync confirmation after 5s;
  // keep local-only warning banner visible so the user can explicitly retry sync.
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

      // 2. Persist to authoritative MongoDB backend with monotonic clientTimestamp
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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link
              to="/dashboard"
              className="text-xs text-[#168B83] hover:text-[#11706A] flex items-center gap-1 font-medium transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to Overview</span>
            </Link>
          </div>
          <h2 className="font-display text-2xl font-bold tracking-tight text-[#172B3A]">
            Account Settings & Preferences
          </h2>
          <p className="text-xs sm:text-sm text-[#6B8092] mt-0.5">
            Configure default room behaviors and account identity.
          </p>
        </div>

        {/* Status Badge: Genuine reflection of email verification or active session */}
        <div className="flex items-center gap-2">
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
            {/* Audio & Video Defaults Card (Screen 22) */}
            <Card className="p-6 bg-white border-[#E3E1D9] shadow-xs rounded-2xl">
              <h3 className="font-display text-sm font-bold text-[#172B3A] mb-1 flex items-center gap-2">
                <Mic className="w-4 h-4 text-[#168B83]" />
                Audio & Video Meeting Defaults
              </h3>
              <p className="text-xs text-[#6B8092] mb-4">
                These settings configure your default audio and camera state when entering pre-join lobbies.
              </p>

              <div className="space-y-4 divide-y divide-[#E3E1D9]/60">
                <div className="flex items-center justify-between pt-3 first:pt-0">
                  <div>
                    <label
                      htmlFor="setting-audio-muted"
                      className="text-xs font-semibold text-[#172B3A] cursor-pointer"
                    >
                      Join with Microphone Muted
                    </label>
                    <p className="text-[11px] text-[#6B8092]">
                      Recommended to prevent background audio disruption upon room admission.
                    </p>
                  </div>
                  <input
                    id="setting-audio-muted"
                    type="checkbox"
                    checked={audioMuted}
                    onChange={(e) => setAudioMuted(e.target.checked)}
                    aria-label="Join with microphone muted"
                    className="w-4 h-4 rounded text-[#168B83] focus:ring-[#168B83] border-[#E3E1D9] cursor-pointer"
                  />
                </div>

                <div className="flex items-center justify-between pt-3">
                  <div>
                    <label
                      htmlFor="setting-video-off"
                      className="text-xs font-semibold text-[#172B3A] cursor-pointer"
                    >
                      Join with Camera Off
                    </label>
                    <p className="text-[11px] text-[#6B8092]">
                      Keep camera feeds off until manually enabled in the pre-join lobby.
                    </p>
                  </div>
                  <input
                    id="setting-video-off"
                    type="checkbox"
                    checked={videoOff}
                    onChange={(e) => setVideoOff(e.target.checked)}
                    aria-label="Join with camera off"
                    className="w-4 h-4 rounded text-[#168B83] focus:ring-[#168B83] border-[#E3E1D9] cursor-pointer"
                  />
                </div>
              </div>
            </Card>

            {/* Notifications Card */}
            <Card className="p-6 bg-white border-[#E3E1D9] shadow-xs rounded-2xl">
              <h3 className="font-display text-sm font-bold text-[#172B3A] mb-1 flex items-center gap-2">
                <Bell className="w-4 h-4 text-[#168B83]" />
                Notification Audio & Alerts
              </h3>
              <p className="text-xs text-[#6B8092] mb-4">
                Configure chimes and in-session notifications.
              </p>

              <div className="flex items-center justify-between">
                <div>
                  <label
                    htmlFor="setting-notification-sounds"
                    className="text-xs font-semibold text-[#172B3A] cursor-pointer"
                  >
                    Play Chimes on Participant Join & Leave
                  </label>
                  <p className="text-[11px] text-[#6B8092]">
                    Audible tone when members enter or depart a room.
                  </p>
                </div>
                <input
                  id="setting-notification-sounds"
                  type="checkbox"
                  checked={notificationSounds}
                  onChange={(e) => setNotificationSounds(e.target.checked)}
                  aria-label="Play chimes on participant join and leave"
                  className="w-4 h-4 rounded text-[#168B83] focus:ring-[#168B83] border-[#E3E1D9] cursor-pointer"
                />
              </div>
            </Card>

            {/* Appearance Card */}
            <Card className="p-6 bg-white border-[#E3E1D9] shadow-xs rounded-2xl">
              <h3 className="font-display text-sm font-bold text-[#172B3A] mb-1 flex items-center gap-2">
                <Sun className="w-4 h-4 text-[#168B83]" />
                Interface Appearance
              </h3>
              <p className="text-xs text-[#6B8092] mb-3">
                Default: Modern Editorial Light Dashboard + Dark Meeting Theater.
              </p>
              <div className="p-3 bg-[#F7F6F2] rounded-xl border border-[#E3E1D9] text-xs text-[#3D5265]">
                <span className="font-semibold text-[#172B3A]">System Default:</span> Dual-surface architecture automatically switches from Warm Ivory for the Dashboard to Dark Theater Mode for video conferences.
              </div>
            </Card>

            {/* Save Button & Persistence Feedback */}
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Button type="submit" variant="primary" size="sm" disabled={isSaving}>
                  {isSaving ? 'Saving...' : 'Save Preferences'}
                </Button>
                {isSaved && cloudSyncStatus === 'synced' && (
                  <span className="text-xs text-emerald-700 font-semibold flex items-center gap-1.5 animate-in fade-in">
                    <Check className="w-4 h-4 text-emerald-600" />
                    Synchronized to Cloud Database!
                  </span>
                )}
                {isSaved && cloudSyncStatus === 'local-only' && (
                  <span className="text-xs text-amber-700 font-semibold flex items-center gap-1.5 animate-in fade-in">
                    <Info className="w-4 h-4 text-amber-600" />
                    Saved locally only — not synced to cloud
                  </span>
                )}
              </div>

              {isSaved && cloudSyncStatus === 'synced' && (
                <div className="p-3 rounded-xl bg-[#DCEDE8]/50 border border-[#168B83]/30 flex items-start gap-2.5 text-xs text-[#172B3A] animate-in fade-in">
                  <Cloud className="w-4 h-4 text-[#168B83] flex-shrink-0 mt-0.5" />
                  <p className="leading-relaxed">
                    Preferences saved and synchronized to your account in the cloud database (with local browser profile fallback). Your pre-join audio and video defaults will persist across sessions and devices.
                  </p>
                </div>
              )}

              {isSaved && cloudSyncStatus === 'local-only' && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-[#172B3A] animate-in fade-in">
                  <div className="flex items-start gap-2.5">
                    <Info className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                    <p className="leading-relaxed">
                      Preferences were saved locally in this browser only because cloud synchronization could not be reached
                      {cloudError ? ` (${cloudError})` : ''}. Changes will not sync automatically; click Retry Cloud Sync once your connection is restored.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={isSaving}
                    onClick={() => {
                      void persistPreferences();
                    }}
                    className="flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>{isSaving ? 'Retrying...' : 'Retry Cloud Sync'}</span>
                  </Button>
                </div>
              )}
            </div>
          </form>
        </div>

        {/* Right Column: Identity Card */}
        <div className="lg:col-span-4 space-y-6">
          <Card className="p-6 bg-white border-[#E3E1D9] shadow-xs rounded-2xl">
            <h3 className="font-display text-sm font-bold text-[#172B3A] mb-3 flex items-center gap-2">
              <User className="w-4 h-4 text-[#168B83]" />
              Account Identity
            </h3>

            <div className="space-y-3 text-xs">
              <div>
                <span className="text-[#6B8092] block text-[11px]">Display Name</span>
                <span className="font-semibold text-[#172B3A]">
                  {user?.firstName} {user?.lastName || ''}
                </span>
              </div>

              <div>
                <span className="text-[#6B8092] block text-[11px]">Email Address</span>
                <span className="font-mono text-[#172B3A]">{user?.email}</span>
              </div>

              <div>
                <span className="text-[#6B8092] block text-[11px]">User Identifier</span>
                <span className="font-mono text-[11px] text-[#6B8092] break-all">{user?.id}</span>
              </div>

              <div className="pt-2 border-t border-[#E3E1D9]">
                <div className="flex items-center gap-1.5 text-emerald-700 text-[11px] font-semibold">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>Argon2id + Dual Token Protection</span>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default SettingsPage;
