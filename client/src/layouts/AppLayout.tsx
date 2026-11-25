import React from 'react';
import { Outlet } from 'react-router-dom';

export const AppLayout: React.FC = () => {
  return (
    <div className="relative min-h-screen flex flex-col bg-[#F7F6F2] text-[#172B3A]">
      {/* Skip link for keyboard users - WCAG 2.2 AA (2.4.1 Bypass Blocks) */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-[#168B83] focus:text-white focus:font-semibold focus:rounded-lg focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-[#172B3A]"
      >
        Skip to main content
      </a>

      <Outlet />
    </div>
  );
};

export default AppLayout;
