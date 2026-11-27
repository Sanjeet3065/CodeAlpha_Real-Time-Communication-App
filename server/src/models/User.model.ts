import mongoose, { Schema, Document, Model } from 'mongoose';
import { hashBearerToken } from '../utils/tokenHash.js';

export interface IUserPreferences {
  defaultAudioMuted: boolean;
  defaultVideoOff: boolean;
  enableVirtualBackground: boolean;
  theme: string;
  notificationSounds: boolean;
}

export type AvatarAccentColor = 'sage' | 'slate' | 'amber' | 'rose' | 'indigo';

export interface IUser extends Document {
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string;
  avatarColor?: AvatarAccentColor;
  jobTitle?: string | null;
  bio?: string | null;
  timeZone?: string | null;
  googleSub?: string | null;
  hasLocalPassword?: boolean;
  role?: 'user' | 'admin';
  isEmailVerified: boolean;
  emailVerificationToken?: string;
  passwordResetToken?: string;
  passwordResetExpires?: Date;
  failedLoginAttempts: number;
  lockoutUntil?: Date | null;
  preferences: IUserPreferences;
  preferencesVersion?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserModel extends Model<IUser> {
  findByHashedToken(
    field: 'emailVerificationToken' | 'passwordResetToken',
    rawToken: string
  ): Promise<IUser | null>;
}

const UserPreferencesSchema = new Schema<IUserPreferences>(
  {
    defaultAudioMuted: { type: Boolean, default: true },
    defaultVideoOff: { type: Boolean, default: false },
    enableVirtualBackground: { type: Boolean, default: false },
    theme: { type: String, default: 'editorial-light' },
    notificationSounds: { type: Boolean, default: true },
  },
  { _id: false }
);

const UserSchema = new Schema<IUser>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    firstName: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 50,
    },
    lastName: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 50,
    },
    avatarUrl: {
      type: String,
      default: null,
    },
    avatarColor: {
      type: String,
      enum: ['sage', 'slate', 'amber', 'rose', 'indigo'],
      default: 'sage',
    },
    jobTitle: {
      type: String,
      trim: true,
      maxlength: 80,
      default: null,
    },
    bio: {
      type: String,
      trim: true,
      maxlength: 160,
      default: null,
    },
    timeZone: {
      type: String,
      trim: true,
      maxlength: 64,
      default: null,
    },
    googleSub: {
      type: String,
      trim: true,
      default: null,
    },
    hasLocalPassword: {
      type: Boolean,
      default: true,
    },
    role: {
      type: String,
      enum: ['user', 'admin'],
      default: 'user',
    },
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    emailVerificationToken: {
      type: String,
      default: null,
    },
    passwordResetToken: {
      type: String,
      default: null,
    },
    passwordResetExpires: {
      type: Date,
      default: null,
    },
    failedLoginAttempts: {
      type: Number,
      default: 0,
    },
    lockoutUntil: {
      type: Date,
      default: null,
    },
    preferences: {
      type: UserPreferencesSchema,
      default: () => ({
        defaultAudioMuted: true,
        defaultVideoOff: false,
        enableVirtualBackground: false,
        theme: 'editorial-light',
        notificationSounds: true,
      }),
    },
    preferencesVersion: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

UserSchema.index({ passwordResetToken: 1 }, { sparse: true });
UserSchema.index({ googleSub: 1 }, { sparse: true });
UserSchema.index({ createdAt: -1 });

// Phase 15: DEF-15-01 - Bearer Token Hashing Support (SHA-256)
// Safely queries bearer tokens matching either the SHA-256 hash or legacy unhashed token
UserSchema.statics.findByHashedToken = async function (
  field: 'emailVerificationToken' | 'passwordResetToken',
  rawToken: string
) {
  if (!rawToken || typeof rawToken !== 'string') return null;
  const hashed = hashBearerToken(rawToken);
  return this.findOne({
    $or: [{ [field]: hashed }, { [field]: rawToken.trim() }],
  });
};

export const User: UserModel =
  (mongoose.models.User as UserModel) || mongoose.model<IUser, UserModel>('User', UserSchema);
