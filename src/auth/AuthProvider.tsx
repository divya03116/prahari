import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { onIdTokenChanged, type User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { toast } from 'sonner';

import { translate } from '@/i18n';
import { roleKey } from '@/i18n/labels';
import { firebase, isConfigured } from '@/lib/firebase';
import { ensureProfile, signOut as doSignOut, touchLastSeen } from '@/services/auth';
import { COLLECTIONS, DEFAULT_ROLE, hasRole, ROLES, type Role, TRUSTED_SIGN_IN_PROVIDERS } from '@/shared/constants';
import type { UserDoc } from '@/shared/types';

type Status = 'loading' | 'signed-out' | 'signed-in';

interface AuthState {
  status: Status;
  user: User | null;
  /** From the ID token's custom claim — the same source the rules and callables trust. */
  role: Role;
  profile: UserDoc | null;
  verified: boolean;
  can: (min: Role) => boolean;
  /** Re-reads the user and token (after verifying email, for instance). */
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const LAST_SEEN_INTERVAL = 60 * 60 * 1000;

function isVerified(user: User | null): boolean {
  if (!user) return false;
  return user.emailVerified || user.providerData.some((p) => (TRUSTED_SIGN_IN_PROVIDERS as readonly string[]).includes(p.providerId));
}

function readRole(value: unknown): Role {
  return (ROLES as readonly string[]).includes(value as string) ? (value as Role) : DEFAULT_ROLE;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>(isConfigured ? 'loading' : 'signed-out');
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<Role>(DEFAULT_ROLE);
  const [verified, setVerified] = useState(false);
  const [profile, setProfile] = useState<UserDoc | null>(null);
  const refreshing = useRef(false);

  // Session: Firebase persists it in IndexedDB (browserLocalPersistence), so a
  // reload restores the signed-in user without a round trip to a login page.
  useEffect(() => {
    if (!isConfigured) return;
    return onIdTokenChanged(firebase.auth, async (u) => {
      if (!u) {
        setUser(null);
        setProfile(null);
        setRole(DEFAULT_ROLE);
        setVerified(false);
        setStatus('signed-out');
        return;
      }
      try {
        const token = await u.getIdTokenResult();
        setRole(readRole(token.claims.role));
      } catch {
        setRole(DEFAULT_ROLE);
      }
      setUser(u);
      setVerified(isVerified(u));
      setStatus('signed-in');
      ensureProfile(u).catch(() => {
        /* the profile listener below reports real failures */
      });
    });
  }, []);

  // The caller's own profile, live. When an administrator changes this
  // person's role or disables them, it shows up here within a second.
  useEffect(() => {
    if (!user) return;
    return onSnapshot(
      doc(firebase.db, COLLECTIONS.users, user.uid),
      (snap) => setProfile(snap.exists() ? (snap.data() as UserDoc) : null),
      () => setProfile(null),
    );
  }, [user]);

  const signOut = useCallback(async () => {
    await doSignOut();
  }, []);

  const refresh = useCallback(async () => {
    const u = firebase.auth.currentUser;
    if (!u) return;
    await u.reload();
    // Force a new ID token so the email_verified and role claims are current;
    // onIdTokenChanged then updates state.
    await u.getIdToken(true);
    setVerified(isVerified(firebase.auth.currentUser));
  }, []);

  // React to administrative changes to this account.
  useEffect(() => {
    if (!user || !profile) return;
    if (profile.disabled) {
      toast.error(translate('account.disabled'));
      void doSignOut();
      return;
    }
    if (profile.role !== role && !refreshing.current) {
      refreshing.current = true;
      user
        .getIdTokenResult(true)
        .then((t) => {
          const next = readRole(t.claims.role);
          if (next === profile.role) toast.success(translate('account.roleNow', { role: translate(roleKey(next)) }));
        })
        .catch(() => {
          // Role changes revoke existing sessions server-side; sign in again
          // to receive a token carrying the new role.
          toast.info(translate('account.roleChanged'));
          void doSignOut();
        })
        .finally(() => {
          refreshing.current = false;
        });
    }
  }, [user, profile, role]);

  // lastSeenAt, at most hourly, for the admin user list.
  useEffect(() => {
    if (!user || !profile || !verified) return;
    const last = profile.lastSeenAt?.toMillis?.() ?? 0;
    if (Date.now() - last > LAST_SEEN_INTERVAL) touchLastSeen(user.uid).catch(() => undefined);
  }, [user, profile, verified]);

  const value = useMemo<AuthState>(
    () => ({
      status,
      user,
      role,
      profile,
      verified,
      can: (min: Role) => verified && hasRole(role, min),
      refresh,
      signOut,
    }),
    [status, user, role, profile, verified, refresh, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** Display name with sensible fallbacks. */
export function useDisplayName(): string {
  const { profile, user } = useAuth();
  return profile?.displayName || user?.displayName || user?.email?.split('@')[0] || 'User';
}
