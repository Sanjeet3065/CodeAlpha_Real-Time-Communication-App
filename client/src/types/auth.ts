export type AvatarAccentColor = 'sage' | 'slate' | 'amber' | 'rose' | 'indigo';

export interface IUserPreferences {
  defaultAudioMuted: boolean;
  defaultVideoOff: boolean;
  enableVirtualBackground: boolean;
  theme: string;
  notificationSounds: boolean;
}

export interface User {
  id: string;
  name?: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string | null;
  avatarColor?: AvatarAccentColor;
  jobTitle?: string | null;
  bio?: string | null;
  timeZone?: string | null;
  hasLocalPassword?: boolean;
  preferences?: IUserPreferences;
  createdAt?: string;
  isEmailVerified?: boolean;
}

export interface UpdateProfileData {
  firstName?: string;
  lastName?: string;
  jobTitle?: string | null;
  bio?: string | null;
  timeZone?: string | null;
  avatarColor?: AvatarAccentColor;
}

export interface UpdateEmailData {
  email: string;
  currentPassword?: string;
}

export interface UpdatePasswordData {
  currentPassword?: string;
  newPassword: string;
}

export interface AuthResponse {
  success: boolean;
  message?: string;
  user: User;
  accessToken: string;
}

export interface RegisterData {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

export interface LoginData {
  email: string;
  password: string;
}

export interface GoogleAuthData {
  code: string;
  redirectUri?: string;
}

export interface GoogleAuthConfigResponse {
  enabled: boolean;
  clientId: string | null;
}

export interface ApiProblemDetails {
  status: number;
  code: string;
  message: string;
  errors?: Array<{ field: string; message: string }>;
  timestamp: string;
}
