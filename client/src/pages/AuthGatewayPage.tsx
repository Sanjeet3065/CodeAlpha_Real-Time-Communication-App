import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  AlertCircle,
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  LayoutDashboard,
  Lock,
  Mail,
  ShieldCheck,
  User as UserIcon,
  X,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { PhaseNoticeModal } from '@/components/landing/PhaseNoticeModal';
import { ApiError } from '@/services/authApi';
import { sanitizeNavigationPath } from '@/lib/navigation';
import { cn } from '@/lib/utils';
import studioWorkspaceImage from '@/assets/studio-workspace.jpg';
import {
  AUTH_ANIMATED_HIGHLIGHTS,
  AUTH_SHOWCASE_COPY,
  AUTH_TOPBAR_COPY,
  STUDIO_WAVEFORM_BARS,
  evaluatePasswordCriteria,
} from '@/components/auth/authShowcaseContent';

export type AuthMode = 'signin' | 'signup';

export interface AuthGatewayPageProps {
  initialMode?: AuthMode;
}

export const AuthGatewayPage: React.FC<AuthGatewayPageProps> = ({ initialMode = 'signin' }) => {
  const { user, isAuthenticated, isLoading, login, register } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const prefersReducedMotion = useReducedMotion();
  const loginEmailInputRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [highlightIndex, setHighlightIndex] = useState(0);

  // Sign In state
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  // Sign Up state
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showSignupPassword, setShowSignupPassword] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  // Feedback & modal state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [noticeModal, setNoticeModal] = useState<{
    isOpen: boolean;
    title: string;
    description: string;
  }>({ isOpen: false, title: '', description: '' });

  useEffect(() => {
    setMode(initialMode);
    setErrorMessage(null);
    setInfoMessage(null);
  }, [initialMode]);

  useEffect(() => {
    if (prefersReducedMotion) {
      return;
    }
    const timer = window.setInterval(() => {
      setHighlightIndex((prev) => (prev + 1) % AUTH_ANIMATED_HIGHLIGHTS.length);
    }, 3600);
    return () => window.clearInterval(timer);
  }, [prefersReducedMotion]);

  const criteria = useMemo(() => evaluatePasswordCriteria(signupPassword), [signupPassword]);
  const allCriteriaMet = useMemo(() => criteria.every((c) => c.valid), [criteria]);
  const passwordsMatch = useMemo(
    () => confirmPassword.length > 0 && signupPassword === confirmPassword,
    [signupPassword, confirmPassword]
  );

  const getDestination = () => {
    const rawRedirect = searchParams.get('redirect');
    return rawRedirect
      ? sanitizeNavigationPath(decodeURIComponent(rawRedirect), '/dashboard')
      : '/dashboard';
  };

  const handleModeSwitch = (nextMode: AuthMode) => {
    if (nextMode === mode || isSubmitting) {
      return;
    }
    setMode(nextMode);
    setErrorMessage(null);
    setInfoMessage(null);
  };

  const handleSignInFirstClick = () => {
    setMode('signin');
    setErrorMessage(null);
    setInfoMessage('Sign in first with your email and password to open your dashboard.');
    window.setTimeout(() => {
      loginEmailInputRef.current?.focus();
    }, 50);
  };

  const openNotice = (topic: 'Privacy Policy' | 'Terms of Service' | 'Security Architecture') => {
    setNoticeModal({
      isOpen: true,
      title: topic,
      description: `CONNECTLY enforces strict ${topic.toLowerCase()} guarantees backed by Argon2id password hashing, dual-JWT rotation, DTLS-SRTP media encryption, and Supabase Row-Level Security.`,
    });
  };

  const handleSignInSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setInfoMessage(null);

    const trimmedEmail = loginEmail.trim();
    if (!trimmedEmail) {
      setErrorMessage('Please enter your email address.');
      return;
    }
    if (!loginPassword) {
      setErrorMessage('Please enter your password.');
      return;
    }

    try {
      setIsSubmitting(true);
      await login({ email: trimmedEmail, password: loginPassword });
      navigate(getDestination(), { replace: true });
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

  const handleSignUpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setInfoMessage(null);

    const trimmedFirst = firstName.trim();
    const trimmedLast = lastName.trim();
    const trimmedEmail = signupEmail.trim();

    if (!trimmedFirst) {
      setErrorMessage('Please enter your first name.');
      return;
    }
    if (!trimmedLast) {
      setErrorMessage('Please enter your last name.');
      return;
    }
    if (!trimmedEmail) {
      setErrorMessage('Please enter your email address.');
      return;
    }
    if (!allCriteriaMet) {
      setErrorMessage('Please satisfy all password security requirements before continuing.');
      return;
    }
    if (signupPassword !== confirmPassword) {
      setErrorMessage('Passwords do not match. Please ensure both fields are identical.');
      return;
    }
    if (!agreedToTerms) {
      setErrorMessage('Please agree to the Terms of Service and Privacy Policy.');
      return;
    }

    try {
      setIsSubmitting(true);
      await register({
        email: trimmedEmail,
        password: signupPassword,
        firstName: trimmedFirst,
        lastName: trimmedLast,
      });

      await login({
        email: trimmedEmail,
        password: signupPassword,
      });

      navigate(getDestination(), { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409) {
          setErrorMessage(
            'An account with this email address already exists. Please sign in or use another email.'
          );
        } else if (err.status === 400 && err.errors && err.errors.length > 0) {
          setErrorMessage(err.errors.map((item) => item.message).join(' '));
        } else {
          setErrorMessage(
            err.message || 'Registration failed. Please check your information and try again.'
          );
        }
      } else {
        setErrorMessage('Unable to reach the registration service. Please verify your connection.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const activeHighlight = AUTH_ANIMATED_HIGHLIGHTS[highlightIndex];

  return (
    <div className="min-h-screen flex flex-col bg-[#F3F2EE] dark:bg-[#141619] text-[#1F2428] dark:text-[#EAECEE] selection:bg-[#E2ECE9] selection:text-[#2F6F68] dark:selection:bg-[#1F302E] dark:selection:text-[#5FA399]">
      {/* Unified Top Bar: Brand Left + Theme & Auth Status Right */}
      <header className="w-full border-b border-[#DDDAD0]/75 dark:border-[#2B3038]/80 bg-[#FAF9F6]/90 dark:bg-[#1C1F24]/90">
        <div className="max-w-[1440px] mx-auto px-5 sm:px-8 lg:px-12 h-16 flex items-center justify-between gap-4">
          {/* Brand Logo */}
          <Link
            to="/"
            className="flex items-center gap-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6F68] dark:focus-visible:ring-[#5FA399] rounded-lg px-1 py-0.5"
            aria-label="CONNECTLY home"
          >
            <span className="w-9 h-9 rounded-xl bg-[#2F6F68] dark:bg-[#5FA399] text-[#FAF9F6] dark:text-[#141619] flex items-center justify-center shadow-cly-sm">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                <path
                  d="M16.5 7.75C15.1 6.65 13.45 6.1 11.75 6.1C7.95 6.1 5.25 8.8 5.25 12C5.25 15.2 7.95 17.9 11.75 17.9C13.45 17.9 15.1 17.35 16.5 16.25"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                />
                <circle cx="17.5" cy="12" r="2" fill="currentColor" />
              </svg>
            </span>
            <div className="flex items-baseline gap-2.5">
              <span className="font-display font-extrabold text-xl tracking-tight text-[#1F2428] dark:text-[#EAECEE]">
                CONNECTLY
              </span>
              <span className="hidden sm:inline text-xs font-medium text-[#646D77] dark:text-[#8E96A0]">
                {AUTH_SHOWCASE_COPY.brandTag}
              </span>
            </div>
          </Link>

          {/* Top-Right Corner: Light/Dark Theme + User Name & Dashboard OR Sign in first */}
          <div className="flex items-center gap-2.5 sm:gap-3">
            <ThemeToggle variant="compact" />

            {!isLoading &&
              (isAuthenticated ? (
                <>
                  <Link
                    to="/dashboard"
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-[#1F2428] dark:text-[#EAECEE] hover:text-[#2F6F68] dark:hover:text-[#5FA399] px-2 py-1 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6F68] dark:focus-visible:ring-[#5FA399]"
                  >
                    <UserIcon
                      className="w-4 h-4 text-[#2F6F68] dark:text-[#5FA399]"
                      aria-hidden="true"
                    />
                    <span>{user?.firstName || 'User'}</span>
                  </Link>
                  <Button
                    type="button"
                    variant="primary"
                    size="md"
                    onClick={() => navigate('/dashboard')}
                    rightIcon={<LayoutDashboard className="w-4 h-4" aria-hidden="true" />}
                  >
                    {AUTH_TOPBAR_COPY.dashboardLabel}
                  </Button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={handleSignInFirstClick}
                  className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-[#EAE8E1] dark:bg-[#141619] border border-[#DDDAD0] dark:border-[#2B3038] text-xs sm:text-sm font-medium text-[#555D66] dark:text-[#A3AAB2] hover:text-[#1F2428] dark:hover:text-[#EAECEE] hover:border-[#2F6F68]/45 dark:hover:border-[#5FA399]/45 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6F68] dark:focus-visible:ring-[#5FA399]"
                >
                  <UserIcon
                    className="w-3.5 h-3.5 text-[#2F6F68] dark:text-[#5FA399]"
                    aria-hidden="true"
                  />
                  <span>{AUTH_TOPBAR_COPY.guestPrompt}</span>
                </button>
              ))}
          </div>
        </div>
      </header>

      {/* Main Split Workspace */}
      <div className="flex-1 w-full max-w-[1440px] mx-auto grid grid-cols-1 lg:grid-cols-12">
        {/* LEFT COLUMN: Editorial Video Studio Visual + Subtle Animation + Text */}
        <section
          aria-label="Connectly Workspace Preview"
          className="lg:col-span-6 px-5 sm:px-8 lg:px-12 py-6 lg:py-8 flex flex-col justify-center border-b lg:border-b-0 lg:border-r border-[#DDDAD0]/80 dark:border-[#2B3038]/80"
        >
          <div className="w-full max-w-xl mx-auto space-y-4">
            <motion.div
              initial={prefersReducedMotion ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
              className="space-y-2"
            >
              <h1 className="font-display text-3xl sm:text-4xl lg:text-[2.45rem] font-semibold tracking-[-0.03em] leading-[1.08] text-[#1F2428] dark:text-[#EAECEE]">
                {AUTH_SHOWCASE_COPY.headlineTop}{' '}
                <span className="text-[#2F6F68] dark:text-[#5FA399]">
                  {AUTH_SHOWCASE_COPY.headlineAccent}
                </span>
              </h1>
              <p className="text-sm text-[#555D66] dark:text-[#A3AAB2] leading-[1.55] max-w-[46ch]">
                {AUTH_SHOWCASE_COPY.subtitle}
              </p>
            </motion.div>

            <motion.div
              initial={prefersReducedMotion ? false : { opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
              className="rounded-2xl bg-[#FAF9F6] dark:bg-[#1C1F24] border border-[#DDDAD0] dark:border-[#2B3038] p-2.5 sm:p-3 shadow-cly-lg"
            >
              <div className="overflow-hidden rounded-xl bg-[#EAE8E1] dark:bg-[#111316] ring-1 ring-inset ring-black/5 dark:ring-white/10">
                <img
                  src={studioWorkspaceImage}
                  alt="Connectly minimalist stone and carbon video conferencing studio monitor and desktop microphone"
                  className="w-full aspect-[16/10] object-cover block"
                />
              </div>

              {/* Subtle Live Studio Telemetry & Audio Equalizer Animation */}
              <div className="px-2 pt-3 pb-1 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="relative flex h-2.5 w-2.5 shrink-0 items-center justify-center">
                    {!prefersReducedMotion && (
                      <motion.span
                        className="absolute inset-0 rounded-full bg-[#2F6F68] dark:bg-[#5FA399]"
                        animate={{ scale: [1, 2.2, 1], opacity: [0.55, 0, 0.55] }}
                        transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
                      />
                    )}
                    <span className="relative h-2 w-2 rounded-full bg-[#2F6F68] dark:bg-[#5FA399]" />
                  </span>

                  <div className="min-w-0 h-5 flex items-center overflow-hidden">
                    <AnimatePresence mode="wait">
                      <motion.div
                        key={activeHighlight.label}
                        initial={prefersReducedMotion ? false : { opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={prefersReducedMotion ? undefined : { opacity: 0, y: -6 }}
                        transition={{ duration: 0.25 }}
                        className="flex items-center gap-2 text-xs truncate"
                      >
                        <span className="font-semibold text-[#1F2428] dark:text-[#EAECEE]">
                          {activeHighlight.label}
                        </span>
                        <span className="text-[#DDDAD0] dark:text-[#2B3038]" aria-hidden="true">
                          ·
                        </span>
                        <span className="text-[#646D77] dark:text-[#8E96A0] truncate">
                          {activeHighlight.detail}
                        </span>
                      </motion.div>
                    </AnimatePresence>
                  </div>
                </div>

                {/* Calm 9-Bar Equalizer Animation */}
                <div
                  className="flex items-end gap-[3px] h-4 shrink-0 px-2 py-1 rounded-md bg-[#F3F2EE] dark:bg-[#141619] border border-[#DDDAD0] dark:border-[#2B3038]"
                  aria-hidden="true"
                >
                  {STUDIO_WAVEFORM_BARS.map((restHeight, idx) => (
                    <motion.span
                      key={idx}
                      className="w-[2.5px] h-full rounded-full bg-[#2F6F68] dark:bg-[#5FA399]"
                      style={{ transformOrigin: 'bottom' }}
                      animate={
                        prefersReducedMotion
                          ? { scaleY: restHeight }
                          : {
                              scaleY: [
                                restHeight,
                                Math.min(1, restHeight + 0.35),
                                Math.max(0.22, restHeight - 0.25),
                                restHeight,
                              ],
                            }
                      }
                      transition={
                        prefersReducedMotion
                          ? undefined
                          : {
                              duration: 1.5 + (idx % 3) * 0.28,
                              delay: idx * 0.08,
                              repeat: Infinity,
                              ease: 'easeInOut',
                            }
                      }
                    />
                  ))}
                </div>
              </div>
            </motion.div>

            <div className="hidden lg:flex items-center gap-4 pt-1 text-xs font-medium text-[#646D77] dark:text-[#8E96A0]">
              <span>Up to 60 peers</span>
              <span className="text-[#DDDAD0] dark:text-[#2B3038]" aria-hidden="true">
                /
              </span>
              <span>Interactive whiteboard</span>
              <span className="text-[#DDDAD0] dark:text-[#2B3038]" aria-hidden="true">
                /
              </span>
              <span>Private file vault</span>
            </div>
          </div>
        </section>

        {/* RIGHT COLUMN: Sign In / Create Account Workspace */}
        <main
          id="main-content"
          className="lg:col-span-6 px-5 sm:px-8 lg:px-12 py-6 lg:py-8 flex flex-col justify-center outline-none"
        >
          <div className="w-full max-w-md mx-auto">
            <div className="bg-[#FAF9F6] dark:bg-[#1C1F24] rounded-2xl border border-[#DDDAD0] dark:border-[#2B3038] shadow-cly-md p-5 sm:p-6">
              {/* Segmented Sign In / Create Account Switcher */}
              <div
                role="tablist"
                aria-label="Authentication mode"
                className="grid grid-cols-2 gap-1 p-1 mb-5 rounded-xl bg-[#EAE8E1] dark:bg-[#141619] border border-[#DDDAD0] dark:border-[#2B3038]"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'signin'}
                  onClick={() => handleModeSwitch('signin')}
                  className={cn(
                    'relative py-2 px-3 rounded-lg text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6F68] dark:focus-visible:ring-[#5FA399]',
                    mode === 'signin'
                      ? 'text-[#1F2428] dark:text-[#EAECEE]'
                      : 'text-[#646D77] dark:text-[#8E96A0] hover:text-[#1F2428] dark:hover:text-[#EAECEE]'
                  )}
                >
                  {mode === 'signin' && (
                    <motion.span
                      layoutId="auth-mode-pill"
                      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                      className="absolute inset-0 rounded-lg bg-[#FAF9F6] dark:bg-[#24282E] border border-[#DDDAD0]/80 dark:border-[#323842] shadow-cly-sm"
                    />
                  )}
                  <span className="relative z-10">Sign In</span>
                </button>

                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'signup'}
                  onClick={() => handleModeSwitch('signup')}
                  className={cn(
                    'relative py-2 px-3 rounded-lg text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6F68] dark:focus-visible:ring-[#5FA399]',
                    mode === 'signup'
                      ? 'text-[#1F2428] dark:text-[#EAECEE]'
                      : 'text-[#646D77] dark:text-[#8E96A0] hover:text-[#1F2428] dark:hover:text-[#EAECEE]'
                  )}
                >
                  {mode === 'signup' && (
                    <motion.span
                      layoutId="auth-mode-pill"
                      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                      className="absolute inset-0 rounded-lg bg-[#FAF9F6] dark:bg-[#24282E] border border-[#DDDAD0]/80 dark:border-[#323842] shadow-cly-sm"
                    />
                  )}
                  <span className="relative z-10">Create Account</span>
                </button>
              </div>

              {errorMessage && (
                <div
                  role="alert"
                  aria-live="assertive"
                  className="mb-5 p-3 rounded-lg bg-[#F6E6E6] dark:bg-[#342023] border border-[#C24D4D]/30 dark:border-[#D46A6A]/30 flex items-start gap-2.5 text-[#C24D4D] dark:text-[#D46A6A]"
                >
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                  <div className="text-xs sm:text-sm font-medium leading-relaxed">
                    {errorMessage}
                  </div>
                </div>
              )}

              {infoMessage && (
                <div
                  role="status"
                  className="mb-5 p-3 rounded-lg bg-[#E2ECE9] dark:bg-[#1F302E] border border-[#2F6F68]/30 dark:border-[#5FA399]/30 flex items-start gap-2.5 text-[#2F6F68] dark:text-[#5FA399]"
                >
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                  <div className="text-xs sm:text-sm font-medium leading-relaxed">
                    {infoMessage}
                  </div>
                </div>
              )}

              <AnimatePresence mode="wait">
                {mode === 'signin' ? (
                  <motion.div
                    key="signin-panel"
                    initial={prefersReducedMotion ? false : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={prefersReducedMotion ? undefined : { opacity: 0, y: -6 }}
                    transition={{ duration: 0.16 }}
                  >
                    <div className="mb-5">
                      <h2 className="font-display text-xl font-bold tracking-tight text-[#1F2428] dark:text-[#EAECEE]">
                        Welcome back
                      </h2>
                      <p className="mt-0.5 text-sm text-[#646D77] dark:text-[#A3AAB2]">
                        Enter your credentials to enter the studio.
                      </p>
                    </div>

                    <form onSubmit={handleSignInSubmit} className="space-y-4" noValidate>
                      <Input
                        ref={loginEmailInputRef}
                        label="Email address"
                        id="login-email"
                        type="email"
                        value={loginEmail}
                        onChange={(e) => setLoginEmail(e.target.value)}
                        placeholder="name@company.com"
                        required
                        autoComplete="email"
                        disabled={isSubmitting}
                        leftIcon={<Mail className="w-4 h-4" aria-hidden="true" />}
                      />

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
                            onClick={() =>
                              setInfoMessage(
                                'Self-service password reset email dispatch will be configured with SMTP delivery in an upcoming phase.'
                              )
                            }
                            className="text-xs font-semibold text-[#2F6F68] dark:text-[#5FA399] hover:text-[#255A54] dark:hover:text-[#6EB2A8] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6F68] dark:focus-visible:ring-[#5FA399] rounded"
                          >
                            Forgot password?
                          </button>
                        </div>

                        <Input
                          id="login-password"
                          type={showLoginPassword ? 'text' : 'password'}
                          value={loginPassword}
                          onChange={(e) => setLoginPassword(e.target.value)}
                          placeholder="Enter your password"
                          required
                          autoComplete="current-password"
                          disabled={isSubmitting}
                          leftIcon={<Lock className="w-4 h-4" aria-hidden="true" />}
                          rightIcon={
                            <button
                              type="button"
                              onClick={() => setShowLoginPassword((prev) => !prev)}
                              className="p-1 text-[#7C848D] dark:text-[#A3AAB2] hover:text-[#1F2428] dark:hover:text-[#EAECEE] transition-colors focus:outline-none"
                              aria-label={showLoginPassword ? 'Hide password' : 'Show password'}
                            >
                              {showLoginPassword ? (
                                <EyeOff className="w-4 h-4" aria-hidden="true" />
                              ) : (
                                <Eye className="w-4 h-4" aria-hidden="true" />
                              )}
                            </button>
                          }
                        />
                      </div>

                      <div className="flex items-center pt-0.5">
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

                      <Button
                        type="submit"
                        variant="primary"
                        size="lg"
                        className="w-full"
                        isLoading={isSubmitting}
                        disabled={isSubmitting}
                        rightIcon={<ArrowRight className="w-4 h-4" aria-hidden="true" />}
                      >
                        Sign In
                      </Button>
                    </form>

                    <div className="mt-5 pt-5 border-t border-[#DDDAD0] dark:border-[#2B3038] text-center">
                      <p className="text-xs sm:text-sm text-[#646D77] dark:text-[#A3AAB2]">
                        New to Connectly?{' '}
                        <button
                          type="button"
                          onClick={() => handleModeSwitch('signup')}
                          className="font-semibold text-[#2F6F68] dark:text-[#5FA399] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6F68] dark:focus-visible:ring-[#5FA399] rounded"
                        >
                          Create an account
                        </button>
                      </p>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="signup-panel"
                    initial={prefersReducedMotion ? false : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={prefersReducedMotion ? undefined : { opacity: 0, y: -6 }}
                    transition={{ duration: 0.16 }}
                  >
                    <div className="mb-3">
                      <h2 className="font-display text-lg sm:text-xl font-bold tracking-tight text-[#1F2428] dark:text-[#EAECEE]">
                        Create your account
                      </h2>
                      <p className="mt-0.5 text-xs sm:text-sm text-[#646D77] dark:text-[#A3AAB2]">
                        Start hosting video meetings and shared rooms.
                      </p>
                    </div>

                    <form onSubmit={handleSignUpSubmit} className="space-y-2.5" noValidate>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <Input
                          label="First name"
                          id="register-firstname"
                          type="text"
                          value={firstName}
                          onChange={(e) => setFirstName(e.target.value)}
                          placeholder="Enter first name"
                          required
                          disabled={isSubmitting}
                          className="h-9"
                          leftIcon={<UserIcon className="w-4 h-4" aria-hidden="true" />}
                        />
                        <Input
                          label="Last name"
                          id="register-lastname"
                          type="text"
                          value={lastName}
                          onChange={(e) => setLastName(e.target.value)}
                          placeholder="Enter last name"
                          required
                          disabled={isSubmitting}
                          className="h-9"
                          leftIcon={<UserIcon className="w-4 h-4" aria-hidden="true" />}
                        />
                      </div>

                      <Input
                        label="Work or personal email"
                        id="register-email"
                        type="email"
                        value={signupEmail}
                        onChange={(e) => setSignupEmail(e.target.value)}
                        placeholder="name@company.com"
                        required
                        autoComplete="email"
                        disabled={isSubmitting}
                        className="h-9"
                        leftIcon={<Mail className="w-4 h-4" aria-hidden="true" />}
                      />

                      <Input
                        label="Password"
                        id="register-password"
                        type={showSignupPassword ? 'text' : 'password'}
                        value={signupPassword}
                        onChange={(e) => setSignupPassword(e.target.value)}
                        placeholder="Create a strong password"
                        required
                        autoComplete="new-password"
                        disabled={isSubmitting}
                        className="h-9"
                        leftIcon={<Lock className="w-4 h-4" aria-hidden="true" />}
                        rightIcon={
                          <button
                            type="button"
                            onClick={() => setShowSignupPassword((prev) => !prev)}
                            className="p-1 text-[#7C848D] dark:text-[#A3AAB2] hover:text-[#1F2428] dark:hover:text-[#EAECEE] transition-colors focus:outline-none"
                            aria-label={showSignupPassword ? 'Hide password' : 'Show password'}
                          >
                            {showSignupPassword ? (
                              <EyeOff className="w-4 h-4" aria-hidden="true" />
                            ) : (
                              <Eye className="w-4 h-4" aria-hidden="true" />
                            )}
                          </button>
                        }
                      />

                      <div className="px-3 py-2 bg-[#F3F2EE] dark:bg-[#141619] rounded-xl border border-[#DDDAD0] dark:border-[#2B3038] text-[11px]">
                        <ul
                          className="grid grid-cols-2 gap-x-3 gap-y-0.5"
                          aria-label="Password requirements"
                        >
                          {criteria.map((c) => (
                            <li
                              key={c.id}
                              className={cn(
                                'flex items-center gap-1.5 transition-colors duration-150',
                                c.valid
                                  ? 'text-[#2F6F68] dark:text-[#5FA399] font-medium'
                                  : 'text-[#7C848D] dark:text-[#747C86]'
                              )}
                            >
                              {c.valid ? (
                                <Check
                                  className="w-3 h-3 shrink-0 text-[#2F6F68] dark:text-[#5FA399]"
                                  aria-hidden="true"
                                />
                              ) : (
                                <span className="w-3 h-3 flex items-center justify-center shrink-0">
                                  <span className="w-1 h-1 rounded-full bg-[#7C848D] dark:bg-[#747C86]" />
                                </span>
                              )}
                              <span className="truncate">{c.label}</span>
                            </li>
                          ))}
                        </ul>
                      </div>

                      <Input
                        label="Confirm password"
                        id="register-confirm-password"
                        type={showSignupPassword ? 'text' : 'password'}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Re-enter your password"
                        required
                        autoComplete="new-password"
                        disabled={isSubmitting}
                        className="h-9"
                        leftIcon={<Lock className="w-4 h-4" aria-hidden="true" />}
                        rightIcon={
                          confirmPassword ? (
                            passwordsMatch ? (
                              <Check
                                className="w-4 h-4 text-[#2F6F68] dark:text-[#5FA399]"
                                aria-label="Passwords match"
                              />
                            ) : (
                              <X
                                className="w-4 h-4 text-[#C24D4D] dark:text-[#D46A6A]"
                                aria-label="Passwords do not match"
                              />
                            )
                          ) : undefined
                        }
                      />

                      <div className="flex items-start pt-0.5">
                        <input
                          id="terms-conditions"
                          type="checkbox"
                          checked={agreedToTerms}
                          onChange={(e) => setAgreedToTerms(e.target.checked)}
                          className="w-4 h-4 mt-0.5 text-[#2F6F68] dark:text-[#5FA399] border-[#DDDAD0] dark:border-[#2B3038] bg-transparent rounded focus:ring-[#2F6F68] dark:focus:ring-[#5FA399] cursor-pointer"
                          required
                        />
                        <label
                          htmlFor="terms-conditions"
                          className="ml-2.5 block text-xs leading-snug text-[#555D66] dark:text-[#A3AAB2] select-none cursor-pointer"
                        >
                          I agree to the{' '}
                          <button
                            type="button"
                            onClick={() => openNotice('Terms of Service')}
                            className="text-[#1F2428] dark:text-[#EAECEE] font-semibold underline underline-offset-2 hover:text-[#2F6F68] dark:hover:text-[#5FA399]"
                          >
                            Terms of Service
                          </button>{' '}
                          and{' '}
                          <button
                            type="button"
                            onClick={() => openNotice('Privacy Policy')}
                            className="text-[#1F2428] dark:text-[#EAECEE] font-semibold underline underline-offset-2 hover:text-[#2F6F68] dark:hover:text-[#5FA399]"
                          >
                            Privacy Policy
                          </button>
                          .
                        </label>
                      </div>

                      <Button
                        type="submit"
                        variant="primary"
                        size="md"
                        className="w-full h-10"
                        isLoading={isSubmitting}
                        disabled={isSubmitting}
                        rightIcon={<ArrowRight className="w-4 h-4" aria-hidden="true" />}
                      >
                        Create Account
                      </Button>
                    </form>

                    <div className="mt-4 pt-3.5 border-t border-[#DDDAD0] dark:border-[#2B3038] text-center">
                      <p className="text-xs sm:text-sm text-[#646D77] dark:text-[#A3AAB2]">
                        Already have an account?{' '}
                        <button
                          type="button"
                          onClick={() => handleModeSwitch('signin')}
                          className="font-semibold text-[#2F6F68] dark:text-[#5FA399] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6F68] dark:focus-visible:ring-[#5FA399] rounded"
                        >
                          Sign In
                        </button>
                      </p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="mt-3.5 px-1 flex items-center justify-between text-[11px] text-[#7C848D] dark:text-[#747C86]">
              <span>&copy; {new Date().getFullYear()} CONNECTLY</span>
              <button
                type="button"
                onClick={() => openNotice('Security Architecture')}
                className="inline-flex items-center gap-1.5 hover:text-[#1F2428] dark:hover:text-[#EAECEE] transition-colors rounded px-1 py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6F68] dark:focus-visible:ring-[#5FA399]"
              >
                <ShieldCheck
                  className="w-3.5 h-3.5 text-[#2F6F68] dark:text-[#5FA399]"
                  aria-hidden="true"
                />
                <span>Encrypted Session Architecture</span>
              </button>
            </div>
          </div>
        </main>
      </div>

      <PhaseNoticeModal
        isOpen={noticeModal.isOpen}
        onClose={() => setNoticeModal((prev) => ({ ...prev, isOpen: false }))}
        title={noticeModal.title}
        targetPhase="Security & Governance Standards"
        description={noticeModal.description}
        detail="Encryption: Argon2id + Dual JWT + DTLS-SRTP + Supabase RLS & Private Storage"
      />
    </div>
  );
};

export default AuthGatewayPage;
