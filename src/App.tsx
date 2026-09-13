import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';

function MeetRedirect() {
  const { meetingCode } = useParams<{ meetingCode: string }>();
  return <Navigate to={`/lobby/${meetingCode || ''}`} replace />;
}
import { AuthProvider } from '@/contexts/AuthContext';
import { ToastContainer } from '@/components/ToastContainer';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { LandingPage } from '@/pages/LandingPage';
import { LoginPage } from '@/pages/LoginPage';
import { SignupPage } from '@/pages/SignupPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { JoinPage } from '@/pages/JoinPage';
import { PreJoinPage } from '@/pages/PreJoinPage';
import { MeetingRoom } from '@/pages/MeetingRoom';
import { SettingsPage } from '@/pages/SettingsPage';
import { ProfilePage } from '@/pages/ProfilePage';
import { ContactsPage } from '@/pages/ContactsPage';
import { NotificationsPage } from '@/pages/NotificationsPage';
import { MeetingsPage } from '@/pages/MeetingsPage';
import { SchedulePage } from '@/pages/SchedulePage';
import { useMediaStore } from '@/stores/mediaStore';

function AutoMediaInitializer() {
  const initAutoMedia = useMediaStore((s) => s.initAutoMedia);

  useEffect(() => {
    // Automatically turn ON mic and camera as soon as the project is opened in the browser
    initAutoMedia().catch((err) => {
      console.warn('Auto media startup init:', err);
    });
  }, [initAutoMedia]);

  return null;
}

function App() {
  return (
    <AuthProvider>
      <AutoMediaInitializer />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/join" element={<ProtectedRoute><JoinPage /></ProtectedRoute>} />
          <Route path="/lobby/:meetingCode" element={<ProtectedRoute><PreJoinPage /></ProtectedRoute>} />
          <Route path="/meeting/:meetingCode" element={<ProtectedRoute><MeetingRoom /></ProtectedRoute>} />
          <Route path="/meet/:meetingCode" element={<MeetRedirect />} />
          <Route path="/dashboard" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
          <Route path="/meetings" element={<ProtectedRoute><MeetingsPage /></ProtectedRoute>} />
          <Route path="/schedule" element={<ProtectedRoute><SchedulePage /></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
          <Route path="/profile" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
          <Route path="/contacts" element={<ProtectedRoute><ContactsPage /></ProtectedRoute>} />
          <Route path="/notifications" element={<ProtectedRoute><NotificationsPage /></ProtectedRoute>} />
          <Route path="/messages" element={<Navigate to="/dashboard" replace />} />
          <Route path="/files" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <ToastContainer />
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
