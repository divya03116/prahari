import type { z } from 'zod';

import { api } from '@/services/callables';
import type { submitReportSchema } from '@/shared/schemas';

import { discardQueuedReport, isConnectionError, queuedReports, queueReport, sendQueuedReports, type QueuedFile } from './outbox';

type SubmitPayload = z.input<typeof submitReportSchema>;

/** How long the first attempt may take before the report is kept on the device instead. */
const FIRST_ATTEMPT_MS = 30_000;

/**
 * Files a report now if the server can be reached; otherwise keeps it in the
 * outbox, from where it is sent automatically. `waitingFiles` are photos that
 * were chosen while offline and still have to be uploaded.
 *
 * Throws only when the server answered and refused the report.
 */
export async function submitOrQueue(uid: string, payload: SubmitPayload, waitingFiles: QueuedFile[] = []): Promise<'sent' | 'queued'> {
  const keep = () => queueReport({ id: payload.reportId, uid, payload, files: waitingFiles });

  if (!navigator.onLine) {
    await keep();
    return 'queued';
  }

  if (waitingFiles.length) {
    // Photos still on the device: the outbox uploads them, then files the report.
    await keep();
    await sendQueuedReports(uid);
    const left = (await queuedReports(uid)).find((r) => r.id === payload.reportId);
    if (!left) return 'sent';
    if (left.error) {
      await discardQueuedReport(left.id);
      throw new Error(left.error);
    }
    return 'queued';
  }

  try {
    await api.submitReport(payload, FIRST_ATTEMPT_MS);
    return 'sent';
  } catch (err) {
    if (!isConnectionError(err)) throw err;
    await keep();
    return 'queued';
  }
}
