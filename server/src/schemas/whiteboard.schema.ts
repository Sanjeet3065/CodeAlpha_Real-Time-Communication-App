import { z } from 'zod';

export const WHITEBOARD_ELEMENT_TYPES = [
  'pen',
  'highlighter',
  'rect',
  'circle',
  'line',
  'arrow',
  'text',
] as const;

export const whiteboardPointSchema = z.object({
  x: z.number().min(-100000).max(100000),
  y: z.number().min(-100000).max(100000),
});

export const whiteboardElementInputSchema = z.object({
  id: z.string().min(1).max(128),
  type: z.enum(WHITEBOARD_ELEMENT_TYPES),
  points: z.array(whiteboardPointSchema).max(2000).optional(),
  x: z.number().min(-100000).max(100000).default(0),
  y: z.number().min(-100000).max(100000).default(0),
  width: z.number().min(0).max(200000).optional(),
  height: z.number().min(0).max(200000).optional(),
  x2: z.number().min(-100000).max(100000).optional(),
  y2: z.number().min(-100000).max(100000).optional(),
  text: z.string().max(1000).optional(),
  fontSize: z.number().min(8).max(128).default(16),
  strokeColor: z
    .string()
    .min(1)
    .max(50)
    .regex(/^(#[0-9a-fA-F]{3,8}|rgba?\(.+\)|[a-zA-Z]+)$/, 'Invalid color string')
    .default('#172B3A'),
  fillColor: z
    .string()
    .max(50)
    .regex(/^(#[0-9a-fA-F]{3,8}|rgba?\(.+\)|[a-zA-Z]+)$/, 'Invalid color string')
    .optional(),
  strokeWidth: z.number().min(1).max(50).default(3),
  opacity: z.number().min(0).max(1).default(1),
  zIndex: z.number().int().min(0).max(1000000).default(0),
});

export const whiteboardOperationInputSchema = z.object({
  operationId: z.string().min(1).max(128),
  type: z.enum(['add', 'update', 'delete']),
  elementId: z.string().min(1).max(128),
  element: whiteboardElementInputSchema.partial().optional(),
});

export const submitWhiteboardOperationsSchema = z.object({
  operations: z.array(whiteboardOperationInputSchema).min(1).max(50),
});

export type SubmitWhiteboardOperationsInput = z.infer<typeof submitWhiteboardOperationsSchema>;
export type WhiteboardOperationInput = z.infer<typeof whiteboardOperationInputSchema>;
export type WhiteboardElementInput = z.infer<typeof whiteboardElementInputSchema>;

export const cursorUpdateSchema = z.object({
  x: z.number().min(-100000).max(100000),
  y: z.number().min(-100000).max(100000),
  tool: z.string().max(32).optional(),
});

export type CursorUpdateInput = z.infer<typeof cursorUpdateSchema>;
