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
import { useI18n } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { api } from '@/services/callables';
import { referenceFieldsSchema, type ReferenceKind } from '@/shared/schemas';
import type { ReferenceDoc, WithId } from '@/shared/types';

type FormIn = z.input<typeof referenceFieldsSchema>;
type FormOut = z.output<typeof referenceFieldsSchema>;

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
  const { t } = useI18n();
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
      toast.success(t(item ? 'ref.updated' : 'ref.added', { name: v.name }));
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !isSubmitting && onOpenChange(o)}
      title={t(item ? `ref.edit.${kind}` : `ref.add.${kind}`)}
      size="sm"
      onSubmit={submit}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="primary" loading={isSubmitting}>
            {item ? t('action.saveChanges') : t(`ref.add.${kind}`)}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <Alert tone="critical">{error}</Alert>}
        <Field label={t('ref.name')} error={errors.name?.message}>
          <Input autoFocus {...register('name')} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('ref.code')} optional error={errors.code?.message}>
            <Input className="font-mono" maxLength={16} {...register('code')} />
          </Field>
          <Field label={kind === 'installations' ? t('ref.region') : t('ref.category')} optional error={errors.region?.message}>
            <Input {...register('region')} />
          </Field>
        </div>
        <label className="flex cursor-pointer items-start gap-2.5 text-sm">
          <Checkbox className="mt-0.5" {...register('active')} />
          <span>
            <span className="block text-fg">{t('users.active')}</span>
            <span className="block text-xs text-fg-subtle">{t('ref.activeHint')}</span>
          </span>
        </label>
      </div>
    </Modal>
  );
}

export default function Reference() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const kind: ReferenceKind = params.get('tab') === 'activities' ? 'activities' : 'installations';
  const ref = useReference();
  const items = kind === 'installations' ? ref.installations : ref.activities;
  const [editing, setEditing] = useState<{ item: WithId<ReferenceDoc> | null } | null>(null);
  const [deleting, setDeleting] = useState<WithId<ReferenceDoc> | null>(null);

  const toggle = async (item: WithId<ReferenceDoc>) => {
    try {
      await api.upsertReference({ kind, id: item.id, name: item.name, code: item.code, region: item.region, active: !item.active });
      toast.success(t(item.active ? 'ref.deactivated' : 'ref.activated', { name: item.name }));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <>
      <PageHeader
        title={t('nav.reference')}
        description={t('ref.description')}
        actions={
          <Button variant="primary" onClick={() => setEditing({ item: null })}>
            <Plus aria-hidden /> {t(`ref.add.${kind}`)}
          </Button>
        }
      />

      <div className="mb-3">
        <Segmented
          label={t('ref.typeLabel')}
          value={kind}
          onChange={(v) => setParams(v === 'installations' ? {} : { tab: v }, { replace: true })}
          options={[
            { value: 'installations', label: t('ref.installations'), count: ref.installations.length },
            { value: 'activities', label: t('ref.activities'), count: ref.activities.length },
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
            title={t(`ref.none.${kind}`)}
            description={t(`ref.noneDesc.${kind}`)}
            action={
              <Button size="sm" variant="primary" onClick={() => setEditing({ item: null })}>
                {t(`ref.add.${kind}`)}
              </Button>
            }
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>{t('ref.name')}</TH>
                <TH className="hidden sm:table-cell">{t('ref.code')}</TH>
                <TH className="hidden md:table-cell">{kind === 'installations' ? t('ref.region') : t('ref.category')}</TH>
                <TH>{t('action.status')}</TH>
                <TH className="hidden lg:table-cell">{t('ref.updatedCol')}</TH>
                <TH className="w-12">
                  <span className="sr-only">{t('users.manage')}</span>
                </TH>
              </tr>
            </THead>
            <tbody>
              {items.map((i) => (
                <TR key={i.id}>
                  <TD className="text-fg">{i.name}</TD>
                  <TD className="hidden font-mono text-xs sm:table-cell">{i.code || '—'}</TD>
                  <TD className="hidden md:table-cell">{i.region || '—'}</TD>
                  <TD>{i.active ? <Badge tone="success" dot>{t('users.active')}</Badge> : <Badge>{t('ref.inactive')}</Badge>}</TD>
                  <TD className="hidden whitespace-nowrap lg:table-cell">{formatDate(i.updatedAt)}</TD>
                  <TD className="text-right">
                    <Menu>
                      <MenuTrigger asChild>
                        <Button size="icon-sm" variant="ghost" aria-label={t('users.manageItem', { name: i.name })}>
                          <MoreHorizontal aria-hidden />
                        </Button>
                      </MenuTrigger>
                      <MenuContent>
                        <MenuItem icon={<Pencil />} onSelect={() => setEditing({ item: i })}>
                          {t('common.edit')}
                        </MenuItem>
                        <MenuItem icon={<Power />} onSelect={() => void toggle(i)}>
                          {i.active ? t('ref.deactivate') : t('ref.activate')}
                        </MenuItem>
                        <MenuSeparator />
                        <MenuItem icon={<Trash2 />} danger onSelect={() => setDeleting(i)}>
                          {t('ref.delete')}
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
        title={t('ref.delete.title', { name: deleting?.name ?? '' })}
        description={t(`ref.deleteDesc.${kind}`)}
        confirmLabel={t('ref.delete')}
        onConfirm={async () => {
          if (!deleting) return;
          await api.deleteReference(kind, deleting.id);
          toast.success(t('ref.deleted', { name: deleting.name }));
        }}
      />
    </>
  );
}
