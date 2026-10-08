import { currentLang, translate, type Lang } from '@/i18n';
import type { TimestampLike } from '@/shared/types';

type DateInput = TimestampLike | Date | number | null | undefined;

function toDate(value: DateInput): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);
  if (typeof value.toDate === 'function') return value.toDate();
  return null;
}

// Month and weekday names follow the interface language; digits stay 0-9 in
// every language so scores, dates and counts read the same everywhere.
const LOCALE: Record<Lang, string> = { en: 'en-IN', hi: 'hi-IN-u-nu-latn', as: 'as-IN-u-nu-latn', bn: 'bn-IN-u-nu-latn' };

interface Formats {
  date: Intl.DateTimeFormat;
  dateTime: Intl.DateTimeFormat;
  short: Intl.DateTimeFormat;
  month: Intl.DateTimeFormat;
  rel: Intl.RelativeTimeFormat;
}
const formats = new Map<Lang, Formats>();

function fmt(): Formats {
  const lang = currentLang();
  let f = formats.get(lang);
  if (!f) {
    // Where the browser has no data for a language, fall back to Indian English rather than its own default.
    const locale = [LOCALE[lang], 'en-IN'];
    f = {
      date: new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }),
      dateTime: new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }),
      short: new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }),
      month: new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }),
      rel: new Intl.RelativeTimeFormat(lang === 'en' ? 'en' : [...locale, 'en'], { numeric: 'auto' }),
    };
    formats.set(lang, f);
  }
  return f;
}

export function formatDate(value: DateInput): string {
  const d = toDate(value);
  return d ? fmt().date.format(d) : '—';
}

export function formatDateTime(value: DateInput): string {
  const d = toDate(value);
  return d ? fmt().dateTime.format(d) : '—';
}

export function formatShortDate(value: DateInput): string {
  const d = toDate(value);
  return d ? fmt().short.format(d) : '—';
}

/** Short month name of a UTC date, e.g. for chart axes. */
export const formatMonth = (d: Date): string => fmt().month.format(d);

const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

export function formatRelative(value: DateInput, now = Date.now()): string {
  const d = toDate(value);
  if (!d) return '—';
  const seconds = Math.round((d.getTime() - now) / 1000);
  for (const [unit, size] of STEPS) {
    if (Math.abs(seconds) >= size) return fmt().rel.format(Math.round(seconds / size), unit);
  }
  return translate('time.justNow');
}

/** Whole days from now until `value`; negative when in the past. */
export function daysUntil(value: DateInput, now = Date.now()): number | null {
  const d = toDate(value);
  if (!d) return null;
  return Math.ceil((d.getTime() - now) / 86_400_000);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const num = new Intl.NumberFormat('en-IN');
export const formatNumber = (n: number): string => num.format(n);

export function formatPercent(part: number, whole: number): string {
  if (!whole) return '0%';
  return `${Math.round((part / whole) * 100)}%`;
}

/** YYYY-MM-DD in UTC, matching the server's dayKey(). */
export function dayKey(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return ((parts[0][0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${formatNumber(n)} ${n === 1 ? one : many}`;
}
