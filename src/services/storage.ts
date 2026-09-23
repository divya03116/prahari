/**
 * Report attachments in Cloud Storage.
 *
 * Files are uploaded before the report exists, into
 * attachments/{uid}/{reportId}/, where reportId is generated in the browser.
 * storage.rules accept only the caller's own folder, only JPEG/PNG/WebP/PDF,
 * only up to 10 MB, and only while that report has not been filed.
 * submitReport then re-checks every file server-side before recording it.
 */

import type { UploadTask } from 'firebase/storage';

import { getStorageLazy } from '@/lib/firebase';
import { LIMITS } from '@/shared/constants';

export function validateFile(file: File): string | null {
  if (!LIMITS.attachmentTypes.includes(file.type)) return `${file.name}: only JPEG, PNG, WebP or PDF files are accepted.`;
  if (file.size === 0) return `${file.name} is empty.`;
  if (file.size > LIMITS.attachmentBytesMax) return `${file.name} is larger than 10 MB.`;
  return null;
}

/** Keeps the name readable while making it safe as a storage object name. */
function safeName(name: string): string {
  const dot = name.lastIndexOf('.');
  const base = (dot > 0 ? name.slice(0, dot) : name).replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 80) || 'file';
  const ext = dot > 0 ? name.slice(dot + 1).replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toLowerCase() : '';
  return ext ? `${base}.${ext}` : base;
}

/** Storage SDK and instance, loaded on first use (see lib/firebase.ts). */
async function sdk() {
  const [storage, mod] = await Promise.all([getStorageLazy(), import('firebase/storage')]);
  return { storage, ...mod };
}

export function attachmentPath(uid: string, reportId: string, file: File): string {
  return `attachments/${uid}/${reportId}/${Date.now().toString(36)}-${safeName(file.name)}`;
}

/**
 * Returns the task wrapped in an object. UploadTask is a thenable, so
 * returning it bare from an async function would make the promise adopt it —
 * resolving only when the upload finishes, with a snapshot instead of the task.
 */
export async function startUpload(path: string, file: File): Promise<{ task: UploadTask }> {
  const { storage, ref, uploadBytesResumable } = await sdk();
  return { task: uploadBytesResumable(ref(storage, path), file, { contentType: file.type }) };
}

export async function removeUpload(path: string): Promise<void> {
  const { storage, ref, deleteObject } = await sdk();
  await deleteObject(ref(storage, path));
}

export async function attachmentUrl(path: string): Promise<string> {
  const { storage, ref, getDownloadURL } = await sdk();
  return getDownloadURL(ref(storage, path));
}
