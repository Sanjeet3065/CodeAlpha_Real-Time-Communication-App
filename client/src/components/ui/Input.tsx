import React, { useId } from 'react';
import { cn } from '@/lib/utils';
import { Label } from './Label';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  helperText?: string;
  error?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      label,
      helperText,
      error,
      leftIcon,
      rightIcon,
      id,
      disabled,
      required,
      ...props
    },
    ref
  ) => {
    const generatedId = useId();
    const inputId = id || generatedId;
    const errorId = `${inputId}-error`;
    const helperId = `${inputId}-helper`;

    const hasError = Boolean(error);
    const describedBy = hasError ? errorId : helperText ? helperId : undefined;

    return (
      <div className="w-full flex flex-col">
        {label && (
          <Label htmlFor={inputId} required={required}>
            {label}
          </Label>
        )}

        <div className="relative flex items-center w-full">
          {leftIcon && (
            <div className="absolute left-3 flex items-center pointer-events-none text-[#6B8092]">
              {leftIcon}
            </div>
          )}

          <input
            ref={ref}
            id={inputId}
            disabled={disabled}
            required={required}
            aria-invalid={hasError ? 'true' : undefined}
            aria-describedby={describedBy}
            className={cn(
              'w-full h-10 px-3.5 text-sm font-normal text-[#172B3A] bg-white border rounded-lg transition-colors duration-150',
              'placeholder:text-[#6B8092] placeholder:font-normal',
              'focus:outline-none focus:ring-2 focus:ring-offset-1',
              hasError
                ? 'border-[#D94F4F] focus:border-[#D94F4F] focus:ring-[#D94F4F]/20'
                : 'border-[#E3E1D9] focus:border-[#168B83] focus:ring-[#168B83]/20',
              disabled && 'bg-[#F7F6F2] opacity-60 cursor-not-allowed',
              leftIcon && 'pl-10',
              rightIcon && 'pr-10',
              className
            )}
            {...props}
          />

          {rightIcon && (
            <div className="absolute right-3 flex items-center text-[#6B8092]">
              {rightIcon}
            </div>
          )}
        </div>

        {hasError && (
          <p id={errorId} className="mt-1.5 text-xs font-medium text-[#D94F4F] flex items-center gap-1" role="alert">
            {error}
          </p>
        )}

        {!hasError && helperText && (
          <p id={helperId} className="mt-1.5 text-xs text-[#6B8092]">
            {helperText}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';
export default Input;
