import React from 'react';
import { Navigate, useSearchParams, Outlet } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { Spinner } from '@/components/ui/Spinner';
import { sanitizeNavigationPath } from '@/lib/navigation';

export interface PublicOnlyRouteProps {
  children?: React.ReactNode;
}

export const PublicOnlyRoute: React.FC<PublicOnlyRouteProps> = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuth();
  const [searchParams] = useSearchParams();

  if (isLoading) {
    return (
      <div
        className="min-h-screen bg-[#F7F6F2] flex flex-col items-center justify-center p-4"
        aria-live="polite"
        aria-busy="true"
      >
        <div className="flex flex-col items-center gap-4 text-center">
          <Spinner size="lg" className="text-[#168B83]" aria-hidden="true" />
          <p className="text-sm font-medium text-[#172B3A] tracking-tight">
            Checking session...
          </p>
        </div>
      </div>
    );
  }

  if (isAuthenticated) {
    const rawRedirect = searchParams.get('redirect');
    const destination = rawRedirect
      ? sanitizeNavigationPath(decodeURIComponent(rawRedirect), '/dashboard')
      : '/dashboard';
    return <Navigate to={destination} replace />;
  }

  return children ? <>{children}</> : <Outlet />;
};

export default PublicOnlyRoute;
