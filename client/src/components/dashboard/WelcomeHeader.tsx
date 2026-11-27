import React from 'react';
import { useAuth } from '@/context/AuthContext';
import { Calendar } from 'lucide-react';

export const WelcomeHeader: React.FC = () => {
  const { user } = useAuth();

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  };

  const getDisplayName = () => {
    if (!user) return 'Collaborator';
    if (user.firstName && user.lastName) {
      return `${user.firstName} ${user.lastName}`;
    }
    if (user.firstName) return user.firstName;
    return user.email.split('@')[0] || 'Collaborator';
  };

  let formattedDate: string;
  try {
    formattedDate = new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      ...(user?.timeZone ? { timeZone: user.timeZone } : {}),
    }).format(new Date());
  } catch {
    formattedDate = new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date());
  }

  return (
    <div className="mb-5 sm:mb-6 flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <h2 className="font-display text-xl sm:text-2xl lg:text-[1.75rem] font-bold tracking-tight text-[#1F2428] dark:text-[#EAECEE] break-words">
          {getGreeting()}, {getDisplayName()}
        </h2>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {user?.jobTitle && (
          <span className="px-2.5 py-1.5 rounded-lg bg-[#E2ECE9] dark:bg-[#1F302E] text-xs font-semibold text-[#2F6F68] dark:text-[#5FA399]">
            {user.jobTitle}
          </span>
        )}
        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#FAF9F6] dark:bg-[#1C1F24] border border-[#DDDAD0] dark:border-[#2B3038] text-xs font-medium text-[#555D66] dark:text-[#A3AAB2]">
          <Calendar className="w-3.5 h-3.5 text-[#2F6F68] dark:text-[#5FA399] flex-shrink-0" aria-hidden="true" />
          <span>{formattedDate}</span>
        </div>
      </div>
    </div>
  );
};
