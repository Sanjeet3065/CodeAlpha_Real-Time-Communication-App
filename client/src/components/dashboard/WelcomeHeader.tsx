import React from 'react';
import { useAuth } from '@/context/AuthContext';
import { Calendar, ShieldCheck } from 'lucide-react';

export const WelcomeHeader: React.FC = () => {
  const { user } = useAuth();

  // Dynamic time-of-day greeting
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  };

  // Safe display name fallback
  const getDisplayName = () => {
    if (!user) return 'Collaborator';
    if (user.firstName && user.lastName) {
      return `${user.firstName} ${user.lastName}`;
    }
    if (user.firstName) return user.firstName;
    return user.email.split('@')[0] || 'Collaborator';
  };

  // Formatted date string
  const formattedDate = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date());

  return (
    <div className="mb-6 sm:mb-8">
      <div className="flex flex-wrap items-center justify-between gap-1.5 sm:gap-2 mb-2">
        <div className="flex items-center gap-1.5 text-[11px] sm:text-xs font-semibold text-[#168B83] uppercase tracking-wider">
          <ShieldCheck className="w-3.5 h-3.5 text-[#168B83] flex-shrink-0" aria-hidden="true" />
          <span>Active Session</span>
        </div>
        <div className="flex items-center gap-1 text-[11px] sm:text-xs text-[#6B8092]">
          <Calendar className="w-3 h-3 flex-shrink-0" aria-hidden="true" />
          <span>{formattedDate}</span>
        </div>
      </div>

      <h2 className="font-display text-xl sm:text-2xl lg:text-3xl font-bold tracking-tight text-[#172B3A] break-words">
        {getGreeting()}, {getDisplayName()}
      </h2>
      <p className="mt-1 text-xs sm:text-sm text-[#6B8092] max-w-2xl leading-relaxed">
        Welcome to your secure collaboration workspace. Launch an instant room, join a session with a code, or manage your files below.
      </p>
    </div>
  );
};
