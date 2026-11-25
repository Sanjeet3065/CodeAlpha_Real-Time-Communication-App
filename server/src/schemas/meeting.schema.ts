import { z } from 'zod';
import { isValidIanaTimeZone } from '../utils/timezone.js';

export const createMeetingSchema = z.strictObject(
  {
    title: z
      .string({ error: 'Meeting title must be a string' })
      .trim()
      .min(1, 'Meeting title cannot be empty')
      .max(120, 'Meeting title cannot exceed 120 characters')
      .optional(),
    maxParticipants: z
      .number({ error: 'maxParticipants must be a number' })
      .int('maxParticipants must be an integer')
      .min(2, 'Meeting must allow at least 2 participants')
      .max(60, 'Meeting capacity cannot exceed 60 participants')
      .optional(),
    settings: z
      .strictObject(
        {
          waitingRoomEnabled: z.boolean().optional(),
          allowCoHostAdmit: z.boolean().optional(),
          allowCoHostRemove: z.boolean().optional(),
          allowCoHostLock: z.boolean().optional(),
        },
        { error: 'Unknown meeting setting provided.' }
      )
      .optional(),
  },
  {
    error: 'Forbidden property in meeting creation payload.',
  }
);

export type CreateMeetingInput = z.infer<typeof createMeetingSchema>;

export const joinMeetingSchema = z.strictObject(
  {
    displayName: z
      .string({ error: 'Display name must be a string' })
      .trim()
      .min(1, 'Display name cannot be empty')
      .max(100, 'Display name cannot exceed 100 characters')
      .optional(),
  },
  {
    error: 'Forbidden property in join payload.',
  }
);

export type JoinMeetingInput = z.infer<typeof joinMeetingSchema>;

export const updateRoleSchema = z.strictObject(
  {
    role: z.enum(['co-host', 'participant'], {
      error: "Role must be either 'co-host' or 'participant'.",
    }),
  },
  {
    error: 'Forbidden property in role update payload.',
  }
);

export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;

export const rejectWaitingSchema = z.strictObject(
  {
    reason: z
      .string({ error: 'Reason must be a string' })
      .trim()
      .max(200, 'Reason cannot exceed 200 characters')
      .optional(),
  },
  {
    error: 'Forbidden property in rejection payload.',
  }
);

export type RejectWaitingInput = z.infer<typeof rejectWaitingSchema>;

export const removeParticipantSchema = z.strictObject(
  {
    reason: z
      .string({ error: 'Reason must be a string' })
      .trim()
      .max(200, 'Reason cannot exceed 200 characters')
      .optional(),
  },
  {
    error: 'Forbidden property in removal payload.',
  }
);

export type RemoveParticipantInput = z.infer<typeof removeParticipantSchema>;

export const updateMeetingSettingsSchema = z
  .strictObject(
    {
      title: z
        .string({ error: 'Meeting title must be a string' })
        .trim()
        .min(1, 'Meeting title cannot be empty')
        .max(120, 'Meeting title cannot exceed 120 characters')
        .optional(),
      waitingRoomEnabled: z.boolean().optional(),
      allowCoHostAdmit: z.boolean().optional(),
      allowCoHostRemove: z.boolean().optional(),
      allowCoHostLock: z.boolean().optional(),
    },
    {
      error: 'Forbidden property in meeting settings payload.',
    }
  )
  .refine(
    (data) =>
      data.title !== undefined ||
      data.waitingRoomEnabled !== undefined ||
      data.allowCoHostAdmit !== undefined ||
      data.allowCoHostRemove !== undefined ||
      data.allowCoHostLock !== undefined,
    {
      message: 'At least one meeting setting must be provided.',
    }
  );

export type UpdateMeetingSettingsInput = z.infer<typeof updateMeetingSettingsSchema>;

/**
 * Phase 09 — LiveKit token request body MUST be empty.
 * Rejects any client-supplied identity, roomName, role, or permission escalation fields.
 */
export const livekitTokenRequestSchema = z.strictObject(
  {},
  {
    error:
      'LiveKit token requests do not accept client-supplied room, identity, role, or permission fields.',
  }
);

export type LiveKitTokenRequestInput = z.infer<typeof livekitTokenRequestSchema>;

/* =========================================================================
 * Phase 16 — Scheduling & Meeting History Schemas
 * ========================================================================= */

const inviteeSchema = z.strictObject({
  email: z.string().trim().email('Invalid invitee email address').toLowerCase(),
  name: z.string().trim().max(100, 'Invitee name cannot exceed 100 characters').optional(),
});

export const scheduleMeetingSchema = z
  .strictObject(
    {
      title: z
        .string({ error: 'Meeting title must be a string' })
        .trim()
        .min(1, 'Meeting title cannot be empty')
        .max(120, 'Meeting title cannot exceed 120 characters')
        .default('Scheduled Meeting'),
      description: z
        .string({ error: 'Description must be a string' })
        .trim()
        .max(500, 'Description cannot exceed 500 characters')
        .optional()
        .nullable(),
      scheduledStartAt: z
        .string({ error: 'scheduledStartAt must be an ISO date-time string' })
        .refine((val) => !isNaN(Date.parse(val)), {
          message: 'scheduledStartAt must be a valid ISO 8601 date-time string.',
        })
        .refine((val) => Date.parse(val) >= Date.now() - 60_000, {
          message: 'Meeting cannot be scheduled in the past.',
        }),
      durationMinutes: z
        .number({ error: 'durationMinutes must be a number' })
        .int('durationMinutes must be an integer')
        .min(15, 'Meeting duration must be at least 15 minutes')
        .max(1440, 'Meeting duration cannot exceed 1440 minutes (24 hours)')
        .default(60),
      scheduledTimeZone: z
        .string({ error: 'scheduledTimeZone must be a valid IANA time zone identifier' })
        .trim()
        .refine(isValidIanaTimeZone, {
          message: 'Invalid or unsupported IANA time zone identifier (e.g. Asia/Kolkata, UTC, America/New_York).',
        })
        .default('UTC'),
      invitees: z
        .array(inviteeSchema, { error: 'invitees must be an array of { email, name? }' })
        .max(50, 'Cannot exceed 50 invitees per meeting')
        .optional()
        .default([]),
      reminderPreferences: z
        .array(
          z
            .number()
            .int('Reminder minutes must be an integer')
            .positive('Reminder minutes must be positive'),
          { error: 'reminderPreferences must be an array of minute offsets' }
        )
        .max(5, 'Cannot exceed 5 reminder triggers')
        .optional()
        .default([15, 60]),
      settings: z
        .strictObject(
          {
            waitingRoomEnabled: z.boolean().optional(),
            allowCoHostAdmit: z.boolean().optional(),
            allowCoHostRemove: z.boolean().optional(),
            allowCoHostLock: z.boolean().optional(),
          },
          { error: 'Unknown meeting setting provided.' }
        )
        .optional(),
    },
    {
      error: 'Forbidden property in schedule meeting payload.',
    }
  );

export type ScheduleMeetingInput = z.infer<typeof scheduleMeetingSchema>;

export const updateScheduledMeetingSchema = z
  .strictObject(
    {
      title: z
        .string({ error: 'Meeting title must be a string' })
        .trim()
        .min(1, 'Meeting title cannot be empty')
        .max(120, 'Meeting title cannot exceed 120 characters')
        .optional(),
      description: z
        .string({ error: 'Description must be a string' })
        .trim()
        .max(500, 'Description cannot exceed 500 characters')
        .optional()
        .nullable(),
      invitees: z
        .array(inviteeSchema, { error: 'invitees must be an array of { email, name? }' })
        .max(50, 'Cannot exceed 50 invitees per meeting')
        .optional(),
      reminderPreferences: z
        .array(
          z
            .number()
            .int('Reminder minutes must be an integer')
            .positive('Reminder minutes must be positive'),
          { error: 'reminderPreferences must be an array of minute offsets' }
        )
        .max(5, 'Cannot exceed 5 reminder triggers')
        .optional(),
      settings: z
        .strictObject(
          {
            waitingRoomEnabled: z.boolean().optional(),
            allowCoHostAdmit: z.boolean().optional(),
            allowCoHostRemove: z.boolean().optional(),
            allowCoHostLock: z.boolean().optional(),
          },
          { error: 'Unknown meeting setting provided.' }
        )
        .optional(),
    },
    {
      error: 'Forbidden property in update scheduled meeting payload.',
    }
  )
  .refine(
    (data) =>
      data.title !== undefined ||
      data.description !== undefined ||
      data.invitees !== undefined ||
      data.reminderPreferences !== undefined ||
      data.settings !== undefined,
    {
      message: 'At least one field must be provided to update the scheduled meeting.',
    }
  );

export type UpdateScheduledMeetingInput = z.infer<typeof updateScheduledMeetingSchema>;

export const rescheduleMeetingSchema = z
  .strictObject(
    {
      scheduledStartAt: z
        .string({ error: 'scheduledStartAt must be an ISO date-time string' })
        .refine((val) => !isNaN(Date.parse(val)), {
          message: 'scheduledStartAt must be a valid ISO 8601 date-time string.',
        })
        .refine((val) => Date.parse(val) >= Date.now() - 60_000, {
          message: 'Rescheduled meeting cannot be set in the past.',
        }),
      durationMinutes: z
        .number({ error: 'durationMinutes must be a number' })
        .int('durationMinutes must be an integer')
        .min(15, 'Meeting duration must be at least 15 minutes')
        .max(1440, 'Meeting duration cannot exceed 1440 minutes')
        .optional(),
      scheduledTimeZone: z
        .string({ error: 'scheduledTimeZone must be a valid IANA time zone identifier' })
        .trim()
        .refine(isValidIanaTimeZone, {
          message: 'Invalid or unsupported IANA time zone identifier.',
        })
        .optional(),
    },
    {
      error: 'Forbidden property in reschedule payload.',
    }
  );

export type RescheduleMeetingInput = z.infer<typeof rescheduleMeetingSchema>;

export const cancelMeetingSchema = z.strictObject(
  {
    reason: z
      .string({ error: 'Cancellation reason must be a string' })
      .trim()
      .max(240, 'Cancellation reason cannot exceed 240 characters')
      .optional()
      .nullable(),
  },
  {
    error: 'Forbidden property in cancel meeting payload.',
  }
);

export type CancelMeetingInput = z.infer<typeof cancelMeetingSchema>;

export const listScheduledMeetingsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  from: z
    .string()
    .optional()
    .refine((val) => !val || !isNaN(Date.parse(val)), {
      message: 'from parameter must be a valid ISO date-time string.',
    }),
  to: z
    .string()
    .optional()
    .refine((val) => !val || !isNaN(Date.parse(val)), {
      message: 'to parameter must be a valid ISO date-time string.',
    }),
});

export type ListScheduledMeetingsQuery = z.infer<typeof listScheduledMeetingsQuerySchema>;

export const meetingHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  role: z.enum(['all', 'host', 'participant']).default('all'),
  status: z.enum(['all', 'ENDED', 'CANCELLED', 'ACTIVE']).default('all'),
  search: z.string().trim().max(100).optional(),
  from: z
    .string()
    .optional()
    .refine((val) => !val || !isNaN(Date.parse(val)), {
      message: 'from parameter must be a valid ISO date-time string.',
    }),
  to: z
    .string()
    .optional()
    .refine((val) => !val || !isNaN(Date.parse(val)), {
      message: 'to parameter must be a valid ISO date-time string.',
    }),
  sort: z.enum(['desc', 'asc']).default('desc'),
});

export type MeetingHistoryQuery = z.infer<typeof meetingHistoryQuerySchema>;

