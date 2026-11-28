import React from 'react';
import { ScheduleMeetingModal } from './ScheduleMeetingModal';
import type { IScheduledMeeting } from '@/types/scheduling';

interface ScheduleNoticeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onMeetingScheduled?: (meeting: IScheduledMeeting) => void;
}

/**
 * Wrapper preserving the ScheduleNoticeModal export for dashboard schedule triggers.
 */
export const ScheduleNoticeModal: React.FC<ScheduleNoticeModalProps> = ({
  isOpen,
  onClose,
  onMeetingScheduled,
}) => {
  return (
    <ScheduleMeetingModal
      isOpen={isOpen}
      onClose={onClose}
      onMeetingScheduled={onMeetingScheduled}
    />
  );
};
