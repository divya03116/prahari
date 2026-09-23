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
import { errorMessage } from '@/lib/errors';
import { daysUntil, formatDate } from '@/lib/format';
import { api } from '@/services/callables';
import { ACTION_STATUS_LABEL, ACTION_STATUSES, LIMITS, type ActionStatus } from '@/shared/constants';
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
      toast.success('Corrective action added');
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !isSubmitting && onOpenChange(o)}
      title="Add corrective action"
      description="A control that removes or reduces the hazard in this report."
      onSubmit={submit}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={isSubmitting}>
            Add action
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <Alert tone="critical">{error}</Alert>}
        <Field label="Control" error={errors.control?.message}>
          <Input autoFocus placeholder="e.g. Install toe boards on all lifts above 2 m" {...register('control')} />
        </Field>
        <Field label="Rationale" optional error={errors.rationale?.message}>
          <Textarea rows={3} maxLength={LIMITS.noteMax} {...register('rationale')} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Owner" error={errors.owner?.message} hint="A role or team, e.g. Maintenance supervisor">
            <Input {...register('owner')} />
          </Field>
          <Field label="Due in (days)" error={errors.dueInDays?.message}>
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
      toast.success('Action updated');
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
      title="Update corrective action"
      description={action?.control}
      onSubmit={submit}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={isSubmitting} disabled={!isDirty}>
            Save changes
          </Button>
        </>
      }
    >
      {action && (
        <div className="flex flex-col gap-4">
          {error && <Alert tone="critical">{error}</Alert>}
          {action.rationale && <p className="text-sm text-fg-muted">{action.rationale}</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Status" error={errors.status?.message}>
              <Select {...register('status')}>
                {statuses.map((s) => (
                  <option key={s} value={s}>
                    {ACTION_STATUS_LABEL[s]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Owner" error={errors.owner?.message} hint={officer ? undefined : 'Only an HSE officer can reassign.'}>
              <Input {...register('owner')} readOnly={!officer} className={officer ? undefined : 'opacity-60'} />
            </Field>
          </div>
          <Field
            label="Reschedule"
            optional
            error={errors.reschedule?.message}
            hint={`Due ${formatDate(action.dueAt)}${due !== null ? (due < 0 ? ` · ${-due} days overdue` : ` · in ${due} days`) : ''}. Enter a number of days from today to change it.`}
          >
            <Input type="number" min={1} max={365} inputMode="numeric" placeholder="Days from today" {...register('reschedule')} readOnly={!officer} className={officer ? undefined : 'opacity-60'} />
          </Field>
          <Field label="Progress note" optional error={errors.note?.message}>
            <Textarea rows={3} maxLength={LIMITS.noteMax} {...register('note')} />
          </Field>
        </div>
      )}
    </Modal>
  );
}
