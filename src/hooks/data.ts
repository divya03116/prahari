import { useCallback, useEffect, useRef, useState } from 'react';

import { errorMessage } from '@/lib/errors';
import type { Cursor, Page } from '@/services/query';
import type { WithId } from '@/shared/types';

export interface AsyncState<T> {
  data: T | undefined;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/** Runs `load` whenever `deps` change; ignores results from stale runs. */
export function useAsync<T>(load: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const run = useRef(0);

  useEffect(() => {
    const id = ++run.current;
    setLoading(true);
    setError(null);
    load()
      .then((d) => {
        if (id === run.current) setData(d);
      })
      .catch((err) => {
        if (id === run.current) setError(errorMessage(err));
      })
      .finally(() => {
        if (id === run.current) setLoading(false);
      });
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, loading, error, reload };
}

/** Live subscription (onSnapshot) with loading and error state. */
export function useLive<T>(
  subscribe: (next: (value: T) => void, error: (err: Error) => void) => () => void,
  deps: unknown[],
): { data: T | undefined; loading: boolean; error: string | null } {
  const [data, setData] = useState<T>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    // If the SDK throws synchronously (a terminated client, say), show the
    // error in this panel rather than taking the whole page down.
    let unsub: (() => void) | undefined;
    try {
      unsub = subscribe(
        (value) => {
          setData(value);
          setLoading(false);
        },
        (err) => {
          setError(errorMessage(err));
          setLoading(false);
        },
      );
    } catch (err) {
      setError(errorMessage(err));
      setLoading(false);
    }
    return () => unsub?.();
  }, deps);

  return { data, loading, error };
}

export interface Pager<T> {
  items: WithId<T>[];
  page: number;
  hasNext: boolean;
  loading: boolean;
  error: string | null;
  next: () => void;
  prev: () => void;
  reload: () => void;
}

/**
 * Cursor pagination. Keeps the cursor that started each visited page so
 * "previous" re-reads exactly that page; resets to page 1 whenever `key`
 * (a serialisation of the filters) changes.
 */
export function usePager<T>(
  fetch: (after: Cursor) => Promise<Page<T>>,
  key: string,
): Pager<T> {
  const [nav, setNav] = useState<{ key: string; starts: Cursor[]; page: number }>({ key, starts: [null], page: 1 });
  const [result, setResult] = useState<Page<T> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const run = useRef(0);
  const fetchRef = useRef(fetch);
  fetchRef.current = fetch;

  // Filters changed: back to page 1 in the same render, so the stale cursor
  // is never used against the new query.
  const fresh = nav.key !== key;
  if (fresh) setNav({ key, starts: [null], page: 1 });
  const starts = fresh ? [null] : nav.starts;
  const page = fresh ? 1 : nav.page;
  const cursor = starts[page - 1] ?? null;

  useEffect(() => {
    const id = ++run.current;
    setLoading(true);
    setError(null);
    fetchRef
      .current(cursor)
      .then((r) => {
        if (id === run.current) setResult(r);
      })
      .catch((err) => {
        if (id === run.current) setError(errorMessage(err));
      })
      .finally(() => {
        if (id === run.current) setLoading(false);
      });
  }, [cursor, key, nonce]);

  return {
    items: result?.items ?? [],
    page,
    hasNext: result?.hasNext ?? false,
    loading,
    error,
    next: () => {
      if (!result?.hasNext || !result.last || loading) return;
      const last = result.last;
      setNav((n) => ({ ...n, starts: [...n.starts.slice(0, n.page), last], page: n.page + 1 }));
    },
    prev: () => setNav((n) => ({ ...n, page: Math.max(1, n.page - 1) })),
    reload: () => setNonce((n) => n + 1),
  };
}

/** Debounced value, for search boxes. */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
