import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import {
  Video,
  LogOut,
  ShieldCheck,
  User as UserIcon,
  Mail,
  Key,
  Clock,
  CheckCircle2,
  Lock,
} from 'lucide-react';

export const DashboardPlaceholderPage: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleLogout = async () => {
    try {
      setIsLoggingOut(true);
      await logout();
      navigate('/login', { replace: true });
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      setIsLoggingOut(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F3F2EE] dark:bg-[#141619] flex flex-col">
      {/* Top Navigation Bar */}
      <header className="bg-[#FAF9F6] dark:bg-[#1C1F24] border-b border-[#DDDAD0] dark:border-[#2B3038] sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#2F6F68] dark:bg-[#5FA399] flex items-center justify-center text-[#FAF9F6] dark:text-[#141619] shadow-sm">
              <Video className="w-5 h-5" aria-hidden="true" />
            </div>
            <span className="font-display font-extrabold text-xl tracking-tight text-[#1F2428] dark:text-[#EAECEE]">
              CONNECTLY
            </span>
            <Badge variant="success">
              Phase 05 Auth Active
            </Badge>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-2 text-sm text-[#1F2428] dark:text-[#EAECEE]">
              <div className="w-8 h-8 rounded-full bg-[#E2ECE9] dark:bg-[#1F302E] text-[#2F6F68] dark:text-[#5FA399] font-bold flex items-center justify-center text-xs">
                {user?.firstName?.[0] || 'U'}
                {user?.lastName?.[0] || ''}
              </div>
              <span className="font-medium">
                {user?.firstName} {user?.lastName}
              </span>
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleLogout}
              isLoading={isLoggingOut}
              disabled={isLoggingOut}
              leftIcon={<LogOut className="w-4 h-4" aria-hidden="true" />}
            >
              Sign Out
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        {/* Welcome Banner */}
        <div className="mb-8">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#2F6F68] dark:text-[#5FA399] tracking-wider uppercase mb-1">
            <ShieldCheck className="w-4 h-4" aria-hidden="true" />
            <span>Authenticated Session Verified</span>
          </div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-[#1F2428] dark:text-[#EAECEE]">
            Welcome, {user?.firstName} {user?.lastName}
          </h1>
          <p className="mt-1.5 text-sm text-[#7C848D] dark:text-[#A3AAB2]">
            You have successfully authenticated through CONNECTLY&apos;s production-grade Argon2id and dual-token security architecture.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* User Profile Card */}
          <Card className="md:col-span-2 p-6 sm:p-8 bg-[#FAF9F6] dark:bg-[#1C1F24] border-[#DDDAD0] dark:border-[#2B3038] shadow-sm">
            <h2 className="font-display text-lg font-bold text-[#1F2428] dark:text-[#EAECEE] mb-4 flex items-center gap-2">
              <UserIcon className="w-5 h-5 text-[#2F6F68] dark:text-[#5FA399]" aria-hidden="true" />
              <span>Identity & Profile Details</span>
            </h2>

            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div className="p-3.5 rounded-xl bg-[#F3F2EE] dark:bg-[#141619] border border-[#DDDAD0]/70 dark:border-[#2B3038]">
                <dt className="text-xs font-medium text-[#7C848D] dark:text-[#A3AAB2] flex items-center gap-1.5 mb-1">
                  <UserIcon className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Full Name</span>
                </dt>
                <dd className="font-semibold text-[#1F2428] dark:text-[#EAECEE]">
                  {user?.firstName} {user?.lastName}
                </dd>
              </div>

              <div className="p-3.5 rounded-xl bg-[#F3F2EE] dark:bg-[#141619] border border-[#DDDAD0]/70 dark:border-[#2B3038]">
                <dt className="text-xs font-medium text-[#7C848D] dark:text-[#A3AAB2] flex items-center gap-1.5 mb-1">
                  <Mail className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Email Address</span>
                </dt>
                <dd className="font-semibold text-[#1F2428] dark:text-[#EAECEE] truncate">
                  {user?.email}
                </dd>
              </div>

              <div className="p-3.5 rounded-xl bg-[#F3F2EE] dark:bg-[#141619] border border-[#DDDAD0]/70 dark:border-[#2B3038]">
                <dt className="text-xs font-medium text-[#7C848D] dark:text-[#A3AAB2] flex items-center gap-1.5 mb-1">
                  <Key className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>User Identifier</span>
                </dt>
                <dd className="font-mono text-xs font-semibold text-[#1F2428] dark:text-[#EAECEE] truncate">
                  {user?.id}
                </dd>
              </div>

              <div className="p-3.5 rounded-xl bg-[#F3F2EE] dark:bg-[#141619] border border-[#DDDAD0]/70 dark:border-[#2B3038]">
                <dt className="text-xs font-medium text-[#7C848D] dark:text-[#A3AAB2] flex items-center gap-1.5 mb-1">
                  <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Default Preferences</span>
                </dt>
                <dd className="text-xs text-[#1F2428] dark:text-[#EAECEE]">
                  Mic Muted: {user?.preferences?.defaultAudioMuted ? 'Yes' : 'No'} • Video Off: {user?.preferences?.defaultVideoOff ? 'Yes' : 'No'}
                </dd>
              </div>
            </dl>

            <div className="mt-6 pt-6 border-t border-[#DDDAD0] dark:border-[#2B3038] flex flex-wrap items-center justify-between gap-4">
              <span className="text-xs text-[#7C848D] dark:text-[#A3AAB2]">
                Session active. Automatic token rotation is operational.
              </span>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={handleLogout}
                isLoading={isLoggingOut}
                disabled={isLoggingOut}
                leftIcon={<LogOut className="w-4 h-4" aria-hidden="true" />}
              >
                Revoke Session & Sign Out
              </Button>
            </div>
          </Card>

          {/* Security Telemetry Card */}
          <Card className="p-6 bg-[#FAF9F6] dark:bg-[#1C1F24] border-[#DDDAD0] dark:border-[#2B3038] shadow-sm flex flex-col justify-between">
            <div>
              <h2 className="font-display text-lg font-bold text-[#1F2428] dark:text-[#EAECEE] mb-4 flex items-center gap-2">
                <Lock className="w-5 h-5 text-[#2F6F68] dark:text-[#5FA399]" aria-hidden="true" />
                <span>Security State</span>
              </h2>

              <ul className="space-y-3 text-xs">
                <li className="flex items-start gap-2 text-[#1F2428] dark:text-[#EAECEE]">
                  <CheckCircle2 className="w-4 h-4 text-[#2F6F68] dark:text-[#5FA399] flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold">Argon2id Hash:</span>
                    <p className="text-[#7C848D] dark:text-[#A3AAB2]">64MB memory, 3 iterations</p>
                  </div>
                </li>
                <li className="flex items-start gap-2 text-[#1F2428] dark:text-[#EAECEE]">
                  <CheckCircle2 className="w-4 h-4 text-[#2F6F68] dark:text-[#5FA399] flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold">Access Token:</span>
                    <p className="text-[#7C848D] dark:text-[#A3AAB2]">15m JWT (stored in memory)</p>
                  </div>
                </li>
                <li className="flex items-start gap-2 text-[#1F2428] dark:text-[#EAECEE]">
                  <CheckCircle2 className="w-4 h-4 text-[#2F6F68] dark:text-[#5FA399] flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold">Refresh Cookie:</span>
                    <p className="text-[#7C848D] dark:text-[#A3AAB2]">7d HttpOnly, SameSite=Lax</p>
                  </div>
                </li>
                <li className="flex items-start gap-2 text-[#1F2428] dark:text-[#EAECEE]">
                  <CheckCircle2 className="w-4 h-4 text-[#2F6F68] dark:text-[#5FA399] flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold">Theft Detection:</span>
                    <p className="text-[#7C848D] dark:text-[#A3AAB2]">Active token reuse detection</p>
                  </div>
                </li>
              </ul>
            </div>

            <div className="mt-6 p-3 bg-[#E2ECE9]/60 dark:bg-[#1F302E]/60 rounded-lg border border-[#2F6F68]/20 dark:border-[#5FA399]/25 text-[11px] text-[#2F6F68] dark:text-[#5FA399] leading-relaxed">
              Protected route validation is enforced. Direct deep links without tokens are automatically bounced to /login.
            </div>
          </Card>
        </div>

        {/* Phase Scope Boundary Notice */}
        <div className="mt-8 p-6 rounded-2xl bg-[#E2ECE9]/50 dark:bg-[#1F302E]/50 border border-[#2F6F68]/20 dark:border-[#5FA399]/25">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#2F6F68] dark:bg-[#5FA399] text-[#FAF9F6] dark:text-[#141619] flex items-center justify-center flex-shrink-0 mt-0.5">
              <ShieldCheck className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[#1F2428] dark:text-[#EAECEE]">
                Phase 05 Scope Boundary Notice
              </h3>
              <p className="mt-1 text-xs text-[#555D66] dark:text-[#A3AAB2] leading-relaxed">
                This account session overview verifies Phase 05 authentication, credential storage, cookie rotation, and protected routing.
                In strict accordance with the 18-phase roadmap, the full User Dashboard (Screen 06) featuring upcoming meeting agenda, calendar scheduling, instant room creation, and the Downloads &amp; Shared Files widget will be implemented in <strong>Phase 06 – User Dashboard</strong>.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default DashboardPlaceholderPage;
