import React, { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
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
  const [activeTab, setActiveTab] = useState<'scheduled' | 'history'>('scheduled');

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
      const details = await schedulingApi.getMeetingHistoryDetails(meetingId);
      setSelectedHistoryDetails(details);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Unable to load meeting history details.');
    }
  };

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
              onClick={() => setActiveTab('scheduled')}
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
              onClick={() => setActiveTab('history')}
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
                  className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border border-[#DDDAD0] dark:border-[#2B3038] focus:outline-none focus:ring-2 focus:ring-[#2F6F68]/30 dark:focus:ring-[#5FA399]/30 text-[#1F2428] dark:text-[#EAECEE]"
                />
              </div>

              {/* Status Filter */}
              <div>
                <select
                  value={historyStatusFilter}
                  onChange={(e) =>
                    setHistoryStatusFilter(e.target.value as 'all' | 'ENDED' | 'CANCELLED')
                  }
                  className="w-full px-3 py-1.5 text-xs rounded-xl border border-[#DDDAD0] dark:border-[#2B3038] bg-[#FAF9F6] dark:bg-[#1C1F24] text-[#1F2428] dark:text-[#EAECEE] focus:outline-none focus:ring-2 focus:ring-[#2F6F68]/30 dark:focus:ring-[#5FA399]/30"
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
                  className="w-full px-3 py-1.5 text-xs rounded-xl border border-[#DDDAD0] dark:border-[#2B3038] bg-[#FAF9F6] dark:bg-[#1C1F24] text-[#1F2428] dark:text-[#EAECEE] focus:outline-none focus:ring-2 focus:ring-[#2F6F68]/30 dark:focus:ring-[#5FA399]/30"
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
                  className="w-full px-3 py-1.5 text-xs rounded-xl border border-[#DDDAD0] dark:border-[#2B3038] bg-[#FAF9F6] dark:bg-[#1C1F24] text-[#1F2428] dark:text-[#EAECEE] focus:outline-none focus:ring-2 focus:ring-[#2F6F68]/30 dark:focus:ring-[#5FA399]/30"
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
            <Card className="p-8 text-center bg-rose-50 border-rose-200">
              <AlertCircle className="w-8 h-8 text-rose-600 mx-auto mb-2" />
              <p className="text-sm font-bold text-rose-950 mb-1">Failed to Load History</p>
              <p className="text-xs text-rose-700 mb-4">{historyError}</p>
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
              <div className="flex items-center justify-between text-xs text-[#7C848D] dark:text-[#A3AAB2] px-1">
                <span>Showing {historyMeetings.length} of {historyTotal} records</span>
              </div>

              {historyMeetings.map((item) => (
                <Card key={item.id} className="p-4 bg-[#FAF9F6] dark:bg-[#1C1F24] border-[#DDDAD0] dark:border-[#2B3038] shadow-xs rounded-2xl hover:border-[#2F6F68]/30 dark:hover:border-[#5FA399]/30 transition-all">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
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
                          <span className="text-rose-600 font-medium">
                            Cancelled {item.cancellationReason ? `(${item.cancellationReason})` : ''}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="shrink-0 flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleOpenHistoryDetails(item.id)}
                        leftIcon={<Eye className="w-3.5 h-3.5" />}
                      >
                        View Details
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}

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
