import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { MailCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { Field, Input } from '@/components/ui/field';
import { AuthLayout } from '@/layouts/AuthLayout';
import { errorMessage } from '@/lib/errors';
import { requestPasswordReset } from '@/services/auth';
import { emailSchema } from './forms';

const schema = z.object({ email: emailSchema });

export default function ForgotPassword() {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<{ email: string }>({ resolver: zodResolver(schema), defaultValues: { email: '' } });

  const onSubmit = handleSubmit(async ({ email }) => {
    setError(null);
    try {
      await requestPasswordReset(email);
      setSentTo(email);
    } catch (err) {
      // Never reveal whether an address has an account.
      if ((err as { code?: string }).code === 'auth/user-not-found') setSentTo(email);
      else setError(errorMessage(err));
    }
  });

  if (sentTo) {
    return (
      <AuthLayout title="Check your email" footer={<Link to="/signin" className="font-medium text-fg hover:underline">Back to sign in</Link>}>
        <div className="flex gap-3 rounded-md border border-border bg-surface p-4">
          <MailCheck className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
          <p className="text-sm text-fg-muted">
            If an account exists for <span className="font-medium text-fg">{sentTo}</span>, a link to reset the password
            is on its way. It expires in one hour.
          </p>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Reset your password"
      description="Enter the email address on your account and we will send you a reset link."
      footer={
        <Link to="/signin" className="font-medium text-fg hover:underline">
          Back to sign in
        </Link>
      }
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {error && <Alert tone="critical">{error}</Alert>}
        <Field label="Email" error={errors.email?.message}>
          <Input type="email" autoComplete="email" autoFocus className="h-9" {...register('email')} />
        </Field>
        <Button type="submit" variant="primary" size="lg" loading={isSubmitting} className="w-full">
          Send reset link
        </Button>
      </form>
    </AuthLayout>
  );
}
