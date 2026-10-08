/**
 * The outbox: reports filed without a working connection.
 *
 * A report that cannot reach the server is kept in IndexedDB on this device —
 * its text, details and any photos — and sent, oldest first, as soon as the
 * server can be reached again. Closing the app in between loses nothing.
 *
 * Sending is safe to repeat: every report carries the id generated when the
 * form was opened, and the server refuses a second report with the same id,
 * which the outbox treats as "already delivered".
 */

import type { z } from 'zod';

import { errorMessage } from '@/lib/errors';
import { api } from '@/services/callables';
import { startUpload } from '@/services/storage';
import type { submitReportSchema } from '@/shared/schemas';

type SubmitPayload = z.input<typeof submitReportSchema>;

export interface QueuedFile {
  path: string;
  name: string;
  contentType: string;
  size: number;
  blob: Blob;
  /** Set once the file is in Storage, so a retry does not upload it again. */
  uploaded?: boolean;
}

export interface QueuedReport {
  /** The report id — also what makes sending idempotent. */
  id: string;
  /** Whose report it is. Only that person's session sends it. */
  uid: string;
  payload: SubmitPayload;
  files: QueuedFile[];
  queuedAt: number;
  /** The server's refusal, when it answered and said no. Needs the person's attention. */
  error?: string;
}

const DB_NAME = 'prahari-outbox';
const STORE = 'reports';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('The device storage could not be opened.'));
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = run(t.objectStore(STORE));
      t.oncomplete = () => resolve(req.result);
      t.onerror = () => reject(t.error ?? req.error);
      t.onabort = () => reject(t.error ?? new Error('The device storage refused the write.'));
    });
  } finally {
    db.close();
  }
}

/* ------------------------------------------------------------------ *
 * Change notifications, so the banner and counts stay current.
 * ------------------------------------------------------------------ */

const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

export function onOutboxChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/* ------------------------------------------------------------------ */

export async function queueReport(item: Omit<QueuedReport, 'queuedAt'>): Promise<void> {
  await tx('readwrite', (s) => s.put({ ...item, queuedAt: Date.now() } satisfies QueuedReport));
  changed();
}

export async function queuedReports(uid: string): Promise<QueuedReport[]> {
  const all = await tx<QueuedReport[]>('readonly', (s) => s.getAll() as IDBRequest<QueuedReport[]>);
  return all.filter((r) => r.uid === uid).sort((a, b) => a.queuedAt - b.queuedAt);
}

export async function discardQueuedReport(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id));
  changed();
}

/** No answer from the server at all: offline, a dropped connection, or a server that is not reachable. */
export function isConnectionError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const { code = '', message = '' } = (err ?? {}) as { code?: string; message?: string };
  if (code === 'functions/unavailable' || code === 'functions/deadline-exceeded' || code === 'unavailable') return true;
  // What the SDK reports when the request never produced a usable reply.
  if (code === 'functions/internal' && /^internal(?: \[0\])?$/.test(message)) return true;
  if (code === 'storage/retry-limit-exceeded' || code === 'storage/unknown' || code === 'auth/network-request-failed') return true;
  return err instanceof TypeError && /fetch|network|load failed/i.test(message);
}

let sending: Promise<{ sent: number; refused: number }> | null = null;

/**
 * Sends everything waiting for this person, oldest first. Stops at the first
 * report that cannot reach the server (it will be retried); a report the
 * server refuses is kept with the reason and the rest carry on.
 */
export function sendQueuedReports(uid: string): Promise<{ sent: number; refused: number }> {
  sending ??= (async () => {
    let sent = 0;
    let refused = 0;
    try {
      for (const item of await queuedReports(uid)) {
        if (item.error) continue; // refused before: waits for the person to decide
        try {
          for (const file of item.files) {
            if (file.uploaded) continue;
            const { task } = await startUpload(file.path, new File([file.blob], file.name, { type: file.contentType }));
            await task;
            file.uploaded = true;
            await tx('readwrite', (s) => s.put(item));
          }
          await api.submitReport({
            ...item.payload,
            attachments: [
              ...(item.payload.attachments ?? []),
              ...item.files.map((f) => ({ path: f.path, name: f.name, size: f.size, contentType: f.contentType })),
            ],
          });
          await tx('readwrite', (s) => s.delete(item.id));
          sent++;
        } catch (err) {
          if ((err as { code?: string } | null)?.code === 'functions/already-exists') {
            // An earlier attempt got through; only its reply was lost.
            await tx('readwrite', (s) => s.delete(item.id));
            sent++;
            continue;
          }
          if (isConnectionError(err)) break;
          await tx('readwrite', (s) => s.put({ ...item, error: errorMessage(err) }));
          refused++;
        }
      }
    } catch {
      /* device storage unavailable: nothing was queued, nothing to send */
    } finally {
      sending = null;
      if (sent || refused) changed();
    }
    return { sent, refused };
  })();
  return sending;
}

/** Puts a refused report back in line, e.g. after the reason has been dealt with. */
export async function retryQueuedReport(id: string): Promise<void> {
  const item = await tx<QueuedReport | undefined>('readonly', (s) => s.get(id) as IDBRequest<QueuedReport | undefined>);
  if (!item) return;
  delete item.error;
  await tx('readwrite', (s) => s.put(item));
  changed();
}
