import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sun, Moon, Monitor, Mic, Video, Shield, Bell, Globe, Save, Loader2 } from 'lucide-react';
import { DashboardLayout } from '@/layouts/DashboardLayout';
import { useAuthStore } from '@/stores/authStore';
import { useThemeStore } from '@/stores/themeStore';
import { updateSettings } from '@/services/meetingApi';
import { supabase } from '@/lib/supabase';
import { toast } from '@/stores/toastStore';
import type { UserSettings } from '@/types';

const DEFAULT_SETTINGS: UserSettings = {
  theme: 'system',
  micEnabled: true,
  cameraEnabled: true,
  waitingRoom: false,
  chatEnabled: true,
  screenShareEnabled: true,
  whiteboardPermission: 'everyone',
};

export function SettingsPage() {
  const navigate = useNavigate();
  const profile = useAuthStore((s) => s.profile);
  const setProfile = useAuthStore((s) => s.setProfile);
  const { theme, setTheme } = useThemeStore();
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<UserSettings>(profile?.settings || DEFAULT_SETTINGS);

  useEffect(() => {
    if (profile?.settings) setSettings(profile.settings);
  }, [profile]);

  async function handleSave() {
    setSaving(true);
    try {
      await updateSettings(settings);
      const { data: updated } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', profile?.id)
        .maybeSingle();
      if (updated) setProfile(updated);
      toast.success('Settings saved');
    } catch (err: any) {
      toast.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  }

  function Toggle({ enabled, onChange, disabled }: { enabled: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
    return (
      <button
        onClick={() => !disabled && onChange(!enabled)}
        disabled={disabled}
        className={`w-12 h-6 rounded-full transition-colors ${enabled ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-700'} ${disabled ? 'opacity-50' : ''}`}
      >
        <div className={`w-5 h-5 rounded-full bg-white shadow transition-transform mt-0.5 ${enabled ? 'translate-x-6' : 'translate-x-0.5'}`} />
      </button>
    );
  }

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Settings</h1>

        {/* General / Theme */}
        <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 mb-4">
          <div className="flex items-center gap-2 mb-4">
            <Globe className="w-5 h-5 text-gray-400" />
            <h2 className="font-semibold text-gray-900 dark:text-white">General</h2>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Theme</label>
            <div className="flex gap-2">
              {[
                { value: 'light' as const, label: 'Light', icon: Sun },
                { value: 'dark' as const, label: 'Dark', icon: Moon },
                { value: 'system' as const, label: 'System', icon: Monitor },
              ].map((t) => (
                <button
                  key={t.value}
                  onClick={() => { setTheme(t.value); setSettings({ ...settings, theme: t.value }); }}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border transition ${
                    theme === t.value
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400'
                      : 'border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
                  }`}
                >
                  <t.icon className="w-4 h-4" />
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Audio & Video */}
        <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 mb-4">
          <div className="flex items-center gap-2 mb-4">
            <Mic className="w-5 h-5 text-gray-400" />
            <h2 className="font-semibold text-gray-900 dark:text-white">Audio & Video Defaults</h2>
          </div>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-white">Microphone enabled by default</p>
                <p className="text-xs text-gray-500">Turn on microphone when joining meetings</p>
              </div>
              <Toggle enabled={settings.micEnabled} onChange={(v) => setSettings({ ...settings, micEnabled: v })} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-white">Camera enabled by default</p>
                <p className="text-xs text-gray-500">Turn on camera when joining meetings</p>
              </div>
              <Toggle enabled={settings.cameraEnabled} onChange={(v) => setSettings({ ...settings, cameraEnabled: v })} />
            </div>
          </div>
        </section>

        {/* Meeting defaults */}
        <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 mb-4">
          <div className="flex items-center gap-2 mb-4">
            <Video className="w-5 h-5 text-gray-400" />
            <h2 className="font-semibold text-gray-900 dark:text-white">Meeting Defaults</h2>
          </div>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-white">Waiting room</p>
                <p className="text-xs text-gray-500">Require host approval before joining</p>
              </div>
              <Toggle enabled={settings.waitingRoom} onChange={(v) => setSettings({ ...settings, waitingRoom: v })} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-white">Chat enabled</p>
                <p className="text-xs text-gray-500">Allow participants to send messages</p>
              </div>
              <Toggle enabled={settings.chatEnabled} onChange={(v) => setSettings({ ...settings, chatEnabled: v })} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-white">Screen sharing enabled</p>
                <p className="text-xs text-gray-500">Allow participants to share their screen</p>
              </div>
              <Toggle enabled={settings.screenShareEnabled} onChange={(v) => setSettings({ ...settings, screenShareEnabled: v })} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-white">Whiteboard permission</p>
                <p className="text-xs text-gray-500">Who can draw on the whiteboard</p>
              </div>
              <select
                value={settings.whiteboardPermission}
                onChange={(e) => setSettings({ ...settings, whiteboardPermission: e.target.value as 'everyone' | 'host' })}
                className="px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white text-sm outline-none border border-gray-300 dark:border-gray-700"
              >
                <option value="everyone">Everyone</option>
                <option value="host">Host only</option>
              </select>
            </div>
          </div>
        </section>

        {/* Privacy */}
        <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 mb-4">
          <div className="flex items-center gap-2 mb-4">
            <Shield className="w-5 h-5 text-gray-400" />
            <h2 className="font-semibold text-gray-900 dark:text-white">Privacy</h2>
          </div>
          <div className="space-y-3">
            <button onClick={() => navigate('/profile')} className="w-full text-left p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition text-sm text-gray-700 dark:text-gray-300">
              Change password
            </button>
            <button onClick={() => navigate('/profile')} className="w-full text-left p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition text-sm text-gray-700 dark:text-gray-300">
              Manage profile
            </button>
          </div>
        </section>

        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
          Save Settings
        </button>
      </div>
    </DashboardLayout>
  );
}
