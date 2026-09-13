import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Menu, Search, Bell, Video, LogOut, User, Settings, Mic, MicOff, VideoOff } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useMediaStore } from '@/stores/mediaStore';
import { supabase } from '@/lib/supabase';
import { UserAvatar } from '@/components/UserAvatar';
import type { Notification } from '@/types';

export function Topbar({ onMenuClick }: { onMenuClick: () => void }) {
  const navigate = useNavigate();
  const profile = useAuthStore((s) => s.profile);
  const signOut = useAuthStore((s) => s.signOut);
  const { micOn, cameraOn, toggleMic, toggleCamera } = useMediaStore();
  const [showProfile, setShowProfile] = useState(false);
  const [showNotifs, setShowNotifs] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const profileRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function loadNotifs() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(10);
      setNotifications(data || []);
      setUnreadCount((data || []).filter((n) => !n.read).length);
    }
    loadNotifs();
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setShowProfile(false);
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setShowNotifs(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  async function handleSignOut() {
    await signOut();
    navigate('/');
  }

  return (
    <header className="sticky top-0 z-20 bg-white/80 dark:bg-gray-950/80 backdrop-blur-lg border-b border-gray-200 dark:border-gray-800">
      <div className="flex items-center justify-between h-16 px-4 lg:px-6">
        <div className="flex items-center gap-3">
          <button onClick={onMenuClick} className="lg:hidden text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
            <Menu className="w-6 h-6" />
          </button>
          <div className="relative hidden md:block">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search meetings, contacts..."
              className="w-64 pl-9 pr-4 py-2 rounded-lg bg-gray-100 dark:bg-gray-900 text-sm text-gray-900 dark:text-white border border-transparent focus:border-blue-500 focus:bg-white dark:focus:bg-gray-800 outline-none transition"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                  navigate(`/contacts?q=${encodeURIComponent(e.currentTarget.value)}`);
                }
              }}
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Automatic Hardware Status Indicator */}
          <div
            title="Browser Microphone & Camera automatically activated"
            className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/80 dark:border-emerald-800/60 text-emerald-700 dark:text-emerald-300 text-xs font-semibold shadow-xs"
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => toggleMic()}
                className="hover:opacity-80 transition flex items-center gap-1"
                title={micOn ? 'Microphone is ON (Click to mute)' : 'Microphone is OFF (Click to unmute)'}
              >
                {micOn ? <Mic className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> : <MicOff className="w-3.5 h-3.5 text-slate-400" />}
              </button>
              <span className="text-slate-300 dark:text-gray-700">|</span>
              <button
                onClick={() => toggleCamera()}
                className="hover:opacity-80 transition flex items-center gap-1"
                title={cameraOn ? 'Camera is ON (Click to turn off)' : 'Camera is OFF (Click to turn on)'}
              >
                {cameraOn ? <Video className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> : <VideoOff className="w-3.5 h-3.5 text-slate-400" />}
              </button>
              <span className="text-[11px] font-bold uppercase tracking-wider ml-0.5 text-emerald-800 dark:text-emerald-300">
                {micOn && cameraOn ? 'Auto Live' : micOn ? 'Mic Live' : cameraOn ? 'Cam Live' : 'Muted'}
              </span>
            </div>
          </div>

          <button
            onClick={() => navigate('/dashboard?new=true')}
            className="flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition shadow-lg shadow-blue-600/20"
          >
            <Video className="w-4 h-4" />
            <span className="hidden sm:inline">New Meeting</span>
          </button>

          {/* Notifications */}
          <div className="relative" ref={notifRef}>
            <button
              onClick={() => setShowNotifs(!showNotifs)}
              className="relative w-10 h-10 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-900 flex items-center justify-center text-gray-600 dark:text-gray-400 transition"
            >
              <Bell className="w-5 h-5" />
              {unreadCount > 0 && (
                <span className="absolute top-1.5 right-1.5 w-4 h-4 bg-rose-500 text-white text-xs font-bold rounded-full flex items-center justify-center">
                  {unreadCount}
                </span>
              )}
            </button>
            {showNotifs && (
              <div className="absolute right-0 mt-2 w-80 bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
                <div className="p-3 border-b border-gray-200 dark:border-gray-800">
                  <h3 className="font-semibold text-gray-900 dark:text-white">Notifications</h3>
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {notifications.length === 0 ? (
                    <p className="p-4 text-sm text-gray-500 text-center">No notifications yet</p>
                  ) : (
                    notifications.map((n) => (
                      <div key={n.id} className={`p-3 border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 transition ${!n.read ? 'bg-blue-50 dark:bg-blue-950/20' : ''}`}>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">{n.title}</p>
                        {n.body && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{n.body}</p>}
                      </div>
                    ))
                  )}
                </div>
                <button
                  onClick={() => { navigate('/notifications'); setShowNotifs(false); }}
                  className="w-full p-3 text-sm text-blue-600 dark:text-blue-400 hover:bg-gray-50 dark:hover:bg-gray-800 font-medium"
                >
                  View all
                </button>
              </div>
            )}
          </div>

          {/* Profile */}
          <div className="relative" ref={profileRef}>
            <button
              onClick={() => setShowProfile(!showProfile)}
              className="flex items-center gap-2 hover:bg-gray-100 dark:hover:bg-gray-900 rounded-lg p-1 transition"
            >
              <UserAvatar
                name={profile?.full_name}
                email={profile?.email}
                avatarUrl={profile?.avatar_url}
                size="sm"
              />
            </button>
            {showProfile && (
              <div className="absolute right-0 mt-2 w-56 bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
                <div className="p-3 border-b border-gray-200 dark:border-gray-800">
                  <p className="font-semibold text-gray-900 dark:text-white text-sm">{profile?.full_name}</p>
                  <p className="text-xs text-gray-500 truncate">{profile?.email}</p>
                </div>
                <div className="p-1">
                  <button onClick={() => { navigate('/profile'); setShowProfile(false); }} className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg flex items-center gap-2">
                    <User className="w-4 h-4" /> Profile
                  </button>
                  <button onClick={() => { navigate('/settings'); setShowProfile(false); }} className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg flex items-center gap-2">
                    <Settings className="w-4 h-4" /> Settings
                  </button>
                  <button onClick={handleSignOut} className="w-full text-left px-3 py-2 text-sm text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg flex items-center gap-2">
                    <LogOut className="w-4 h-4" /> Sign Out
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
