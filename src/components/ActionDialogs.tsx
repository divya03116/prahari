import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';

import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/dialog';
import { Alert } from '@/components/ui/feedback';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { useI18n } from '@/i18n';
import { actionStatusKey } from '@/i18n/labels';
import { errorMessage } from '@/lib/errors';
import { daysUntil, formatDate } from '@/lib/format';
import { api } from '@/services/callables';
import { ACTION_STATUSES, LIMITS, type ActionStatus } from '@/shared/constants';
import { actionFieldsSchema } from '@/shared/schemas';
import type { ActionDoc, WithId } from '@/shared/types';

type CreateValues = z.input<typeof actionFieldsSchema>;
type CreateOutput = z.output<typeof actionFieldsSchema>;

export function CreateActionDialog({
  reportId,
  open,
  onOpenChange,
}: {
  reportId: string;
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
  } = useForm<CreateValues, unknown, CreateOutput>({
    resolver: zodResolver(actionFieldsSchema),
    defaultValues: { control: '', rationale: '', owner: '', dueInDays: 7 },
  });

  useEffect(() => {
    if (open) {
      reset();
      setError(null);
    }
  }, [open, reset]);

  const submit = handleSubmit(async (v) => {
    setError(null);
    try {
      await api.createAction({ ...v, reportId });
      toast.success(t('action.added'));
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !isSubmitting && onOpenChange(o)}
      title={t('action.add.title')}
      description={t('action.add.desc')}
      onSubmit={submit}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="primary" loading={isSubmitting}>
            {t('detail.addAction')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <Alert tone="critical">{error}</Alert>}
        <Field label={t('action.control')} error={errors.control?.message}>
          <Input autoFocus placeholder={t('action.controlPlaceholder')} {...register('control')} />
        </Field>
        <Field label={t('action.rationale')} optional error={errors.rationale?.message}>
          <Textarea rows={3} maxLength={LIMITS.noteMax} {...register('rationale')} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('action.owner')} error={errors.owner?.message} hint={t('action.ownerHint')}>
            <Input {...register('owner')} />
          </Field>
          <Field label={t('action.dueInDays')} error={errors.dueInDays?.message}>
            <Input type="number" min={1} max={365} inputMode="numeric" {...register('dueInDays')} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

const editSchema = z.object({
  status: z.enum(ACTION_STATUSES),
  owner: z.string().trim().min(1, 'Owner is required').max(LIMITS.nameMax),
  reschedule: z.union([z.literal(''), z.coerce.number().int().min(1, 'At least 1 day').max(365, 'At most 365 days')]),
  note: z.string().trim().max(LIMITS.noteMax),
});
type EditValues = z.input<typeof editSchema>;
type EditOutput = z.output<typeof editSchema>;

/**
 * Edit an action. HSE officers and admins may change everything; an
 * installation manager (at their own installation) may change status and the
 * progress note only — the same rule updateAction enforces on the server.
 */
export function EditActionDialog({
  action,
  onOpenChange,
  onSaved,
}: {
  action: WithId<ActionDoc> | null;
  onOpenChange: (o: boolean) => void;
  onSaved?: () => void;
}) {
  const { can } = useAuth();
  const { t } = useI18n();
  const officer = can('hse-officer');
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<EditValues, unknown, EditOutput>({ resolver: zodResolver(editSchema) });

  useEffect(() => {
    if (action) {
      reset({ status: action.status, owner: action.owner, reschedule: '', note: action.note ?? '' });
      setError(null);
    }
  }, [action, reset]);

  const submit = handleSubmit(async (v) => {
    if (!action) return;
    setError(null);
    const patch: Parameters<typeof api.updateAction>[0] = { actionId: action.id };
    if (v.status !== action.status) patch.status = v.status;
    if (officer && v.owner !== action.owner) patch.owner = v.owner;
    if (officer && v.reschedule !== '') patch.dueInDays = v.reschedule;
    if (v.note !== (action.note ?? '')) patch.note = v.note;
    if (Object.keys(patch).length === 1) {
      onOpenChange(false);
      return;
    }
    try {
      await api.updateAction(patch);
      toast.success(t('action.updated'));
      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  const due = action ? daysUntil(action.dueAt) : null;
  const statuses: readonly ActionStatus[] = officer ? ACTION_STATUSES : ACTION_STATUSES.filter((s) => s !== 'cancelled');

  return (
    <Modal
      open={Boolean(action)}
      onOpenChange={(o) => !isSubmitting && onOpenChange(o)}
      title={t('action.update.title')}
      description={action?.control}
      onSubmit={submit}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="primary" loading={isSubmitting} disabled={!isDirty}>
            {t('action.saveChanges')}
          </Button>
        </>
      }
    >
      {action && (
        <div className="flex flex-col gap-4">
          {error && <Alert tone="critical">{error}</Alert>}
          {action.rationale && <p className="text-sm text-fg-muted">{action.rationale}</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('action.status')} error={errors.status?.message}>
              <Select {...register('status')}>
                {statuses.map((s) => (
                  <option key={s} value={s}>
                    {t(actionStatusKey(s))}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('action.owner')} error={errors.owner?.message} hint={officer ? undefined : t('action.onlyOfficerReassign')}>
              <Input {...register('owner')} readOnly={!officer} className={officer ? undefined : 'opacity-60'} />
            </Field>
          </div>
          <Field
            label={t('action.reschedule')}
            optional
            error={errors.reschedule?.message}
            hint={`${t('detail.due', { date: formatDate(action.dueAt) })}${due !== null ? (due < 0 ? ` · ${t('action.daysOverdue', { days: -due })}` : ` · ${t('action.inDays', { days: due })}`) : ''}. ${t('action.rescheduleHint')}`}
          >
            <Input type="number" min={1} max={365} inputMode="numeric" placeholder={t('action.daysFromToday')} {...register('reschedule')} readOnly={!officer} className={officer ? undefined : 'opacity-60'} />
          </Field>
          <Field label={t('action.progressNote')} optional error={errors.note?.message}>
            <Textarea rows={3} maxLength={LIMITS.noteMax} {...register('note')} />
          </Field>
        </div>
      )}
    </Modal>
  );
}
