import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { MailCheck } from 'lucide-react';
import { toast } from 'sonner';

import { FullPageSpinner } from '@/auth/guards';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { rich, useI18n } from '@/i18n';
import { AuthLayout } from '@/layouts/AuthLayout';
import { errorMessage } from '@/lib/errors';
import { usingEmulators } from '@/lib/firebase';
import { resendVerification } from '@/services/auth';

const COOLDOWN = 60;

export default function VerifyEmail() {
  const { status, user, verified, refresh, signOut } = useAuth();
  const navigate = useNavigate();
  const { t } = useI18n();
  const [cooldown, setCooldown] = useState(0);
  const [checking, setChecking] = useState(false);
  const [sending, setSending] = useState(false);
  const [notYet, setNotYet] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  // Verified in another tab or on a phone? Notice without a click.
  useEffect(() => {
    if (!user || verified) return;
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh().catch(() => undefined);
    }, 5000);
    return () => clearInterval(t);
  }, [user, verified, refresh]);

  if (status === 'loading') return <FullPageSpinner />;
  if (!user) return <Navigate to="/signin" replace />;
  if (verified) return <Navigate to="/app" replace />;

  const resend = async () => {
    setSending(true);
    try {
      await resendVerification(user);
      setCooldown(COOLDOWN);
      toast.success(t('auth.verify.emailSent'));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  const check = async () => {
    setChecking(true);
    setNotYet(false);
    try {
      await refresh();
      if (user.emailVerified) navigate('/app', { replace: true });
      else setNotYet(true);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setChecking(false);
    }
  };

  return (
    <AuthLayout
      title={t('auth.verify.title')}
      footer={
        <button type="button" className="cursor-pointer text-fg-muted hover:text-fg" onClick={() => void signOut()}>
          {t('auth.useDifferentAccount')}
        </button>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex gap-3 rounded-md border border-border bg-surface p-4">
          <MailCheck className="mt-0.5 size-5 shrink-0 text-signal" aria-hidden />
          <p className="text-sm text-fg-muted">
            {rich(t('auth.verify.sent'), { email: <span className="font-medium text-fg">{user.email}</span> })}
          </p>
        </div>
        {notYet && <Alert tone="warning">{t('auth.verify.notYet')}</Alert>}
        {usingEmulators && (
          <Alert tone="info" title={t('auth.verify.localTitle')}>
            {t('auth.verify.localBody')}
          </Alert>
        )}
        <Button variant="primary" size="lg" className="w-full" loading={checking} onClick={check}>
          {t('auth.verify.done')}
        </Button>
        <Button size="lg" className="w-full" onClick={resend} loading={sending} disabled={cooldown > 0}>
          {cooldown > 0 ? t('auth.verify.sendAgainIn', { seconds: cooldown }) : t('auth.verify.sendAgain')}
        </Button>
      </div>
    </AuthLayout>
  );
}
