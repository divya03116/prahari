import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { MailCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { Field, Input } from '@/components/ui/field';
import { rich, useI18n } from '@/i18n';
import { AuthLayout } from '@/layouts/AuthLayout';
import { errorMessage } from '@/lib/errors';
import { requestPasswordReset } from '@/services/auth';
import { emailSchema } from './forms';

const schema = z.object({ email: emailSchema });

export default function ForgotPassword() {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { t } = useI18n();
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
      <AuthLayout title={t('auth.checkEmail')} footer={<Link to="/signin" className="font-medium text-fg hover:underline">{t('auth.backToSignIn')}</Link>}>
        <div className="flex gap-3 rounded-md border border-border bg-surface p-4">
          <MailCheck className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
          <p className="text-sm text-fg-muted">
            {rich(t('auth.resetSent'), { email: <span className="font-medium text-fg">{sentTo}</span> })}
          </p>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title={t('auth.reset.title')}
      description={t('auth.reset.description')}
      footer={
        <Link to="/signin" className="font-medium text-fg hover:underline">
          {t('auth.backToSignIn')}
        </Link>
      }
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {error && <Alert tone="critical">{error}</Alert>}
        <Field label={t('auth.email')} error={errors.email?.message}>
          <Input type="email" autoComplete="email" autoFocus className="h-9" {...register('email')} />
        </Field>
        <Button type="submit" variant="primary" size="lg" loading={isSubmitting} className="w-full">
          {t('auth.sendResetLink')}
        </Button>
      </form>
    </AuthLayout>
  );
}
