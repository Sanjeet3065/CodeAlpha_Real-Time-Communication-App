import { z } from 'zod';

export const passwordCriteriaRegex = {
  uppercase: /[A-Z]/,
  lowercase: /[a-z]/,
  number: /[0-9]/,
  symbol: /[^A-Za-z0-9]/,
};

export const registerSchema = z.object({
  email: z
    .string()
    .trim()
    .max(254, 'Email cannot exceed 254 characters')
    .email('Please enter a valid email address'),
  password: z
    .string()
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
  firstName: z.string().trim().min(1, 'First name is required').max(50, 'First name cannot exceed 50 characters'),
  lastName: z.string().trim().min(1, 'Last name is required').max(50, 'Last name cannot exceed 50 characters'),
});

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .max(254, 'Email cannot exceed 254 characters')
    .email('Please enter a valid email address'),
  password: z
    .string()
    .min(1, 'Password is required')
    .max(128, 'Password cannot exceed 128 characters'),
});

export const googleAuthSchema = z.object({
  code: z.string().trim().min(1, 'Authorization code is required').max(4096),
  redirectUri: z.string().trim().min(1).max(512).optional().default('postmessage'),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type GoogleAuthInput = z.infer<typeof googleAuthSchema>;
