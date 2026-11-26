import React from 'react';
import { cn } from '@/lib/utils';

export interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean;
}

export const Label: React.FC<LabelProps> = ({
  className,
  required,
  children,
  ...props
}) => {
  return (
    <label
      className={cn(
        'block text-xs font-semibold uppercase tracking-wider text-[#1F2428] dark:text-[#EAECEE] mb-1.5 select-none',
        className
      )}
      {...props}
    >
      {children}
      {required && <span className="text-[#C24D4D] dark:text-[#D46A6A] ml-1" aria-hidden="true">*</span>}
    </label>
  );
};

export default Label;
