import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
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
    <div className="min-h-screen bg-[#F7F6F2] flex flex-col justify-between px-4 py-8 sm:px-6 lg:px-8">
      {/* Top minimal bar */}
      <div className="w-full max-w-md mx-auto flex items-center justify-between mb-4">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm font-medium text-[#3D5265] hover:text-[#172B3A] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#168B83] rounded-md px-1.5 py-1"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          <span>Back to Home</span>
        </Link>
        <span className="text-xs text-[#6B8092] font-mono">CONNECTLY v0.1.0</span>
      </div>

      {/* Main Login Card */}
      <div className="w-full max-w-md mx-auto">
        <div className="bg-white rounded-2xl border border-[#E3E1D9] shadow-sm p-6 sm:p-8">
          {/* Brand Logo & Header */}
          <div className="text-center mb-8">
            <Link
              to="/"
              className="inline-flex items-center justify-center gap-2 mb-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#168B83] rounded-lg p-1"
            >
              <div className="w-10 h-10 rounded-xl bg-[#168B83] flex items-center justify-center text-white shadow-sm">
                <Video className="w-5 h-5" aria-hidden="true" />
              </div>
              <span className="font-display font-extrabold text-2xl tracking-tight text-[#172B3A]">
                CONNECTLY
              </span>
            </Link>
            <h1 className="font-display text-2xl font-bold tracking-tight text-[#172B3A]">
              Welcome back
            </h1>
            <p className="mt-1 text-sm text-[#6B8092]">
              Sign in to access your meetings and collaborate.
            </p>
          </div>

          {/* Feedback Banners */}
          {errorMessage && (
            <div
              role="alert"
              aria-live="assertive"
              className="mb-6 p-3.5 rounded-lg bg-[#D94F4F]/10 border border-[#D94F4F]/30 flex items-start gap-2.5 text-[#D94F4F]"
            >
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" aria-hidden="true" />
              <div className="text-sm font-medium leading-relaxed">{errorMessage}</div>
            </div>
          )}

          {infoMessage && (
            <div
              role="status"
              className="mb-6 p-3.5 rounded-lg bg-[#DCEDE8] border border-[#168B83]/30 flex items-start gap-2.5 text-[#168B83]"
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
                  className="block text-sm font-medium text-[#172B3A]"
                >
                  Password
                </label>
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  className="text-xs font-semibold text-[#168B83] hover:text-[#0E5B56] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#168B83] rounded"
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
                      className="p-1 text-[#6B8092] hover:text-[#172B3A] transition-colors focus:outline-none"
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
                className="w-4 h-4 text-[#168B83] border-[#E3E1D9] rounded focus:ring-[#168B83] cursor-pointer"
              />
              <label
                htmlFor="remember-me"
                className="ml-2 block text-sm text-[#3D5265] select-none cursor-pointer"
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
          <div className="mt-6 pt-6 border-t border-[#E3E1D9] text-center">
            <p className="text-sm text-[#6B8092]">
              Don&apos;t have an account?{' '}
              <Link
                to="/register"
                className="font-semibold text-[#168B83] hover:text-[#0E5B56] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#168B83] rounded"
              >
                Sign Up
              </Link>
            </p>
          </div>
        </div>

        {/* Security badge note */}
        <div className="mt-6 text-center text-xs text-[#6B8092] flex items-center justify-center gap-1.5">
          <Lock className="w-3.5 h-3.5 text-[#168B83]" aria-hidden="true" />
          <span>Argon2id cryptographic credential protection & dual-token security</span>
        </div>
      </div>

      {/* Empty footer spacer for balance */}
      <div className="text-center py-2 text-xs text-[#6B8092]">
        &copy; {new Date().getFullYear()} CONNECTLY. All rights reserved.
      </div>
    </div>
  );
};

export default LoginPage;
