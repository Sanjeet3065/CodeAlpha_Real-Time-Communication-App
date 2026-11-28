import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  Eye,
  EyeOff,
  KeyRound,
  Mail,
  User as UserIcon,
} from 'lucide-react';
import { ModalShell } from '@/components/ui/ModalShell';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/context/AuthContext';
import { ApiError, authApi } from '@/services/authApi';
import { AVATAR_ACCENT_OPTIONS, getAvatarAccentClasses } from '@/lib/avatarAccent';
import {
  allPasswordCriteriaMet,
  evaluatePasswordCriteria,
} from '@/components/auth/authShowcaseContent';
import type { AvatarAccentColor } from '@/types/auth';

interface EditProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'profile' | 'security';
}

const COMMON_TIMEZONES = [
  'UTC',
  'Asia/Kolkata',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Dubai',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
];

export const EditProfileModal: React.FC<EditProfileModalProps> = ({
  isOpen,
  onClose,
  initialTab = 'profile',
}) => {
  const { user, updateUser } = useAuth();
  const firstInputRef = useRef<HTMLInputElement>(null);
  const passwordSectionRef = useRef<HTMLInputElement>(null);
  const wasOpenRef = useRef(false);

  const [activeTab, setActiveTab] = useState<'profile' | 'security'>(initialTab);

  // Profile fields
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [bio, setBio] = useState('');
  const [timeZone, setTimeZone] = useState('UTC');
  const [avatarColor, setAvatarColor] = useState<AvatarAccentColor>('sage');
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);

  // Email fields
  const [newEmail, setNewEmail] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [isSavingEmail, setIsSavingEmail] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailSuccess, setEmailSuccess] = useState<string | null>(null);

  // Password fields
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);

  const detectedTz = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      return 'UTC';
    }
  }, []);

  const timeZoneOptions = useMemo(() => {
    const merged = new Set([detectedTz, ...(user?.timeZone ? [user.timeZone] : []), ...COMMON_TIMEZONES]);
    return Array.from(merged);
  }, [detectedTz, user?.timeZone]);

  useEffect(() => {
    if (!isOpen) {
      wasOpenRef.current = false;
      return;
    }

    // Initialize inputs/tabs ONLY on closed -> open transition so saving doesn't reset tabs or feedback
    if (!wasOpenRef.current) {
      wasOpenRef.current = true;
      setActiveTab(initialTab);
      setFirstName(user?.firstName || '');
      setLastName(user?.lastName || '');
      setJobTitle(user?.jobTitle || '');
      setBio(user?.bio || '');
      setTimeZone(user?.timeZone || detectedTz);
      setAvatarColor(user?.avatarColor || 'sage');
      setNewEmail(user?.email || '');
      setEmailPassword('');
      setCurrentPassword('');
      setNewPassword('');
      setShowNewPassword(false);
      setProfileError(null);
      setProfileSuccess(null);
      setEmailError(null);
      setEmailSuccess(null);
      setPasswordError(null);
      setPasswordSuccess(null);
    }
  }, [isOpen, initialTab, user, detectedTz]);

  const hasLocalPassword = user?.hasLocalPassword !== false;
  const criteria = evaluatePasswordCriteria(newPassword);
  const initials = `${(firstName || user?.firstName || 'U')[0] || ''}${(lastName || user?.lastName || '')[0] || ''}`.toUpperCase();

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileError(null);
    setProfileSuccess(null);

    if (!firstName.trim() || !lastName.trim()) {
      setProfileError('First and last name cannot be empty.');
      return;
    }

    try {
      setIsSavingProfile(true);
      const updated = await authApi.updateProfile({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        jobTitle: jobTitle.trim() || null,
        bio: bio.trim() || null,
        timeZone: timeZone || detectedTz,
        avatarColor,
      });
      updateUser(updated);
      setProfileSuccess('Profile saved to your account.');
    } catch (err) {
      setProfileError(err instanceof ApiError ? err.message : 'Could not update profile.');
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleSaveEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailError(null);
    setEmailSuccess(null);

    const normalized = newEmail.trim().toLowerCase();
    if (!normalized) {
      setEmailError('Enter a valid email address.');
      return;
    }
    if (user?.email && normalized === user.email.toLowerCase()) {
      setEmailError('This is already your active email address.');
      return;
    }
    if (!emailPassword) {
      setEmailError('Enter your current password to confirm email changes.');
      return;
    }

    try {
      setIsSavingEmail(true);
      const res = await authApi.updateEmail({
        email: normalized,
        currentPassword: emailPassword,
      });
      updateUser(res.user);
      setEmailPassword('');
      setEmailSuccess('Email address updated.');
    } catch (err) {
      setEmailError(err instanceof ApiError ? err.message : 'Unable to update email address.');
    } finally {
      setIsSavingEmail(false);
    }
  };

  const handleSavePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(null);

    if (hasLocalPassword && !currentPassword) {
      setPasswordError('Enter your current password.');
      return;
    }
    if (!allPasswordCriteriaMet(newPassword)) {
      setPasswordError('New password does not meet all 5 strength requirements.');
      return;
    }

    try {
      setIsSavingPassword(true);
      const res = await authApi.updatePassword({
        ...(hasLocalPassword ? { currentPassword } : {}),
        newPassword,
      });
      updateUser(res.user);
      setCurrentPassword('');
      setNewPassword('');
      setPasswordSuccess(hasLocalPassword ? 'Password updated securely.' : 'Local password created.');
    } catch (err) {
      setPasswordError(err instanceof ApiError ? err.message : 'Unable to update password.');
    } finally {
      setIsSavingPassword(false);
    }
  };

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      title="Edit Profile"
      titleId="edit-profile-modal-title"
      subtitle={user?.email}
      icon={<UserIcon className="w-4 h-4" aria-hidden="true" />}
      size="md"
      closeLabel="Close edit profile modal"
      initialFocusRef={activeTab === 'profile' ? firstInputRef : undefined}
      bodyClassName="p-0 flex flex-col overflow-hidden"
    >
      {/* Switcher Tabs */}
      <div
        role="tablist"
        aria-label="Profile sections"
        className="px-6 pt-3 pb-2 border-b border-[#DDDAD0] dark:border-[#2B3038] flex gap-2 bg-[#FAF9F6] dark:bg-[#1C1F24] shrink-0"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'profile'}
          onClick={() => setActiveTab('profile')}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6F68] dark:focus-visible:ring-[#5FA399] ${
            activeTab === 'profile'
              ? 'bg-[#E2ECE9] dark:bg-[#1F302E] text-[#2F6F68] dark:text-[#5FA399]'
              : 'text-[#646D77] dark:text-[#A3AAB2] hover:bg-[#F3F2EE] dark:hover:bg-[#24282E]'
          }`}
        >
          <UserIcon className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Personal Info</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'security'}
          onClick={() => setActiveTab('security')}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6F68] dark:focus-visible:ring-[#5FA399] ${
            activeTab === 'security'
              ? 'bg-[#E2ECE9] dark:bg-[#1F302E] text-[#2F6F68] dark:text-[#5FA399]'
              : 'text-[#646D77] dark:text-[#A3AAB2] hover:bg-[#F3F2EE] dark:hover:bg-[#24282E]'
          }`}
        >
          <KeyRound className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Email &amp; Password</span>
        </button>
      </div>

      {/* Scrollable Body */}
      <div className="p-6 overflow-y-auto cly-scrollbar flex-1 space-y-5">
        {activeTab === 'profile' ? (
          <form onSubmit={handleSaveProfile} className="space-y-4">
            {/* Avatar Accent Swatches */}
            <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-[#F3F2EE] dark:bg-[#141619] border border-[#DDDAD0] dark:border-[#2B3038]">
              <div className="flex items-center gap-2.5">
                <div
                  className={`w-8 h-8 rounded-full font-bold text-xs flex items-center justify-center shrink-0 ${getAvatarAccentClasses(
                    avatarColor
                  )}`}
                >
                  {initials}
                </div>
                <span className="text-xs font-semibold text-[#1F2428] dark:text-[#EAECEE]">
                  Badge Color
                </span>
              </div>
              <div className="flex items-center gap-2">
                {AVATAR_ACCENT_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setAvatarColor(opt.id)}
                    aria-label={`Select ${opt.label} badge color`}
                    aria-pressed={avatarColor === opt.id}
                    className={`w-6 h-6 rounded-full ${opt.swatchClass} transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6F68] dark:focus-visible:ring-[#5FA399] ${
                      avatarColor === opt.id
                        ? 'ring-2 ring-offset-2 ring-[#2F6F68] dark:ring-[#5FA399] ring-offset-[#F3F2EE] dark:ring-offset-[#141619] scale-110'
                        : 'opacity-75 hover:opacity-100'
                    }`}
                  />
                ))}
              </div>
            </div>

            {/* Name Row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="profile-first-name"
                  className="block text-xs font-semibold text-[#1F2428] dark:text-[#EAECEE] mb-1.5"
                >
                  First Name
                </label>
                <input
                  ref={firstInputRef}
                  id="profile-first-name"
                  type="text"
                  required
                  maxLength={50}
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl bg-[#F3F2EE] dark:bg-[#141619] border border-[#DDDAD0] dark:border-[#2B3038] text-sm text-[#1F2428] dark:text-[#EAECEE] focus:outline-none focus:ring-2 focus:ring-[#2F6F68]/30 dark:focus:ring-[#5FA399]/30 focus:border-[#2F6F68] dark:focus:border-[#5FA399]"
                />
              </div>
              <div>
                <label
                  htmlFor="profile-last-name"
                  className="block text-xs font-semibold text-[#1F2428] dark:text-[#EAECEE] mb-1.5"
                >
                  Last Name
                </label>
                <input
                  id="profile-last-name"
                  type="text"
                  required
                  maxLength={50}
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl bg-[#F3F2EE] dark:bg-[#141619] border border-[#DDDAD0] dark:border-[#2B3038] text-sm text-[#1F2428] dark:text-[#EAECEE] focus:outline-none focus:ring-2 focus:ring-[#2F6F68]/30 dark:focus:ring-[#5FA399]/30 focus:border-[#2F6F68] dark:focus:border-[#5FA399]"
                />
              </div>
            </div>

            {/* Role + Timezone Row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="profile-job-title"
                  className="block text-xs font-semibold text-[#1F2428] dark:text-[#EAECEE] mb-1.5"
                >
                  Role / Title <span className="font-normal text-[#636B74] dark:text-[#8E96A0]">(Optional)</span>
                </label>
                <input
                  id="profile-job-title"
                  type="text"
                  maxLength={80}
                  placeholder="e.g. Product Engineer"
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl bg-[#F3F2EE] dark:bg-[#141619] border border-[#DDDAD0] dark:border-[#2B3038] text-sm text-[#1F2428] dark:text-[#EAECEE] placeholder-[#636B74] dark:placeholder-[#747C86] focus:outline-none focus:ring-2 focus:ring-[#2F6F68]/30 dark:focus:ring-[#5FA399]/30 focus:border-[#2F6F68] dark:focus:border-[#5FA399]"
                />
              </div>
              <div>
                <label
                  htmlFor="profile-timezone"
                  className="block text-xs font-semibold text-[#1F2428] dark:text-[#EAECEE] mb-1.5"
                >
                  Time Zone
                </label>
                <select
                  id="profile-timezone"
                  value={timeZone}
                  onChange={(e) => setTimeZone(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl bg-[#F3F2EE] dark:bg-[#141619] border border-[#DDDAD0] dark:border-[#2B3038] text-xs font-medium text-[#1F2428] dark:text-[#EAECEE] [color-scheme:light] dark:[color-scheme:dark] focus:outline-none focus:ring-2 focus:ring-[#2F6F68]/30 dark:focus:ring-[#5FA399]/30 focus:border-[#2F6F68] dark:focus:border-[#5FA399]"
                >
                  {timeZoneOptions.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Bio */}
            <div>
              <label
                htmlFor="profile-bio"
                className="block text-xs font-semibold text-[#1F2428] dark:text-[#EAECEE] mb-1.5"
              >
                Short Bio <span className="font-normal text-[#636B74] dark:text-[#8E96A0]">(Optional)</span>
              </label>
              <textarea
                id="profile-bio"
                rows={2}
                maxLength={160}
                placeholder="Share your focus area or availability note..."
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-[#F3F2EE] dark:bg-[#141619] border border-[#DDDAD0] dark:border-[#2B3038] text-xs text-[#1F2428] dark:text-[#EAECEE] placeholder-[#636B74] dark:placeholder-[#747C86] focus:outline-none focus:ring-2 focus:ring-[#2F6F68]/30 dark:focus:ring-[#5FA399]/30 focus:border-[#2F6F68] dark:focus:border-[#5FA399]"
              />
            </div>

            {profileError && (
              <div
                role="alert"
                className="p-3 rounded-xl bg-[#F6E6E6] dark:bg-[#2B1B1D] border border-[#C24D4D]/30 dark:border-[#D46A6A]/35 text-xs text-[#C24D4D] dark:text-[#E58484] flex items-start gap-2"
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{profileError}</span>
              </div>
            )}

            {profileSuccess && (
              <div className="p-3 rounded-xl bg-[#E2ECE9] dark:bg-[#1F302E] border border-[#2F6F68]/30 dark:border-[#5FA399]/30 text-xs text-[#2F6F68] dark:text-[#5FA399] font-medium flex items-center gap-2">
                <Check className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>{profileSuccess}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button type="button" variant="outline" size="sm" onClick={onClose}>
                Close
              </Button>
              <Button type="submit" variant="primary" size="sm" disabled={isSavingProfile}>
                {isSavingProfile ? 'Saving...' : 'Save Profile'}
              </Button>
            </div>
          </form>
        ) : (
          <div className="space-y-6">
            {/* Update Email Section */}
            <form
              onSubmit={handleSaveEmail}
              className="p-4 rounded-xl bg-[#F3F2EE] dark:bg-[#141619] border border-[#DDDAD0] dark:border-[#2B3038] space-y-3"
            >
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-[#2F6F68] dark:text-[#5FA399]" aria-hidden="true" />
                <h3 className="text-xs font-bold text-[#1F2428] dark:text-[#EAECEE]">
                  Email Address
                </h3>
              </div>

              {!hasLocalPassword ? (
                <div className="text-xs text-[#555D66] dark:text-[#A3AAB2] space-y-2">
                  <p>
                    Set a local password below before switching your login email so your account stays recoverable.
                  </p>
                  <button
                    type="button"
                    onClick={() => passwordSectionRef.current?.focus()}
                    className="text-[#2F6F68] dark:text-[#5FA399] font-semibold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6F68] dark:focus-visible:ring-[#5FA399] rounded"
                  >
                    Set Password First ↓
                  </button>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label
                        htmlFor="profile-new-email"
                        className="block text-[11px] font-semibold text-[#555D66] dark:text-[#A3AAB2] mb-1"
                      >
                        New Email
                      </label>
                      <input
                        id="profile-new-email"
                        type="email"
                        required
                        maxLength={254}
                        value={newEmail}
                        onChange={(e) => setNewEmail(e.target.value)}
                        className="w-full h-9 px-3 rounded-lg bg-[#FAF9F6] dark:bg-[#1C1F24] border border-[#DDDAD0] dark:border-[#2B3038] text-xs text-[#1F2428] dark:text-[#EAECEE] focus:outline-none focus:ring-2 focus:ring-[#2F6F68]/30 dark:focus:ring-[#5FA399]/30"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="profile-email-password"
                        className="block text-[11px] font-semibold text-[#555D66] dark:text-[#A3AAB2] mb-1"
                      >
                        Current Password
                      </label>
                      <input
                        id="profile-email-password"
                        type="password"
                        required
                        value={emailPassword}
                        onChange={(e) => setEmailPassword(e.target.value)}
                        placeholder="Confirm password"
                        className="w-full h-9 px-3 rounded-lg bg-[#FAF9F6] dark:bg-[#1C1F24] border border-[#DDDAD0] dark:border-[#2B3038] text-xs text-[#1F2428] dark:text-[#EAECEE] focus:outline-none focus:ring-2 focus:ring-[#2F6F68]/30 dark:focus:ring-[#5FA399]/30"
                      />
                    </div>
                  </div>

                  {emailError && (
                    <p role="alert" className="text-[11px] text-[#C24D4D] dark:text-[#E58484] font-medium">
                      {emailError}
                    </p>
                  )}
                  {emailSuccess && (
                    <p className="text-[11px] text-[#2F6F68] dark:text-[#5FA399] font-medium">
                      {emailSuccess}
                    </p>
                  )}

                  <div className="flex justify-end">
                    <Button type="submit" variant="outline" size="sm" disabled={isSavingEmail}>
                      {isSavingEmail ? 'Updating...' : 'Update Email'}
                    </Button>
                  </div>
                </>
              )}
            </form>

            {/* Password Update / Initial Set Section */}
            <form
              onSubmit={handleSavePassword}
              className="p-4 rounded-xl bg-[#F3F2EE] dark:bg-[#141619] border border-[#DDDAD0] dark:border-[#2B3038] space-y-3"
            >
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-[#2F6F68] dark:text-[#5FA399]" aria-hidden="true" />
                <h3 className="text-xs font-bold text-[#1F2428] dark:text-[#EAECEE]">
                  {hasLocalPassword ? 'Change Password' : 'Set Local Password'}
                </h3>
              </div>

              {hasLocalPassword && (
                <div>
                  <label
                    htmlFor="profile-current-password"
                    className="block text-[11px] font-semibold text-[#555D66] dark:text-[#A3AAB2] mb-1"
                  >
                    Current Password
                  </label>
                  <input
                    id="profile-current-password"
                    type="password"
                    required
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Enter current password"
                    className="w-full h-9 px-3 rounded-lg bg-[#FAF9F6] dark:bg-[#1C1F24] border border-[#DDDAD0] dark:border-[#2B3038] text-xs text-[#1F2428] dark:text-[#EAECEE] focus:outline-none focus:ring-2 focus:ring-[#2F6F68]/30 dark:focus:ring-[#5FA399]/30"
                  />
                </div>
              )}

              <div>
                <label
                  htmlFor="profile-new-password"
                  className="block text-[11px] font-semibold text-[#555D66] dark:text-[#A3AAB2] mb-1"
                >
                  New Password
                </label>
                <div className="relative">
                  <input
                    ref={passwordSectionRef}
                    id="profile-new-password"
                    type={showNewPassword ? 'text' : 'password'}
                    required
                    maxLength={128}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Minimum 8 characters"
                    className="w-full h-9 pl-3 pr-9 rounded-lg bg-[#FAF9F6] dark:bg-[#1C1F24] border border-[#DDDAD0] dark:border-[#2B3038] text-xs text-[#1F2428] dark:text-[#EAECEE] focus:outline-none focus:ring-2 focus:ring-[#2F6F68]/30 dark:focus:ring-[#5FA399]/30"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword((prev) => !prev)}
                    aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded text-[#636B74] dark:text-[#A3AAB2] hover:text-[#1F2428] dark:hover:text-[#EAECEE] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6F68] dark:focus-visible:ring-[#5FA399]"
                  >
                    {showNewPassword ? (
                      <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />
                    ) : (
                      <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                    )}
                  </button>
                </div>
              </div>

              {/* Live Password Strength Criteria */}
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {criteria.map((c) => (
                  <span
                    key={c.id}
                    className={`px-2 py-0.5 rounded-md text-[10px] font-medium border ${
                      c.valid
                        ? 'bg-[#E2ECE9] dark:bg-[#1F302E] text-[#2F6F68] dark:text-[#5FA399] border-[#2F6F68]/30 dark:border-[#5FA399]/30'
                        : 'bg-[#FAF9F6] dark:bg-[#1C1F24] text-[#636B74] dark:text-[#8E96A0] border-[#DDDAD0] dark:border-[#2B3038]'
                    }`}
                  >
                    {c.label}
                  </span>
                ))}
              </div>

              {passwordError && (
                <p role="alert" className="text-[11px] text-[#C24D4D] dark:text-[#E58484] font-medium">
                  {passwordError}
                </p>
              )}
              {passwordSuccess && (
                <p className="text-[11px] text-[#2F6F68] dark:text-[#5FA399] font-medium">
                  {passwordSuccess}
                </p>
              )}

              <div className="flex justify-end">
                <Button type="submit" variant="primary" size="sm" disabled={isSavingPassword}>
                  {isSavingPassword
                    ? 'Saving...'
                    : hasLocalPassword
                      ? 'Update Password'
                      : 'Set Password'}
                </Button>
              </div>
            </form>
          </div>
        )}
      </div>
    </ModalShell>
  );
};
