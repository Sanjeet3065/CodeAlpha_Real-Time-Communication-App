import React from 'react';
import { cn } from '@/lib/utils';
import type { BadgeVariant } from '@/types';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  showDot?: boolean;
}

const variantStyles: Record<BadgeVariant, { container: string; dot: string }> = {
  success: {
    container: 'bg-[#E2ECE9] text-[#2F6F68] border-[#2F6F68]/20 dark:bg-[#1F302E] dark:text-[#5FA399] dark:border-[#5FA399]/25',
    dot: 'bg-[#2F6F68] dark:bg-[#5FA399]',
  },
  warning: {
    container: 'bg-[#F6EDE0] text-[#8F5819] border-[#B87323]/25 dark:bg-[#302719] dark:text-[#D49A4A] dark:border-[#D49A4A]/25',
    dot: 'bg-[#B87323] dark:bg-[#D49A4A]',
  },
  error: {
    container: 'bg-[#F6E6E6] text-[#9E3939] border-[#C24D4D]/25 dark:bg-[#342023] dark:text-[#D46A6A] dark:border-[#D46A6A]/25',
    dot: 'bg-[#C24D4D] dark:bg-[#D46A6A]',
  },
  info: {
    container: 'bg-[#E6EDF5] text-[#2D5078] border-[#3E6899]/25 dark:bg-[#1E2936] dark:text-[#6E95C2] dark:border-[#6E95C2]/25',
    dot: 'bg-[#3E6899] dark:bg-[#6E95C2]',
  },
  neutral: {
    container: 'bg-[#EAE8E1] text-[#555D66] border-[#DDDAD0] dark:bg-[#24282E] dark:text-[#A3AAB2] dark:border-[#2B3038]',
    dot: 'bg-[#7C848D] dark:bg-[#747C86]',
  },
  host: {
    container: 'bg-[#E2ECE9] text-[#2F6F68] border-[#2F6F68]/25 dark:bg-[#1F302E] dark:text-[#5FA399] dark:border-[#5FA399]/25 font-semibold',
    dot: 'bg-[#2F6F68] dark:bg-[#5FA399]',
  },
  'co-host': {
    container: 'bg-[#E6EDF5] text-[#1F2428] border-[#3E6899]/25 dark:bg-[#1E2936] dark:text-[#EAECEE] dark:border-[#6E95C2]/30 font-semibold',
    dot: 'bg-[#3E6899] dark:bg-[#6E95C2]',
  },
};

export const Badge: React.FC<BadgeProps> = ({
  className,
  variant = 'neutral',
  showDot = true,
  children,
  ...props
}) => {
  const styles = variantStyles[variant];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border select-none',
        styles.container,
        className
      )}
      {...props}
    >
      {showDot && (
        <span
          className={cn('w-1.5 h-1.5 rounded-full shrink-0', styles.dot)}
          aria-hidden="true"
        />
      )}
      {children}
    </span>
  );
};

export default Badge;
