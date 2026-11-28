import React, { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AppLayout } from '@/layouts/AppLayout';
import { AuthGatewayPage } from '@/pages/AuthGatewayPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { LoginPage } from '@/pages/LoginPage';
import { RegisterPage } from '@/pages/RegisterPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { DownloadsPage } from '@/pages/DownloadsPage';
import { MeetingsPage } from '@/pages/MeetingsPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { PublicOnlyRoute } from '@/components/auth/PublicOnlyRoute';
import { LoadingFallback } from '@/components/feedback/LoadingFallback';

const PreJoinLobbyPage = lazy(() => import('@/pages/PreJoinLobbyPage'));
const MeetingRoomPage = lazy(() => import('@/pages/MeetingRoomPage'));

export const AppRouter: React.FC = () => {
  return (
    <Routes>
      {/* Direct Auth Entry Gateway (shows user Name + Dashboard in header when signed in) */}
      <Route element={<AppLayout />}>
        <Route path="/" element={<AuthGatewayPage initialMode="signin" />} />
        {/* Retire /scaffold — redirect to /dashboard */}
        <Route path="/scaffold" element={<Navigate to="/dashboard" replace />} />
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
            <Suspense fallback={<LoadingFallback />}>
              <PreJoinLobbyPage />
            </Suspense>
          </ProtectedRoute>
        }
      />
      <Route
        path="/lobby/:meetingCode"
        element={
          <ProtectedRoute>
            <Suspense fallback={<LoadingFallback />}>
              <PreJoinLobbyPage />
            </Suspense>
          </ProtectedRoute>
        }
      />
      <Route
        path="/meeting/:meetingCode"
        element={
          <ProtectedRoute>
            <Suspense fallback={<LoadingFallback />}>
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
