import React from 'react';
import { cn } from '@/lib/utils';
import { Container } from '@/components/ui/Container';
import type { ContainerSize } from '@/types';

export interface PageShellProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: ContainerSize;
  padded?: boolean;
}

export const PageShell: React.FC<PageShellProps> = ({
  size = 'xl',
  padded = true,
  className,
  children,
  ...props
}) => {
  return (
    <div
      className={cn(
        'w-full min-h-screen bg-[#F3F2EE] dark:bg-[#141619] flex flex-col',
        padded && 'py-6 md:py-10',
        className
      )}
      {...props}
    >
      <Container size={size} className="flex-1 flex flex-col">
        {children}
      </Container>
    </div>
  );
};

export default PageShell;
