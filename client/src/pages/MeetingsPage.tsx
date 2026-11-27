import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { DashboardLayout } from '@/components/dashboard/DashboardLayout';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import {
  Calendar,
  Clock,
  ArrowLeft,
  Plus,
  Search,
  Users,
  Share2,
  Eye,
  RefreshCw,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  X,
  History,
  Trash2,
  Check,
  Loader2,
} from 'lucide-react';
import { schedulingApi } from '@/services/schedulingApi';
import { ScheduleMeetingModal } from '@/components/dashboard/ScheduleMeetingModal';
import { RescheduleModal } from '@/components/dashboard/RescheduleModal';
import { CancelMeetingModal } from '@/components/dashboard/CancelMeetingModal';
import { MeetingInvitationModal } from '@/components/dashboard/MeetingInvitationModal';
import type {
  IScheduledMeeting,
  IMeetingHistoryItem,
  IMeetingHistoryDetails,
} from '@/types/scheduling';

export const MeetingsPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const resolveTabFromUrl = useCallback((): 'scheduled' | 'history' => {
    if (
      location.pathname === '/meetings/history' ||
      searchParams.get('tab')?.toLowerCase() === 'history'
    ) {
      return 'history';
    }
    return 'scheduled';
  }, [location.pathname, searchParams]);

  const [activeTab, setActiveTab] = useState<'scheduled' | 'history'>(() => resolveTabFromUrl());

  useEffect(() => {
    setActiveTab(resolveTabFromUrl());
  }, [resolveTabFromUrl]);

  const switchTab = (nextTab: 'scheduled' | 'history') => {
    setActiveTab(nextTab);
    setSelectedHistoryIds([]);
    setDeleteConfirmTargets(null);
    setHistoryFeedback(null);
    const targetPath = nextTab === 'history' ? '/meetings/history' : '/meetings';
    if (location.pathname !== targetPath || searchParams.has('tab')) {
      navigate(targetPath, { replace: false });
    }
  };

  // Upcoming meetings state
  const [upcomingMeetings, setUpcomingMeetings] = useState<IScheduledMeeting[]>([]);
  const [upcomingPage, setUpcomingPage] = useState(1);
  const [upcomingTotalPages, setUpcomingTotalPages] = useState(1);
  const [isUpcomingLoading, setIsUpcomingLoading] = useState(false);
  const [upcomingError, setUpcomingError] = useState<string | null>(null);

  // History state
  const [historyMeetings, setHistoryMeetings] = useState<IMeetingHistoryItem[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotalPages, setHistoryTotalPages] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyFeedback, setHistoryFeedback] = useState<string | null>(null);
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<string[]>([]);
  const [deleteConfirmTargets, setDeleteConfirmTargets] = useState<IMeetingHistoryItem[] | null>(null);
  const [isDeletingHistory, setIsDeletingHistory] = useState(false);
  const [deleteHistoryError, setDeleteHistoryError] = useState<string | null>(null);

  // History filter state
  const [historyStatusFilter, setHistoryStatusFilter] = useState<'all' | 'ENDED' | 'CANCELLED'>('all');
  const [historyRoleFilter, setHistoryRoleFilter] = useState<'all' | 'host' | 'participant'>('all');
  const [historySearchTerm, setHistorySearchTerm] = useState('');
  const [historySortOrder, setHistorySortOrder] = useState<'desc' | 'asc'>('desc');

  // Modals state
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [rescheduleMeeting, setRescheduleMeeting] = useState<IScheduledMeeting | null>(null);
  const [cancelMeeting, setCancelMeeting] = useState<IScheduledMeeting | null>(null);
  const [invitationCode, setInvitationCode] = useState<string | null>(null);

  // History Details Modal state
  const [selectedHistoryDetails, setSelectedHistoryDetails] = useState<IMeetingHistoryDetails | null>(null);

  // Fetch upcoming scheduled meetings
  const fetchUpcoming = useCallback(async (page = 1) => {
    try {
      setIsUpcomingLoading(true);
      setUpcomingError(null);
      const res = await schedulingApi.listUpcomingMeetings({ page, limit: 10 });
      setUpcomingMeetings(res.meetings);
      setUpcomingPage(res.pagination.page);
      setUpcomingTotalPages(res.pagination.totalPages);
    } catch (err: unknown) {
      setUpcomingError(err instanceof Error ? err.message : 'Failed to load upcoming sessions.');
    } finally {
      setIsUpcomingLoading(false);
    }
  }, []);

  // Fetch past meeting history
  const fetchHistory = useCallback(async (page = 1) => {
    try {
      setIsHistoryLoading(true);
      setHistoryError(null);
      const res = await schedulingApi.listMeetingHistory({
        page,
        limit: 10,
        status: historyStatusFilter,
        role: historyRoleFilter,
        search: historySearchTerm.trim() || undefined,
        sort: historySortOrder,
      });
      setHistoryMeetings(res.meetings);
      setHistoryPage(res.pagination.page);
      setHistoryTotalPages(res.pagination.totalPages);
      setHistoryTotal(res.pagination.total);
      setSelectedHistoryIds((prev) =>
        prev.filter((id) => res.meetings.some((m) => m.id === id))
      );
    } catch (err: unknown) {
      setHistoryError(err instanceof Error ? err.message : 'Failed to load meeting history.');
    } finally {
      setIsHistoryLoading(false);
    }
  }, [historyStatusFilter, historyRoleFilter, historySearchTerm, historySortOrder]);

  useEffect(() => {
    if (activeTab === 'scheduled') {
      fetchUpcoming(1);
    } else {
      fetchHistory(1);
    }
  }, [activeTab, fetchUpcoming, fetchHistory]);

  const handleOpenHistoryDetails = async (meetingId: string) => {
    try {
      setHistoryError(null);
      const details = await schedulingApi.getMeetingHistoryDetails(meetingId);
      setSelectedHistoryDetails(details);
    } catch (err: unknown) {
      setHistoryError(
        err instanceof Error ? err.message : 'Unable to load meeting history details.'
      );
    }
  };

  const toggleHistorySelection = (meetingId: string) => {
    setSelectedHistoryIds((prev) =>
      prev.includes(meetingId) ? prev.filter((id) => id !== meetingId) : [...prev, meetingId]
    );
  };

  const allVisibleSelected =
    historyMeetings.length > 0 &&
    historyMeetings.every((item) => selectedHistoryIds.includes(item.id));

  const toggleSelectAllVisible = () => {
    if (allVisibleSelected) {
      setSelectedHistoryIds([]);
    } else {
      setSelectedHistoryIds(historyMeetings.map((item) => item.id));
    }
  };

  const requestSingleDelete = (item: IMeetingHistoryItem) => {
    setDeleteHistoryError(null);
    setDeleteConfirmTargets([item]);
  };

  const requestBulkDelete = () => {
    const selectedItems = historyMeetings.filter((m) => selectedHistoryIds.includes(m.id));
    if (selectedItems.length === 0) return;
    setDeleteHistoryError(null);
    setDeleteConfirmTargets(selectedItems);
  };

  const handleConfirmDeleteHistory = async () => {
    if (!deleteConfirmTargets || deleteConfirmTargets.length === 0) return;
    try {
      setIsDeletingHistory(true);
      setDeleteHistoryError(null);
      const targetIds = deleteConfirmTargets.map((item) => item.id);

      if (targetIds.length === 1) {
        await schedulingApi.deleteMeetingHistoryEntry(targetIds[0]);
      } else {
        await schedulingApi.deleteMeetingHistoryEntries(targetIds);
      }

      const deletedSet = new Set(targetIds);
      const remainingCountOnPage = historyMeetings.filter((m) => !deletedSet.has(m.id)).length;
      const nextPage = remainingCountOnPage === 0 && historyPage > 1 ? historyPage - 1 : historyPage;

      setSelectedHistoryIds((prev) => prev.filter((id) => !deletedSet.has(id)));
      setDeleteConfirmTargets(null);
      setHistoryFeedback(
        targetIds.length === 1
          ? `"${deleteConfirmTargets[0].title}" removed from your meeting history.`
          : `${targetIds.length} records removed from your meeting history.`
      );
      window.dispatchEvent(new CustomEvent('connectly:history-updated'));
      await fetchHistory(nextPage);
    } catch (err: unknown) {
      setDeleteHistoryError(
        err instanceof Error ? err.message : 'Unable to remove selected meeting history.'
      );
    } finally {
      setIsDeletingHistory(false);
    }
  };

  useEffect(() => {
    if (!deleteConfirmTargets) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isDeletingHistory) {
        setDeleteConfirmTargets(null);
      }
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleEsc);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleEsc);
    };
  }, [deleteConfirmTargets, isDeletingHistory]);

  return (
    <DashboardLayout
      title="Meetings & Collaboration"
      subtitle="Manage your upcoming collaboration sessions and review past meetings"
    >
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link
              to="/dashboard"
              className="text-xs text-[#2F6F68] dark:text-[#5FA399] hover:text-[#255A54] dark:hover:text-[#6EB2A8] flex items-center gap-1 font-medium transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to Overview</span>
            </Link>
          </div>
          <h2 className="font-display text-2xl font-bold tracking-tight text-[#1F2428] dark:text-[#EAECEE]">
            Meetings & Calendar
          </h2>
          <p className="text-xs sm:text-sm text-[#7C848D] dark:text-[#A3AAB2] mt-0.5">
            View scheduled rooms, invitation links, and past attendance logs.
          </p>
        </div>

        {/* Tab Switcher & Action */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center p-1 bg-[#FAF9F6] dark:bg-[#1C1F24] border border-[#DDDAD0] dark:border-[#2B3038] rounded-xl">
            <button
              type="button"
              onClick={() => switchTab('scheduled')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                activeTab === 'scheduled'
                  ? 'bg-[#E2ECE9] dark:bg-[#1F302E] text-[#2F6F68] dark:text-[#5FA399]'
                  : 'text-[#7C848D] dark:text-[#A3AAB2] hover:text-[#1F2428] dark:hover:text-[#EAECEE]'
              }`}
            >
              Upcoming & Scheduled
            </button>
            <button
              type="button"
              onClick={() => switchTab('history')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                activeTab === 'history'
                  ? 'bg-[#E2ECE9] dark:bg-[#1F302E] text-[#2F6F68] dark:text-[#5FA399]'
                  : 'text-[#7C848D] dark:text-[#A3AAB2] hover:text-[#1F2428] dark:hover:text-[#EAECEE]'
              }`}
            >
              Past History
            </button>
          </div>

          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => setIsScheduleModalOpen(true)}
            leftIcon={<Plus className="w-4 h-4" />}
          >
            Schedule Meeting
          </Button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: UPCOMING & SCHEDULED MEETINGS                                      */}
      {/* ========================================================================= */}
      {activeTab === 'scheduled' && (
        <div className="space-y-4">
          {isUpcomingLoading && upcomingMeetings.length === 0 ? (
            <Card className="p-12 text-center flex flex-col items-center justify-center">
              <RefreshCw className="w-8 h-8 text-[#2F6F68] dark:text-[#5FA399] animate-spin mb-3" />
              <p className="text-xs text-[#7C848D] dark:text-[#A3AAB2]">Loading scheduled sessions...</p>
            </Card>
          ) : upcomingError ? (
            <Card className="p-8 text-center bg-rose-50 border-rose-200">
              <AlertCircle className="w-8 h-8 text-rose-600 mx-auto mb-2" />
              <p className="text-sm font-bold text-rose-950 mb-1">Failed to Load Schedule</p>
              <p className="text-xs text-rose-700 mb-4">{upcomingError}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => fetchUpcoming(1)}>
                Retry
              </Button>
            </Card>
          ) : upcomingMeetings.length === 0 ? (
            <Card className="p-12 bg-[#FAF9F6] dark:bg-[#1C1F24] border-[#DDDAD0] dark:border-[#2B3038] shadow-xs rounded-2xl text-center flex flex-col items-center justify-center min-h-[380px]">
              <div className="w-16 h-16 rounded-2xl bg-[#E2ECE9] dark:bg-[#1F302E] text-[#2F6F68] dark:text-[#5FA399] flex items-center justify-center mb-4">
                <Calendar className="w-8 h-8" aria-hidden="true" />
              </div>
              <h3 className="font-display text-base sm:text-lg font-bold text-[#1F2428] dark:text-[#EAECEE] mb-1">
                No Scheduled Meetings
              </h3>
              <p className="text-xs sm:text-sm text-[#7C848D] dark:text-[#A3AAB2] max-w-md mx-auto mb-6 leading-relaxed">
                You do not have any upcoming meetings on your calendar. Click below to schedule a meeting and invite participants.
              </p>
              <Button
                variant="primary"
                size="sm"
                onClick={() => setIsScheduleModalOpen(true)}
                leftIcon={<Plus className="w-4 h-4" />}
              >
                Schedule First Meeting
              </Button>
            </Card>
          ) : (
            <div className="space-y-3">
              {upcomingMeetings.map((m) => {
                const startDate = m.scheduledStartAt ? new Date(m.scheduledStartAt) : null;
                const formattedDate = startDate
                  ? startDate.toLocaleDateString([], {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })
                  : 'Date not set';
                const formattedTime = startDate
                  ? startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                  : '';

                return (
                  <Card key={m.id} className="p-5 bg-[#FAF9F6] dark:bg-[#1C1F24] border-[#DDDAD0] dark:border-[#2B3038] shadow-xs rounded-2xl hover:border-[#2F6F68]/40 dark:hover:border-[#5FA399]/40 transition-all">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                      {/* Left Info */}
                      <div className="space-y-1.5 flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-bold text-[#2F6F68] dark:text-[#5FA399] flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5" />
                            {formattedDate} at {formattedTime}
                          </span>
                          <span className="text-[10px] text-[#7C848D] dark:text-[#A3AAB2]">
                            ({m.scheduledTimeZone})
                          </span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#F3F2EE] dark:bg-[#141619] border border-[#DDDAD0] dark:border-[#2B3038] font-medium text-[#1F2428] dark:text-[#EAECEE]">
                            {m.durationMinutes} mins
                          </span>
                          {m.settings?.waitingRoomEnabled && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#E2ECE9] dark:bg-[#1F302E] text-[#2F6F68] dark:text-[#5FA399] font-semibold">
                              Waiting Room Active
                            </span>
                          )}
                        </div>

                        <h3 className="font-display text-base font-bold text-[#1F2428] dark:text-[#EAECEE] truncate">
                          {m.title}
                        </h3>

                        {m.description && (
                          <p className="text-xs text-[#7C848D] dark:text-[#A3AAB2] line-clamp-1 max-w-2xl">
                            {m.description}
                          </p>
                        )}

                        <div className="flex items-center gap-4 text-xs text-[#7C848D] dark:text-[#A3AAB2] pt-1 flex-wrap">
                          <span className="font-mono text-[#2F6F68] dark:text-[#5FA399] font-semibold">
                            {m.meetingCode}
                          </span>
                          <span>Host: <strong className="text-[#1F2428] dark:text-[#EAECEE]">{m.hostName}</strong></span>
                          <span className="flex items-center gap-1">
                            <Users className="w-3.5 h-3.5" />
                            {m.invitees?.length || 0} Invited
                          </span>
                        </div>
                      </div>

                      {/* Right Actions */}
                      <div className="flex items-center gap-2 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-[#DDDAD0] dark:border-[#2B3038]">
                        <Button
                          type="button"
                          variant="primary"
                          size="sm"
                          onClick={() => navigate(`/lobby/${m.meetingCode}`)}
                        >
                          Join Room
                        </Button>

                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setInvitationCode(m.meetingCode)}
                          title="View & Copy Invitation"
                          leftIcon={<Share2 className="w-3.5 h-3.5" />}
                        >
                          Invite
                        </Button>

                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setRescheduleMeeting(m)}
                        >
                          Reschedule
                        </Button>

                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setCancelMeeting(m)}
                          className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  </Card>
                );
              })}

              {/* Pagination */}
              {upcomingTotalPages > 1 && (
                <div className="flex items-center justify-between pt-4 px-2">
                  <span className="text-xs text-[#7C848D] dark:text-[#A3AAB2]">
                    Page {upcomingPage} of {upcomingTotalPages}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={upcomingPage <= 1}
                      onClick={() => fetchUpcoming(upcomingPage - 1)}
                      leftIcon={<ChevronLeft className="w-3.5 h-3.5" />}
                    >
                      Previous
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={upcomingPage >= upcomingTotalPages}
                      onClick={() => fetchUpcoming(upcomingPage + 1)}
                      rightIcon={<ChevronRight className="w-3.5 h-3.5" />}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: MEETING HISTORY                                                    */}
      {/* ========================================================================= */}
      {activeTab === 'history' && (
        <div className="space-y-4">
          {historyFeedback && (
            <div
              role="status"
              className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl bg-[#E2ECE9] dark:bg-[#1F302E] border border-[#2F6F68]/25 dark:border-[#5FA399]/30 text-xs font-medium text-[#255A54] dark:text-[#7BC4B9] animate-in fade-in duration-150"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Check className="w-4 h-4 shrink-0 text-[#2F6F68] dark:text-[#5FA399]" aria-hidden="true" />
                <span className="truncate">{historyFeedback}</span>
              </div>
              <button
                type="button"
                onClick={() => setHistoryFeedback(null)}
                aria-label="Dismiss notification"
                className="p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-colors shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* History Filters Toolbar */}
          <Card className="p-4 bg-[#FAF9F6] dark:bg-[#1C1F24] border-[#DDDAD0] dark:border-[#2B3038] shadow-xs rounded-2xl">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-center">
              {/* Search Bar */}
              <div className="relative">
                <Search className="w-4 h-4 text-[#7C848D] dark:text-[#A3AAB2] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={historySearchTerm}
                  onChange={(e) => setHistorySearchTerm(e.target.value)}
                  placeholder="Search title or cly-xxx-xxx..."
                  className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border border-[#DDDAD0] dark:border-[#2B3038] bg-[#F3F2EE] dark:bg-[#141619] focus:outline-none focus:ring-2 focus:ring-[#2F6F68]/30 dark:focus:ring-[#5FA399]/30 text-[#1F2428] dark:text-[#EAECEE] placeholder:text-[#7C848D]/70 dark:placeholder:text-[#747C86]"
                />
              </div>

              {/* Status Filter */}
              <div>
                <select
                  value={historyStatusFilter}
                  onChange={(e) =>
                    setHistoryStatusFilter(e.target.value as 'all' | 'ENDED' | 'CANCELLED')
                  }
                  className="w-full px-3 py-1.5 text-xs rounded-xl border border-[#DDDAD0] dark:border-[#2B3038] bg-[#F3F2EE] dark:bg-[#141619] text-[#1F2428] dark:text-[#EAECEE] focus:outline-none focus:ring-2 focus:ring-[#2F6F68]/30 dark:focus:ring-[#5FA399]/30"
                >
                  <option value="all">All Statuses (Ended & Cancelled)</option>
                  <option value="ENDED">Completed Only</option>
                  <option value="CANCELLED">Cancelled Only</option>
                </select>
              </div>

              {/* Role Filter */}
              <div>
                <select
                  value={historyRoleFilter}
                  onChange={(e) =>
                    setHistoryRoleFilter(e.target.value as 'all' | 'host' | 'participant')
                  }
                  className="w-full px-3 py-1.5 text-xs rounded-xl border border-[#DDDAD0] dark:border-[#2B3038] bg-[#F3F2EE] dark:bg-[#141619] text-[#1F2428] dark:text-[#EAECEE] focus:outline-none focus:ring-2 focus:ring-[#2F6F68]/30 dark:focus:ring-[#5FA399]/30"
                >
                  <option value="all">All Roles (Hosted & Attended)</option>
                  <option value="host">Hosted by Me</option>
                  <option value="participant">Attended as Participant</option>
                </select>
              </div>

              {/* Sort Order */}
              <div>
                <select
                  value={historySortOrder}
                  onChange={(e) => setHistorySortOrder(e.target.value as 'desc' | 'asc')}
                  className="w-full px-3 py-1.5 text-xs rounded-xl border border-[#DDDAD0] dark:border-[#2B3038] bg-[#F3F2EE] dark:bg-[#141619] text-[#1F2428] dark:text-[#EAECEE] focus:outline-none focus:ring-2 focus:ring-[#2F6F68]/30 dark:focus:ring-[#5FA399]/30"
                >
                  <option value="desc">Newest First</option>
                  <option value="asc">Oldest First</option>
                </select>
              </div>
            </div>
          </Card>

          {/* History List or Table */}
          {isHistoryLoading && historyMeetings.length === 0 ? (
            <Card className="p-12 text-center flex flex-col items-center justify-center">
              <RefreshCw className="w-8 h-8 text-[#2F6F68] dark:text-[#5FA399] animate-spin mb-3" />
              <p className="text-xs text-[#7C848D] dark:text-[#A3AAB2]">Loading meeting history records...</p>
            </Card>
          ) : historyError ? (
            <Card className="p-8 text-center bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-900/50">
              <AlertCircle className="w-8 h-8 text-rose-600 dark:text-rose-400 mx-auto mb-2" />
              <p className="text-sm font-bold text-rose-950 dark:text-rose-200 mb-1">Failed to Load History</p>
              <p className="text-xs text-rose-700 dark:text-rose-300 mb-4">{historyError}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => fetchHistory(1)}>
                Retry
              </Button>
            </Card>
          ) : historyMeetings.length === 0 ? (
            <Card className="p-12 bg-[#FAF9F6] dark:bg-[#1C1F24] border-[#DDDAD0] dark:border-[#2B3038] shadow-xs rounded-2xl text-center flex flex-col items-center justify-center min-h-[380px]">
              <div className="w-16 h-16 rounded-2xl bg-[#F3F2EE] dark:bg-[#141619] text-[#7C848D] dark:text-[#A3AAB2] flex items-center justify-center mb-4">
                <History className="w-8 h-8" aria-hidden="true" />
              </div>
              <h3 className="font-display text-base sm:text-lg font-bold text-[#1F2428] dark:text-[#EAECEE] mb-1">
                No Meeting History Found
              </h3>
              <p className="text-xs sm:text-sm text-[#7C848D] dark:text-[#A3AAB2] max-w-md mx-auto mb-6 leading-relaxed">
                {historySearchTerm
                  ? 'No past sessions match your search or filter criteria.'
                  : 'Meetings you host or participate in will appear here once ended or cancelled.'}
              </p>
              {historySearchTerm && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setHistorySearchTerm('');
                    setHistoryStatusFilter('all');
                    setHistoryRoleFilter('all');
                  }}
                >
                  Clear Filters
                </Button>
              )}
            </Card>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#7C848D] dark:text-[#A3AAB2] px-1">
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={allVisibleSelected}
                    aria-label="Select all visible meetings"
                    onClick={toggleSelectAllVisible}
                    className={`w-[18px] h-[18px] rounded-md border flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6F68] dark:focus-visible:ring-[#5FA399] ${
                      allVisibleSelected
                        ? 'bg-[#2F6F68] dark:bg-[#5FA399] border-[#2F6F68] dark:border-[#5FA399] text-white dark:text-[#141619]'
                        : 'bg-[#FAF9F6] dark:bg-[#1C1F24] border-[#CCC8BC] dark:border-[#3A404A] hover:border-[#2F6F68] dark:hover:border-[#5FA399]'
                    }`}
                  >
                    {allVisibleSelected && <Check className="w-3 h-3 stroke-[2.75]" aria-hidden="true" />}
                  </button>
                  <button
                    type="button"
                    onClick={toggleSelectAllVisible}
                    className="font-medium text-[#555D66] dark:text-[#A3AAB2] hover:text-[#1F2428] dark:hover:text-[#EAECEE] transition-colors"
                  >
                    {allVisibleSelected ? 'Deselect all' : 'Select all'}
                  </button>
                  <span aria-hidden="true" className="text-[#DDDAD0] dark:text-[#2B3038]">|</span>
                  <span>Showing {historyMeetings.length} of {historyTotal} records</span>
                </div>
                <span className="text-[11px] text-[#7C848D] dark:text-[#8E96A0]">
                  Removals apply only to your account
                </span>
              </div>

              {selectedHistoryIds.length > 0 && (
                <div
                  role="region"
                  aria-label="Selected history actions"
                  className="px-4 py-2.5 rounded-xl bg-[#FAF9F6] dark:bg-[#1C1F24] border border-rose-200 dark:border-rose-900/50 shadow-xs flex flex-wrap items-center justify-between gap-3 animate-in fade-in slide-in-from-top-1 duration-150"
                >
                  <div className="flex items-center gap-2.5 text-xs">
                    <span className="px-2.5 py-0.5 rounded-full bg-[#E2ECE9] dark:bg-[#1F302E] text-[#2F6F68] dark:text-[#5FA399] font-semibold">
                      {selectedHistoryIds.length} selected
                    </span>
                    <button
                      type="button"
                      onClick={() => setSelectedHistoryIds([])}
                      className="text-[#7C848D] dark:text-[#A3AAB2] hover:text-[#1F2428] dark:hover:text-[#EAECEE] font-medium transition-colors"
                    >
                      Clear
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={requestBulkDelete}
                    className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Delete Selected</span>
                  </button>
                </div>
              )}

              {historyMeetings.map((item) => {
                const isSelected = selectedHistoryIds.includes(item.id);
                return (
                  <Card
                    key={item.id}
                    className={`p-4 bg-[#FAF9F6] dark:bg-[#1C1F24] shadow-xs rounded-2xl transition-all ${
                      isSelected
                        ? 'border-[#2F6F68] dark:border-[#5FA399] ring-1 ring-[#2F6F68]/20 dark:ring-[#5FA399]/25'
                        : 'border-[#DDDAD0] dark:border-[#2B3038] hover:border-[#2F6F68]/30 dark:hover:border-[#5FA399]/30'
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0 flex-1">
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={isSelected}
                          aria-label={`Select ${item.title}`}
                          onClick={() => toggleHistorySelection(item.id)}
                          className={`mt-1 w-[18px] h-[18px] rounded-md border flex items-center justify-center shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6F68] dark:focus-visible:ring-[#5FA399] ${
                            isSelected
                              ? 'bg-[#2F6F68] dark:bg-[#5FA399] border-[#2F6F68] dark:border-[#5FA399] text-white dark:text-[#141619]'
                              : 'bg-[#F3F2EE] dark:bg-[#141619] border-[#CCC8BC] dark:border-[#3A404A] hover:border-[#2F6F68] dark:hover:border-[#5FA399]'
                          }`}
                        >
                          {isSelected && <Check className="w-3 h-3 stroke-[2.75]" aria-hidden="true" />}
                        </button>

                        <div className="space-y-1 min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-xs font-bold text-[#2F6F68] dark:text-[#5FA399]">
                              {item.meetingCode}
                            </span>
                            <Badge
                              variant={
                                item.status === 'ENDED'
                                  ? 'success'
                                  : item.status === 'CANCELLED'
                                  ? 'neutral'
                                  : 'info'
                              }
                            >
                              {item.status}
                            </Badge>
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#F3F2EE] dark:bg-[#141619] border border-[#DDDAD0] dark:border-[#2B3038] text-[#1F2428] dark:text-[#EAECEE] font-semibold capitalize">
                              Role: {item.userRole}
                            </span>
                          </div>

                          <h4 className="font-display text-sm font-bold text-[#1F2428] dark:text-[#EAECEE] truncate">
                            {item.title}
                          </h4>

                          <div className="flex items-center gap-4 text-xs text-[#7C848D] dark:text-[#A3AAB2] flex-wrap">
                            <span>
                              {new Date(item.createdAt).toLocaleDateString([], {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                              })}
                            </span>
                            <span>Host: {item.hostName}</span>
                            <span>Duration: <strong className="text-[#1F2428] dark:text-[#EAECEE]">{item.formattedDuration}</strong></span>
                            {item.cancelledAt && (
                              <span className="text-rose-600 dark:text-rose-400 font-medium">
                                Cancelled {item.cancellationReason ? `(${item.cancellationReason})` : ''}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="shrink-0 flex items-center gap-2 pl-7 sm:pl-0">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => handleOpenHistoryDetails(item.id)}
                          leftIcon={<Eye className="w-3.5 h-3.5" />}
                        >
                          View Details
                        </Button>
                        <button
                          type="button"
                          onClick={() => requestSingleDelete(item)}
                          aria-label={`Delete ${item.title} from history`}
                          title="Remove from your history"
                          className="p-2 rounded-lg border border-[#DDDAD0] dark:border-[#2B3038] bg-[#FAF9F6] dark:bg-[#1C1F24] text-[#7C848D] dark:text-[#A3AAB2] hover:text-rose-600 dark:hover:text-rose-400 hover:border-rose-300 dark:hover:border-rose-800/70 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
                        >
                          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  </Card>
                );
              })}

              {/* History Pagination */}
              {historyTotalPages > 1 && (
                <div className="flex items-center justify-between pt-4 px-2">
                  <span className="text-xs text-[#7C848D] dark:text-[#A3AAB2]">
                    Page {historyPage} of {historyTotalPages}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={historyPage <= 1}
                      onClick={() => fetchHistory(historyPage - 1)}
                      leftIcon={<ChevronLeft className="w-3.5 h-3.5" />}
                    >
                      Previous
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={historyPage >= historyTotalPages}
                      onClick={() => fetchHistory(historyPage + 1)}
                      rightIcon={<ChevronRight className="w-3.5 h-3.5" />}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* HISTORY DETAILS MODAL (OBJECT-LEVEL AUTHORIZED AUDIT LOGS)                */}
      {/* ========================================================================= */}
      {selectedHistoryDetails && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#141619]/65 animate-in fade-in duration-150"
        >
          <div className="w-full max-w-xl bg-[#FAF9F6] dark:bg-[#1C1F24] rounded-2xl shadow-xl border border-[#DDDAD0] dark:border-[#2B3038] overflow-hidden max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#DDDAD0] dark:border-[#2B3038] bg-[#F3F2EE] dark:bg-[#141619]">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-[#E2ECE9] dark:bg-[#1F302E] text-[#2F6F68] dark:text-[#5FA399] flex items-center justify-center">
                  <History className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-display text-sm font-bold text-[#1F2428] dark:text-[#EAECEE]">
                    Meeting Session Record
                  </h3>
                  <span className="font-mono text-[11px] text-[#2F6F68] dark:text-[#5FA399]">
                    {selectedHistoryDetails.meeting.meetingCode}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedHistoryDetails(null)}
                className="p-1 rounded-lg text-[#7C848D] dark:text-[#A3AAB2] hover:text-[#1F2428] dark:hover:text-[#EAECEE] hover:bg-black/5"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-5 text-xs text-[#1F2428] dark:text-[#EAECEE]">
              {/* Meeting Summary Box */}
              <div className="p-4 bg-[#F3F2EE] dark:bg-[#141619] rounded-xl border border-[#DDDAD0] dark:border-[#2B3038] space-y-2">
                <h4 className="font-display text-sm font-bold text-[#1F2428] dark:text-[#EAECEE]">
                  {selectedHistoryDetails.meeting.title}
                </h4>
                {selectedHistoryDetails.meeting.description && (
                  <p className="text-[#7C848D] dark:text-[#A3AAB2]">{selectedHistoryDetails.meeting.description}</p>
                )}
                <div className="grid grid-cols-2 gap-2 pt-2 text-[11px] border-t border-[#DDDAD0] dark:border-[#2B3038]">
                  <div>
                    <span className="font-semibold text-[#7C848D] dark:text-[#A3AAB2]">Host: </span>
                    <span>{selectedHistoryDetails.meeting.hostName}</span>
                  </div>
                  <div>
                    <span className="font-semibold text-[#7C848D] dark:text-[#A3AAB2]">Your Role: </span>
                    <span className="capitalize">{selectedHistoryDetails.meeting.userRole}</span>
                  </div>
                  <div>
                    <span className="font-semibold text-[#7C848D] dark:text-[#A3AAB2]">Status: </span>
                    <span>{selectedHistoryDetails.meeting.status}</span>
                  </div>
                  <div>
                    <span className="font-semibold text-[#7C848D] dark:text-[#A3AAB2]">Actual Duration: </span>
                    <span>{selectedHistoryDetails.meeting.formattedDuration}</span>
                  </div>
                </div>
              </div>

              {/* Participant Attendance */}
              <div>
                <h4 className="font-bold text-xs text-[#1F2428] dark:text-[#EAECEE] mb-2 uppercase tracking-wider">
                  Participant Attendance ({selectedHistoryDetails.participants.length})
                </h4>
                <div className="border border-[#DDDAD0] dark:border-[#2B3038] rounded-xl overflow-hidden divide-y divide-[#DDDAD0]/70 dark:divide-[#2B3038]">
                  {selectedHistoryDetails.participants.map((p, idx) => (
                    <div key={idx} className="p-2.5 flex items-center justify-between text-[11px]">
                      <div>
                        <span className="font-semibold text-[#1F2428] dark:text-[#EAECEE] block">{p.displayName}</span>
                        <span className="text-[10px] text-[#7C848D] dark:text-[#A3AAB2] capitalize">{p.role}</span>
                      </div>
                      <div className="text-right text-[10px] text-[#7C848D] dark:text-[#A3AAB2]">
                        {p.joinedAt ? (
                          <span>Joined: {new Date(p.joinedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        ) : (
                          <span>Requested</span>
                        )}
                        {p.leftAt && (
                          <span className="block">Left: {new Date(p.leftAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Lifecycle Audit Timeline */}
              <div>
                <h4 className="font-bold text-xs text-[#1F2428] dark:text-[#EAECEE] mb-2 uppercase tracking-wider">
                  Lifecycle Audit Events
                </h4>
                <div className="space-y-2 border-l-2 border-[#2F6F68]/30 dark:border-[#5FA399]/30 pl-3 ml-2">
                  {selectedHistoryDetails.timeline.map((entry, idx) => (
                    <div key={idx} className="relative pb-2 last:pb-0">
                      <span className="absolute -left-[19px] top-1 w-2.5 h-2.5 rounded-full bg-[#2F6F68] dark:bg-[#5FA399]" />
                      <div className="text-[11px]">
                        <span className="font-bold text-[#1F2428] dark:text-[#EAECEE]">{entry.action}</span>
                        {entry.details && <span className="text-[#7C848D] dark:text-[#A3AAB2]"> — {entry.details}</span>}
                        <span className="text-[10px] text-[#7C848D]/75 dark:text-[#747C86] block mt-0.5">
                          {new Date(entry.timestamp).toLocaleString([], {
                            dateStyle: 'short',
                            timeStyle: 'medium',
                          })}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-[#DDDAD0] dark:border-[#2B3038] bg-[#F3F2EE] dark:bg-[#141619] flex justify-end">
              <Button type="button" variant="outline" size="sm" onClick={() => setSelectedHistoryDetails(null)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal for Removing Meeting History */}
      {deleteConfirmTargets &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="remove-history-title"
            onClick={(e) => {
              if (e.target === e.currentTarget && !isDeletingHistory) {
                setDeleteConfirmTargets(null);
              }
            }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#141619]/65 animate-in fade-in duration-150"
          >
            <div className="w-full max-w-md bg-[#FAF9F6] dark:bg-[#1C1F24] rounded-2xl shadow-xl border border-[#DDDAD0] dark:border-[#2B3038] overflow-hidden">
              <div className="flex items-center justify-between px-6 py-4 border-b border-[#DDDAD0] dark:border-[#2B3038] bg-[#F3F2EE] dark:bg-[#141619]">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-rose-100 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 flex items-center justify-center">
                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                  </div>
                  <h2
                    id="remove-history-title"
                    className="font-display text-base font-bold text-[#1F2428] dark:text-[#EAECEE]"
                  >
                    Remove from History
                  </h2>
                </div>
                <button
                  type="button"
                  disabled={isDeletingHistory}
                  onClick={() => setDeleteConfirmTargets(null)}
                  aria-label="Close remove confirmation dialog"
                  className="p-1.5 rounded-lg text-[#7C848D] dark:text-[#A3AAB2] hover:text-[#1F2428] dark:hover:text-[#EAECEE] hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-6 space-y-4">
                {deleteHistoryError && (
                  <div
                    role="alert"
                    aria-live="assertive"
                    className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-xs text-rose-700 dark:text-rose-300"
                  >
                    {deleteHistoryError}
                  </div>
                )}

                <p className="text-xs sm:text-sm text-[#1F2428] dark:text-[#EAECEE] leading-relaxed">
                  {deleteConfirmTargets.length === 1 ? (
                    <>
                      Remove <strong>&ldquo;{deleteConfirmTargets[0].title}&rdquo;</strong> from your account history?
                    </>
                  ) : (
                    <>
                      Remove <strong>{deleteConfirmTargets.length} selected meetings</strong> from your account history?
                    </>
                  )}
                </p>

                <div className="p-3 rounded-xl bg-[#F3F2EE] dark:bg-[#141619] border border-[#DDDAD0] dark:border-[#2B3038] space-y-1.5">
                  {deleteConfirmTargets.slice(0, 3).map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-2 text-xs"
                    >
                      <span className="font-medium text-[#1F2428] dark:text-[#EAECEE] truncate">
                        {item.title}
                      </span>
                      <span className="font-mono text-[11px] text-[#2F6F68] dark:text-[#5FA399] shrink-0">
                        {item.meetingCode}
                      </span>
                    </div>
                  ))}
                  {deleteConfirmTargets.length > 3 && (
                    <p className="text-[11px] text-[#7C848D] dark:text-[#8E96A0] pt-0.5">
                      +{deleteConfirmTargets.length - 3} more selected
                    </p>
                  )}
                </div>

                <p className="text-[11px] text-[#7C848D] dark:text-[#8E96A0] leading-relaxed">
                  This only removes records from your account. Other participants keep their copy unless they delete it too.
                </p>
              </div>

              <div className="px-6 py-4 border-t border-[#DDDAD0] dark:border-[#2B3038] bg-[#F3F2EE] dark:bg-[#141619] flex items-center justify-end gap-2.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isDeletingHistory}
                  onClick={() => setDeleteConfirmTargets(null)}
                >
                  Cancel
                </Button>
                <button
                  type="button"
                  disabled={isDeletingHistory}
                  onClick={handleConfirmDeleteHistory}
                  className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
                >
                  {isDeletingHistory ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                      <span>Removing...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Remove</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* Global Modals */}
      <ScheduleMeetingModal
        isOpen={isScheduleModalOpen}
        onClose={() => setIsScheduleModalOpen(false)}
        onMeetingScheduled={() => {
          fetchUpcoming(1);
          setIsScheduleModalOpen(false);
        }}
      />

      <RescheduleModal
        isOpen={Boolean(rescheduleMeeting)}
        onClose={() => setRescheduleMeeting(null)}
        meeting={rescheduleMeeting}
        onRescheduled={() => {
          fetchUpcoming(upcomingPage);
          setRescheduleMeeting(null);
        }}
      />

      <CancelMeetingModal
        isOpen={Boolean(cancelMeeting)}
        onClose={() => setCancelMeeting(null)}
        meeting={cancelMeeting}
        onCancelled={() => {
          fetchUpcoming(upcomingPage);
          setCancelMeeting(null);
        }}
      />

      <MeetingInvitationModal
        isOpen={Boolean(invitationCode)}
        onClose={() => setInvitationCode(null)}
        meetingCode={invitationCode}
      />
    </DashboardLayout>
  );
};

export default MeetingsPage;
