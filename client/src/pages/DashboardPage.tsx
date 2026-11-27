import React, { useState } from 'react';
import { DashboardLayout } from '@/components/dashboard/DashboardLayout';
import { WelcomeHeader } from '@/components/dashboard/WelcomeHeader';
import { UpNextBanner } from '@/components/dashboard/UpNextBanner';
import { QuickActionBar } from '@/components/dashboard/QuickActionBar';
import { UpcomingMeetingsSection } from '@/components/dashboard/UpcomingMeetingsSection';
import { PreCallStudioWidget } from '@/components/dashboard/PreCallStudioWidget';
import { RecentActivityWidget } from '@/components/dashboard/RecentActivityWidget';
import { JoinMeetingModal } from '@/components/dashboard/JoinMeetingModal';
import { InstantMeetingModal } from '@/components/dashboard/InstantMeetingModal';
import { ScheduleNoticeModal } from '@/components/dashboard/ScheduleNoticeModal';

export const DashboardPage: React.FC = () => {
  const [isJoinModalOpen, setIsJoinModalOpen] = useState(false);
  const [isInstantModalOpen, setIsInstantModalOpen] = useState(false);
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [prefilledCode, setPrefilledCode] = useState('');
  const [prefilledInstantTitle, setPrefilledInstantTitle] = useState('');
  const [scheduleRefreshKey, setScheduleRefreshKey] = useState(0);

  const handleOpenJoinModal = (code = '') => {
    setPrefilledCode(code);
    setIsJoinModalOpen(true);
  };

  const handleOpenInstant = (initialTitle = '') => {
    setPrefilledInstantTitle(initialTitle);
    setIsInstantModalOpen(true);
  };

  const handleMeetAgain = (previousTitle: string) => {
    const clean = previousTitle.replace(/^Follow-up:\s*/i, '').trim();
    handleOpenInstant(clean ? `Follow-up: ${clean}` : '');
  };

  return (
    <DashboardLayout title="Dashboard">
      <WelcomeHeader />

      <UpNextBanner refreshKey={scheduleRefreshKey} />

      <QuickActionBar
        onInstantMeeting={() => handleOpenInstant('')}
        onJoinMeeting={(code) => handleOpenJoinModal(code || '')}
        onScheduleMeeting={() => setIsScheduleModalOpen(true)}
      />

      {/* Video-First 2-Column Studio Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6 items-stretch">
        <div className="lg:col-span-7 flex flex-col">
          <UpcomingMeetingsSection
            onInstantMeeting={() => handleOpenInstant('')}
            onScheduleMeeting={() => setIsScheduleModalOpen(true)}
            refreshKey={scheduleRefreshKey}
          />
        </div>

        <div className="lg:col-span-5 flex flex-col gap-5 sm:gap-6">
          <PreCallStudioWidget />
          <RecentActivityWidget
            refreshKey={scheduleRefreshKey}
            onMeetAgain={handleMeetAgain}
          />
        </div>
      </div>

      {/* Streamlined Action Modals */}
      <JoinMeetingModal
        isOpen={isJoinModalOpen}
        onClose={() => setIsJoinModalOpen(false)}
        initialCode={prefilledCode}
      />

      <InstantMeetingModal
        isOpen={isInstantModalOpen}
        onClose={() => setIsInstantModalOpen(false)}
        initialTitle={prefilledInstantTitle}
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
