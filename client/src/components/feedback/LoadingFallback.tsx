import React from 'react';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/utils';

export interface LoadingFallbackProps {
  message?: string;
  fullPage?: boolean;
  className?: string;
}

export const LoadingFallback: React.FC<LoadingFallbackProps> = ({
  message = 'Loading Connectly...',
  fullPage = true,
  className,
}) => {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex flex-col items-center justify-center gap-3 p-8 text-[#1F2428] dark:text-[#EAECEE]',
        fullPage ? 'min-h-screen bg-[#F3F2EE] dark:bg-[#141619]' : 'w-full py-16',
        className
      )}
    >
      <Spinner size="lg" className="text-[#2F6F68] dark:text-[#5FA399]" />
      <p className="text-sm font-medium text-[#555D66] dark:text-[#A3AAB2] animate-pulse">
        {message}
      </p>
    </div>
  );
};

export default LoadingFallback;
