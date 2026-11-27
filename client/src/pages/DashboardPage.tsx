import React, { useState } from 'react';
import { DashboardLayout } from '@/components/dashboard/DashboardLayout';
import { WelcomeHeader } from '@/components/dashboard/WelcomeHeader';
import { QuickActionBar } from '@/components/dashboard/QuickActionBar';
import { UpcomingMeetingsSection } from '@/components/dashboard/UpcomingMeetingsSection';
import { RecentActivityWidget } from '@/components/dashboard/RecentActivityWidget';
import { RecentDownloadsWidget } from '@/components/dashboard/RecentDownloadsWidget';
import { JoinMeetingModal } from '@/components/dashboard/JoinMeetingModal';
import { InstantMeetingModal } from '@/components/dashboard/InstantMeetingModal';
import { ScheduleNoticeModal } from '@/components/dashboard/ScheduleNoticeModal';

export const DashboardPage: React.FC = () => {
  const [isJoinModalOpen, setIsJoinModalOpen] = useState(false);
  const [isInstantModalOpen, setIsInstantModalOpen] = useState(false);
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [prefilledCode, setPrefilledCode] = useState('');
  const [scheduleRefreshKey, setScheduleRefreshKey] = useState(0);

  const handleOpenJoinModal = (code = '') => {
    setPrefilledCode(code);
    setIsJoinModalOpen(true);
  };

  return (
    <DashboardLayout title="Dashboard">
      <WelcomeHeader />

      <QuickActionBar
        onInstantMeeting={() => setIsInstantModalOpen(true)}
        onJoinMeeting={(code) => handleOpenJoinModal(code || '')}
        onScheduleMeeting={() => setIsScheduleModalOpen(true)}
      />

      {/* Balanced 2-Column Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6 items-stretch">
        <div className="lg:col-span-7 flex flex-col">
          <UpcomingMeetingsSection
            onInstantMeeting={() => setIsInstantModalOpen(true)}
            onScheduleMeeting={() => setIsScheduleModalOpen(true)}
            refreshKey={scheduleRefreshKey}
          />
        </div>

        <div className="lg:col-span-5 flex flex-col gap-5 sm:gap-6">
          <RecentActivityWidget refreshKey={scheduleRefreshKey} />
          <RecentDownloadsWidget />
        </div>
      </div>

      {/* Interactive Action Modals */}
      <JoinMeetingModal
        isOpen={isJoinModalOpen}
        onClose={() => setIsJoinModalOpen(false)}
        initialCode={prefilledCode}
      />

      <InstantMeetingModal
        isOpen={isInstantModalOpen}
        onClose={() => setIsInstantModalOpen(false)}
      />

      <ScheduleNoticeModal
        isOpen={isScheduleModalOpen}
        onClose={() => setIsScheduleModalOpen(false)}
        onMeetingScheduled={() => setScheduleRefreshKey((prev) => prev + 1)}
      />
    </DashboardLayout>
  );
};

export default DashboardPage;
