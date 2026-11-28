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
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { BrandMark } from '@/components/ui/BrandMark';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { PhaseNoticeModal } from '@/components/landing/PhaseNoticeModal';
import { ApiError, authApi } from '@/services/authApi';
import {
  GoogleAuthCancelledError,
  preloadGoogleIdentityScript,
  requestGoogleAuthCode,
  resolveGoogleClientId,
} from '@/lib/googleOAuth';
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

const GoogleContinueSection: React.FC<{
  disabled: boolean;
  isLoading: boolean;
  onClick: () => void;
}> = ({ disabled, isLoading, onClick }) => (
  <div className="mb-4 space-y-3.5">
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || isLoading}
      className={cn(
        'w-full h-10 px-4 rounded-lg border border-[#DDDAD0] dark:border-[#2B3038]',
        'bg-[#FFFFFF] dark:bg-[#141619] hover:bg-[#F3F2EE] dark:hover:bg-[#191D22]',
        'text-sm font-medium text-[#1F2428] dark:text-[#EAECEE] shadow-cly-sm',
        'flex items-center justify-center gap-2.5 transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6F68] dark:focus-visible:ring-[#5FA399]',
        (disabled || isLoading) && 'opacity-60 cursor-not-allowed'
      )}
    >
      {isLoading ? (
        <span
          className="w-4 h-4 border-2 border-[#2F6F68] dark:border-[#5FA399] border-t-transparent rounded-full animate-spin"
          aria-hidden="true"
        />
      ) : (
        <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
            fill="#4285F4"
          />
          <path
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            fill="#34A853"
          />
          <path
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            fill="#FBBC05"
          />
          <path
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            fill="#EA4335"
          />
        </svg>
      )}
      <span>{isLoading ? 'Signing in with Google...' : 'Continue with Google'}</span>
    </button>

    <div className="flex items-center gap-3">
      <span className="flex-1 border-t border-[#DDDAD0] dark:border-[#2B3038]" aria-hidden="true" />
      <span className="shrink-0 whitespace-nowrap text-[10px] font-medium uppercase tracking-wider text-[#7C848D] dark:text-[#8E96A0]">
        or continue with email
      </span>
      <span className="flex-1 border-t border-[#DDDAD0] dark:border-[#2B3038]" aria-hidden="true" />
    </div>
  </div>
);

export const AuthGatewayPage: React.FC<AuthGatewayPageProps> = ({ initialMode = 'signin' }) => {
  const { user, isAuthenticated, isLoading, login, loginWithGoogle, register } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const prefersReducedMotion = useReducedMotion();
  const loginEmailInputRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [googleClientId, setGoogleClientId] = useState<string | null>(
    import.meta.env?.VITE_GOOGLE_CLIENT_ID?.trim() || null
  );

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
  const [showSignupPassword, setShowSignupPassword] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  // Feedback & modal state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false);
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
    let active = true;
    resolveGoogleClientId(import.meta.env?.VITE_GOOGLE_CLIENT_ID, () =>
      authApi.getGoogleConfig()
    ).then((resolvedId) => {
      if (!active || !resolvedId) {
        return;
      }
      setGoogleClientId(resolvedId);
      void preloadGoogleIdentityScript().catch(() => {});
    });
    return () => {
      active = false;
    };
  }, []);

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

  const getDestination = () => {
    const rawRedirect = searchParams.get('redirect');
    return rawRedirect
      ? sanitizeNavigationPath(decodeURIComponent(rawRedirect), '/dashboard')
      : '/dashboard';
  };

  const handleModeSwitch = (nextMode: AuthMode) => {
    if (nextMode === mode || isSubmitting || isGoogleSubmitting) {
      return;
    }
    setMode(nextMode);
    setErrorMessage(null);
    setInfoMessage(null);
  };

  const handleGoogleAuth = async () => {
    if (isSubmitting || isGoogleSubmitting) {
      return;
    }
    setErrorMessage(null);
    setInfoMessage(null);

    try {
      setIsGoogleSubmitting(true);
      const clientId =
        googleClientId ||
        (await resolveGoogleClientId(import.meta.env?.VITE_GOOGLE_CLIENT_ID, () =>
          authApi.getGoogleConfig()
        ));

      if (!clientId) {
        setInfoMessage(
          'Google Sign-In requires GOOGLE_CLIENT_ID & GOOGLE_CLIENT_SECRET in your server environment.'
        );
        return;
      }

      setGoogleClientId(clientId);
      const code = await requestGoogleAuthCode(clientId);
      await loginWithGoogle({ code, redirectUri: 'postmessage' });
      navigate(getDestination(), { replace: true });
    } catch (err) {
      if (err instanceof GoogleAuthCancelledError) {
        return;
      }
      if (err instanceof ApiError) {
        setErrorMessage(err.message || 'Google authentication failed. Please try again.');
      } else if (err instanceof Error) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage('Unable to complete Google authentication right now.');
      }
    } finally {
      setIsGoogleSubmitting(false);
    }
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
      {/* Skip to main form — visually hidden until focused */}
      <a
        href="#main-auth-form"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:rounded-lg focus:bg-[#FAF9F6] dark:focus:bg-[#1C1F24] focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-[#2F6F68] dark:focus:text-[#5FA399] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6F68] dark:focus-visible:ring-[#5FA399]"
      >
        Skip to form
      </a>

      {/* Unified Top Bar: Brand Left + Theme & Auth Status Right */}
      <header className="sticky top-0 z-30 w-full border-b border-[#DDDAD0]/80 dark:border-[#2B3038]/85 bg-[#FAF9F6]/95 dark:bg-[#1C1F24]/95 backdrop-blur-md">
        <div className="max-w-[1440px] mx-auto px-5 sm:px-8 lg:px-12 h-16 flex items-center justify-between gap-4">
          {/* Brand Logo */}
          <Link
            to="/"
            className="flex items-center gap-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6F68] dark:focus-visible:ring-[#5FA399] rounded-lg px-1 py-0.5"
            aria-label="CONNECTLY home"
          >
            <BrandMark />
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
          className="order-2 lg:order-1 lg:col-span-6 px-5 sm:px-8 lg:px-10 xl:px-12 py-6 lg:py-8 flex flex-col justify-center border-t lg:border-t-0 lg:border-r border-[#DDDAD0]/80 dark:border-[#2B3038]/80"
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
          className="order-1 lg:order-2 lg:col-span-6 px-4 sm:px-8 lg:px-10 xl:px-12 py-5 sm:py-6 lg:py-8 flex flex-col justify-center outline-none"
        >
          <div className="w-full max-w-[500px] mx-auto">
            <div className="bg-[#FAF9F6] dark:bg-[#1C1F24] rounded-2xl border border-[#DDDAD0] dark:border-[#2B3038] shadow-cly-lg p-6 sm:p-7">
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
                    <h2 className="mb-4 font-display text-xl font-bold tracking-tight text-[#1F2428] dark:text-[#EAECEE]">
                      Welcome back
                    </h2>

                    <GoogleContinueSection
                      disabled={isSubmitting}
                      isLoading={isGoogleSubmitting}
                      onClick={handleGoogleAuth}
                    />

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
                          <Label htmlFor="login-password" required className="mb-0">
                            Password
                          </Label>
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

                      <div className="flex items-center gap-2.5 pt-0.5">
                        <input
                          id="remember-me"
                          type="checkbox"
                          checked={rememberMe}
                          onChange={(e) => setRememberMe(e.target.checked)}
                          className="w-4 h-4 shrink-0 text-[#2F6F68] dark:text-[#5FA399] border-[#DDDAD0] dark:border-[#2B3038] bg-transparent rounded focus:ring-[#2F6F68] dark:focus:ring-[#5FA399] cursor-pointer"
                        />
                        <label
                          htmlFor="remember-me"
                          className="text-xs sm:text-sm text-[#555D66] dark:text-[#A3AAB2] select-none cursor-pointer"
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

                    <div className="mt-5 pt-4 border-t border-[#DDDAD0] dark:border-[#2B3038] text-center">
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
                    <h2 className="mb-4 font-display text-xl font-bold tracking-tight text-[#1F2428] dark:text-[#EAECEE]">
                      Create your account
                    </h2>

                    <GoogleContinueSection
                      disabled={isSubmitting}
                      isLoading={isGoogleSubmitting}
                      onClick={handleGoogleAuth}
                    />

                    <form onSubmit={handleSignUpSubmit} className="space-y-3.5" noValidate>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                        <Input
                          label="First name"
                          id="register-firstname"
                          type="text"
                          value={firstName}
                          onChange={(e) => setFirstName(e.target.value)}
                          placeholder="Enter first name"
                          required
                          disabled={isSubmitting}
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
                          leftIcon={<UserIcon className="w-4 h-4" aria-hidden="true" />}
                        />
                      </div>

                      <Input
                        label="Email address"
                        id="register-email"
                        type="email"
                        value={signupEmail}
                        onChange={(e) => setSignupEmail(e.target.value)}
                        placeholder="name@company.com"
                        required
                        autoComplete="email"
                        disabled={isSubmitting}
                        leftIcon={<Mail className="w-4 h-4" aria-hidden="true" />}
                      />

                      <div className="space-y-2.5">
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

                        <ul
                          className="flex flex-wrap gap-1.5"
                          aria-label="Password requirements"
                        >
                          {criteria.map((c) => (
                            <li
                              key={c.id}
                              className={cn(
                                'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] leading-none transition-colors duration-150',
                                c.valid
                                  ? 'border-[#2F6F68]/40 dark:border-[#5FA399]/40 bg-[#E2ECE9]/70 dark:bg-[#1F302E]/70 text-[#2F6F68] dark:text-[#5FA399] font-medium'
                                  : 'border-[#DDDAD0] dark:border-[#2B3038] bg-[#F3F2EE]/80 dark:bg-[#141619] text-[#7C848D] dark:text-[#8E96A0]'
                              )}
                            >
                              {c.valid ? (
                                <Check className="w-3 h-3 shrink-0" aria-hidden="true" />
                              ) : (
                                <span
                                  className="w-1 h-1 rounded-full bg-current opacity-70"
                                  aria-hidden="true"
                                />
                              )}
                              <span>{c.label}</span>
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div className="flex items-start sm:items-center gap-2.5 pt-0.5">
                        <input
                          id="terms-conditions"
                          type="checkbox"
                          checked={agreedToTerms}
                          onChange={(e) => setAgreedToTerms(e.target.checked)}
                          className="w-4 h-4 mt-0.5 sm:mt-0 shrink-0 text-[#2F6F68] dark:text-[#5FA399] border-[#DDDAD0] dark:border-[#2B3038] bg-transparent rounded focus:ring-[#2F6F68] dark:focus:ring-[#5FA399] cursor-pointer"
                          required
                        />
                        <label
                          htmlFor="terms-conditions"
                          className="text-xs sm:text-sm leading-snug text-[#555D66] dark:text-[#A3AAB2] select-none cursor-pointer"
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
                        size="lg"
                        className="w-full"
                        isLoading={isSubmitting}
                        disabled={isSubmitting}
                        rightIcon={<ArrowRight className="w-4 h-4" aria-hidden="true" />}
                      >
                        Create Account
                      </Button>
                    </form>

                    <div className="mt-5 pt-4 border-t border-[#DDDAD0] dark:border-[#2B3038] text-center">
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
