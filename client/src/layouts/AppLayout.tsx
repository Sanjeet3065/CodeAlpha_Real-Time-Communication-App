import React from 'react';
import { Outlet } from 'react-router-dom';

export const AppLayout: React.FC = () => {
  return (
    <div className="relative min-h-screen flex flex-col bg-[#F3F2EE] text-[#1F2428] dark:bg-[#141619] dark:text-[#EAECEE]">
      {/* Skip link for keyboard users - WCAG 2.2 AA (2.4.1 Bypass Blocks) */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-[#2F6F68] dark:focus:bg-[#5FA399] focus:text-[#FAF9F6] dark:focus:text-[#141619] focus:font-semibold focus:rounded-lg focus:shadow-cly-md focus:outline-none focus:ring-2 focus:ring-[#1F2428] dark:focus:ring-[#EAECEE]"
      >
        Skip to main content
      </a>

      <Outlet />
    </div>
  );
};

export default AppLayout;
