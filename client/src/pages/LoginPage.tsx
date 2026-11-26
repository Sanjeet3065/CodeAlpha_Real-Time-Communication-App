import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { ApiError } from '@/services/authApi';
import { sanitizeNavigationPath } from '@/lib/navigation';
import { Eye, EyeOff, Lock, Mail, AlertCircle, ArrowLeft, Video } from 'lucide-react';

export const LoginPage: React.FC = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setInfoMessage(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setErrorMessage('Please enter your email address.');
      return;
    }
    if (!password) {
      setErrorMessage('Please enter your password.');
      return;
    }

    try {
      setIsSubmitting(true);
      await login({ email: trimmedEmail, password });

      const rawRedirect = searchParams.get('redirect');
      const destination = rawRedirect
        ? sanitizeNavigationPath(decodeURIComponent(rawRedirect), '/dashboard')
        : '/dashboard';
      navigate(destination, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setErrorMessage('Invalid email or password. Please verify your credentials and try again.');
        } else if (err.status === 429) {
          setErrorMessage('Too many login attempts. Please wait 15 minutes before trying again.');
        } else {
          setErrorMessage(err.message || 'Login failed. Please try again.');
        }
      } else {
        setErrorMessage('Unable to reach the authentication service. Please check your connection.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleForgotPassword = (e: React.MouseEvent) => {
    e.preventDefault();
    setInfoMessage('Self-service password reset email dispatch will be configured with SMTP delivery in an upcoming phase.');
  };

  return (
    <div className="min-h-screen bg-[#F3F2EE] dark:bg-[#141619] flex flex-col justify-between px-4 py-8 sm:px-6 lg:px-8">
      {/* Top minimal bar */}
      <div className="w-full max-w-md mx-auto flex items-center justify-between mb-4">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm font-medium text-[#555D66] dark:text-[#A3AAB2] hover:text-[#1F2428] dark:hover:text-[#EAECEE] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6F68] dark:focus-visible:ring-[#5FA399] rounded-md px-1.5 py-1"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          <span>Back to Home</span>
        </Link>
        <ThemeToggle variant="compact" />
      </div>

      {/* Main Login Card */}
      <div className="w-full max-w-md mx-auto">
        <div className="bg-[#FAF9F6] dark:bg-[#1C1F24] rounded-2xl border border-[#DDDAD0] dark:border-[#2B3038] shadow-cly-sm p-6 sm:p-8">
          {/* Brand Logo & Header */}
          <div className="text-center mb-8">
            <Link
              to="/"
              className="inline-flex items-center justify-center gap-2 mb-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6F68] dark:focus-visible:ring-[#5FA399] rounded-lg p-1"
            >
              <div className="w-10 h-10 rounded-xl bg-[#2F6F68] dark:bg-[#5FA399] flex items-center justify-center text-[#FAF9F6] dark:text-[#141619] shadow-cly-sm">
                <Video className="w-5 h-5" aria-hidden="true" />
              </div>
              <span className="font-display font-extrabold text-2xl tracking-tight text-[#1F2428] dark:text-[#EAECEE]">
                CONNECTLY
              </span>
            </Link>
            <h1 className="font-display text-2xl font-bold tracking-tight text-[#1F2428] dark:text-[#EAECEE]">
              Welcome back
            </h1>
            <p className="mt-1 text-sm text-[#7C848D] dark:text-[#A3AAB2]">
              Sign in to access your meetings and collaborate.
            </p>
          </div>

          {/* Feedback Banners */}
          {errorMessage && (
            <div
              role="alert"
              aria-live="assertive"
              className="mb-6 p-3.5 rounded-lg bg-[#F6E6E6] dark:bg-[#342023] border border-[#C24D4D]/30 dark:border-[#D46A6A]/30 flex items-start gap-2.5 text-[#C24D4D] dark:text-[#D46A6A]"
            >
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" aria-hidden="true" />
              <div className="text-sm font-medium leading-relaxed">{errorMessage}</div>
            </div>
          )}

          {infoMessage && (
            <div
              role="status"
              className="mb-6 p-3.5 rounded-lg bg-[#E2ECE9] dark:bg-[#1F302E] border border-[#2F6F68]/30 dark:border-[#5FA399]/30 flex items-start gap-2.5 text-[#2F6F68] dark:text-[#5FA399]"
            >
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" aria-hidden="true" />
              <div className="text-sm font-medium leading-relaxed">{infoMessage}</div>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            <div>
              <Input
                label="Email address"
                id="login-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
                required
                autoComplete="email"
                autoFocus
                disabled={isSubmitting}
                leftIcon={<Mail className="w-4 h-4" aria-hidden="true" />}
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="login-password"
                  className="block text-sm font-medium text-[#1F2428] dark:text-[#EAECEE]"
                >
                  Password
                </label>
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  className="text-xs font-semibold text-[#2F6F68] dark:text-[#5FA399] hover:text-[#255A54] dark:hover:text-[#6EB2A8] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6F68] dark:focus-visible:ring-[#5FA399] rounded"
                >
                  Forgot password?
                </button>
              </div>
              <div className="relative">
                <Input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                  autoComplete="current-password"
                  disabled={isSubmitting}
                  leftIcon={<Lock className="w-4 h-4" aria-hidden="true" />}
                  rightIcon={
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="p-1 text-[#7C848D] dark:text-[#A3AAB2] hover:text-[#1F2428] dark:hover:text-[#EAECEE] transition-colors focus:outline-none"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? (
                        <EyeOff className="w-4 h-4" aria-hidden="true" />
                      ) : (
                        <Eye className="w-4 h-4" aria-hidden="true" />
                      )}
                    </button>
                  }
                />
              </div>
            </div>

            {/* Remember Me Checkbox */}
            <div className="flex items-center">
              <input
                id="remember-me"
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="w-4 h-4 text-[#2F6F68] dark:text-[#5FA399] border-[#DDDAD0] dark:border-[#2B3038] bg-transparent rounded focus:ring-[#2F6F68] dark:focus:ring-[#5FA399] cursor-pointer"
              />
              <label
                htmlFor="remember-me"
                className="ml-2 block text-sm text-[#555D66] dark:text-[#A3AAB2] select-none cursor-pointer"
              >
                Remember this device
              </label>
            </div>

            {/* Submit Button */}
            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="w-full"
              isLoading={isSubmitting}
              disabled={isSubmitting}
            >
              Sign In
            </Button>
          </form>

          {/* Card Footer Link */}
          <div className="mt-6 pt-6 border-t border-[#DDDAD0] dark:border-[#2B3038] text-center">
            <p className="text-sm text-[#7C848D] dark:text-[#A3AAB2]">
              Don&apos;t have an account?{' '}
              <Link
                to="/register"
                className="font-semibold text-[#2F6F68] dark:text-[#5FA399] hover:text-[#255A54] dark:hover:text-[#6EB2A8] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6F68] dark:focus-visible:ring-[#5FA399] rounded"
              >
                Sign Up
              </Link>
            </p>
          </div>
        </div>

        {/* Security badge note */}
        <div className="mt-6 text-center text-xs text-[#7C848D] dark:text-[#747C86] flex items-center justify-center gap-1.5">
          <Lock className="w-3.5 h-3.5 text-[#2F6F68] dark:text-[#5FA399]" aria-hidden="true" />
          <span>Argon2id cryptographic credential protection &amp; dual-token security</span>
        </div>
      </div>

      {/* Empty footer spacer for balance */}
      <div className="text-center py-2 text-xs text-[#7C848D] dark:text-[#747C86]">
        &copy; {new Date().getFullYear()} CONNECTLY. All rights reserved.
      </div>
    </div>
  );
};

export default LoginPage;
