import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate } from 'react-router-dom';

import { PasswordInput } from '@/components/PasswordInput';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { Field, Input } from '@/components/ui/field';
import { useI18n } from '@/i18n';
import { AuthLayout } from '@/layouts/AuthLayout';
import { errorMessage } from '@/lib/errors';
import { signUp } from '@/services/auth';
import { SocialSignIn } from './SocialSignIn';
import { signUpSchema, type SignUpValues } from './forms';

export default function SignUp() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignUpValues>({ resolver: zodResolver(signUpSchema), defaultValues: { name: '', email: '', password: '' } });

  const onSubmit = handleSubmit(async ({ name, email, password }) => {
    setError(null);
    try {
      await signUp(name, email, password);
      navigate('/verify-email', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    }
  });


  return (
    <AuthLayout
      title={t('auth.signUp.title')}
      description={t('auth.signUp.description')}
      aside={
        <>
          {t('auth.haveAccount')}{' '}
          <Link to="/signin" className="font-medium text-fg hover:underline">
            {t('auth.signIn')}
          </Link>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <Alert tone="critical">{error}</Alert>}
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <Field label={t('auth.fullName')} error={errors.name?.message}>
            <Input autoComplete="name" autoFocus className="h-9" {...register('name')} />
          </Field>
          <Field label={t('auth.workEmail')} error={errors.email?.message}>
            <Input type="email" autoComplete="email" className="h-9" {...register('email')} />
          </Field>
          <Field label={t('auth.password')} error={errors.password?.message} hint={t('auth.passwordHint')}>
            <PasswordInput autoComplete="new-password" {...register('password')} />
          </Field>
          <Button type="submit" variant="primary" size="lg" loading={isSubmitting} className="mt-1 w-full">
            {t('auth.createAccount')}
          </Button>
        </form>
        <div className="flex items-center gap-3 text-xs text-fg-subtle">
          <span className="h-px flex-1 bg-border" />
          {t('common.or')}
          <span className="h-px flex-1 bg-border" />
        </div>
        <SocialSignIn mode="signup" onDone={() => navigate('/app', { replace: true })} onError={setError} />
        <p className="text-xs text-fg-subtle">
          {t('auth.signUp.note')}
        </p>
      </div>
    </AuthLayout>
  );
}
