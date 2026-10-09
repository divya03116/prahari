import { useEffect, useState } from 'react';
import { Ban, Building2, CheckCircle2, MoreHorizontal, Search, ShieldCheck, Trash2, Users as UsersIcon } from 'lucide-react';
import { toast } from 'sonner';

import { useAuth } from '@/auth/AuthProvider';
import { Badge, RoleBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Modal } from '@/components/ui/dialog';
import { Alert, EmptyState, ErrorState, SkeletonRows } from '@/components/ui/feedback';
import { Field, Input, Select } from '@/components/ui/field';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/menu';
import { Avatar, PageHeader } from '@/components/ui/misc';
import { Panel } from '@/components/ui/panel';
import { Pagination, Table, TD, TH, THead, TR } from '@/components/ui/table';
import { useDebounced, usePager } from '@/hooks/data';
import { useReference } from '@/hooks/reference';
import { useI18n } from '@/i18n';
import { roleDescriptionKey, roleKey } from '@/i18n/labels';
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/errors';
import { formatRelative } from '@/lib/format';
import { api } from '@/services/callables';
import { listUsers } from '@/services/directory';
import { LIMITS, ROLES, type Role } from '@/shared/constants';
import type { UserDoc, WithId } from '@/shared/types';

type Dialog =
  | { kind: 'role'; user: WithId<UserDoc> }
  | { kind: 'installation'; user: WithId<UserDoc> }
  | { kind: 'disable'; user: WithId<UserDoc> }
  | { kind: 'delete'; user: WithId<UserDoc> }
  | null;

function RoleDialog({ user, onClose, onDone }: { user: WithId<UserDoc>; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [role, setRole] = useState<Role>(user.role);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.setUserRole(user.id, role);
      toast.success(t('users.roleNow', { name: user.displayName, role: t(roleKey(role)) }));
      onDone();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onOpenChange={(o) => !o && !busy && onClose()}
      title={t('users.changeRole')}
      description={`${user.displayName} · ${user.email}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={() => void save()} loading={busy} disabled={role === user.role}>
            {t('users.saveRole')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {error && <Alert tone="critical">{error}</Alert>}
        <div role="radiogroup" aria-label={t('settings.role')} className="flex flex-col gap-1.5">
          {ROLES.map((r) => (
            <label
              key={r}
              className={cn(
                'flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2.5 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-signal',
                role === r ? 'border-fg/40 bg-surface-3' : 'border-border hover:bg-surface-2',
              )}
            >
              <input type="radio" name="role" checked={role === r} onChange={() => setRole(r)} className="mt-1 accent-[var(--color-signal)]" />
              <span>
                <span className="block text-sm font-medium text-fg">{t(roleKey(r))}</span>
                <span className="block text-xs text-fg-subtle">{t(roleDescriptionKey(r))}</span>
              </span>
            </label>
          ))}
        </div>
        <p className="text-xs text-fg-subtle">
          {t('users.roleNote')}
        </p>
      </div>
    </Modal>
  );
}

function InstallationDialog({ user, onClose, onDone }: { user: WithId<UserDoc>; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const { installations } = useReference();
  const [value, setValue] = useState(user.installationId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.setUserInstallation(user.id, value || null);
      toast.success(t('users.installationUpdated'));
      onDone();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onOpenChange={(o) => !o && !busy && onClose()}
      title={t('users.assignInstallation')}
      description={t('users.assignDesc')}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={() => void save()} loading={busy} disabled={value === (user.installationId ?? '')}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {error && <Alert tone="critical">{error}</Alert>}
        <Field label={t('reports.installation')}>
          <Select value={value} onChange={(e) => setValue(e.target.value)}>
            <option value="">{t('users.none')}</option>
            {installations.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
                {i.active ? '' : ` ${t('users.inactive')}`}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}

export default function Users() {
  const { user: me } = useAuth();
  const { t } = useI18n();
  const { installationName } = useReference();
  const [role, setRole] = useState<Role | ''>('');
  const [searchInput, setSearchInput] = useState('');
  const search = useDebounced(searchInput, 350);
  const [dialog, setDialog] = useState<Dialog>(null);

  const filters = { role: role || null, search };
  const pager = usePager<UserDoc>((after) => listUsers(filters, LIMITS.pageSize, after), JSON.stringify(filters));

  useEffect(() => setDialog(null), [search, role]);

  const close = () => setDialog(null);

  return (
    <>
      <PageHeader
        title={t('nav.users')}
        description={t('users.description')}
      />

      <Panel>
        <div className="flex flex-col gap-2 border-b border-border p-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
            <Input
              type="search"
              aria-label={t('users.search')}
              placeholder={t('users.searchPlaceholder')}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-8"
            />
          </div>
          <Select aria-label={t('settings.role')} value={role} onChange={(e) => setRole(e.target.value as Role | '')} className="sm:w-52">
            <option value="">{t('users.allRoles')}</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {t(roleKey(r))}
              </option>
            ))}
          </Select>
        </div>

        {pager.error ? (
          <ErrorState message={pager.error} onRetry={pager.reload} />
        ) : pager.loading && !pager.items.length ? (
          <SkeletonRows rows={6} />
        ) : !pager.items.length ? (
          <EmptyState icon={<UsersIcon />} title={t('users.noMatch')} description={search ? t('users.searchHint') : undefined} />
        ) : (
          <div className={pager.loading ? 'opacity-60 transition-opacity' : undefined}>
            <Table>
              <THead>
                <tr>
                  <TH>{t('users.col.user')}</TH>
                  <TH>{t('settings.role')}</TH>
                  <TH className="hidden md:table-cell">{t('reports.installation')}</TH>
                  <TH className="hidden sm:table-cell">{t('action.status')}</TH>
                  <TH className="hidden lg:table-cell">{t('users.col.lastSeen')}</TH>
                  <TH className="w-12">
                    <span className="sr-only">{t('users.manage')}</span>
                  </TH>
                </tr>
              </THead>
              <tbody>
                {pager.items.map((u) => {
                  const self = u.id === me?.uid;
                  return (
                    <TR key={u.id}>
                      <TD className="max-w-0 min-w-56">
                        <div className="flex items-center gap-2.5">
                          <Avatar name={u.displayName} />
                          <div className="min-w-0">
                            <p className="truncate text-fg">
                              {u.displayName} {self && <span className="text-xs text-fg-subtle">{t('users.you')}</span>}
                            </p>
                            <p className="truncate text-xs text-fg-subtle">{u.email}</p>
                          </div>
                        </div>
                      </TD>
                      <TD>
                        <RoleBadge role={u.role} />
                      </TD>
                      <TD className="hidden whitespace-nowrap md:table-cell">
                        {u.installationId ? installationName(u.installationId) : <span className="text-fg-subtle">—</span>}
                      </TD>
                      <TD className="hidden sm:table-cell">
                        {u.disabled ? <Badge tone="critical">{t('users.disabled')}</Badge> : <Badge tone="success" dot>{t('users.active')}</Badge>}
                      </TD>
                      <TD className="hidden whitespace-nowrap lg:table-cell">{formatRelative(u.lastSeenAt)}</TD>
                      <TD className="text-right">
                        <Menu>
                          <MenuTrigger asChild>
                            <Button size="icon-sm" variant="ghost" aria-label={t('users.manageItem', { name: u.displayName })} disabled={self}>
                              <MoreHorizontal aria-hidden />
                            </Button>
                          </MenuTrigger>
                          <MenuContent>
                            <MenuItem icon={<ShieldCheck />} onSelect={() => setDialog({ kind: 'role', user: u })}>
                              {t('users.changeRole')}
                            </MenuItem>
                            <MenuItem icon={<Building2 />} onSelect={() => setDialog({ kind: 'installation', user: u })}>
                              {t('users.assignInstallation')}
                            </MenuItem>
                            <MenuItem
                              icon={u.disabled ? <CheckCircle2 /> : <Ban />}
                              onSelect={() => setDialog({ kind: 'disable', user: u })}
                            >
                              {u.disabled ? t('users.enable') : t('users.disable')}
                            </MenuItem>
                            <MenuSeparator />
                            <MenuItem icon={<Trash2 />} danger onSelect={() => setDialog({ kind: 'delete', user: u })}>
                              {t('users.delete')}
                            </MenuItem>
                          </MenuContent>
                        </Menu>
                      </TD>
                    </TR>
                  );
                })}
              </tbody>
            </Table>
          </div>
        )}
        {(pager.items.length > 0 || pager.page > 1) && (
          <Pagination page={pager.page} hasNext={pager.hasNext} onPrev={pager.prev} onNext={pager.next} loading={pager.loading} />
        )}
      </Panel>

      {dialog?.kind === 'role' && <RoleDialog user={dialog.user} onClose={close} onDone={pager.reload} />}
      {dialog?.kind === 'installation' && <InstallationDialog user={dialog.user} onClose={close} onDone={pager.reload} />}
      <ConfirmDialog
        open={dialog?.kind === 'disable'}
        onOpenChange={(o) => !o && close()}
        title={dialog?.kind === 'disable' && dialog.user.disabled ? t('users.enable.title') : t('users.disable.title')}
        description={
          dialog?.kind === 'disable'
            ? dialog.user.disabled
              ? t('users.enable.desc', { name: dialog.user.displayName })
              : t('users.disable.desc', { name: dialog.user.displayName })
            : ''
        }
        variant={dialog?.kind === 'disable' && dialog.user.disabled ? 'primary' : 'danger'}
        confirmLabel={dialog?.kind === 'disable' && dialog.user.disabled ? t('users.enable.confirm') : t('users.disable.confirm')}
        onConfirm={async () => {
          if (dialog?.kind !== 'disable') return;
          await api.setUserDisabled(dialog.user.id, !dialog.user.disabled);
          toast.success(dialog.user.disabled ? t('users.enabledToast') : t('users.disabledToast'));
          pager.reload();
        }}
      />
      <ConfirmDialog
        open={dialog?.kind === 'delete'}
        onOpenChange={(o) => !o && close()}
        title={t('users.delete.title')}
        description={
          dialog?.kind === 'delete'
            ? t('users.delete.desc', { email: dialog.user.email })
            : ''
        }
        confirmLabel={t('users.delete')}
        onConfirm={async () => {
          if (dialog?.kind !== 'delete') return;
          await api.deleteUser(dialog.user.id);
          toast.success(t('users.deletedToast'));
          pager.reload();
        }}
      />
    </>
  );
}
