import React from 'react';
import { cn } from '@/lib/utils';
import { Spinner } from './Spinner';
import type { ButtonVariant, ButtonSize } from '@/types';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    'bg-[#2F6F68] text-[#FAF9F6] hover:bg-[#255A54] active:bg-[#1E4944] dark:bg-[#5FA399] dark:text-[#141619] dark:hover:bg-[#6EB2A8] dark:active:bg-[#4E8F85] shadow-cly-sm focus-visible:ring-[#2F6F68] dark:focus-visible:ring-[#5FA399]',
  secondary:
    'bg-[#E2ECE9] text-[#1F2428] hover:bg-[#D2E1DC] active:bg-[#C3D5CE] dark:bg-[#1F302E] dark:text-[#EAECEE] dark:hover:bg-[#273C39] focus-visible:ring-[#2F6F68] dark:focus-visible:ring-[#5FA399]',
  tertiary:
    'bg-transparent text-[#1F2428] hover:bg-[#EAE8E1] active:bg-[#DDDAD0] dark:text-[#EAECEE] dark:hover:bg-[#24282E] dark:active:bg-[#2B3038] focus-visible:ring-[#2F6F68] dark:focus-visible:ring-[#5FA399]',
  destructive:
    'bg-[#C24D4D] text-[#FAF9F6] hover:bg-[#A63D3D] active:bg-[#8E3232] dark:bg-[#D46A6A] dark:text-[#141619] dark:hover:bg-[#C15858] shadow-cly-sm focus-visible:ring-[#C24D4D] dark:focus-visible:ring-[#D46A6A]',
  outline:
    'bg-transparent border border-[#DDDAD0] text-[#1F2428] hover:bg-[#EAE8E1] active:bg-[#DDDAD0] dark:border-[#2B3038] dark:text-[#EAECEE] dark:hover:bg-[#24282E] dark:active:bg-[#2B3038] focus-visible:ring-[#2F6F68] dark:focus-visible:ring-[#5FA399]',
  icon:
    'bg-transparent text-[#1F2428] hover:bg-[#EAE8E1] active:bg-[#DDDAD0] dark:text-[#EAECEE] dark:hover:bg-[#24282E] p-2 aspect-square focus-visible:ring-[#2F6F68] dark:focus-visible:ring-[#5FA399]',
  fab:
    'bg-[#2F6F68] text-[#FAF9F6] hover:bg-[#255A54] active:bg-[#1E4944] dark:bg-[#5FA399] dark:text-[#141619] dark:hover:bg-[#6EB2A8] dark:active:bg-[#4E8F85] rounded-full shadow-cly-md p-3.5 focus-visible:ring-[#2F6F68] dark:focus-visible:ring-[#5FA399]',
  dock:
    'bg-[#1C1F24] text-[#EAECEE] hover:bg-[#2B3038] active:bg-[#141619] border border-white/10 rounded-full focus-visible:ring-[#5FA399]',
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs font-medium rounded-md min-h-[32px]',
  md: 'h-10 px-4 text-sm font-medium rounded-lg min-h-[40px]',
  lg: 'h-12 px-6 text-base font-semibold rounded-lg min-h-[48px]',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = 'primary',
      size = 'md',
      isLoading = false,
      leftIcon,
      rightIcon,
      children,
      disabled,
      type = 'button',
      ...props
    },
    ref
  ) => {
    const isActuallyDisabled = disabled || isLoading;

    return (
      <button
        ref={ref}
        type={type}
        disabled={isActuallyDisabled}
        aria-busy={isLoading ? 'true' : undefined}
        aria-disabled={isActuallyDisabled ? 'true' : undefined}
        className={cn(
          // Base button styles
          'relative inline-flex items-center justify-center font-medium transition-all duration-150 select-none outline-none',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
          'active:scale-[0.98]',
          // WCAG touch-target sizing safety on touch viewports (min 44x44px touch bounding box)
          'touch-manipulation',
          // Disabled state
          isActuallyDisabled && 'opacity-45 cursor-not-allowed pointer-events-none active:scale-100',
          // Variants & Sizes
          variantStyles[variant],
          variant !== 'icon' && variant !== 'fab' && sizeStyles[size],
          className
        )}
        {...props}
      >
        {isLoading && (
          <span className="absolute inset-0 flex items-center justify-center">
            <Spinner size={size === 'sm' ? 'sm' : 'md'} />
          </span>
        )}

        <span
          className={cn(
            'inline-flex items-center gap-2 transition-opacity duration-150',
            isLoading && 'opacity-0'
          )}
        >
          {leftIcon && <span className="inline-flex shrink-0">{leftIcon}</span>}
          {children}
          {rightIcon && <span className="inline-flex shrink-0">{rightIcon}</span>}
        </span>
      </button>
    );
  }
);

Button.displayName = 'Button';
export default Button;
