import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';

export interface ErrorFallbackProps {
  error?: Error | null;
  resetErrorBoundary?: () => void;
  title?: string;
  message?: string;
}

export const ErrorFallback: React.FC<ErrorFallbackProps> = ({
  error,
  resetErrorBoundary,
  title = 'Something unexpected occurred',
  message = 'An application error interrupted your session. You can try refreshing the page or restarting your action.',
}) => {
  return (
    <div
      role="alert"
      className="min-h-screen flex items-center justify-center bg-[#F3F2EE] dark:bg-[#141619] py-12 px-4"
    >
      <Container size="sm">
        <div className="bg-[#FAF9F6] dark:bg-[#1C1F24] rounded-2xl border border-[#DDDAD0] dark:border-[#2B3038] p-8 shadow-cly-md text-center">
          <div className="w-14 h-14 rounded-full bg-[#F6E6E6] dark:bg-[#342023] text-[#C24D4D] dark:text-[#D46A6A] flex items-center justify-center mx-auto mb-5">
            <AlertTriangle className="w-7 h-7" aria-hidden="true" />
          </div>

          <h1 className="text-xl font-bold text-[#1F2428] dark:text-[#EAECEE] mb-2 font-display">
            {title}
          </h1>

          <p className="text-sm text-[#555D66] dark:text-[#A3AAB2] mb-6 leading-relaxed">
            {message}
          </p>

          {error && process.env.NODE_ENV !== 'production' && (
            <div className="text-left bg-[#111316] text-[#A3AAB2] p-3 rounded-lg text-xs font-mono mb-6 overflow-auto max-h-40 border border-white/10">
              <p className="text-[#D46A6A] font-semibold mb-1">{error.name}: {error.message}</p>
              {error.stack && <pre className="whitespace-pre-wrap">{error.stack}</pre>}
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            {resetErrorBoundary ? (
              <Button
                variant="primary"
                onClick={resetErrorBoundary}
                leftIcon={<RefreshCw className="w-4 h-4" />}
              >
                Try Again
              </Button>
            ) : (
              <Button
                variant="primary"
                onClick={() => window.location.reload()}
                leftIcon={<RefreshCw className="w-4 h-4" />}
              >
                Reload Page
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => { window.location.href = '/'; }}
            >
              Back to Safety
            </Button>
          </div>
        </div>
      </Container>
    </div>
  );
};

export default ErrorFallback;
