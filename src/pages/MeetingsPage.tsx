import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Video, Clock, Copy, Check, Calendar, ArrowRight, Trash2 } from 'lucide-react';
import { DashboardLayout } from '@/layouts/DashboardLayout';
import { EmptyState, LoadingSpinner } from '@/components/LoadingStates';
import { getUserMeetings, getJoinedMeetings, deleteMeeting } from '@/services/meetingApi';
import { formatDate, formatTime } from '@/lib/utils';
import type { Meeting, MeetingParticipant } from '@/types';
import { toast } from '@/stores/toastStore';

type Tab = 'upcoming' | 'past' | 'hosted' | 'joined';

export function MeetingsPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('hosted');
  const [hosted, setHosted] = useState<Meeting[]>([]);
  const [joined, setJoined] = useState<MeetingParticipant[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [h, j] = await Promise.all([getUserMeetings(), getJoinedMeetings()]);
      setHosted(h);
      setJoined(j);
    } catch (err) {
      // silent
    } finally {
      setLoading(false);
    }
  }

  async function copyLink(code: string) {
    await navigator.clipboard.writeText(`${window.location.origin}/meeting/${code}`);
    setCopiedCode(code);
    toast.success('Link copied');
    setTimeout(() => setCopiedCode(null), 2000);
  }

  async function handleDelete(meetingId: string, title?: string) {
    if (!window.confirm(`Are you sure you want to remove "${title || 'this meeting'}" from your list?`)) {
      return;
    }
    try {
      await deleteMeeting(meetingId);
      setHosted((prev) => prev.filter((m) => m.id !== meetingId));
      setJoined((prev) => prev.filter((j) => (j as any).meeting?.id !== meetingId && j.meeting_id !== meetingId));
      toast.success('Meeting removed');
    } catch (err: any) {
      toast.error(err.message || 'Failed to remove meeting');
    }
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'hosted', label: 'Hosted by Me' },
    { id: 'joined', label: 'Joined by Me' },
    { id: 'upcoming', label: 'Upcoming' },
    { id: 'past', label: 'Past' },
  ];

  const pastMeetings = hosted.filter((m) => m.status === 'ended');
  const upcomingMeetings = hosted.filter((m) => m.status === 'scheduled' || m.status === 'active');

  const currentList = tab === 'hosted' ? hosted : tab === 'joined' ? joined.map((j) => (j as { meeting?: Meeting }).meeting).filter((m): m is Meeting => !!m) : tab === 'past' ? pastMeetings : upcomingMeetings;

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Meetings</h1>

        <div className="flex gap-2 mb-6 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition whitespace-nowrap ${
                tab === t.id ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <LoadingSpinner text="Loading meetings..." />
        ) : currentList.length === 0 ? (
          <EmptyState
            icon={<Video className="w-8 h-8" />}
            title="No meetings"
            description="Create a new meeting to get started."
            action={
              <button onClick={() => navigate('/dashboard?new=true')} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition">
                New Meeting
              </button>
            }
          />
        ) : (
          <div className="space-y-3">
            {currentList.map((m: any) => (
              <div key={m.id} className="flex items-center gap-4 p-4 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800">
                <div className="w-12 h-12 rounded-lg bg-blue-50 dark:bg-blue-950/50 flex items-center justify-center flex-shrink-0">
                  <Video className="w-6 h-6 text-blue-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 dark:text-white truncate">{m.title}</p>
                  <div className="flex items-center gap-3 text-xs text-gray-500 mt-1">
                    <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {formatDate(m.started_at || m.created_at)}</span>
                    <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {formatTime(m.started_at || m.created_at)}</span>
                    {m.status === 'ended' && <span className="text-rose-500">Ended</span>}
                    {m.status === 'active' && <span className="text-emerald-500">Active</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={() => copyLink(m.code)} title="Copy link" className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition">
                    {copiedCode === m.code ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                  </button>
                  <button onClick={() => handleDelete(m.id, m.title)} title="Remove meeting" className="p-2 rounded-lg hover:bg-rose-100 dark:hover:bg-rose-950/50 text-gray-400 hover:text-rose-600 dark:hover:text-rose-400 transition">
                    <Trash2 className="w-4 h-4" />
                  </button>
                  {m.status !== 'ended' && (
                    <button onClick={() => navigate(`/lobby/${m.code}`)} className="flex items-center gap-1 px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition">
                      Join <ArrowRight className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
