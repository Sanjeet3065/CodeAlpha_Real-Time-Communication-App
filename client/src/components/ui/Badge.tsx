import React from 'react';
import { cn } from '@/lib/utils';
import type { BadgeVariant } from '@/types';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  showDot?: boolean;
}

const variantStyles: Record<BadgeVariant, { container: string; dot: string }> = {
  success: {
    container: 'bg-[#DCEDE8] text-[#168B83] border-[#168B83]/20',
    dot: 'bg-[#168B83]',
  },
  warning: {
    container: 'bg-[#FEF3C7] text-[#92400E] border-[#F59E0B]/20',
    dot: 'bg-[#D97706]',
  },
  error: {
    container: 'bg-[#FEE2E2] text-[#991B1B] border-[#EF4444]/20',
    dot: 'bg-[#D94F4F]',
  },
  info: {
    container: 'bg-[#EFF6FF] text-[#1E40AF] border-[#3B82F6]/20',
    dot: 'bg-[#1D4ED8]',
  },
  neutral: {
    container: 'bg-[#F2F1EC] text-[#3D5265] border-[#E3E1D9]',
    dot: 'bg-[#6B8092]',
  },
  host: {
    container: 'bg-[#DCEDE8] text-[#168B83] border-[#168B83]/30 font-semibold',
    dot: 'bg-[#168B83]',
  },
  'co-host': {
    container: 'bg-[#E8EBF2] text-[#172B3A] border-[#172B3A]/20 font-semibold',
    dot: 'bg-[#172B3A]',
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
