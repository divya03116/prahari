import { useEffect, useRef, useState } from 'react';
import type { ConfirmationResult } from 'firebase/auth';
import { Phone } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { useI18n } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { confirmPhoneCode, resetPhoneVerifier, sendPhoneCode, signInWithApple, signInWithGoogle } from '@/services/auth';
import { GoogleButton } from './GoogleButton';

/**
 * "+91 98765 43210", "098765 43210" or "9876543210" → "+919876543210".
 * Ten digits with no country code are taken as an Indian mobile number.
 */
export function normalisePhone(raw: string): string {
  const s = raw.replace(/[\s()-]/g, '');
  if (s.startsWith('+')) return s;
  const digits = s.replace(/^0+/, '');
  return digits.length === 10 ? `+91${digits}` : `+${digits}`;
}

function AppleButton({ onClick, label }: { onClick: () => Promise<void>; label: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="lg"
      className="w-full"
      loading={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await onClick();
        } finally {
          setBusy(false);
        }
      }}
    >
      {!busy && (
        <svg viewBox="0 0 24 24" aria-hidden className="size-4 fill-current">
          <path d="M16.37 12.73c-.02-2.2 1.8-3.26 1.88-3.31-1.03-1.5-2.62-1.7-3.19-1.72-1.36-.14-2.65.8-3.34.8-.69 0-1.75-.78-2.88-.76-1.48.02-2.85.86-3.61 2.19-1.54 2.67-.39 6.63 1.11 8.8.73 1.06 1.6 2.25 2.74 2.21 1.1-.04 1.51-.71 2.84-.71 1.33 0 1.7.71 2.86.69 1.18-.02 1.93-1.08 2.65-2.14.84-1.23 1.18-2.42 1.2-2.48-.03-.01-2.3-.88-2.32-3.49ZM14.2 6.28c.6-.73 1.01-1.75.9-2.76-.87.04-1.93.58-2.55 1.31-.56.65-1.05 1.69-.92 2.68.97.08 1.96-.49 2.57-1.23Z" />
        </svg>
      )}
      {label}
    </Button>
  );
}

/**
 * The sign-in options besides email and password: Google, Apple and a phone
 * number with an SMS code. All three create the account on first use, so the
 * same block serves sign-in and sign-up.
 */
export function SocialSignIn({
  mode,
  onDone,
  onError,
}: {
  mode: 'signin' | 'signup';
  onDone: () => void;
  onError: (message: string | null) => void;
}) {
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [phone, setPhone] = useState('+91 ');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState<ConfirmationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const captcha = useRef<HTMLDivElement>(null);
  const { t } = useI18n();
  const signup = mode === 'signup';

  useEffect(() => () => resetPhoneVerifier(), []);

  const run = async (fn: () => Promise<unknown>) => {
    onError(null);
    try {
      await fn();
      onDone();
    } catch (err) {
      onError(errorMessage(err));
    }
  };

  const send = async () => {
    onError(null);
    setBusy(true);
    try {
      setSent(await sendPhoneCode(normalisePhone(phone), captcha.current!));
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (!sent) return;
    setBusy(true);
    await run(() => confirmPhoneCode(sent, code.trim()));
    setBusy(false);
  };

  return (
    <div className="flex flex-col gap-2.5">
      <GoogleButton onClick={() => run(signInWithGoogle)} label={t(signup ? 'auth.signUpWith' : 'auth.continueWith', { provider: 'Google' })} />
      <AppleButton onClick={() => run(signInWithApple)} label={t(signup ? 'auth.signUpWith' : 'auth.continueWith', { provider: 'Apple' })} />

      {!phoneOpen ? (
        <Button size="lg" className="w-full" onClick={() => setPhoneOpen(true)}>
          <Phone aria-hidden /> {t(signup ? 'auth.signUpWithPhone' : 'auth.continueWithPhone')}
        </Button>
      ) : (
        <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface-2 p-4">
          {!sent ? (
            <>
              <Field label={t('auth.phoneNumber')} hint={t('auth.phoneHint')}>
                <Input
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  autoFocus
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void send()}
                />
              </Field>
              <Button variant="primary" loading={busy} disabled={phone.replace(/\D/g, '').length < 8} onClick={() => void send()}>
                {t('auth.sendCode')}
              </Button>
            </>
          ) : (
            <>
              <Field label={t('auth.smsCode')} hint={t('auth.sentTo', { phone: normalisePhone(phone) })}>
                <Input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  onKeyDown={(e) => e.key === 'Enter' && code.length === 6 && void verify()}
                />
              </Field>
              <div className="flex gap-2">
                <Button variant="primary" className="flex-1" loading={busy} disabled={code.length !== 6} onClick={() => void verify()}>
                  {t('auth.verifyContinue')}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setSent(null);
                    setCode('');
                    resetPhoneVerifier();
                  }}
                >
                  {t('auth.changeNumber')}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
      {/* The invisible reCAPTCHA that protects SMS sending lives here. */}
      <div ref={captcha} />
    </div>
  );
}
