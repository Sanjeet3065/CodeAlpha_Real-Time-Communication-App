import React from 'react';
import { cn } from '@/lib/utils';

export interface BrandMarkProps {
  className?: string;
  iconSize?: number;
}

/**
 * Shared Connectly geometric 'C' logo badge used across public auth and dashboard chrome.
 */
export const BrandMark: React.FC<BrandMarkProps> = ({
  className,
  iconSize = 20,
}) => (
  <span
    className={cn(
      'w-9 h-9 rounded-xl bg-[#2F6F68] dark:bg-[#5FA399] text-[#FAF9F6] dark:text-[#141619] flex items-center justify-center shadow-cly-sm shrink-0',
      className
    )}
  >
    <svg
      width={iconSize}
      height={iconSize}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M16.5 7.75C15.1 6.65 13.45 6.1 11.75 6.1C7.95 6.1 5.25 8.8 5.25 12C5.25 15.2 7.95 17.9 11.75 17.9C13.45 17.9 15.1 17.35 16.5 16.25"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <circle cx="17.5" cy="12" r="2" fill="currentColor" />
    </svg>
  </span>
);

export default BrandMark;
