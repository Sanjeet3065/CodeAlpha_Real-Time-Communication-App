import React, { useState } from 'react';
import { DashboardLayout } from '@/components/dashboard/DashboardLayout';
import { WelcomeHeader } from '@/components/dashboard/WelcomeHeader';
import { QuickActionBar } from '@/components/dashboard/QuickActionBar';
import { UpcomingMeetingsSection } from '@/components/dashboard/UpcomingMeetingsSection';
import { QuickCodeWidget } from '@/components/dashboard/QuickCodeWidget';
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

  const handleOpenJoinModal = (code = '') => {
    setPrefilledCode(code);
    setIsJoinModalOpen(true);
  };

  return (
    <DashboardLayout
      title="Dashboard"
      subtitle="Overview of your collaboration schedule and active workspaces"
    >
      {/* 1. Welcome Header Section */}
      <WelcomeHeader />

      {/* 2. Top Quick Action Bar */}
      <QuickActionBar
        onInstantMeeting={() => setIsInstantModalOpen(true)}
        onJoinMeeting={() => handleOpenJoinModal('')}
        onScheduleMeeting={() => setIsScheduleModalOpen(true)}
      />

      {/* 3. Main Dashboard 2-Column Split Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column (60% on desktop: 7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          <UpcomingMeetingsSection
            onInstantMeeting={() => setIsInstantModalOpen(true)}
            onScheduleMeeting={() => setIsScheduleModalOpen(true)}
          />
        </div>

        {/* Right Column (40% on desktop: 5 cols) */}
        <div className="lg:col-span-5 space-y-6">
          {/* Quick Code Entry Box */}
          <QuickCodeWidget onJoinCode={(code) => handleOpenJoinModal(code)} />

          {/* Recent Activity Feed Widget */}
          <RecentActivityWidget />

          {/* Recent Downloads & Shared Files Quick-Access Widget */}
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
      />
    </DashboardLayout>
  );
};

export default DashboardPage;
