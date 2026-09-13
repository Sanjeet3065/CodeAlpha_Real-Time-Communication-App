import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Video,
  Mic,
  Plus,
  Calendar,
  ArrowRight,
  Clock,
  X,
  Copy,
  Check,
  Zap,
  Sparkles,
  Shield,
  ShieldCheck,
  PenTool,
  Hash,
  Trash2,
  AlertTriangle
} from 'lucide-react';
import { DashboardLayout } from '@/layouts/DashboardLayout';
import { LoadingSpinner, EmptyState } from '@/components/LoadingStates';
import { useAuthStore } from '@/stores/authStore';
import { createMeeting, getUserMeetings, getJoinedMeetings, getScheduledMeetings, deleteMeeting } from '@/services/meetingApi';
import { toast } from '@/stores/toastStore';
import { formatTime, formatDate } from '@/lib/utils';
import type { Meeting, MeetingParticipant, ScheduledMeeting } from '@/types';

export function DashboardPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const profile = useAuthStore((s) => s.profile);

  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showNewModal, setShowNewModal] = useState(false);
  const [createdMeeting, setCreatedMeeting] = useState<Meeting | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedRoomCode, setCopiedRoomCode] = useState(false);
  const [meetingTitle, setMeetingTitle] = useState('');
  const [quickCode, setQuickCode] = useState('');
  const [allUserMeetings, setAllUserMeetings] = useState<Meeting[]>([]);
  const [recentMeetings, setRecentMeetings] = useState<Meeting[]>([]);
  const [joinedMeetings, setJoinedMeetings] = useState<MeetingParticipant[]>([]);
  const [upcoming, setUpcoming] = useState<ScheduledMeeting[]>([]);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());

  // Clock ticker for live time in the banner
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (searchParams.get('new') === 'true') {
      setShowNewModal(true);
    }
    loadData();
  }, [searchParams]);

  async function loadData() {
    try {
      const [meetings, joined, scheduled] = await Promise.all([
        getUserMeetings(),
        getJoinedMeetings(),
        getScheduledMeetings(),
      ]);
      setAllUserMeetings(meetings);
      setRecentMeetings(meetings.slice(0, 5));
      setJoinedMeetings(joined.slice(0, 5));
      setUpcoming(scheduled.filter((s) => new Date(s.scheduled_for) > new Date()).slice(0, 3));
    } catch (err) {
      toast.error('Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  }

  // Duplicate title detection against user's meetings
  const trimmedTitle = meetingTitle.trim();
  const duplicateMeeting = trimmedTitle
    ? allUserMeetings.find(
        (m) => m.title.trim().toLowerCase() === trimmedTitle.toLowerCase()
      )
    : null;
  const isDuplicateTitle = Boolean(duplicateMeeting);

  async function handleCreateMeeting(customTitle?: string) {
    const finalTitle = (customTitle || meetingTitle).trim() || 'Instant Meeting';

    // Check if title already exists in user's meeting history
    const isDup = allUserMeetings.some(
      (m) => m.title.trim().toLowerCase() === finalTitle.toLowerCase()
    );
    if (isDup) {
      toast.error(`⚠️ "${finalTitle}" naam se meeting already exist karti hai! Kripya dusra naam chune ya Recent Meetings se purani meeting delete karein.`);
      return;
    }

    setCreating(true);
    try {
      const meeting = await createMeeting(finalTitle);
      toast.success('Meeting created successfully!');
      setAllUserMeetings((prev) => [meeting, ...prev]);
      setRecentMeetings((prev) => [meeting, ...prev.filter((m) => m.id !== meeting.id).slice(0, 4)]);
      // Keep modal open and show Room Code, Link & WhatsApp share view
      setCreatedMeeting(meeting);
      setShowNewModal(true);
    } catch (err: any) {
      toast.error(err.message || 'Failed to create meeting');
    } finally {
      setCreating(false);
    }
  }

  function handleCloseNewModal() {
    setShowNewModal(false);
    setCreatedMeeting(null);
    setMeetingTitle('');
    setCopiedLink(false);
    setCopiedRoomCode(false);
  }

  async function copyCodeOnly(code: string) {
    await navigator.clipboard.writeText(code);
    setCopiedRoomCode(true);
    toast.success(`Meeting Room Code "${code}" copied!`);
    setTimeout(() => setCopiedRoomCode(false), 2000);
  }

  async function copyMeetingLinkOnly(code: string) {
    const url = `${window.location.origin}/lobby/${code}`;
    await navigator.clipboard.writeText(url);
    setCopiedLink(true);
    toast.success('Meeting link copied to clipboard!');
    setTimeout(() => setCopiedLink(false), 2000);
  }

  function shareOnWhatsApp(meeting: Meeting) {
    const url = `${window.location.origin}/lobby/${meeting.code}`;
    const msg = `🚀 Join my video meeting on Connectly!\n\n📌 Topic: ${meeting.title}\n🔑 Room Code: ${meeting.code}\n🔗 Join Link: ${url}\n\nClick the link to join directly from your browser!`;
    const whatsappUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`;
    window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
  }

  function handleQuickJoin() {
    if (!quickCode.trim()) {
      toast.error('Please enter a meeting code');
      return;
    }
    const clean = quickCode.trim().replace(/\s+/g, '').toUpperCase();
    navigate(`/lobby/${clean}`);
  }

  async function copyMeetingLink(code: string) {
    const url = `${window.location.origin}/lobby/${code}`;
    await navigator.clipboard.writeText(url);
    setCopiedCode(code);
    toast.success('Meeting link copied to clipboard!');
    setTimeout(() => setCopiedCode(null), 2000);
  }

  async function handleDeleteMeeting(meetingId: string, title?: string) {
    if (!window.confirm(`Are you sure you want to remove "${title || 'this meeting'}" from your history?`)) {
      return;
    }
    try {
      await deleteMeeting(meetingId);
      setRecentMeetings((prev) => prev.filter((m) => m.id !== meetingId));
      setAllUserMeetings((prev) => prev.filter((m) => m.id !== meetingId));
      setJoinedMeetings((prev) => prev.filter((m) => m.meeting_id !== meetingId && (m as any).meeting?.id !== meetingId));
      toast.success('Meeting removed from history');
    } catch (err: any) {
      toast.error(err.message || 'Failed to remove meeting');
    }
  }

  // Greeting based on time of day
  const hour = currentTime.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const firstName = profile?.full_name?.split(' ')[0] || 'there';

  const quickActions = [
    {
      label: 'New Meeting',
      desc: 'Start an instant room & invite guests',
      icon: Video,
      color: 'from-blue-600 to-indigo-600',
      badge: 'Instant',
      onClick: () => setShowNewModal(true),
    },
    {
      label: 'Join Meeting',
      desc: 'Enter a room via meeting code or link',
      icon: Plus,
      color: 'from-emerald-500 to-teal-600',
      badge: 'Code / URL',
      onClick: () => navigate('/join'),
    },
    {
      label: 'Schedule Meeting',
      desc: 'Plan ahead and send calendar invites',
      icon: Calendar,
      color: 'from-amber-500 to-orange-600',
      badge: 'Calendar',
      onClick: () => navigate('/schedule'),
    },
    {
      label: 'Interactive Whiteboard',
      desc: 'Collaborate live on an infinite canvas',
      icon: PenTool,
      color: 'from-purple-600 to-pink-600',
      badge: 'Creative',
      onClick: () => handleCreateMeeting('Whiteboard Collaboration Session'),
    },
  ];

  if (loading) {
    return (
      <DashboardLayout>
        <LoadingSpinner text="Loading dashboard..." />
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="max-w-7xl mx-auto space-y-8 pb-10">
        {/* =========================================================================
            1. HERO INTERACTIVE BANNER (Compact & Sleek with Studio Hardware Lab)
            ========================================================================= */}
        <div className="relative rounded-3xl overflow-hidden bg-gradient-to-br from-indigo-900 via-indigo-800 to-slate-950 text-white shadow-xl shadow-indigo-950/25 border border-indigo-500/20 p-5 sm:p-6 lg:p-7">
          {/* Ambient Glowing Orbs Background */}
          <div className="absolute top-0 right-1/4 w-80 h-80 bg-indigo-500/20 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-10 right-0 w-72 h-72 bg-purple-500/20 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute top-1/2 left-0 w-60 h-60 bg-blue-500/15 rounded-full blur-3xl pointer-events-none" />

          <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-center">
            {/* Left Hero Content - Compact & Clean */}
            <div className="lg:col-span-7 space-y-4">
              {/* Live Status & Date Pill */}
              <div className="flex flex-wrap items-center gap-2.5">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur-md border border-white/15 text-xs font-semibold text-indigo-200 shadow-sm">
                  <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                  <span>{greeting}, {firstName}!</span>
                </div>

                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 backdrop-blur-md border border-white/10 text-xs text-slate-300">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block animate-pulse" />
                  <span>
                    {currentTime.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
                    {' · '}
                    {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>

                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/20 backdrop-blur-md border border-emerald-400/30 text-xs text-emerald-200 font-medium">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400"></span>
                  </span>
                  <Mic className="w-3 h-3 text-emerald-300" />
                  <Video className="w-3 h-3 text-emerald-300" />
                  <span>Mic & Camera Auto-Ready</span>
                </div>
              </div>

              {/* Banner Headline - Compact */}
              <div>
                <h1 className="text-2xl sm:text-3xl lg:text-[32px] font-extrabold tracking-tight leading-tight text-white">
                  Collaborate in real time with HD clarity.
                </h1>
                <p className="mt-1.5 text-slate-300 text-xs sm:text-sm leading-relaxed max-w-xl">
                  Host instant encrypted video calls, broadcast screens, and collaborate on shared whiteboards with low latency.
                </p>
              </div>

              {/* Interactive Quick Join Bar */}
              <div className="pt-1 flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 max-w-lg">
                <div className="relative flex-1">
                  <Hash className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    value={quickCode}
                    onChange={(e) => setQuickCode(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleQuickJoin()}
                    placeholder="Enter meeting code..."
                    className="w-full pl-10 pr-3 py-2.5 rounded-xl bg-white/10 backdrop-blur-md border border-white/20 text-white placeholder-slate-400 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:bg-white/15 transition shadow-inner"
                  />
                </div>

                <button
                  onClick={handleQuickJoin}
                  className="px-5 py-2.5 rounded-xl bg-white text-indigo-900 hover:bg-indigo-50 font-bold text-xs sm:text-sm transition-all shadow-md hover:shadow-lg hover:scale-105 active:scale-95 flex items-center justify-center gap-2 flex-shrink-0"
                >
                  <span>Join Room</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>

                <button
                  onClick={() => setShowNewModal(true)}
                  className="px-3.5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs sm:text-sm transition-all shadow-md hover:scale-105 active:scale-95 flex items-center justify-center gap-1.5 flex-shrink-0"
                  title="Start Instant Meeting"
                >
                  <Zap className="w-3.5 h-3.5 text-amber-300" />
                  <span className="sm:hidden lg:inline">Instant</span>
                </button>
              </div>
            </div>
            {/* Right Hero: Project Real-Time Video Collaboration Showcase */}
            <div className="lg:col-span-5 relative group">
              <div className="relative overflow-hidden rounded-2xl border border-white/20 bg-slate-950/70 shadow-2xl backdrop-blur-xl">
                {/* Ambient dynamic glow */}
                <div className="absolute -inset-1 bg-gradient-to-tr from-indigo-500/30 via-purple-500/20 to-pink-500/25 rounded-2xl blur-xl opacity-75 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />

                {/* Main Hero Image */}
                <div className="relative aspect-[4/3] w-full overflow-hidden">
                  <img
                    src="/meeting-hero.jpg"
                    alt="Real-Time Video Communication Platform"
                    className="w-full h-full object-cover transform group-hover:scale-105 transition-transform duration-700 ease-out"
                    loading="eager"
                  />
                  {/* Gradient vignettes */}
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/20 to-transparent pointer-events-none" />
                  <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-transparent pointer-events-none" />

                  {/* Top Floating Badges */}
                  <div className="absolute top-3 inset-x-3 flex items-center justify-between pointer-events-none">
                    <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-950/75 backdrop-blur-md border border-emerald-500/40 text-[11px] font-semibold text-emerald-300 shadow-lg">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      <span>HD WebRTC Video</span>
                    </div>

                    <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-950/75 backdrop-blur-md border border-indigo-400/30 text-[11px] font-semibold text-indigo-200 shadow-lg">
                      <ShieldCheck className="w-3.5 h-3.5 text-indigo-400" />
                      <span>E2E Encrypted</span>
                    </div>
                  </div>

                  {/* Bottom Feature Card Bar */}
                  <div className="absolute bottom-3 inset-x-3 p-3 rounded-xl bg-slate-900/85 backdrop-blur-md border border-white/15 text-white shadow-xl flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-9 h-9 rounded-lg bg-indigo-600/40 border border-indigo-400/40 flex items-center justify-center text-indigo-300 flex-shrink-0">
                        <Video className="w-4 h-4" />
                      </div>
                      <div className="truncate">
                        <p className="text-xs font-bold text-white truncate">Ultra-Low Latency Mesh</p>
                        <p className="text-[11px] text-slate-300 truncate">P2P Audio, Video & Screen Sharing</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <span className="text-[10px] font-bold font-mono px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                        60 FPS
                      </span>
                      <span className="text-[10px] font-bold font-mono px-2 py-0.5 rounded-md bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                        HD 1080p
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* =========================================================================
            2. INTERACTIVE QUICK ACTION CARDS (Polished with 4 vibrant options)
            ========================================================================= */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Quick Actions</h2>
            <span className="text-xs text-slate-500 dark:text-slate-400">Launch or schedule in seconds</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {quickActions.map((action) => (
              <button
                key={action.label}
                onClick={action.onClick}
                className="group relative overflow-hidden rounded-2xl p-5 text-left bg-white dark:bg-gray-900 border border-slate-200/80 dark:border-gray-800 shadow-sm hover:shadow-xl hover:border-indigo-300 dark:hover:border-indigo-500/50 hover:-translate-y-1.5 transition-all duration-300 flex flex-col justify-between"
              >
                {/* Accent glow on hover */}
                <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-br from-indigo-500/10 to-transparent rounded-full blur-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />

                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div
                      className={`w-12 h-12 rounded-xl bg-gradient-to-br ${action.color} text-white flex items-center justify-center shadow-md group-hover:scale-110 group-hover:rotate-3 transition-transform`}
                    >
                      <action.icon className="w-6 h-6" />
                    </div>
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-slate-100 dark:bg-gray-800 text-slate-600 dark:text-slate-400 group-hover:bg-indigo-50 dark:group-hover:bg-indigo-950/60 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                      {action.badge}
                    </span>
                  </div>

                  <h3 className="font-bold text-slate-900 dark:text-white text-base group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                    {action.label}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                    {action.desc}
                  </p>
                </div>

                <div className="mt-4 flex items-center gap-1 text-xs font-semibold text-indigo-600 dark:text-indigo-400 group-hover:gap-2 transition-all">
                  <span>Start now</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* =========================================================================
            3. RECENT MEETINGS & UPCOMING SESSIONS
            ========================================================================= */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Recent Meetings (7 cols) */}
          <div className="lg:col-span-7 bg-white dark:bg-gray-900 rounded-2xl border border-slate-200/80 dark:border-gray-800 shadow-sm overflow-hidden flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-gray-800">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                  <Video className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="font-bold text-slate-900 dark:text-white text-base">Recent Meetings</h2>
                  <p className="text-xs text-slate-400">Your meeting history & rooms</p>
                </div>
              </div>

              <button
                onClick={() => navigate('/meetings')}
                className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 flex items-center gap-1 hover:underline"
              >
                <span>View all history</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            </div>

            <div className="p-3 flex-1">
              {recentMeetings.length === 0 ? (
                <div className="py-12">
                  <EmptyState
                    icon={<Video className="w-10 h-10 text-indigo-500/60" />}
                    title="No meetings recorded yet"
                    description="Your created and joined meetings will be listed here with instant rejoin links."
                    action={
                      <button
                        onClick={() => setShowNewModal(true)}
                        className="mt-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl transition shadow-md shadow-indigo-600/20"
                      >
                        Start Your First Meeting
                      </button>
                    }
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  {recentMeetings.map((m) => (
                    <div
                      key={m.id}
                      className="group flex items-center justify-between p-3.5 rounded-xl hover:bg-slate-50 dark:hover:bg-gray-800/80 border border-transparent hover:border-slate-200 dark:hover:border-gray-700/80 transition-all duration-200"
                    >
                      <div className="flex items-center gap-3.5 min-w-0">
                        <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform">
                          <Video className="w-5 h-5" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                            {m.title}
                          </p>
                          <div className="flex items-center gap-2.5 text-xs text-slate-400 mt-0.5">
                            <span className="font-mono bg-slate-100 dark:bg-gray-800 px-1.5 py-0.5 rounded text-[11px] text-slate-600 dark:text-slate-300">
                              {m.code}
                            </span>
                            <span>•</span>
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {formatDate(m.started_at)} · {formatTime(m.started_at)}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                          onClick={() => copyMeetingLink(m.code)}
                          title="Copy meeting link"
                          className="p-2 rounded-lg hover:bg-slate-200 dark:hover:bg-gray-700 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition"
                        >
                          {copiedCode === m.code ? (
                            <Check className="w-4 h-4 text-emerald-500" />
                          ) : (
                            <Copy className="w-4 h-4" />
                          )}
                        </button>

                        <button
                          onClick={() => handleDeleteMeeting(m.id, m.title)}
                          title="Remove from history"
                          className="p-2 rounded-lg hover:bg-rose-100 dark:hover:bg-rose-950/50 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 transition"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>

                        <button
                          onClick={() => navigate(`/lobby/${m.code}`)}
                          className="px-3.5 py-1.5 text-xs font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 shadow-sm transition hover:scale-105 active:scale-95"
                        >
                          Rejoin
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Upcoming Schedule (5 cols) */}
          <div className="lg:col-span-5 bg-white dark:bg-gray-900 rounded-2xl border border-slate-200/80 dark:border-gray-800 shadow-sm overflow-hidden flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-gray-800">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                  <Calendar className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="font-bold text-slate-900 dark:text-white text-base">Upcoming Schedule</h2>
                  <p className="text-xs text-slate-400">Scheduled syncs & webinars</p>
                </div>
              </div>

              <button
                onClick={() => navigate('/schedule')}
                className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 flex items-center gap-1 hover:underline"
              >
                <span>Schedule</span>
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="p-3 flex-1">
              {upcoming.length === 0 ? (
                <div className="py-12">
                  <EmptyState
                    icon={<Calendar className="w-10 h-10 text-amber-500/60" />}
                    title="No meetings scheduled"
                    description="Plan ahead with your team or clients to automatically send invites and links."
                    action={
                      <button
                        onClick={() => navigate('/schedule')}
                        className="mt-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl transition shadow-md shadow-indigo-600/20"
                      >
                        Schedule a Meeting
                      </button>
                    }
                  />
                </div>
              ) : (
                <div className="space-y-2.5">
                  {upcoming.map((s) => {
                    const schedDate = new Date(s.scheduled_for);
                    return (
                      <div
                        key={s.id}
                        className="group flex items-center gap-3.5 p-3.5 rounded-xl hover:bg-slate-50 dark:hover:bg-gray-800/80 border border-transparent hover:border-slate-200 dark:hover:border-gray-700 transition"
                      >
                        <div className="w-12 h-12 rounded-xl bg-gradient-to-b from-amber-50 to-orange-50 dark:from-amber-950/40 dark:to-orange-950/30 border border-amber-200/60 dark:border-amber-800/50 flex flex-col items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform">
                          <span className="text-[10px] font-bold text-amber-600 uppercase">
                            {schedDate.toLocaleDateString([], { month: 'short' })}
                          </span>
                          <span className="text-base font-extrabold text-amber-800 dark:text-amber-300 leading-none">
                            {schedDate.getDate()}
                          </span>
                        </div>

                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                            {s.title}
                          </p>
                          <p className="text-xs text-slate-400 mt-0.5">
                            {formatTime(s.scheduled_for)} · {s.duration_minutes} min
                          </p>
                        </div>

                        <button
                          onClick={() => {
                            if (s.meeting_id) {
                              copyMeetingLink(s.meeting_id);
                            } else {
                              navigate('/schedule');
                            }
                          }}
                          className="p-2 rounded-lg hover:bg-slate-200 dark:hover:bg-gray-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition"
                          title="Copy meeting link or view schedule"
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Quick Security Badge Footer */}
            <div className="p-3.5 bg-slate-50 dark:bg-gray-800/50 border-t border-slate-100 dark:border-gray-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span className="flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5 text-emerald-500" />
                <span>WebRTC E2E Encrypted</span>
              </span>
              <button
                onClick={() => navigate('/settings')}
                className="hover:text-indigo-600 dark:hover:text-indigo-400 transition"
              >
                Settings →
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* =========================================================================
          NEW MEETING MODAL (Enhanced with Room Code, WhatsApp Share & Duplicate Guard)
          ========================================================================= */}
      {showNewModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
          onClick={handleCloseNewModal}
        >
          <div
            className="bg-white dark:bg-gray-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-gray-800 w-full max-w-md p-6 sm:p-7 space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${
                    createdMeeting
                      ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400'
                      : 'bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400'
                  }`}
                >
                  {createdMeeting ? (
                    <Check className="w-5 h-5 stroke-[2.5]" />
                  ) : (
                    <Video className="w-5 h-5" />
                  )}
                </div>
                <div>
                  <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                    {createdMeeting ? 'Meeting Room Ready!' : 'Start New Meeting'}
                  </h2>
                  <p className="text-xs text-slate-400">
                    {createdMeeting
                      ? 'Share room code/link or enter directly'
                      : 'Get an instant room with shareable link'}
                  </p>
                </div>
              </div>

              <button
                onClick={handleCloseNewModal}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-gray-800 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* STEP 1: CREATE MEETING FORM */}
            {!createdMeeting ? (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                    Meeting Topic / Title
                  </label>
                  <input
                    type="text"
                    value={meetingTitle}
                    onChange={(e) => setMeetingTitle(e.target.value)}
                    placeholder="e.g. Weekly Product Sync"
                    className={`w-full px-4 py-3 rounded-xl border bg-white dark:bg-gray-800 text-slate-900 dark:text-white outline-none transition text-sm ${
                      isDuplicateTitle
                        ? 'border-amber-500 focus:ring-2 focus:ring-amber-500/50'
                        : 'border-slate-300 dark:border-gray-700 focus:ring-2 focus:ring-indigo-500'
                    }`}
                    onKeyDown={(e) => e.key === 'Enter' && !isDuplicateTitle && handleCreateMeeting()}
                    autoFocus
                  />
                </div>

                {/* Real-Time Duplicate Title Warning Banner */}
                {isDuplicateTitle && (
                  <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300 text-xs space-y-1 animate-in fade-in">
                    <div className="flex items-center gap-1.5 font-bold text-amber-600 dark:text-amber-400">
                      <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                      <span>Duplicate Room Name Detected</span>
                    </div>
                    <p className="text-[11px] leading-relaxed">
                      &quot;<strong>{trimmedTitle}</strong>&quot; naam se meeting aapke recent meetings me already exist karti hai.
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      💡 Kripya koi dusra naam chune, ya <strong>Recent Meetings</strong> me jakar purani meeting ko delete karein jisse aap dobara is naam se bana sakein.
                    </p>
                  </div>
                )}

                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-gray-800/60 border border-slate-200/60 dark:border-gray-700 text-xs text-slate-600 dark:text-slate-300 space-y-1.5">
                  <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400 font-semibold">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Instant Features Included:</span>
                  </div>
                  <p>• Crystal-clear HD WebRTC audio & video</p>
                  <p>• Screen sharing & collaborative whiteboard</p>
                  <p>• Instant Room Code & WhatsApp one-click invite</p>
                </div>

                <button
                  onClick={() => handleCreateMeeting()}
                  disabled={creating || isDuplicateTitle}
                  className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition shadow-lg shadow-indigo-600/25 flex items-center justify-center gap-2 disabled:opacity-50 hover:scale-[1.02] active:scale-[0.98]"
                >
                  {creating ? (
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <>
                      <span>Create & Generate Link</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            ) : (
              /* STEP 2: MEETING CREATED - CODE, LINK & WHATSAPP SHARE */
              <div className="space-y-4 animate-in fade-in duration-200">
                {/* Meeting Topic Info Pill */}
                <div className="p-3 rounded-xl bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-200/60 dark:border-indigo-800/60 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                      Topic
                    </span>
                    <p className="text-sm font-bold text-slate-900 dark:text-white truncate">
                      {createdMeeting.title}
                    </p>
                  </div>
                  <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-[10px] font-bold flex items-center gap-1 flex-shrink-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Room Live
                  </span>
                </div>

                {/* 1. Meeting Room Code Box with Copy */}
                <div className="space-y-1.5">
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Meeting Room Code
                  </label>
                  <div className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-100 dark:bg-gray-800 border border-slate-200 dark:border-gray-700">
                    <div className="flex-1 font-mono font-extrabold text-base tracking-widest text-indigo-600 dark:text-indigo-400 px-2 truncate">
                      {createdMeeting.code}
                    </div>
                    <button
                      onClick={() => copyCodeOnly(createdMeeting.code)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition active:scale-95 shadow-sm ${
                        copiedRoomCode
                          ? 'bg-emerald-600 text-white'
                          : 'bg-white dark:bg-gray-700 hover:bg-slate-50 dark:hover:bg-gray-600 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-gray-600'
                      }`}
                    >
                      {copiedRoomCode ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedRoomCode ? 'Copied!' : 'Copy Code'}</span>
                    </button>
                  </div>
                </div>

                {/* 2. Direct Meeting Link Box with Copy */}
                <div className="space-y-1.5">
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Meeting Join Link
                  </label>
                  <div className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-100 dark:bg-gray-800 border border-slate-200 dark:border-gray-700">
                    <div className="flex-1 font-mono text-xs text-slate-600 dark:text-slate-300 px-2 truncate">
                      {`${window.location.origin}/lobby/${createdMeeting.code}`}
                    </div>
                    <button
                      onClick={() => copyMeetingLinkOnly(createdMeeting.code)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition active:scale-95 shadow-sm ${
                        copiedLink
                          ? 'bg-emerald-600 text-white'
                          : 'bg-white dark:bg-gray-700 hover:bg-slate-50 dark:hover:bg-gray-600 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-gray-600'
                      }`}
                    >
                      {copiedLink ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedLink ? 'Copied!' : 'Copy Link'}</span>
                    </button>
                  </div>
                </div>

                {/* 3. Direct Share to WhatsApp Button */}
                <button
                  onClick={() => shareOnWhatsApp(createdMeeting)}
                  className="w-full py-3 px-4 rounded-xl bg-[#25D366] hover:bg-[#20bd5a] text-white font-bold text-sm transition-all shadow-md hover:shadow-lg flex items-center justify-center gap-2.5 hover:scale-[1.01] active:scale-[0.99]"
                >
                  <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                    <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-5.805 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z" />
                  </svg>
                  <span>Direct Share on WhatsApp</span>
                </button>

                {/* 4. Action Buttons */}
                <div className="pt-2 space-y-2">
                  <button
                    onClick={() => {
                      setShowNewModal(false);
                      navigate(`/lobby/${createdMeeting.code}`);
                    }}
                    className="w-full py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm transition shadow-lg shadow-indigo-600/25 flex items-center justify-center gap-2 hover:scale-[1.01] active:scale-[0.99]"
                  >
                    <span>Enter Meeting Room Now</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>

                  <button
                    onClick={handleCloseNewModal}
                    className="w-full py-2 text-xs font-semibold text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 transition"
                  >
                    Close & Stay on Dashboard
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}


    </DashboardLayout>
  );
}
