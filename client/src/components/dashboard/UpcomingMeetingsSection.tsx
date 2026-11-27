import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CalendarClock,
  Plus,
  Users,
  AlertCircle,
  RefreshCw,
  Clock,
  Share2,
  Calendar,
  MoreVertical,
  XCircle,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { schedulingApi } from '@/services/schedulingApi';
import { meetingSocket } from '@/services/meetingSocket';
import { MeetingInvitationModal } from './MeetingInvitationModal';
import { RescheduleModal } from './RescheduleModal';
import { CancelMeetingModal } from './CancelMeetingModal';
import type { IScheduledMeeting } from '@/types/scheduling';

interface UpcomingMeetingsSectionProps {
  onInstantMeeting: () => void;
  onScheduleMeeting?: () => void;
  refreshKey?: number;
}

export const UpcomingMeetingsSection: React.FC<UpcomingMeetingsSectionProps> = ({
  onInstantMeeting,
  onScheduleMeeting,
  refreshKey = 0,
}) => {
  const navigate = useNavigate();
  const [meetings, setMeetings] = useState<IScheduledMeeting[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modals state
  const [invitationCode, setInvitationCode] = useState<string | null>(null);
  const [selectedMeetingForReschedule, setSelectedMeetingForReschedule] = useState<IScheduledMeeting | null>(null);
  const [selectedMeetingForCancel, setSelectedMeetingForCancel] = useState<IScheduledMeeting | null>(null);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

  const fetchUpcoming = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const res = await schedulingApi.listUpcomingMeetings({ page: 1, limit: 10 });
      setMeetings(res.meetings);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : 'Unable to load upcoming collaboration sessions.'
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUpcoming();

    // Real-time synchronization
    const socket = meetingSocket.getSocket();
    if (socket) {
      const handleMeetingEvent = () => {
        fetchUpcoming();
      };
      socket.on('meeting:scheduled', handleMeetingEvent);
      socket.on('meeting:rescheduled', handleMeetingEvent);
      socket.on('meeting:cancelled', handleMeetingEvent);
      socket.on('meeting:updated', handleMeetingEvent);

      return () => {
        socket.off('meeting:scheduled', handleMeetingEvent);
        socket.off('meeting:rescheduled', handleMeetingEvent);
        socket.off('meeting:cancelled', handleMeetingEvent);
        socket.off('meeting:updated', handleMeetingEvent);
      };
    }
  }, [fetchUpcoming, refreshKey]);

  return (
    <Card className="p-5 sm:p-6 bg-[#FAF9F6] dark:bg-[#1C1F24] border-[#DDDAD0] dark:border-[#2B3038] shadow-xs rounded-2xl flex flex-col flex-1 h-full">
      {/* Section Header */}
      <div className="flex items-center justify-between pb-3.5 mb-4 border-b border-[#DDDAD0]/80 dark:border-[#2B3038]">
        <h3 className="font-display text-base font-bold text-[#1F2428] dark:text-[#EAECEE]">
          Upcoming Meetings
        </h3>
        <div className="flex items-center gap-2">
          <Badge variant="neutral">{meetings.length} Scheduled</Badge>
          <button
            type="button"
            onClick={fetchUpcoming}
            aria-label="Refresh upcoming meetings"
            className="p-1.5 rounded-lg text-[#7C848D] dark:text-[#A3AAB2] hover:text-[#1F2428] dark:hover:text-[#EAECEE] hover:bg-[#F3F2EE] dark:hover:bg-[#24282E] transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Loading State */}
      {isLoading && meetings.length === 0 && (
        <div className="py-12 flex flex-1 flex-col items-center justify-center space-y-3">
          <div className="w-8 h-8 border-2 border-[#2F6F68] dark:border-[#5FA399] border-t-transparent rounded-full animate-spin" />
          <p className="text-xs text-[#7C848D] dark:text-[#A3AAB2]">Loading upcoming sessions...</p>
        </div>
      )}

      {/* Error State */}
      {!isLoading && error && (
        <div className="py-8 px-4 text-center rounded-xl bg-[#F6E6E6] dark:bg-[#342023] border border-[#C24D4D]/30 dark:border-[#D46A6A]/30">
          <AlertCircle className="w-6 h-6 text-[#C24D4D] dark:text-[#D46A6A] mx-auto mb-2" />
          <p className="text-xs font-semibold text-[#C24D4D] dark:text-[#D46A6A] mb-1">Unable to Load Schedule</p>
          <p className="text-xs text-[#7C848D] dark:text-[#A3AAB2] mb-3">{error}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={fetchUpcoming}
            leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
          >
            Retry
          </Button>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !error && meetings.length === 0 && (
        <div className="py-10 px-4 text-center flex-1 flex flex-col items-center justify-center">
          <div className="w-11 h-11 rounded-xl bg-[#E2ECE9] dark:bg-[#1F302E] text-[#2F6F68] dark:text-[#5FA399] flex items-center justify-center mb-3">
            <CalendarClock className="w-5 h-5" aria-hidden="true" />
          </div>
          <h4 className="font-display text-sm font-bold text-[#1F2428] dark:text-[#EAECEE] mb-1">
            No upcoming meetings
          </h4>
          <p className="text-xs text-[#7C848D] dark:text-[#A3AAB2] max-w-xs mx-auto mb-5 leading-relaxed">
            Schedule a session in advance or launch an instant room.
          </p>
          <div className="flex flex-wrap justify-center gap-2.5">
            {onScheduleMeeting && (
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={onScheduleMeeting}
                leftIcon={<Calendar className="w-4 h-4" />}
              >
                Schedule Meeting
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onInstantMeeting}
              leftIcon={<Plus className="w-4 h-4" />}
            >
              Start Instant Room
            </Button>
          </div>
        </div>
      )}

      {/* Populated State */}
      {!error && meetings.length > 0 && (
        <div className="space-y-3 divide-y divide-[#DDDAD0]/70 dark:divide-[#2B3038]">
          {meetings.map((meeting) => {
            const startDate = meeting.scheduledStartAt ? new Date(meeting.scheduledStartAt) : null;
            const timeStr = startDate
              ? startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              : '--:--';
            const dateStr = startDate
              ? startDate.toLocaleDateString([], { month: 'short', day: 'numeric' })
              : '';

            return (
              <div key={meeting.id} className="pt-3 first:pt-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-xs font-bold text-[#2F6F68] dark:text-[#5FA399] flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />
                        {dateStr} at {timeStr}
                      </span>
                      <span className="text-[10px] text-[#7C848D] dark:text-[#A3AAB2]">
                        ({meeting.scheduledTimeZone || 'UTC'})
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#F3F2EE] dark:bg-[#141619] border border-[#DDDAD0] dark:border-[#2B3038] text-[#1F2428] dark:text-[#EAECEE] font-medium">
                        {meeting.durationMinutes}m
                      </span>
                      {meeting.settings?.waitingRoomEnabled && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#E2ECE9] dark:bg-[#1F302E] text-[#2F6F68] dark:text-[#5FA399] font-semibold">
                          Waiting Room
                        </span>
                      )}
                    </div>

                    <h4 className="text-sm font-semibold text-[#1F2428] dark:text-[#EAECEE] truncate">
                      {meeting.title}
                    </h4>

                    <div className="flex items-center gap-3 mt-1 text-xs text-[#7C848D] dark:text-[#A3AAB2] flex-wrap">
                      <span className="font-mono text-[#2F6F68] dark:text-[#5FA399] font-semibold">
                        {meeting.meetingCode}
                      </span>
                      <span className="flex items-center gap-1">
                        <Users className="w-3.5 h-3.5" />
                        {meeting.invitees?.length || 0} invited
                      </span>
                      <span>By {meeting.hostName}</span>
                    </div>
                  </div>

                  {/* Actions Column */}
                  <div className="flex items-center gap-1.5 shrink-0 relative">
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      onClick={() => navigate(`/lobby/${meeting.meetingCode}`)}
                    >
                      Join
                    </Button>

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setInvitationCode(meeting.meetingCode)}
                      title="Share Invitation"
                    >
                      <Share2 className="w-3.5 h-3.5" />
                    </Button>

                    {/* Actions Menu Toggle */}
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() =>
                          setActiveMenuId(activeMenuId === meeting.id ? null : meeting.id)
                        }
                        className="p-1.5 rounded-lg border border-[#DDDAD0] dark:border-[#2B3038] hover:bg-[#F3F2EE] dark:hover:bg-[#24282E] text-[#7C848D] dark:text-[#A3AAB2]"
                        title="More Actions"
                      >
                        <MoreVertical className="w-3.5 h-3.5" />
                      </button>

                      {activeMenuId === meeting.id && (
                        <div
                          className="absolute right-0 top-full mt-1 w-36 bg-[#FAF9F6] dark:bg-[#1C1F24] border border-[#DDDAD0] dark:border-[#2B3038] rounded-xl shadow-lg z-20 py-1 text-xs animate-in fade-in-50"
                          onMouseLeave={() => setActiveMenuId(null)}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedMeetingForReschedule(meeting);
                              setActiveMenuId(null);
                            }}
                            className="w-full text-left px-3 py-1.5 hover:bg-[#F3F2EE] dark:hover:bg-[#24282E] text-[#1F2428] dark:text-[#EAECEE]"
                          >
                            Reschedule
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedMeetingForCancel(meeting);
                              setActiveMenuId(null);
                            }}
                            className="w-full text-left px-3 py-1.5 hover:bg-[#F6E6E6] dark:hover:bg-[#342023] text-[#C24D4D] dark:text-[#D46A6A] flex items-center gap-1.5"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Action Modals */}
      <MeetingInvitationModal
        isOpen={Boolean(invitationCode)}
        onClose={() => setInvitationCode(null)}
        meetingCode={invitationCode}
      />

      <RescheduleModal
        isOpen={Boolean(selectedMeetingForReschedule)}
        onClose={() => setSelectedMeetingForReschedule(null)}
        meeting={selectedMeetingForReschedule}
        onRescheduled={() => fetchUpcoming()}
      />

      <CancelMeetingModal
        isOpen={Boolean(selectedMeetingForCancel)}
        onClose={() => setSelectedMeetingForCancel(null)}
        meeting={selectedMeetingForCancel}
        onCancelled={() => fetchUpcoming()}
      />
    </Card>
  );
};
