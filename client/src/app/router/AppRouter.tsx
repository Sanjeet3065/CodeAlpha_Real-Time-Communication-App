import React, { Suspense, lazy } from 'react';
import { Routes, Route } from 'react-router-dom';
import { AppLayout } from '@/layouts/AppLayout';
import { AuthGatewayPage } from '@/pages/AuthGatewayPage';
import { RootScaffoldPage } from '@/pages/RootScaffoldPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { LoginPage } from '@/pages/LoginPage';
import { RegisterPage } from '@/pages/RegisterPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { DownloadsPage } from '@/pages/DownloadsPage';
import { MeetingsPage } from '@/pages/MeetingsPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { PublicOnlyRoute } from '@/components/auth/PublicOnlyRoute';

const PreJoinLobbyPage = lazy(() => import('@/pages/PreJoinLobbyPage'));
const MeetingRoomPage = lazy(() => import('@/pages/MeetingRoomPage'));

export const AppRouter: React.FC = () => {
  return (
    <Routes>
      {/* Direct Auth Entry Gateway (shows user Name + Dashboard in header when signed in) */}
      <Route element={<AppLayout />}>
        <Route path="/" element={<AuthGatewayPage initialMode="signin" />} />
        <Route path="/scaffold" element={<RootScaffoldPage />} />
      </Route>

      {/* Public-Only Auth Screens (Redirects to /dashboard if already logged in) */}
      <Route
        path="/login"
        element={
          <PublicOnlyRoute>
            <LoginPage />
          </PublicOnlyRoute>
        }
      />
      <Route
        path="/register"
        element={
          <PublicOnlyRoute>
            <RegisterPage />
          </PublicOnlyRoute>
        }
      />

      {/* Protected Authenticated Dashboard & Hub Routes */}
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <DashboardPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/downloads"
        element={
          <ProtectedRoute>
            <DownloadsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/meetings"
        element={
          <ProtectedRoute>
            <MeetingsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/meetings/scheduled"
        element={
          <ProtectedRoute>
            <MeetingsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/meetings/history"
        element={
          <ProtectedRoute>
            <MeetingsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings"
        element={
          <ProtectedRoute>
            <SettingsPage />
          </ProtectedRoute>
        }
      />

      {/* Protected Phase 08 Pre-Join Lobby & Meeting Room Routes */}
      <Route
        path="/join/:meetingCode"
        element={
          <ProtectedRoute>
            <Suspense
              fallback={
                <div className="min-h-screen bg-[#F3F2EE] dark:bg-[#141619] flex items-center justify-center p-6">
                  <div className="w-8 h-8 border-2 border-[#2F6F68] dark:border-[#5FA399] border-t-transparent rounded-full animate-spin" />
                </div>
              }
            >
              <PreJoinLobbyPage />
            </Suspense>
          </ProtectedRoute>
        }
      />
      <Route
        path="/lobby/:meetingCode"
        element={
          <ProtectedRoute>
            <Suspense
              fallback={
                <div className="min-h-screen bg-[#F3F2EE] dark:bg-[#141619] flex items-center justify-center p-6">
                  <div className="w-8 h-8 border-2 border-[#2F6F68] dark:border-[#5FA399] border-t-transparent rounded-full animate-spin" />
                </div>
              }
            >
              <PreJoinLobbyPage />
            </Suspense>
          </ProtectedRoute>
        }
      />
      <Route
        path="/meeting/:meetingCode"
        element={
          <ProtectedRoute>
            <Suspense
              fallback={
                <div className="min-h-screen bg-[#111316] text-white flex items-center justify-center p-6">
                  <div className="w-8 h-8 border-2 border-[#2F6F68] dark:border-[#5FA399] border-t-transparent rounded-full animate-spin" />
                </div>
              }
            >
              <MeetingRoomPage />
            </Suspense>
          </ProtectedRoute>
        }
      />

      {/* 404 Catch-All in AppLayout */}
      <Route element={<AppLayout />}>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
};

export default AppRouter;
