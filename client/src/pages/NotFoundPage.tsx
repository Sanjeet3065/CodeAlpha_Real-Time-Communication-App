import React from 'react';
import { Link } from 'react-router-dom';
import { useSafeNavigate } from '@/lib/navigation';
import { PageShell } from '@/components/layout/PageShell';
import { BrandMark } from '@/components/ui/BrandMark';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Home, ArrowLeft } from 'lucide-react';

export const NotFoundPage: React.FC = () => {
  const navigate = useSafeNavigate();

  return (
    <div className="min-h-screen bg-[#F3F2EE] dark:bg-[#141619] flex flex-col">
      <header className="w-full h-16 px-4 sm:px-6 flex items-center justify-between border-b border-[#DDDAD0]/80 dark:border-[#2B3038] bg-[#FAF9F6]/90 dark:bg-[#1C1F24]/90 backdrop-blur-sm">
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6F68] dark:focus-visible:ring-[#5FA399]"
        >
          <BrandMark />
          <span className="font-display text-sm font-bold tracking-tight text-[#1F2428] dark:text-[#EAECEE]">
            CONNECTLY
          </span>
        </Link>

        <ThemeToggle />
      </header>

      <main id="main-content" tabIndex={-1} className="flex-1 flex flex-col outline-none">
        <PageShell size="sm" className="min-h-0 flex-1 items-center justify-center py-12">
          <Card variant="standard" className="text-center p-8 md:p-12 shadow-cly-md">
            <span className="font-mono text-5xl font-extrabold text-[#2F6F68] dark:text-[#5FA399] tracking-wider block mb-2">
              404
            </span>
            <h1 className="text-2xl font-bold font-display text-[#1F2428] dark:text-[#EAECEE] mb-3">
              Page not found
            </h1>
            <p className="text-sm text-[#555D66] dark:text-[#A3AAB2] mb-8 leading-relaxed">
              This route may have moved or expired.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Button
                type="button"
                variant="primary"
                onClick={() => navigate('/dashboard')}
                leftIcon={<Home className="w-4 h-4" aria-hidden="true" />}
              >
                Back to Dashboard
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate(-1)}
                leftIcon={<ArrowLeft className="w-4 h-4" aria-hidden="true" />}
              >
                Go Back
              </Button>
            </div>
          </Card>
        </PageShell>
      </main>
    </div>
  );
};

export default NotFoundPage;
