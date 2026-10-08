import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { PasswordInput } from '@/components/PasswordInput';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { Field, Input } from '@/components/ui/field';
import { useI18n } from '@/i18n';
import { AuthLayout } from '@/layouts/AuthLayout';
import { errorMessage } from '@/lib/errors';
import { safeRedirect } from '@/lib/redirect';
import { signIn } from '@/services/auth';
import { SocialSignIn } from './SocialSignIn';
import { signInSchema, type SignInValues } from './forms';

export default function SignIn() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const next = safeRedirect(params.get('next'));

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignInValues>({ resolver: zodResolver(signInSchema), defaultValues: { email: '', password: '' } });

  const onSubmit = handleSubmit(async ({ email, password }) => {
    setError(null);
    try {
      const user = await signIn(email, password);
      navigate(user.emailVerified ? next : '/verify-email', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  return (
    <AuthLayout
      title={t('auth.signIn.title')}
      description={t('auth.signIn.description')}
      aside={
        <>
          {t('auth.newHere')}{' '}
          <Link to="/signup" className="font-medium text-fg hover:underline">
            {t('auth.createAnAccount')}
          </Link>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {params.get('verified') && (
          <Alert tone="success" title={t('auth.emailVerified')}>
            {t('auth.signInToContinue')}
          </Alert>
        )}
        {params.get('reset') && (
          <Alert tone="success" title={t('auth.passwordUpdated')}>
            {t('auth.signInNewPassword')}
          </Alert>
        )}
        {error && <Alert tone="critical">{error}</Alert>}

        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <Field label={t('auth.email')} error={errors.email?.message}>
            <Input type="email" autoComplete="email" autoFocus className="h-9" {...register('email')} />
          </Field>
          <Field
            label={t('auth.password')}
            error={errors.password?.message}
            aside={
              <Link to="/forgot-password" className="text-xs text-fg-muted hover:text-fg">
                {t('auth.forgot')}
              </Link>
            }
          >
            <PasswordInput autoComplete="current-password" {...register('password')} />
          </Field>
          <Button type="submit" variant="primary" size="lg" loading={isSubmitting} className="mt-1 w-full">
            {t('auth.signIn')}
          </Button>
        </form>

        <div className="flex items-center gap-3 text-xs text-fg-subtle">
          <span className="h-px flex-1 bg-border" />
          {t('common.or')}
          <span className="h-px flex-1 bg-border" />
        </div>
        <SocialSignIn mode="signin" onDone={() => navigate(next, { replace: true })} onError={setError} />
      </div>
    </AuthLayout>
  );
}
