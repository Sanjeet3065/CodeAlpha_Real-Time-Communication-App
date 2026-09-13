import { useState, useEffect } from 'react';
import { Bell, Check, Loader2 } from 'lucide-react';
import { DashboardLayout } from '@/layouts/DashboardLayout';
import { EmptyState } from '@/components/LoadingStates';
import { getNotifications, markNotificationRead } from '@/services/meetingApi';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { formatTime, formatDate } from '@/lib/utils';
import type { Notification as AppNotification } from '@/types';

export function NotificationsPage() {
  const profile = useAuthStore((s) => s.profile);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadNotifications();

    if (!profile?.id) return;
    const channelName = `notifications:${profile.id}`;
    const existingChannel = supabase.getChannels().find((ch: any) => ch.topic === channelName);
    if (existingChannel) {
      supabase.removeChannel(existingChannel);
    }

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${profile.id}` },
        (payload) => {
          setNotifications((prev) => [payload.new as AppNotification, ...prev]);
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [profile?.id]);

  async function loadNotifications() {
    try {
      const n = await getNotifications();
      setNotifications(n);
    } catch (err) {
      // silent
    } finally {
      setLoading(false);
    }
  }

  async function handleMarkRead(id: string) {
    try {
      await markNotificationRead(id);
      setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, read: true } : n));
    } catch (err) {
      // silent
    }
  }

  async function handleMarkAllRead() {
    const unread = notifications.filter((n) => !n.read);
    for (const n of unread) {
      await handleMarkRead(n.id);
    }
  }

  return (
    <DashboardLayout>
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Notifications</h1>
          {notifications.some((n) => !n.read) && (
            <button onClick={handleMarkAllRead} className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30 rounded-lg transition">
              <Check className="w-4 h-4" /> Mark all read
            </button>
          )}
        </div>

        {loading ? (
          <div className="text-center py-12"><Loader2 className="w-8 h-8 animate-spin text-blue-500 mx-auto" /></div>
        ) : notifications.length === 0 ? (
          <EmptyState icon={<Bell className="w-8 h-8" />} title="No notifications" description="You'll see meeting invites, contact requests, and other updates here." />
        ) : (
          <div className="space-y-2">
            {notifications.map((n) => (
              <div
                key={n.id}
                className={`flex items-start gap-3 p-4 rounded-xl border transition cursor-pointer ${
                  n.read
                    ? 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800'
                    : 'bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800'
                }`}
                onClick={() => !n.read && handleMarkRead(n.id)}
              >
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  n.type === 'contact_request' ? 'bg-emerald-50 dark:bg-emerald-950/30' :
                  n.type === 'meeting_invite' ? 'bg-blue-50 dark:bg-blue-950/30' :
                  'bg-amber-50 dark:bg-amber-950/30'
                }`}>
                  <Bell className={`w-5 h-5 ${
                    n.type === 'contact_request' ? 'text-emerald-500' :
                    n.type === 'meeting_invite' ? 'text-blue-500' :
                    'text-amber-500'
                  }`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{n.title}</p>
                  {n.body && <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{n.body}</p>}
                  <p className="text-xs text-gray-400 mt-1">{formatDate(n.created_at)} · {formatTime(n.created_at)}</p>
                </div>
                {!n.read && <div className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0 mt-1.5" />}
              </div>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
