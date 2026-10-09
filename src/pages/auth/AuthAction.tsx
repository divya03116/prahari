/**
 * Handler for the links in Firebase Auth emails (verify email, reset
 * password, recover email). Point the email templates' action URL at
 * https://<your-domain>/auth/action in the Firebase console to use it.
 */

import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, XCircle } from 'lucide-react';

import { useAuth } from '@/auth/AuthProvider';
import { PasswordInput } from '@/components/PasswordInput';
import { Button, buttonClass } from '@/components/ui/button';
import { Alert, Spinner } from '@/components/ui/feedback';
import { Field } from '@/components/ui/field';
import { translate, useI18n } from '@/i18n';
import { AuthLayout } from '@/layouts/AuthLayout';
import { errorMessage } from '@/lib/errors';
import { applyCode, confirmReset, inspectActionCode, verifyResetCode } from '@/services/auth';
import { resetSchema, type ResetValues } from './forms';

type State =
  | { kind: 'working' }
  | { kind: 'done'; title: string; body: string }
  | { kind: 'reset'; email: string }
  | { kind: 'failed'; message: string };

export default function AuthAction() {
  const [params] = useSearchParams();
  const mode = params.get('mode');
  const code = params.get('oobCode') ?? '';
  const [state, setState] = useState<State>({ kind: 'working' });
  const { user, refresh } = useAuth();
  const { t } = useI18n();
  const started = useRef(false);

  useEffect(() => {
    // Action codes are single-use: StrictMode's double effect must not apply one twice.
    if (started.current) return;
    started.current = true;
    (async () => {
      if (!code) throw Object.assign(new Error('missing'), { code: 'auth/invalid-action-code' });
      switch (mode) {
        case 'verifyEmail':
          await applyCode(code);
          setState({ kind: 'done', title: translate('link.verified.title'), body: translate('link.verified.body') });
          return;
        case 'resetPassword': {
          const email = await verifyResetCode(code);
          setState({ kind: 'reset', email });
          return;
        }
        case 'recoverEmail': {
          const info = await inspectActionCode(code);
          await applyCode(code);
          setState({
            kind: 'done',
            title: translate('link.restored.title'),
            body: translate('link.restored.body', { email: info.data.email ?? translate('link.restored.fallback') }),
          });
          return;
        }
        default:
          setState({ kind: 'failed', message: translate('link.unknown') });
      }
    })().catch((err) => setState({ kind: 'failed', message: errorMessage(err) }));
  }, [mode, code]);

  // A signed-in user who just verified needs a fresh token carrying email_verified.
  useEffect(() => {
    if (state.kind === 'done' && mode === 'verifyEmail' && user) void refresh().catch(() => undefined);
  }, [state.kind, mode, user, refresh]);

  if (state.kind === 'working') {
    return (
      <AuthLayout title={t('link.wait')}>
        <div className="flex items-center gap-3 text-sm text-fg-muted">
          <Spinner /> {t('link.checking')}
        </div>
      </AuthLayout>
    );
  }

  if (state.kind === 'reset') return <ResetForm code={code} email={state.email} />;

  if (state.kind === 'failed') {
    return (
      <AuthLayout title={t('link.unusable')}>
        <div className="flex gap-3 rounded-md border border-critical-line bg-critical-soft p-4">
          <XCircle className="mt-0.5 size-5 shrink-0 text-critical" aria-hidden />
          <p className="text-sm text-fg-muted">{state.message}</p>
        </div>
        <div className="mt-6 flex gap-2">
          <Link to="/signin" className={buttonClass({ variant: 'primary' })}>
            {t('auth.signIn')}
          </Link>
          <Link to="/forgot-password" className={buttonClass()}>
            {t('link.newReset')}
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={state.title}>
      <div className="flex gap-3 rounded-md border border-success-line bg-success-soft p-4">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
        <p className="text-sm text-fg-muted">{state.body}</p>
      </div>
      <Link to={user ? '/app' : '/signin?verified=1'} className={buttonClass({ variant: 'primary', size: 'lg', className: 'mt-6 w-full' })}>
        {user ? t('link.continue') : t('auth.signIn')}
      </Link>
    </AuthLayout>
  );
}

function ResetForm({ code, email }: { code: string; email: string }) {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetValues>({ resolver: zodResolver(resetSchema), defaultValues: { password: '', confirm: '' } });

  const onSubmit = handleSubmit(async ({ password }) => {
    setError(null);
    try {
      await confirmReset(code, password);
      navigate('/signin?reset=1', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  return (
    <AuthLayout title={t('link.reset.title')} description={t('link.reset.for', { email })}>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {error && <Alert tone="critical">{error}</Alert>}
        <Field label={t('link.newPassword')} error={errors.password?.message} hint={t('auth.passwordHint')}>
          <PasswordInput autoComplete="new-password" autoFocus {...register('password')} />
        </Field>
        <Field label={t('link.confirmPassword')} error={errors.confirm?.message}>
          <PasswordInput autoComplete="new-password" {...register('confirm')} />
        </Field>
        <Button type="submit" variant="primary" size="lg" loading={isSubmitting} className="w-full">
          {t('link.updatePassword')}
        </Button>
      </form>
    </AuthLayout>
  );
}
