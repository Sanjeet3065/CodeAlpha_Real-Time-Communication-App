import { z } from 'zod';

export const ALLOWED_REACTIONS = ['👍', '❤️', '👏', '🎉', '😂', '😮', '🔥', '🚀'] as const;
export type AllowedReaction = (typeof ALLOWED_REACTIONS)[number];

export const sendChatMessageSchema = z.strictObject(
  {
    content: z
      .string({ error: 'Message content must be a string' })
      .trim()
      .min(1, 'Message cannot be empty')
      .max(1000, 'Message cannot exceed 1000 characters'),
    clientMessageId: z
      .string({ error: 'clientMessageId must be a string' })
      .trim()
      .min(1)
      .max(100)
      .optional(),
  },
  {
    error: 'Unknown property in chat message payload.',
  }
);

export type SendChatMessageInput = z.infer<typeof sendChatMessageSchema>;

export const getChatHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.string().trim().optional(),
  beforeId: z.string().trim().optional(),
});

export type GetChatHistoryQuery = z.infer<typeof getChatHistoryQuerySchema>;

export const sendReactionSchema = z.strictObject(
  {
    emoji: z
      .string({ error: 'Emoji must be a string' })
      .trim()
      .min(1, 'Emoji cannot be empty')
      .max(16, 'Emoji too long')
      .refine(
        (val) => (ALLOWED_REACTIONS as readonly string[]).includes(val),
        { message: 'Invalid or unsupported emoji reaction.' }
      ),
    clientReactionId: z
      .string({ error: 'clientReactionId must be a string' })
      .trim()
      .min(1, 'clientReactionId cannot be empty')
      .max(100, 'clientReactionId cannot exceed 100 characters'),
  },
  {
    error: 'Unknown property in reaction payload.',
  }
);

export type SendReactionInput = z.infer<typeof sendReactionSchema>;
