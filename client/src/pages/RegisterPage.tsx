import React, { useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ApiError } from '@/services/authApi';
import {
  Eye,
  EyeOff,
  Lock,
  Mail,
  User as UserIcon,
  Check,
  X,
  AlertCircle,
  ArrowLeft,
  Video,
} from 'lucide-react';

interface PasswordCriterion {
  id: string;
  label: string;
  valid: boolean;
}

export const RegisterPage: React.FC = () => {
  const { register, login } = useAuth();
  const navigate = useNavigate();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Password criteria verification in real-time
  const criteria: PasswordCriterion[] = useMemo(() => {
    return [
      {
        id: 'length',
        label: 'At least 8 characters',
        valid: password.length >= 8,
      },
      {
        id: 'upper',
        label: 'At least 1 uppercase letter (A-Z)',
        valid: /[A-Z]/.test(password),
      },
      {
        id: 'lower',
        label: 'At least 1 lowercase letter (a-z)',
        valid: /[a-z]/.test(password),
      },
      {
        id: 'number',
        label: 'At least 1 number (0-9)',
        valid: /[0-9]/.test(password),
      },
      {
        id: 'symbol',
        label: 'At least 1 special character (!@#$%^&*)',
        valid: /[^A-Za-z0-9]/.test(password),
      },
    ];
  }, [password]);

  const allCriteriaMet = useMemo(() => criteria.every((c) => c.valid), [criteria]);
  const passwordsMatch = useMemo(
    () => confirmPassword.length > 0 && password === confirmPassword,
    [password, confirmPassword]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const trimmedFirst = firstName.trim();
    const trimmedLast = lastName.trim();
    const trimmedEmail = email.trim();

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
    if (password !== confirmPassword) {
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
        password,
        firstName: trimmedFirst,
        lastName: trimmedLast,
      });

      // Automatically sign in the user after successful registration
      await login({
        email: trimmedEmail,
        password,
      });

      navigate('/dashboard', { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409) {
          setErrorMessage('An account with this email address already exists. Please sign in or use another email.');
        } else if (err.status === 400 && err.errors && err.errors.length > 0) {
          setErrorMessage(err.errors.map((e) => e.message).join(' '));
        } else {
          setErrorMessage(err.message || 'Registration failed. Please check your information and try again.');
        }
      } else {
        setErrorMessage('Unable to reach the registration service. Please verify your connection.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F7F6F2] flex flex-col justify-between px-4 py-8 sm:px-6 lg:px-8">
      {/* Top minimal bar */}
      <div className="w-full max-w-lg mx-auto flex items-center justify-between mb-4">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm font-medium text-[#3D5265] hover:text-[#172B3A] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#168B83] rounded-md px-1.5 py-1"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          <span>Back to Home</span>
        </Link>
        <span className="text-xs text-[#6B8092] font-mono">CONNECTLY v0.1.0</span>
      </div>

      {/* Main Registration Card */}
      <div className="w-full max-w-lg mx-auto">
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
              Create your account
            </h1>
            <p className="mt-1 text-sm text-[#6B8092]">
              Start crystal-clear, high-capacity meetings in seconds.
            </p>
          </div>

          {/* Feedback Banner */}
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

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {/* Name Fields Row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Input
                  label="First name"
                  id="register-firstname"
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="Sarah"
                  required
                  autoFocus
                  disabled={isSubmitting}
                  leftIcon={<UserIcon className="w-4 h-4" aria-hidden="true" />}
                />
              </div>
              <div>
                <Input
                  label="Last name"
                  id="register-lastname"
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Chen"
                  required
                  disabled={isSubmitting}
                  leftIcon={<UserIcon className="w-4 h-4" aria-hidden="true" />}
                />
              </div>
            </div>

            {/* Email Field */}
            <div>
              <Input
                label="Work or personal email"
                id="register-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="sarah.chen@company.com"
                required
                autoComplete="email"
                disabled={isSubmitting}
                leftIcon={<Mail className="w-4 h-4" aria-hidden="true" />}
              />
            </div>

            {/* Password Field */}
            <div>
              <Input
                label="Password"
                id="register-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Create a strong password"
                required
                autoComplete="new-password"
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

            {/* Real-time Password Criteria Checklist */}
            <div className="p-3.5 bg-[#F7F6F2] rounded-xl border border-[#E3E1D9] text-xs">
              <p className="font-semibold text-[#172B3A] mb-2">Password must contain:</p>
              <ul className="space-y-1.5" aria-label="Password requirements">
                {criteria.map((c) => (
                  <li
                    key={c.id}
                    className={`flex items-center gap-2 transition-colors duration-150 ${
                      c.valid ? 'text-[#168B83] font-medium' : 'text-[#6B8092]'
                    }`}
                  >
                    {c.valid ? (
                      <Check className="w-3.5 h-3.5 flex-shrink-0 text-[#168B83]" aria-hidden="true" />
                    ) : (
                      <span className="w-3.5 h-3.5 flex items-center justify-center flex-shrink-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#A8B2BD]" />
                      </span>
                    )}
                    <span>{c.label}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Confirm Password Field */}
            <div>
              <Input
                label="Confirm password"
                id="register-confirm-password"
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter your password"
                required
                autoComplete="new-password"
                disabled={isSubmitting}
                leftIcon={<Lock className="w-4 h-4" aria-hidden="true" />}
                rightIcon={
                  confirmPassword ? (
                    passwordsMatch ? (
                      <Check className="w-4 h-4 text-[#168B83]" aria-label="Passwords match" />
                    ) : (
                      <X className="w-4 h-4 text-[#D94F4F]" aria-label="Passwords do not match" />
                    )
                  ) : undefined
                }
              />
            </div>

            {/* Terms and Conditions Checkbox */}
            <div className="flex items-start pt-1">
              <input
                id="terms-conditions"
                type="checkbox"
                checked={agreedToTerms}
                onChange={(e) => setAgreedToTerms(e.target.checked)}
                className="w-4 h-4 mt-0.5 text-[#168B83] border-[#E3E1D9] rounded focus:ring-[#168B83] cursor-pointer"
                required
              />
              <label
                htmlFor="terms-conditions"
                className="ml-2.5 block text-xs leading-relaxed text-[#3D5265] select-none cursor-pointer"
              >
                I agree to the{' '}
                <span className="text-[#172B3A] font-semibold underline underline-offset-2">
                  Terms of Service
                </span>{' '}
                and acknowledge the{' '}
                <span className="text-[#172B3A] font-semibold underline underline-offset-2">
                  Privacy Policy
                </span>
                .
              </label>
            </div>

            {/* Submit Button */}
            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="w-full mt-2"
              isLoading={isSubmitting}
              disabled={isSubmitting}
            >
              Create Account
            </Button>
          </form>

          {/* Card Footer Link */}
          <div className="mt-6 pt-6 border-t border-[#E3E1D9] text-center">
            <p className="text-sm text-[#6B8092]">
              Already have an account?{' '}
              <Link
                to="/login"
                className="font-semibold text-[#168B83] hover:text-[#0E5B56] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#168B83] rounded"
              >
                Sign In
              </Link>
            </p>
          </div>
        </div>

        {/* Security badge note */}
        <div className="mt-6 text-center text-xs text-[#6B8092] flex items-center justify-center gap-1.5">
          <Lock className="w-3.5 h-3.5 text-[#168B83]" aria-hidden="true" />
          <span>Encrypted with Argon2id cryptographic parameters & zero plaintext leaks</span>
        </div>
      </div>

      {/* Footer copyright */}
      <div className="text-center py-2 text-xs text-[#6B8092]">
        &copy; {new Date().getFullYear()} CONNECTLY. All rights reserved.
      </div>
    </div>
  );
};

export default RegisterPage;
