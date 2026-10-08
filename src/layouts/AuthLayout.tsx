import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { Logo } from '@/components/brand';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { useI18n } from '@/i18n';
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
  const { t } = useI18n();
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2 sm:px-6">
        <Logo />
        <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
          {aside && <div className="text-sm text-fg-muted">{aside}</div>}
          <LanguageSwitcher compact />
        </div>
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
        <span>{t('auth.footer')}</span>
        <Link to="/" className="hover:text-fg-muted">
          {t('common.home')}
        </Link>
        {usingEmulators && <span className="text-info">{t('auth.localEmulators')}</span>}
      </footer>
    </div>
  );
}
