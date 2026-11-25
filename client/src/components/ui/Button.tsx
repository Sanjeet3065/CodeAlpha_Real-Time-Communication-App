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
    'bg-[#168B83] text-white hover:bg-[#11706A] active:bg-[#0E5C57] shadow-sm focus-visible:ring-[#168B83]',
  secondary:
    'bg-[#DCEDE8] text-[#172B3A] hover:bg-[#C8E2DB] active:bg-[#B5D7CF] focus-visible:ring-[#168B83]',
  tertiary:
    'bg-transparent text-[#172B3A] hover:bg-[#F7F6F2] active:bg-[#ECEBE4] focus-visible:ring-[#168B83]',
  destructive:
    'bg-[#D94F4F] text-white hover:bg-[#BF3C3C] active:bg-[#A32F2F] shadow-sm focus-visible:ring-[#D94F4F]',
  outline:
    'bg-transparent border border-[#E3E1D9] text-[#172B3A] hover:bg-[#F7F6F2] active:bg-[#ECEBE4] focus-visible:ring-[#168B83]',
  icon:
    'bg-transparent text-[#172B3A] hover:bg-[#F7F6F2] active:bg-[#ECEBE4] p-2 aspect-square focus-visible:ring-[#168B83]',
  fab:
    'bg-[#168B83] text-white hover:bg-[#11706A] active:bg-[#0E5C57] rounded-full shadow-lg p-3.5 focus-visible:ring-[#168B83]',
  dock:
    'bg-[#253746] text-white hover:bg-[#334A5D] active:bg-[#1A2530] border border-white/10 rounded-full focus-visible:ring-[#2EC4B6]',
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
