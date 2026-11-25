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
        'flex flex-col items-center justify-center gap-3 p-8 text-[#172B3A]',
        fullPage ? 'min-h-screen bg-[#F7F6F2]' : 'w-full py-16',
        className
      )}
    >
      <Spinner size="lg" className="text-[#168B83]" />
      <p className="text-sm font-medium text-[#3D5265] animate-pulse">
        {message}
      </p>
    </div>
  );
};

export default LoadingFallback;
