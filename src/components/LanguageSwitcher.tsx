import { Languages } from 'lucide-react';

import { cn } from '@/lib/cn';
import { LANGUAGES, useI18n, type Lang } from '@/i18n';

/**
 * Chooses the interface language. A native select: it works with every
 * keyboard, screen reader and phone picker, and shows each language in its own
 * script so it can be found by someone who cannot read the current one.
 */
export function LanguageSwitcher({ className, compact = false }: { className?: string; compact?: boolean }) {
  const { lang, setLang, t } = useI18n();
  return (
    <label
      className={cn(
        'relative inline-flex items-center gap-1.5 rounded-full border border-border-strong bg-surface text-fg-muted',
        'transition-colors hover:border-[#3f3f46] hover:text-fg focus-within:border-signal focus-within:ring-2 focus-within:ring-signal/25',
        compact ? 'h-8 pr-1 pl-2.5 text-xs' : 'h-9 pr-1.5 pl-3 text-sm',
        className,
      )}
    >
      <Languages aria-hidden className="size-4 shrink-0" />
      <select
        aria-label={t('nav.language')}
        value={lang}
        onChange={(e) => setLang(e.target.value as Lang)}
        className="cursor-pointer appearance-none bg-transparent py-1 pr-1 text-fg focus:outline-none"
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code} lang={l.code} className="bg-surface text-fg">
            {l.name}
          </option>
        ))}
      </select>
    </label>
  );
}
