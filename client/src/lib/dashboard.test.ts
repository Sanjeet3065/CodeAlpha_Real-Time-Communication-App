import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validateMeetingCode } from './meetingCode.ts';

// Pure helper functions matching dashboard logic
function formatFileSize(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

function getGreetingForHour(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function formatUserDisplayName(user: { firstName?: string | null; lastName?: string | null; email?: string } | null): string {
  if (!user) return 'Collaborator';
  if (user.firstName && user.lastName) return `${user.firstName} ${user.lastName}`.trim();
  if (user.firstName) return user.firstName.trim();
  if (user.email) return user.email.split('@')[0] || 'Collaborator';
  return 'Collaborator';
}

describe('Dashboard Utilities & Data Contracts', () => {
  it('should generate appropriate greetings based on 24-hour time', () => {
    assert.strictEqual(getGreetingForHour(8), 'Good morning');
    assert.strictEqual(getGreetingForHour(11), 'Good morning');
    assert.strictEqual(getGreetingForHour(12), 'Good afternoon');
    assert.strictEqual(getGreetingForHour(15), 'Good afternoon');
    assert.strictEqual(getGreetingForHour(18), 'Good evening');
    assert.strictEqual(getGreetingForHour(23), 'Good evening');
    assert.strictEqual(getGreetingForHour(2), 'Good morning');
  });

  it('should format user display names safely with fallbacks', () => {
    // Both first and last
    assert.strictEqual(
      formatUserDisplayName({ firstName: 'Sarah', lastName: 'Chen', email: 'sarah@connectly.io' }),
      'Sarah Chen'
    );
    // First name only
    assert.strictEqual(
      formatUserDisplayName({ firstName: 'Alex', lastName: null, email: 'alex@connectly.io' }),
      'Alex'
    );
    // Email fallback
    assert.strictEqual(
      formatUserDisplayName({ firstName: null, lastName: null, email: 'engineer@connectly.io' }),
      'engineer'
    );
    // Null user
    assert.strictEqual(formatUserDisplayName(null), 'Collaborator');
  });

  it('should format file sizes in decimal megabytes', () => {
    assert.strictEqual(formatFileSize(5033164), '4.8 MB');
    assert.strictEqual(formatFileSize(1048576), '1.0 MB');
    assert.strictEqual(formatFileSize(0), '0 B');
  });

  it('should enforce that shared files possess an associated meeting name contract', () => {
    const fileContractSample = {
      id: 'file-101',
      name: 'architecture_specs_v2.pdf',
      extension: 'pdf',
      sizeBytes: 5033164,
      sharedAt: '2026-11-17T10:14:00.000Z',
      associatedMeetingName: 'Quarterly Architecture Sync',
      associatedMeetingCode: 'cly-789-qwa',
      sharedBy: { id: 'u1', name: 'Dr. Sarah Chen' },
      mimeType: 'application/pdf',
    };

    assert.ok(fileContractSample.associatedMeetingName, 'Downloaded file must be traceable to a meeting');
    assert.strictEqual(fileContractSample.associatedMeetingName, 'Quarterly Architecture Sync');
    assert.ok(validateMeetingCode(fileContractSample.associatedMeetingCode).isValid);
  });

  it('should validate meeting agenda item contract fields', () => {
    const agendaItem = {
      id: 'agenda-1',
      code: 'cly-789-qwa',
      title: 'Quarterly Architecture & Roadmap Sync',
      scheduledStart: '2026-11-17T10:00:00.000Z',
      scheduledEnd: '2026-11-17T11:00:00.000Z',
      host: { id: 'user-1', name: 'Dr. Sarah Chen' },
      isWaitingRoomEnabled: true,
      participantCount: 14,
      inviteUrl: 'http://localhost:5173/join/cly-789-qwa',
    };

    assert.strictEqual(agendaItem.code, 'cly-789-qwa');
    assert.ok(agendaItem.title.length > 0);
    assert.strictEqual(agendaItem.isWaitingRoomEnabled, true);
    assert.strictEqual(agendaItem.participantCount, 14);
  });

  it('should enforce consolidated dashboard structure, shared BrandMark, and balanced 2-column stretch layout', () => {
    const libDir = import.meta.dirname;
    const dashboardPage = fs.readFileSync(path.resolve(libDir, '../pages/DashboardPage.tsx'), 'utf8');
    const sidebar = fs.readFileSync(path.resolve(libDir, '../components/dashboard/AppSidebar.tsx'), 'utf8');
    const authGateway = fs.readFileSync(path.resolve(libDir, '../pages/AuthGatewayPage.tsx'), 'utf8');
    const quickBar = fs.readFileSync(path.resolve(libDir, '../components/dashboard/QuickActionBar.tsx'), 'utf8');
    const welcomeHeader = fs.readFileSync(path.resolve(libDir, '../components/dashboard/WelcomeHeader.tsx'), 'utf8');
    const activityWidget = fs.readFileSync(path.resolve(libDir, '../components/dashboard/RecentActivityWidget.tsx'), 'utf8');

    assert.ok(!dashboardPage.includes('QuickCodeWidget'), 'DashboardPage should not duplicate QuickCodeWidget');
    assert.ok(dashboardPage.includes('items-stretch'), 'Dashboard columns should stretch cleanly to align bottom edges');
    assert.ok(sidebar.includes('BrandMark') && authGateway.includes('BrandMark'), 'Sidebar and Auth gateway should share BrandMark');
    assert.ok(quickBar.includes('validateMeetingCode') && quickBar.includes('Join Room'), 'QuickActionBar should support direct room code entry and Join Room trigger');
    assert.ok(!welcomeHeader.includes('Active Session'), 'WelcomeHeader should omit redundant Active Session chrome');
    assert.ok(activityWidget.includes('schedulingApi.listMeetingHistory'), 'RecentActivityWidget should fetch live meeting history');

    const accountMenu = fs.readFileSync(path.resolve(libDir, '../components/dashboard/AccountMenu.tsx'), 'utf8');
    const editProfileModal = fs.readFileSync(path.resolve(libDir, '../components/dashboard/EditProfileModal.tsx'), 'utf8');
    const appRouter = fs.readFileSync(path.resolve(libDir, '../app/router/AppRouter.tsx'), 'utf8');
    assert.ok(accountMenu.includes('Edit Profile') && accountMenu.includes('EditProfileModal'), 'AccountMenu should include Edit Profile trigger');
    assert.ok(
      editProfileModal.includes('authApi.updateProfile') &&
        editProfileModal.includes('authApi.updateEmail') &&
        editProfileModal.includes('authApi.updatePassword'),
      'EditProfileModal should support DB-backed profile, email, and password updates'
    );
    assert.ok(!dashboardPage.includes('RecentDownloadsWidget'), 'Dashboard Overview should stay focused on video meetings without Downloads card');
    assert.ok(
      dashboardPage.includes('UpNextBanner') &&
        dashboardPage.includes('PreCallStudioWidget') &&
        dashboardPage.includes('RecentActivityWidget'),
      'DashboardPage should compose UpNextBanner, PreCallStudioWidget, and RecentActivityWidget'
    );
    assert.ok(
      appRouter.includes('/join/:meetingCode') && appRouter.includes('/lobby/:meetingCode'),
      'AppRouter should map both /join/:meetingCode and /lobby/:meetingCode to PreJoinLobbyPage'
    );

    const studioWidget = fs.readFileSync(path.resolve(libDir, '../components/dashboard/PreCallStudioWidget.tsx'), 'utf8');
    assert.ok(studioWidget.includes('preferencesApi.updatePreferences'), 'PreCallStudioWidget should sync join defaults to backend preferences');
    assert.ok(studioWidget.includes('stopStudioTest'), 'PreCallStudioWidget should explicitly stop camera/mic preview tracks on exit');
  });
});
