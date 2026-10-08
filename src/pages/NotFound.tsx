import { Link } from 'react-router-dom';

import { Logo } from '@/components/brand';
import { buttonClass } from '@/components/ui/button';
import { useI18n } from '@/i18n';

export default function NotFound() {
  const { t } = useI18n();
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-14 items-center px-4 sm:px-6">
        <Logo />
      </header>
      <main className="flex flex-1 flex-col items-center justify-center px-4 pb-24 text-center">
        <p className="font-mono text-sm text-fg-subtle">404</p>
        <h1 className="mt-2 text-xl font-semibold text-fg">{t('notFound.title')}</h1>
        <p className="mt-2 max-w-sm text-sm text-fg-muted">{t('notFound.desc')}</p>
        <div className="mt-6 flex gap-2">
          <Link to="/app" className={buttonClass({ variant: 'primary' })}>
            {t('notFound.console')}
          </Link>
          <Link to="/" className={buttonClass()}>
            {t('common.home')}
          </Link>
        </div>
      </main>
    </div>
  );
}
