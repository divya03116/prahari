import { z } from 'zod';

import { translate, type MessageKey, type Vars } from '@/i18n';
import { LIMITS } from '@/shared/constants';

/** A message read when the check fails, so it is in the language chosen at that moment. */
const msg = (key: MessageKey, vars?: Vars) => ({ error: () => translate(key, vars) });

export const emailSchema = z.string().trim().min(1, msg('form.emailRequired')).email(msg('form.emailInvalid'));

export const passwordSchema = z
  .string()
  .min(8, msg('form.passwordMin'))
  .max(128, msg('form.passwordMax'))
  .regex(/[A-Za-z]/, msg('form.passwordLetter'))
  .regex(/[0-9]/, msg('form.passwordNumber'));

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, msg('form.passwordRequired')),
});
export type SignInValues = z.infer<typeof signInSchema>;

export const signUpSchema = z.object({
  name: z.string().trim().min(1, msg('form.nameRequired')).max(LIMITS.nameMax, msg('form.nameMax', { max: LIMITS.nameMax })),
  email: emailSchema,
  password: passwordSchema,
});
export type SignUpValues = z.infer<typeof signUpSchema>;

export const resetSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { ...msg('form.passwordsDiffer'), path: ['confirm'] });
export type ResetValues = z.infer<typeof resetSchema>;
