import { useState } from 'react';
import { getInitials, getAvatarColor } from '@/lib/utils';

interface UserAvatarProps {
  name?: string | null;
  avatarUrl?: string | null;
  email?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  className?: string;
}

const sizeClasses = {
  xs: 'w-6 h-6 text-[10px]',
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-12 h-12 text-base',
  xl: 'w-20 h-20 text-2xl',
  '2xl': 'w-24 h-24 text-3xl',
};

export function UserAvatar({
  name = '',
  avatarUrl,
  email = '',
  size = 'sm',
  className = '',
}: UserAvatarProps) {
  const [hasError, setHasError] = useState(false);

  const displayName = name?.trim() || email?.split('@')[0] || 'User';
  const initials = getInitials(displayName);
  const colorClass = getAvatarColor(email || displayName);
  const sizeClass = sizeClasses[size] || sizeClasses.sm;

  // If avatarUrl exists and hasn't errored, try rendering image with no-referrer
  if (avatarUrl && !hasError) {
    return (
      <img
        src={avatarUrl}
        alt={displayName}
        referrerPolicy="no-referrer"
        onError={() => setHasError(true)}
        className={`${sizeClass} rounded-full object-cover shadow-sm ring-1 ring-white/10 ${className}`}
      />
    );
  }

  // Elegant First Name & Surname Initials Circle
  return (
    <div
      className={`${sizeClass} rounded-full ${colorClass} flex items-center justify-center text-white font-bold tracking-wider uppercase shadow-md select-none ring-1 ring-white/20 flex-shrink-0 ${className}`}
      title={displayName}
    >
      {initials}
    </div>
  );
}
