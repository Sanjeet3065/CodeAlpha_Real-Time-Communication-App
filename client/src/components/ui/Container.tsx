import React from 'react';
import { cn } from '@/lib/utils';
import type { ContainerSize } from '@/types';

export interface ContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: ContainerSize;
}

const sizeStyles: Record<ContainerSize, string> = {
  sm: 'max-w-cly-sm',
  md: 'max-w-cly-md',
  lg: 'max-w-cly-lg',
  xl: 'max-w-cly-xl',
  full: 'max-w-full',
};

export const Container: React.FC<ContainerProps> = ({
  size = 'xl',
  className,
  children,
  ...props
}) => {
  return (
    <div
      className={cn(
        'w-full mx-auto px-4 sm:px-6 lg:px-8',
        sizeStyles[size],
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
};

export default Container;
