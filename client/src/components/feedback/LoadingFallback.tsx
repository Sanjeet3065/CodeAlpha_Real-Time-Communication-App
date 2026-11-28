import React from 'react';
import { cn } from '@/lib/utils';

export interface LoadingFallbackProps {
  fullPage?: boolean;
  className?: string;
}

export const LoadingFallback: React.FC<LoadingFallbackProps> = ({
  fullPage = true,
  className,
}) => {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading…"
      className={cn(
        'flex flex-col items-center justify-center gap-4',
        fullPage
          ? 'h-[100dvh] w-full bg-[#F3F2EE] dark:bg-[#141619]'
          : 'w-full py-16',
        className
      )}
    >
      <div
        className="h-10 w-10 animate-spin rounded-full border-2 border-[#DDDAD0] dark:border-[#2B3038] border-t-[#2F6F68] dark:border-t-[#5FA399]"
        aria-hidden="true"
      />
      <p className="sr-only">Loading…</p>
    </div>
  );
};

export default LoadingFallback;
