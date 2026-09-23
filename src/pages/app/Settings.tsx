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
import { useReference } from '@/hooks/reference';
import { errorMessage } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import { requestPasswordReset, updateDisplayName } from '@/services/auth';
import { api } from '@/services/callables';
import { firebase } from '@/lib/firebase';
import { ROLE_DESCRIPTION } from '@/shared/constants';
import { profileSchema, type ProfileInput } from '@/shared/schemas';

export default function Settings() {
  const { user, role, profile, signOut } = useAuth();
  // First-time setup of a fresh project: /app/settings?setup=admin
  const [params] = useSearchParams();
  const setup = params.get('setup') === 'admin' && role !== 'admin';
  const [claiming, setClaiming] = useState(false);
  const claimAdmin = async () => {
    setClaiming(true);
    try {
      await api.claimFirstAdmin();
      await firebase.auth.currentUser?.getIdToken(true);
      toast.success('You are now the administrator');
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
      toast.success('Name updated');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  });

  const sendReset = async () => {
    if (!user?.email) return;
    setSending(true);
    try {
      await requestPasswordReset(user.email);
      toast.success('Password reset link sent', { description: `Check ${user.email}.` });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <PageHeader title="Settings" description="Your profile and account." />
      {setup && (
        <Panel className="mb-5">
          <PanelHeader
            title="First-time setup"
            description="A new PRAHARI project has no administrator yet. The address configured at deployment can claim that role once."
          />
          <PanelFooter>
            <Button variant="primary" loading={claiming} onClick={() => void claimAdmin()}>
              Become the first administrator
            </Button>
          </PanelFooter>
        </Panel>
      )}

      <div className="flex max-w-2xl flex-col gap-6">
        <Panel>
          <form onSubmit={save} noValidate>
            <PanelHeader title="Profile" description="Your name appears on verdicts and actions you record. It is never attached to reports you file." />
            <PanelBody className="flex flex-col gap-4">
              <Field label="Display name" error={errors.displayName?.message}>
                <Input autoComplete="name" {...register('displayName')} />
              </Field>
              {user?.email || !user?.phoneNumber ? (
                <Field label="Email" hint="Your sign-in address. Contact an administrator to change it.">
                  <Input value={user?.email ?? ''} readOnly className="opacity-70" />
                </Field>
              ) : (
                <Field label="Phone" hint="You sign in with this number and an SMS code.">
                  <Input value={user.phoneNumber} readOnly className="opacity-70" />
                </Field>
              )}
            </PanelBody>
            <PanelFooter>
              <Button type="submit" variant="primary" size="sm" loading={isSubmitting} disabled={!isDirty}>
                Save
              </Button>
            </PanelFooter>
          </form>
        </Panel>

        <Panel>
          <PanelHeader title="Access" description="Roles are assigned by an administrator." />
          <PanelBody className="py-1">
            <dl className="divide-y divide-border">
              <DataRow label="Role">
                <RoleBadge role={role} />
              </DataRow>
              <DataRow label="What it allows">
                <span className="text-fg-muted">{ROLE_DESCRIPTION[role]}</span>
              </DataRow>
              <DataRow label="Installation">{profile?.installationId ? installationName(profile.installationId) : 'Not assigned'}</DataRow>
              <DataRow label="Member since">{formatDateTime(profile?.createdAt)}</DataRow>
            </dl>
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader title="Security" />
          <PanelBody className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-fg">Password</p>
              <p className="text-sm text-fg-subtle">
                {passwordAccount ? 'We email you a link to choose a new password.' : 'You sign in with Google; manage your password there.'}
              </p>
            </div>
            {passwordAccount && (
              <Button size="sm" onClick={() => void sendReset()} loading={sending}>
                Send reset link
              </Button>
            )}
          </PanelBody>
          <PanelBody className="flex flex-col gap-4 border-t border-border sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-fg">Sign out</p>
              <p className="text-sm text-fg-subtle">End your session on this device.</p>
            </div>
            <Button
              size="sm"
              variant="danger"
              onClick={async () => {
                await signOut();
                navigate('/signin', { replace: true });
              }}
            >
              Sign out
            </Button>
          </PanelBody>
        </Panel>
      </div>
    </>
  );
}
