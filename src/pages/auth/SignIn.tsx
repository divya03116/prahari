import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { PasswordInput } from '@/components/PasswordInput';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { Field, Input } from '@/components/ui/field';
import { AuthLayout } from '@/layouts/AuthLayout';
import { errorMessage } from '@/lib/errors';
import { safeRedirect } from '@/lib/redirect';
import { signIn } from '@/services/auth';
import { SocialSignIn } from './SocialSignIn';
import { signInSchema, type SignInValues } from './forms';

export default function SignIn() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
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
      title="Sign in to PRAHARI"
      description="Use the account your organisation registered you with."
      aside={
        <>
          New here?{' '}
          <Link to="/signup" className="font-medium text-fg hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {params.get('verified') && (
          <Alert tone="success" title="Email verified">
            Sign in to continue.
          </Alert>
        )}
        {params.get('reset') && (
          <Alert tone="success" title="Password updated">
            Sign in with your new password.
          </Alert>
        )}
        {error && <Alert tone="critical">{error}</Alert>}

        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <Field label="Email" error={errors.email?.message}>
            <Input type="email" autoComplete="email" autoFocus className="h-9" {...register('email')} />
          </Field>
          <Field
            label="Password"
            error={errors.password?.message}
            aside={
              <Link to="/forgot-password" className="text-xs text-fg-muted hover:text-fg">
                Forgot password?
              </Link>
            }
          >
            <PasswordInput autoComplete="current-password" {...register('password')} />
          </Field>
          <Button type="submit" variant="primary" size="lg" loading={isSubmitting} className="mt-1 w-full">
            Sign in
          </Button>
        </form>

        <div className="flex items-center gap-3 text-xs text-fg-subtle">
          <span className="h-px flex-1 bg-border" />
          or
          <span className="h-px flex-1 bg-border" />
        </div>
        <SocialSignIn mode="signin" onDone={() => navigate(next, { replace: true })} onError={setError} />
      </div>
    </AuthLayout>
  );
}
