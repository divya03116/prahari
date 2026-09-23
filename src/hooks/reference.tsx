import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { useAuth } from '@/auth/AuthProvider';
import { errorMessage } from '@/lib/errors';
import { watchReference } from '@/services/directory';
import type { ReferenceDoc, WithId } from '@/shared/types';

interface ReferenceState {
  installations: WithId<ReferenceDoc>[];
  activities: WithId<ReferenceDoc>[];
  loading: boolean;
  error: string | null;
  installationName: (id: string | null | undefined) => string;
}

const Ctx = createContext<ReferenceState | null>(null);

/**
 * Installations and activities, subscribed once for the whole signed-in
 * session and shared by every form, filter and table that needs them.
 */
export function ReferenceProvider({ children }: { children: ReactNode }) {
  const { verified, user } = useAuth();
  const [installations, setInstallations] = useState<WithId<ReferenceDoc>[]>([]);
  const [activities, setActivities] = useState<WithId<ReferenceDoc>[]>([]);
  const [loaded, setLoaded] = useState({ installations: false, activities: false });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !verified) return;
    const onError = (err: Error) => setError(errorMessage(err));
    const a = watchReference(
      'installations',
      (items) => {
        setInstallations(items);
        setLoaded((l) => ({ ...l, installations: true }));
      },
      onError,
    );
    const b = watchReference(
      'activities',
      (items) => {
        setActivities(items);
        setLoaded((l) => ({ ...l, activities: true }));
      },
      onError,
    );
    return () => {
      a();
      b();
    };
  }, [user, verified]);

  const value = useMemo<ReferenceState>(() => {
    const names = new Map(installations.map((i) => [i.id, i.name]));
    return {
      installations,
      activities,
      loading: !(loaded.installations && loaded.activities) && !error,
      error,
      installationName: (id) => (id ? (names.get(id) ?? 'Unknown installation') : '—'),
    };
  }, [installations, activities, loaded, error]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useReference(): ReferenceState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useReference must be used inside <ReferenceProvider>');
  return ctx;
}
