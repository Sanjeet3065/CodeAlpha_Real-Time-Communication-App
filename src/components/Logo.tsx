import { APP_NAME } from '@/lib/constants';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  showText?: boolean;
  className?: string;
}

export function Logo({ size = 'md', showText = true, className = '' }: LogoProps) {
  const sizes = {
    sm: { icon: 'w-7 h-7 p-1', text: 'text-lg' },
    md: { icon: 'w-9 h-9 p-1.5', text: 'text-xl' },
    lg: { icon: 'w-11 h-11 p-2', text: 'text-2xl' },
  };

  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <div className={`${sizes[size].icon} rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-600/20 flex-shrink-0`}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="w-full h-full">
          <circle cx="12" cy="12" r="2.5" fill="currentColor" />
          <circle cx="6" cy="7" r="2" />
          <circle cx="18" cy="7" r="2" />
          <circle cx="6" cy="17" r="2" />
          <circle cx="18" cy="17" r="2" />
          <line x1="8" y1="8" x2="10" y2="10.5" />
          <line x1="16" y1="8" x2="14" y2="10.5" />
          <line x1="8" y1="16" x2="10" y2="13.5" />
          <line x1="16" y1="16" x2="14" y2="13.5" />
        </svg>
      </div>
      {showText && (
        <span className={`${sizes[size].text} font-bold text-indigo-700 dark:text-indigo-400 tracking-tight`}>
          {APP_NAME}
        </span>
      )}
    </div>
  );
}
