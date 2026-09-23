import { Link } from 'react-router-dom';

import { cn } from '@/lib/cn';

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn('size-5', className)} fill="none">
      <path
        d="M12 2.75 4.25 5.6v6.02c0 4.47 3.13 8.4 7.75 9.63 4.62-1.23 7.75-5.16 7.75-9.63V5.6L12 2.75Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M12 7.5v5.25M12 15.6v.9" stroke="var(--color-signal)" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({ to = '/', className }: { to?: string; className?: string }) {
  return (
    <Link to={to} className={cn('inline-flex items-center gap-2 text-fg', className)} aria-label="PRAHARI home">
      <LogoMark />
      <span className="text-sm font-semibold tracking-[0.14em]">PRAHARI</span>
    </Link>
  );
}
