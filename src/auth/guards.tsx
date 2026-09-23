import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { ShieldOff } from 'lucide-react';

import { buttonClass } from '@/components/ui/button';
import { EmptyState, Spinner } from '@/components/ui/feedback';
import { Link } from 'react-router-dom';
import { safeRedirect } from '@/lib/redirect';
import { ROLE_LABEL, type Role } from '@/shared/constants';
import { useAuth } from './AuthProvider';

export function FullPageSpinner() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <Spinner label="Loading session" />
    </div>
  );
}

/** Signed in AND verified, or off to sign-in / verification. */
export function RequireAuth() {
  const { status, verified } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <FullPageSpinner />;
  if (status === 'signed-out') {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/signin?next=${next}`} replace />;
  }
  if (!verified) return <Navigate to="/verify-email" replace />;
  return <Outlet />;
}

/** Sign-in, sign-up and reset pages: a signed-in, verified user skips them. */
export function PublicOnly() {
  const { status, verified } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <FullPageSpinner />;
  if (status === 'signed-in' && verified) {
    const next = new URLSearchParams(location.search).get('next');
    return <Navigate to={safeRedirect(next)} replace />;
  }
  return <Outlet />;
}

export function Forbidden({ min }: { min: Role }) {
  return (
    <EmptyState
      className="py-24"
      icon={<ShieldOff />}
      title="You do not have access to this page"
      description={`It requires the ${ROLE_LABEL[min]} role or higher. An administrator can change your role.`}
      action={
        <Link to="/app" className={buttonClass({ size: 'sm' })}>
          Back to dashboard
        </Link>
      }
    />
  );
}

/** In-shell role gate. The server enforces the same rule; this only avoids a dead end. */
export function RequireRole({ min, children }: { min: Role; children?: ReactNode }) {
  const { can } = useAuth();
  if (!can(min)) return <Forbidden min={min} />;
  return children ? <>{children}</> : <Outlet />;
}
