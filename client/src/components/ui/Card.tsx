import React from 'react';
import { cn } from '@/lib/utils';
import type { CardVariant } from '@/types';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
}

const variantStyles: Record<CardVariant, string> = {
  standard: 'bg-white border border-[#E3E1D9] shadow-sm text-[#172B3A]',
  elevated: 'bg-white border-0 shadow-md text-[#172B3A]',
  theater: 'bg-[#253746] border border-white/10 text-white shadow-xl',
};

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant = 'standard', children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          'rounded-xl p-5 transition-shadow duration-150',
          variantStyles[variant],
          className
        )}
        {...props}
      >
        {children}
      </div>
    );
  }
);

Card.displayName = 'Card';
export default Card;
