import React from 'react';
import { cn } from '@/lib/utils';

export interface VisuallyHiddenProps extends React.HTMLAttributes<HTMLSpanElement> {
  children: React.ReactNode;
}

/**
 * VisuallyHidden hides content visually while keeping it fully accessible to screen readers.
 * Adheres to WCAG 2.2 Level AA accessibility standards.
 */
export const VisuallyHidden: React.FC<VisuallyHiddenProps> = ({
  children,
  className,
  ...props
}) => {
  return (
    <span
      className={cn(
        'sr-only absolute -m-px h-px w-px overflow-hidden whitespace-nowrap border-0 p-0 [clip:rect(0,0,0,0)]',
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
};

export default VisuallyHidden;
