import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

import { useAuth, useDisplayName } from '@/auth/AuthProvider';
import { RoleBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/misc';
import { DataRow, Panel, PanelBody, PanelFooter, PanelHeader } from '@/components/ui/panel';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { useReference } from '@/hooks/reference';
import { useI18n } from '@/i18n';
import { InstallApp } from '@/pwa/InstallApp';
import { roleDescriptionKey } from '@/i18n/labels';
import { errorMessage } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import { requestPasswordReset, updateDisplayName } from '@/services/auth';
import { api } from '@/services/callables';
import { firebase } from '@/lib/firebase';
import { profileSchema, type ProfileInput } from '@/shared/schemas';

export default function Settings() {
  const { user, role, profile, signOut } = useAuth();
  const { t } = useI18n();
  // First-time setup of a fresh project: /app/settings?setup=admin
  const [params] = useSearchParams();
  const setup = params.get('setup') === 'admin' && role !== 'admin';
  const [claiming, setClaiming] = useState(false);
  const claimAdmin = async () => {
    setClaiming(true);
    try {
      await api.claimFirstAdmin();
      await firebase.auth.currentUser?.getIdToken(true);
      toast.success(t('settings.nowAdmin'));
      window.location.assign('/app');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setClaiming(false);
    }
  };
  const { installationName } = useReference();
  const name = useDisplayName();
  const navigate = useNavigate();
  const [sending, setSending] = useState(false);
  const passwordAccount = user?.providerData.some((p) => p.providerId === 'password');

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<ProfileInput>({ resolver: zodResolver(profileSchema), defaultValues: { displayName: name } });

  useEffect(() => reset({ displayName: name }), [name, reset]);

  const save = handleSubmit(async ({ displayName }) => {
    if (!user) return;
    try {
      await updateDisplayName(user, displayName);
      toast.success(t('settings.nameUpdated'));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  });

  const sendReset = async () => {
    if (!user?.email) return;
    setSending(true);
    try {
      await requestPasswordReset(user.email);
      toast.success(t('settings.resetSent'), { description: t('settings.checkAddress', { email: user.email }) });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <PageHeader title={t('settings.title')} description={t('settings.description')} />
      {setup && (
        <Panel className="mb-5">
          <PanelHeader
            title={t('settings.firstSetup')}
            description={t('settings.firstSetupDescription')}
          />
          <PanelFooter>
            <Button variant="primary" loading={claiming} onClick={() => void claimAdmin()}>
              {t('settings.becomeAdmin')}
            </Button>
          </PanelFooter>
        </Panel>
      )}

      <div className="flex max-w-2xl flex-col gap-6">
        <Panel>
          <form onSubmit={save} noValidate>
            <PanelHeader title={t('settings.profile')} description={t('settings.profileDescription')} />
            <PanelBody className="flex flex-col gap-4">
              <Field label={t('settings.displayName')} error={errors.displayName?.message}>
                <Input autoComplete="name" {...register('displayName')} />
              </Field>
              {user?.email || !user?.phoneNumber ? (
                <Field label={t('auth.email')} hint={t('settings.emailHint')}>
                  <Input value={user?.email ?? ''} readOnly className="opacity-70" />
                </Field>
              ) : (
                <Field label={t('settings.phone')} hint={t('settings.phoneHint')}>
                  <Input value={user.phoneNumber} readOnly className="opacity-70" />
                </Field>
              )}
            </PanelBody>
            <PanelFooter>
              <Button type="submit" variant="primary" size="sm" loading={isSubmitting} disabled={!isDirty}>
                {t('common.save')}
              </Button>
            </PanelFooter>
          </form>
        </Panel>

        <Panel>
          <PanelHeader title={t('settings.language')} description={t('settings.languageDescription')} />
          <PanelBody>
            <LanguageSwitcher />
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader title={t('settings.app')} description={t('settings.appDescription')} />
          <PanelBody>
            <InstallApp />
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader title={t('settings.access')} description={t('settings.accessDescription')} />
          <PanelBody className="py-1">
            <dl className="divide-y divide-border">
              <DataRow label={t('settings.role')}>
                <RoleBadge role={role} />
              </DataRow>
              <DataRow label={t('settings.whatItAllows')}>
                <span className="text-fg-muted">{t(roleDescriptionKey(role))}</span>
              </DataRow>
              <DataRow label={t('settings.installation')}>{profile?.installationId ? installationName(profile.installationId) : t('common.notAssigned')}</DataRow>
              <DataRow label={t('settings.memberSince')}>{formatDateTime(profile?.createdAt)}</DataRow>
            </dl>
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader title={t('settings.security')} />
          <PanelBody className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-fg">{t('auth.password')}</p>
              <p className="text-sm text-fg-subtle">
                {passwordAccount ? t('settings.passwordEmailLink') : t('settings.passwordGoogle')}
              </p>
            </div>
            {passwordAccount && (
              <Button size="sm" onClick={() => void sendReset()} loading={sending}>
                {t('auth.sendResetLink')}
              </Button>
            )}
          </PanelBody>
          <PanelBody className="flex flex-col gap-4 border-t border-border sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-fg">{t('nav.signOut')}</p>
              <p className="text-sm text-fg-subtle">{t('settings.signOutDescription')}</p>
            </div>
            <Button
              size="sm"
              variant="danger"
              onClick={async () => {
                await signOut();
                navigate('/signin', { replace: true });
              }}
            >
              {t('nav.signOut')}
            </Button>
          </PanelBody>
        </Panel>
      </div>
    </>
  );
}
