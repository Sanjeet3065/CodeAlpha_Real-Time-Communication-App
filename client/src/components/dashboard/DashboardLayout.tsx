import React, { useState } from 'react';
import { AppSidebar } from './AppSidebar';
import { DashboardHeader } from './DashboardHeader';
import { MobileNavigationDrawer } from './MobileNavigationDrawer';

interface DashboardLayoutProps {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
}

export const DashboardLayout: React.FC<DashboardLayoutProps> = ({
  children,
  title,
  subtitle,
}) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[#F3F2EE] dark:bg-[#141619] flex">
      {/* Skip to Content for WCAG 2.2 AA Accessibility */}
      <a
        href="#dashboard-main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:px-4 focus:py-2 focus:bg-[#1F2428] dark:focus:bg-[#5FA399] focus:text-[#FAF9F6] dark:focus:text-[#141619] focus:rounded-lg focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-[#2F6F68] dark:focus:ring-[#5FA399]"
      >
        Skip to main content
      </a>

      {/* Desktop Persistent Sidebar */}
      <div className="hidden lg:block lg:flex-shrink-0 sticky top-0 h-screen">
        <AppSidebar />
      </div>

      {/* Mobile Drawer */}
      <MobileNavigationDrawer
        isOpen={isMobileMenuOpen}
        onClose={() => setIsMobileMenuOpen(false)}
      />

      {/* Main Content Area with Header */}
      <div className="flex-1 flex flex-col min-w-0">
        <DashboardHeader
          onOpenMobileMenu={() => setIsMobileMenuOpen(true)}
          title={title}
          subtitle={subtitle}
        />

        <main
          id="dashboard-main-content"
          tabIndex={-1}
          className="flex-1 p-4 sm:p-6 lg:p-7 max-w-[1380px] w-full mx-auto outline-none"
        >
          {children}
        </main>
      </div>
    </div>
  );
};
