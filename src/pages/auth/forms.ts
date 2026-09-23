import { z } from 'zod';

import { LIMITS } from '@/shared/constants';

export const emailSchema = z.string().trim().min(1, 'Email is required').email('Enter a valid email address');

export const passwordSchema = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(128, 'Use at most 128 characters')
  .regex(/[A-Za-z]/, 'Include at least one letter')
  .regex(/[0-9]/, 'Include at least one number');

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required'),
});
export type SignInValues = z.infer<typeof signInSchema>;

export const signUpSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(LIMITS.nameMax, `At most ${LIMITS.nameMax} characters`),
  email: emailSchema,
  password: passwordSchema,
});
export type SignUpValues = z.infer<typeof signUpSchema>;

export const resetSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { message: 'Passwords do not match', path: ['confirm'] });
export type ResetValues = z.infer<typeof resetSchema>;
