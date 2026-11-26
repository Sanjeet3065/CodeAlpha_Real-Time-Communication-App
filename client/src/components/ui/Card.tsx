import React from 'react';
import { cn } from '@/lib/utils';
import type { CardVariant } from '@/types';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
}

const variantStyles: Record<CardVariant, string> = {
  standard:
    'bg-[#FAF9F6] border border-[#DDDAD0] shadow-cly-sm text-[#1F2428] dark:bg-[#1C1F24] dark:border-[#2B3038] dark:text-[#EAECEE]',
  elevated:
    'bg-[#FFFFFF] border border-[#DDDAD0]/80 shadow-cly-md text-[#1F2428] dark:bg-[#24282E] dark:border-[#3A404A]/80 dark:text-[#EAECEE]',
  theater:
    'bg-[#1C1F24] border border-white/10 text-[#EAECEE] shadow-cly-theater',
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
