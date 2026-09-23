import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { Logo } from '@/components/brand';
import { usingEmulators } from '@/lib/firebase';

export function AuthLayout({
  title,
  description,
  aside,
  children,
  footer,
}: {
  title: string;
  description?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-14 items-center justify-between px-4 sm:px-6">
        <Logo />
        {aside && <div className="text-sm text-fg-muted">{aside}</div>}
      </header>

      <main className="flex flex-1 items-start justify-center px-4 pt-[8vh] pb-16 sm:items-center sm:pt-0">
        <div className="w-full max-w-[380px]">
          <div className="mb-6">
            <h1 className="text-xl font-semibold tracking-[-0.01em] text-fg">{title}</h1>
            {description && <p className="mt-1.5 text-sm text-fg-muted">{description}</p>}
          </div>
          {children}
          {footer && <div className="mt-6 text-sm text-fg-muted">{footer}</div>}
        </div>
      </main>

      <footer className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-4 pb-6 text-xs text-fg-subtle">
        <span>PRAHARI · SIF precursor intelligence</span>
        <Link to="/" className="hover:text-fg-muted">
          Home
        </Link>
        {usingEmulators && <span className="text-info">Local emulators — emails are not sent</span>}
      </footer>
    </div>
  );
}
