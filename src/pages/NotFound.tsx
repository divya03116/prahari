import { Link } from 'react-router-dom';

import { Logo } from '@/components/brand';
import { buttonClass } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-14 items-center px-4 sm:px-6">
        <Logo />
      </header>
      <main className="flex flex-1 flex-col items-center justify-center px-4 pb-24 text-center">
        <p className="font-mono text-sm text-fg-subtle">404</p>
        <h1 className="mt-2 text-xl font-semibold text-fg">This page does not exist</h1>
        <p className="mt-2 max-w-sm text-sm text-fg-muted">The link may be out of date, or the address mistyped.</p>
        <div className="mt-6 flex gap-2">
          <Link to="/app" className={buttonClass({ variant: 'primary' })}>
            Go to the console
          </Link>
          <Link to="/" className={buttonClass()}>
            Home
          </Link>
        </div>
      </main>
    </div>
  );
}
