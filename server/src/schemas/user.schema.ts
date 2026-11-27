import { z } from 'zod';
import { passwordCriteriaRegex } from './auth.schema.js';
import { isValidIanaTimeZone } from '../utils/timezone.js';

export const AVATAR_ACCENT_COLORS = ['sage', 'slate', 'amber', 'rose', 'indigo'] as const;

export const updateProfileSchema = z
  .strictObject(
    {
      firstName: z
        .string({ error: 'First name must be a string' })
        .trim()
        .min(1, 'First name cannot be empty')
        .max(50, 'First name cannot exceed 50 characters')
        .optional(),
      lastName: z
        .string({ error: 'Last name must be a string' })
        .trim()
        .min(1, 'Last name cannot be empty')
        .max(50, 'Last name cannot exceed 50 characters')
        .optional(),
      jobTitle: z
        .union([
          z
            .string({ error: 'Job title must be a string' })
            .trim()
            .max(80, 'Job title cannot exceed 80 characters'),
          z.null(),
        ])
        .optional(),
      bio: z
        .union([
          z
            .string({ error: 'Bio must be a string' })
            .trim()
            .max(160, 'Bio cannot exceed 160 characters'),
          z.null(),
        ])
        .optional(),
      timeZone: z
        .union([
          z
            .string({ error: 'Time zone must be a string' })
            .trim()
            .min(1, 'Time zone cannot be empty')
            .max(64, 'Time zone cannot exceed 64 characters')
            .refine((tz) => isValidIanaTimeZone(tz), {
              message: 'Please choose a valid IANA time zone (e.g. Asia/Kolkata or UTC).',
            }),
          z.null(),
        ])
        .optional(),
      avatarColor: z
        .enum(AVATAR_ACCENT_COLORS, {
          error: 'Avatar accent must be one of sage, slate, amber, rose, or indigo.',
        })
        .optional(),
    },
    {
      error:
        'Forbidden property in payload: Mass assignment of security or unauthorized fields is rejected.',
    }
  )
  .refine(
    (data) =>
      data.firstName !== undefined ||
      data.lastName !== undefined ||
      data.jobTitle !== undefined ||
      data.bio !== undefined ||
      data.timeZone !== undefined ||
      data.avatarColor !== undefined,
    {
      message: 'At least one allowed profile field must be provided for an update.',
    }
  );

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const updateEmailSchema = z.strictObject(
  {
    email: z
      .string({ error: 'Email address must be a string' })
      .trim()
      .max(254, 'Email cannot exceed 254 characters')
      .email('Please enter a valid email address'),
    currentPassword: z
      .string({ error: 'Current password must be a string' })
      .min(1, 'Current password is required')
      .max(128, 'Password cannot exceed 128 characters')
      .optional(),
  },
  {
    error: 'Forbidden property in email update payload.',
  }
);

export type UpdateEmailInput = z.infer<typeof updateEmailSchema>;

export const updatePasswordSchema = z.strictObject(
  {
    currentPassword: z
      .string({ error: 'Current password must be a string' })
      .max(128, 'Password cannot exceed 128 characters')
      .optional(),
    newPassword: z
      .string({ error: 'New password must be a string' })
      .min(8, 'Password must be at least 8 characters')
      .max(128, 'Password cannot exceed 128 characters')
      .refine((val) => passwordCriteriaRegex.uppercase.test(val), {
        message: 'Password must contain at least one uppercase letter',
      })
      .refine((val) => passwordCriteriaRegex.lowercase.test(val), {
        message: 'Password must contain at least one lowercase letter',
      })
      .refine((val) => passwordCriteriaRegex.number.test(val), {
        message: 'Password must contain at least one number',
      })
      .refine((val) => passwordCriteriaRegex.symbol.test(val), {
        message: 'Password must contain at least one special character/symbol',
      }),
  },
  {
    error: 'Forbidden property in password update payload.',
  }
);

export type UpdatePasswordInput = z.infer<typeof updatePasswordSchema>;

// Upper bound for valid Unix epoch millisecond timestamps (Year 2100-01-01T00:00:00.000Z)
export const MAX_VALID_CLIENT_TIMESTAMP = 4_102_444_800_000;

export const updatePreferencesSchema = z
  .strictObject(
    {
      defaultAudioMuted: z
        .boolean({
          error: 'defaultAudioMuted must be a boolean value',
        })
        .optional(),
      defaultVideoOff: z
        .boolean({
          error: 'defaultVideoOff must be a boolean value',
        })
        .optional(),
      clientTimestamp: z
        .number({
          error: 'clientTimestamp must be a finite non-negative integer',
        })
        .finite('clientTimestamp must be a finite number')
        .int('clientTimestamp must be an integer')
        .nonnegative('clientTimestamp must be non-negative')
        .max(MAX_VALID_CLIENT_TIMESTAMP, 'clientTimestamp exceeds maximum permitted timestamp range')
        .optional(),
      clientSessionId: z
        .string({
          error: 'clientSessionId must be a string',
        })
        .trim()
        .min(1, 'clientSessionId cannot be empty')
        .max(64, 'clientSessionId cannot exceed 64 characters')
        .regex(/^[a-zA-Z0-9_-]+$/, 'clientSessionId contains invalid characters')
        .optional(),
      expectedVersion: z
        .number({
          error: 'expectedVersion must be a positive integer',
        })
        .finite('expectedVersion must be a finite number')
        .int('expectedVersion must be an integer')
        .positive('expectedVersion must be positive')
        .max(Number.MAX_SAFE_INTEGER, 'expectedVersion exceeds safe integer range')
        .optional(),
      expectedFieldVersions: z
        .strictObject(
          {
            defaultAudioMuted: z
              .number({ error: 'expectedFieldVersions.defaultAudioMuted must be a non-negative integer' })
              .finite('expectedFieldVersions.defaultAudioMuted must be finite')
              .int('expectedFieldVersions.defaultAudioMuted must be an integer')
              .nonnegative('expectedFieldVersions.defaultAudioMuted must be non-negative')
              .max(Number.MAX_SAFE_INTEGER)
              .optional(),
            defaultVideoOff: z
              .number({ error: 'expectedFieldVersions.defaultVideoOff must be a non-negative integer' })
              .finite('expectedFieldVersions.defaultVideoOff must be finite')
              .int('expectedFieldVersions.defaultVideoOff must be an integer')
              .nonnegative('expectedFieldVersions.defaultVideoOff must be non-negative')
              .max(Number.MAX_SAFE_INTEGER)
              .optional(),
          },
          {
            error:
              'Forbidden property in expectedFieldVersions: Only defaultAudioMuted and defaultVideoOff are permitted.',
          }
        )
        .optional(),
    },
    {
      error:
        'Forbidden property in preferences payload: Only defaultAudioMuted, defaultVideoOff, clientTimestamp, clientSessionId, expectedVersion, and expectedFieldVersions are permitted.',
    }
  )
  .refine(
    (data) => data.defaultAudioMuted !== undefined || data.defaultVideoOff !== undefined,
    {
      message:
        'At least one preference setting (defaultAudioMuted or defaultVideoOff) must be provided.',
    }
  );

export type UpdatePreferencesInput = z.infer<typeof updatePreferencesSchema>;
