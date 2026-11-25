import { z } from 'zod';

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
    },
    {
      error:
        'Forbidden property in payload: Mass assignment of security or unauthorized fields is rejected.',
    }
  )
  .refine((data) => data.firstName !== undefined || data.lastName !== undefined, {
    message: 'At least one profile field (firstName or lastName) must be provided for an update.',
  });

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

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
