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
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/errors';
import { formatRelative } from '@/lib/format';
import { api } from '@/services/callables';
import { listUsers } from '@/services/directory';
import { LIMITS, ROLE_DESCRIPTION, ROLE_LABEL, ROLES, type Role } from '@/shared/constants';
import type { UserDoc, WithId } from '@/shared/types';

type Dialog =
  | { kind: 'role'; user: WithId<UserDoc> }
  | { kind: 'installation'; user: WithId<UserDoc> }
  | { kind: 'disable'; user: WithId<UserDoc> }
  | { kind: 'delete'; user: WithId<UserDoc> }
  | null;

function RoleDialog({ user, onClose, onDone }: { user: WithId<UserDoc>; onClose: () => void; onDone: () => void }) {
  const [role, setRole] = useState<Role>(user.role);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.setUserRole(user.id, role);
      toast.success(`${user.displayName} is now ${ROLE_LABEL[role]}`);
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
      title="Change role"
      description={`${user.displayName} · ${user.email}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} loading={busy} disabled={role === user.role}>
            Save role
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {error && <Alert tone="critical">{error}</Alert>}
        <div role="radiogroup" aria-label="Role" className="flex flex-col gap-1.5">
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
                <span className="block text-sm font-medium text-fg">{ROLE_LABEL[r]}</span>
                <span className="block text-xs text-fg-subtle">{ROLE_DESCRIPTION[r]}</span>
              </span>
            </label>
          ))}
        </div>
        <p className="text-xs text-fg-subtle">
          The change is recorded in the audit log. The person is asked to sign in again so their session carries the new role.
        </p>
      </div>
    </Modal>
  );
}

function InstallationDialog({ user, onClose, onDone }: { user: WithId<UserDoc>; onClose: () => void; onDone: () => void }) {
  const { installations } = useReference();
  const [value, setValue] = useState(user.installationId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.setUserInstallation(user.id, value || null);
      toast.success('Installation updated');
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
      title="Assign installation"
      description="Installation managers can update corrective actions at the installation assigned here."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} loading={busy} disabled={value === (user.installationId ?? '')}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {error && <Alert tone="critical">{error}</Alert>}
        <Field label="Installation">
          <Select value={value} onChange={(e) => setValue(e.target.value)}>
            <option value="">None</option>
            {installations.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
                {i.active ? '' : ' (inactive)'}
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
        title="Users & roles"
        description="Everyone with an account. Roles are enforced by the server and the security rules, not only by this screen."
      />

      <Panel>
        <div className="flex flex-col gap-2 border-b border-border p-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
            <Input
              type="search"
              aria-label="Search by email"
              placeholder="Search by email, e.g. priya@"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-8"
            />
          </div>
          <Select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as Role | '')} className="sm:w-52">
            <option value="">All roles</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </Select>
        </div>

        {pager.error ? (
          <ErrorState message={pager.error} onRetry={pager.reload} />
        ) : pager.loading && !pager.items.length ? (
          <SkeletonRows rows={6} />
        ) : !pager.items.length ? (
          <EmptyState icon={<UsersIcon />} title="No users match" description={search ? 'Search matches the start of an email address.' : undefined} />
        ) : (
          <div className={pager.loading ? 'opacity-60 transition-opacity' : undefined}>
            <Table>
              <THead>
                <tr>
                  <TH>User</TH>
                  <TH>Role</TH>
                  <TH className="hidden md:table-cell">Installation</TH>
                  <TH className="hidden sm:table-cell">Status</TH>
                  <TH className="hidden lg:table-cell">Last seen</TH>
                  <TH className="w-12">
                    <span className="sr-only">Manage</span>
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
                              {u.displayName} {self && <span className="text-xs text-fg-subtle">(you)</span>}
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
                        {u.disabled ? <Badge tone="critical">Disabled</Badge> : <Badge tone="success" dot>Active</Badge>}
                      </TD>
                      <TD className="hidden whitespace-nowrap lg:table-cell">{formatRelative(u.lastSeenAt)}</TD>
                      <TD className="text-right">
                        <Menu>
                          <MenuTrigger asChild>
                            <Button size="icon-sm" variant="ghost" aria-label={`Manage ${u.displayName}`} disabled={self}>
                              <MoreHorizontal aria-hidden />
                            </Button>
                          </MenuTrigger>
                          <MenuContent>
                            <MenuItem icon={<ShieldCheck />} onSelect={() => setDialog({ kind: 'role', user: u })}>
                              Change role
                            </MenuItem>
                            <MenuItem icon={<Building2 />} onSelect={() => setDialog({ kind: 'installation', user: u })}>
                              Assign installation
                            </MenuItem>
                            <MenuItem
                              icon={u.disabled ? <CheckCircle2 /> : <Ban />}
                              onSelect={() => setDialog({ kind: 'disable', user: u })}
                            >
                              {u.disabled ? 'Enable account' : 'Disable account'}
                            </MenuItem>
                            <MenuSeparator />
                            <MenuItem icon={<Trash2 />} danger onSelect={() => setDialog({ kind: 'delete', user: u })}>
                              Delete account
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
        title={dialog?.kind === 'disable' && dialog.user.disabled ? 'Enable this account?' : 'Disable this account?'}
        description={
          dialog?.kind === 'disable'
            ? dialog.user.disabled
              ? `${dialog.user.displayName} will be able to sign in again.`
              : `${dialog.user.displayName} is signed out everywhere and cannot sign in until re-enabled. Their reports stay in the register.`
            : ''
        }
        variant={dialog?.kind === 'disable' && dialog.user.disabled ? 'primary' : 'danger'}
        confirmLabel={dialog?.kind === 'disable' && dialog.user.disabled ? 'Enable' : 'Disable'}
        onConfirm={async () => {
          if (dialog?.kind !== 'disable') return;
          await api.setUserDisabled(dialog.user.id, !dialog.user.disabled);
          toast.success(dialog.user.disabled ? 'Account enabled' : 'Account disabled');
          pager.reload();
        }}
      />
      <ConfirmDialog
        open={dialog?.kind === 'delete'}
        onOpenChange={(o) => !o && close()}
        title="Delete this account?"
        description={
          dialog?.kind === 'delete'
            ? `${dialog.user.email} is removed permanently and cannot sign in. Reports they filed remain in the register, linked to an anonymous ID. This cannot be undone.`
            : ''
        }
        confirmLabel="Delete account"
        onConfirm={async () => {
          if (dialog?.kind !== 'delete') return;
          await api.deleteUser(dialog.user.id);
          toast.success('Account deleted');
          pager.reload();
        }}
      />
    </>
  );
}
