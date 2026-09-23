import {
  getCountFromServer,
  getDocs,
  limit,
  query,
  startAfter,
  type DocumentData,
  type Query,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';

import type { WithId } from '@/shared/types';

export type Cursor = QueryDocumentSnapshot<DocumentData> | null;

export interface Page<T> {
  items: WithId<T>[];
  /** Pass back as `after` to fetch the next page. */
  last: Cursor;
  hasNext: boolean;
}

/**
 * One page of a query, by cursor. Reads pageSize + 1 documents so "is there
 * a next page" is known without a second query or a count.
 */
export async function fetchPage<T>(q: Query<DocumentData>, pageSize: number, after: Cursor): Promise<Page<T>> {
  const snap = await getDocs(query(q, ...(after ? [startAfter(after)] : []), limit(pageSize + 1)));
  const docs = snap.docs.slice(0, pageSize);
  return {
    items: docs.map((d) => ({ id: d.id, ...(d.data() as T) })),
    last: docs.at(-1) ?? null,
    hasNext: snap.docs.length > pageSize,
  };
}

/** Server-side count aggregation: one billed read per 1000 matches, no documents transferred. */
export async function count(q: Query<DocumentData>): Promise<number> {
  const snap = await getCountFromServer(q);
  return snap.data().count;
}
