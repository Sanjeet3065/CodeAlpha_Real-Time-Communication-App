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
            <div className="absolute left-3 flex items-center pointer-events-none text-[#7C848D] dark:text-[#747C86]">
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
              'w-full h-10 px-3.5 text-sm font-normal text-[#1F2428] bg-[#FFFFFF] border rounded-lg transition-colors duration-150',
              'dark:text-[#EAECEE] dark:bg-[#141619]',
              'placeholder:text-[#7C848D] dark:placeholder:text-[#747C86] placeholder:font-normal',
              'focus:outline-none focus:ring-2 focus:ring-offset-1 dark:focus:ring-offset-[#1C1F24]',
              hasError
                ? 'border-[#C24D4D] focus:border-[#C24D4D] focus:ring-[#C24D4D]/20 dark:border-[#D46A6A] dark:focus:border-[#D46A6A]'
                : 'border-[#DDDAD0] focus:border-[#2F6F68] focus:ring-[#2F6F68]/20 dark:border-[#2B3038] dark:focus:border-[#5FA399] dark:focus:ring-[#5FA399]/20',
              disabled && 'bg-[#EAE8E1] dark:bg-[#24282E] opacity-60 cursor-not-allowed',
              leftIcon && 'pl-10',
              rightIcon && 'pr-10',
              className
            )}
            {...props}
          />

          {rightIcon && (
            <div className="absolute right-3 flex items-center text-[#7C848D] dark:text-[#747C86]">
              {rightIcon}
            </div>
          )}
        </div>

        {hasError && (
          <p id={errorId} className="mt-1.5 text-xs font-medium text-[#C24D4D] dark:text-[#D46A6A] flex items-center gap-1" role="alert">
            {error}
          </p>
        )}

        {!hasError && helperText && (
          <p id={helperId} className="mt-1.5 text-xs text-[#7C848D] dark:text-[#747C86]">
            {helperText}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';
export default Input;
