import React from 'react';
import { useSafeNavigate } from '@/lib/navigation';
import { PageShell } from '@/components/layout/PageShell';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Home, ArrowLeft } from 'lucide-react';

export const NotFoundPage: React.FC = () => {
  const navigate = useSafeNavigate();

  return (
    <main id="main-content" tabIndex={-1} className="flex-1 flex flex-col outline-none">
      <PageShell size="sm" className="items-center justify-center py-20 flex-1">
        <Card variant="standard" className="text-center p-8 md:p-12 shadow-md">
          <span className="font-mono text-5xl font-extrabold text-[#168B83] tracking-wider block mb-2">
            404
          </span>
          <h1 className="text-2xl font-bold font-display text-[#172B3A] mb-3">
            Page Not Found
          </h1>
          <p className="text-sm text-[#3D5265] mb-8 leading-relaxed">
            The route you are looking for does not exist or has not been initialized yet in the current development phase.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button
              variant="primary"
              onClick={() => navigate('/')}
              leftIcon={<Home className="w-4 h-4" />}
            >
              Back to Home
            </Button>
            <Button
              variant="outline"
              onClick={() => navigate(-1)}
              leftIcon={<ArrowLeft className="w-4 h-4" />}
            >
              Go Back
            </Button>
          </div>
        </Card>
      </PageShell>
    </main>
  );
};

export default NotFoundPage;
