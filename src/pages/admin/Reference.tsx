import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useSearchParams } from 'react-router-dom';
import { Building2, MoreHorizontal, Pencil, Plus, Power, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { z } from 'zod';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Modal } from '@/components/ui/dialog';
import { Alert, EmptyState, ErrorState, SkeletonRows } from '@/components/ui/feedback';
import { Checkbox, Field, Input } from '@/components/ui/field';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/menu';
import { PageHeader, Segmented } from '@/components/ui/misc';
import { Panel } from '@/components/ui/panel';
import { Table, TD, TH, THead, TR } from '@/components/ui/table';
import { useReference } from '@/hooks/reference';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { api } from '@/services/callables';
import { referenceFieldsSchema, type ReferenceKind } from '@/shared/schemas';
import type { ReferenceDoc, WithId } from '@/shared/types';

type FormIn = z.input<typeof referenceFieldsSchema>;
type FormOut = z.output<typeof referenceFieldsSchema>;

const NOUN: Record<ReferenceKind, string> = { installations: 'installation', activities: 'activity' };

function EditDialog({
  kind,
  item,
  open,
  onOpenChange,
}: {
  kind: ReferenceKind;
  item: WithId<ReferenceDoc> | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormIn, unknown, FormOut>({ resolver: zodResolver(referenceFieldsSchema) });

  useEffect(() => {
    if (open) {
      setError(null);
      reset(
        item
          ? { name: item.name, code: item.code, region: item.region, active: item.active }
          : { name: '', code: '', region: '', active: true },
      );
    }
  }, [open, item, reset]);

  const submit = handleSubmit(async (v) => {
    setError(null);
    try {
      // Omit `id` on create: callables serialise undefined as null.
      await api.upsertReference({ ...v, kind, ...(item ? { id: item.id } : {}) });
      toast.success(item ? `${v.name} updated` : `${v.name} added`);
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !isSubmitting && onOpenChange(o)}
      title={item ? `Edit ${NOUN[kind]}` : `Add ${NOUN[kind]}`}
      size="sm"
      onSubmit={submit}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={isSubmitting}>
            {item ? 'Save changes' : `Add ${NOUN[kind]}`}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <Alert tone="critical">{error}</Alert>}
        <Field label="Name" error={errors.name?.message}>
          <Input autoFocus {...register('name')} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Code" optional error={errors.code?.message}>
            <Input className="font-mono" maxLength={16} {...register('code')} />
          </Field>
          <Field label={kind === 'installations' ? 'Region' : 'Category'} optional error={errors.region?.message}>
            <Input {...register('region')} />
          </Field>
        </div>
        <label className="flex cursor-pointer items-start gap-2.5 text-sm">
          <Checkbox className="mt-0.5" {...register('active')} />
          <span>
            <span className="block text-fg">Active</span>
            <span className="block text-xs text-fg-subtle">Inactive entries stay on existing reports but cannot be chosen for new ones.</span>
          </span>
        </label>
      </div>
    </Modal>
  );
}

export default function Reference() {
  const [params, setParams] = useSearchParams();
  const kind: ReferenceKind = params.get('tab') === 'activities' ? 'activities' : 'installations';
  const ref = useReference();
  const items = kind === 'installations' ? ref.installations : ref.activities;
  const [editing, setEditing] = useState<{ item: WithId<ReferenceDoc> | null } | null>(null);
  const [deleting, setDeleting] = useState<WithId<ReferenceDoc> | null>(null);

  const toggle = async (item: WithId<ReferenceDoc>) => {
    try {
      await api.upsertReference({ kind, id: item.id, name: item.name, code: item.code, region: item.region, active: !item.active });
      toast.success(`${item.name} ${item.active ? 'deactivated' : 'activated'}`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <>
      <PageHeader
        title="Reference data"
        description="The installations and activities people choose from when filing a report."
        actions={
          <Button variant="primary" onClick={() => setEditing({ item: null })}>
            <Plus aria-hidden /> Add {NOUN[kind]}
          </Button>
        }
      />

      <div className="mb-3">
        <Segmented
          label="Reference type"
          value={kind}
          onChange={(v) => setParams(v === 'installations' ? {} : { tab: v }, { replace: true })}
          options={[
            { value: 'installations', label: 'Installations', count: ref.installations.length },
            { value: 'activities', label: 'Activities', count: ref.activities.length },
          ]}
        />
      </div>

      <Panel>
        {ref.error ? (
          <ErrorState message={ref.error} />
        ) : ref.loading ? (
          <SkeletonRows rows={5} />
        ) : !items.length ? (
          <EmptyState
            icon={<Building2 />}
            title={`No ${kind} yet`}
            description={`Reports cannot be filed until at least one ${NOUN[kind]} exists.`}
            action={
              <Button size="sm" variant="primary" onClick={() => setEditing({ item: null })}>
                Add {NOUN[kind]}
              </Button>
            }
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Name</TH>
                <TH className="hidden sm:table-cell">Code</TH>
                <TH className="hidden md:table-cell">{kind === 'installations' ? 'Region' : 'Category'}</TH>
                <TH>Status</TH>
                <TH className="hidden lg:table-cell">Updated</TH>
                <TH className="w-12">
                  <span className="sr-only">Manage</span>
                </TH>
              </tr>
            </THead>
            <tbody>
              {items.map((i) => (
                <TR key={i.id}>
                  <TD className="text-fg">{i.name}</TD>
                  <TD className="hidden font-mono text-xs sm:table-cell">{i.code || '—'}</TD>
                  <TD className="hidden md:table-cell">{i.region || '—'}</TD>
                  <TD>{i.active ? <Badge tone="success" dot>Active</Badge> : <Badge>Inactive</Badge>}</TD>
                  <TD className="hidden whitespace-nowrap lg:table-cell">{formatDate(i.updatedAt)}</TD>
                  <TD className="text-right">
                    <Menu>
                      <MenuTrigger asChild>
                        <Button size="icon-sm" variant="ghost" aria-label={`Manage ${i.name}`}>
                          <MoreHorizontal aria-hidden />
                        </Button>
                      </MenuTrigger>
                      <MenuContent>
                        <MenuItem icon={<Pencil />} onSelect={() => setEditing({ item: i })}>
                          Edit
                        </MenuItem>
                        <MenuItem icon={<Power />} onSelect={() => void toggle(i)}>
                          {i.active ? 'Deactivate' : 'Activate'}
                        </MenuItem>
                        <MenuSeparator />
                        <MenuItem icon={<Trash2 />} danger onSelect={() => setDeleting(i)}>
                          Delete
                        </MenuItem>
                      </MenuContent>
                    </Menu>
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>

      <EditDialog kind={kind} item={editing?.item ?? null} open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(null)} />
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.name ?? ''}?`}
        description={`Only an ${NOUN[kind]} that no report refers to can be deleted. If reports use it, deactivate it instead — it will stay on those reports but disappear from the form.`}
        confirmLabel="Delete"
        onConfirm={async () => {
          if (!deleting) return;
          await api.deleteReference(kind, deleting.id);
          toast.success(`${deleting.name} deleted`);
        }}
      />
    </>
  );
}
