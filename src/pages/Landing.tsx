import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  ClipboardCheck,
  FileLock2,
  Gauge,
  Languages,
  ListChecks,
  ScrollText,
  ShieldCheck,
  UserX,
} from 'lucide-react';

import { useAuth } from '@/auth/AuthProvider';
import { Logo } from '@/components/brand';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { buttonClass } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/feedback';
import { useI18n, type MessageKey } from '@/i18n';

const EngineDemo = lazy(() => import('./landing/EngineDemo'));

function Nav() {
  const { status, verified } = useAuth();
  const { t } = useI18n();
  const inApp = status === 'signed-in' && verified;
  return (
    <header className="sticky top-0 z-30 border-b border-border/70 bg-canvas/90 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <Logo />
        <nav aria-label={t('land.nav.sections')} className="hidden items-center gap-5 text-sm text-fg-muted md:flex">
          <a href="#how" className="hover:text-fg">
            {t('land.nav.how')}
          </a>
          <a href="#try" className="hover:text-fg">
            {t('land.nav.try')}
          </a>
          <a href="#trust" className="hover:text-fg">
            {t('land.nav.security')}
          </a>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <LanguageSwitcher compact className="hidden sm:inline-flex" />
          {inApp ? (
            <Link to="/app" className={buttonClass({ variant: 'primary', size: 'sm' })}>
              {t('land.nav.open')} <ArrowRight aria-hidden />
            </Link>
          ) : (
            <>
              <Link to="/signin" className={buttonClass({ variant: 'ghost', size: 'sm' })}>
                {t('auth.signIn')}
              </Link>
              <Link to="/signup" className={buttonClass({ variant: 'primary', size: 'sm' })}>
                {t('auth.createAccount')}
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

/** A static, labelled rendering of the register — built from the real components' styles. */
function RegisterPreview() {
  const { t } = useI18n();
  // Example reports are shown as written; only the frame around them is translated.
  const rows = [
    { score: 81, tier: 1, text: 'Scaffold third lift missing toe boards, fitter working directly below', place: 'Tank farm · Scaffolding' },
    { score: 62, tier: 2, text: 'H2S alarm bypassed on the separator skid while the permit was still open', place: 'Gas gathering · Maintenance' },
    { score: 57, tier: 2, text: 'Crane lifting a pipe spool over the manifold, no tag line, two riggers under the load', place: 'Crude unit · Lifting' },
    { score: 11, tier: 3, text: 'Housekeeping: hose lying across the walkway near the pump house', place: 'Pump station · Operations' },
  ] as const;
  const color = { 1: 'text-critical', 2: 'text-warning', 3: 'text-success' } as const;
  const bar = { 1: 'bg-critical', 2: 'bg-warning', 3: 'bg-success' } as const;
  return (
    <figure className="overflow-hidden rounded-lg border border-border bg-surface shadow-overlay">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <span className="text-sm font-medium text-fg">{t('nav.reports')}</span>
        <span className="text-xs text-fg-subtle">{t('land.preview.sort')}</span>
      </div>
      <ul className="divide-y divide-border">
        {rows.map((r) => (
          <li key={r.text} className="flex items-center gap-4 px-4 py-3">
            <div className="flex w-20 shrink-0 items-center gap-2">
              <span className={`w-6 text-sm font-semibold tabular ${color[r.tier]}`}>{r.score}</span>
              <span className="relative h-1 flex-1 overflow-hidden rounded-full bg-surface-3">
                <span className={`absolute inset-y-0 left-0 rounded-full ${bar[r.tier]}`} style={{ width: `${r.score}%` }} />
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-fg">{r.text}</p>
              <p className="truncate text-xs text-fg-subtle">{r.place}</p>
            </div>
          </li>
        ))}
      </ul>
      <figcaption className="border-t border-border px-4 py-2 text-2xs text-fg-subtle">
        {t('land.preview.caption')}
      </figcaption>
    </figure>
  );
}

function FieldVideo() {
  const { t } = useI18n();
  const ref = useRef<HTMLVideoElement>(null);
  const [visible, setVisible] = useState(false);

  // Only fetch the video once its section is about to scroll into view.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        setVisible(true);
        io.disconnect();
      }
    }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  return (
    <video
      ref={ref}
      className="aspect-[4/5] w-full rounded-lg border border-border object-cover"
      poster="/hero-poster.jpg"
      src={visible && !reduced ? '/hero.mp4' : undefined}
      autoPlay={!reduced}
      muted
      loop
      playsInline
      preload="none"
      aria-label={t('land.video')}
    />
  );
}

interface Point {
  icon: JSX.Element;
  title: MessageKey;
  body: MessageKey;
}

const STEPS: Point[] = [
  { icon: <ScrollText />, title: 'land.step1.title', body: 'land.step1.body' },
  { icon: <Gauge />, title: 'land.step2.title', body: 'land.step2.body' },
  { icon: <ListChecks />, title: 'land.step3.title', body: 'land.step3.body' },
  { icon: <ClipboardCheck />, title: 'land.step4.title', body: 'land.step4.body' },
];

const TRUST: Point[] = [
  { icon: <ShieldCheck />, title: 'land.trust1.title', body: 'land.trust1.body' },
  { icon: <UserX />, title: 'land.trust2.title', body: 'land.trust2.body' },
  { icon: <FileLock2 />, title: 'land.trust3.title', body: 'land.trust3.body' },
  { icon: <ScrollText />, title: 'land.trust4.title', body: 'land.trust4.body' },
];

export default function Landing() {
  const { t } = useI18n();
  return (
    <div className="min-h-dvh">
      <Nav />
      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pt-16 pb-20 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:pt-24">
          <div>
            <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs text-fg-muted">
              <span className="size-1.5 rounded-full bg-signal" aria-hidden />
              {t('land.badge')}
            </p>
            <h1 className="text-3xl font-semibold tracking-[-0.02em] text-fg sm:text-4xl">
              {t('land.h1')}
            </h1>
            <p className="mt-5 max-w-xl text-md leading-7 text-fg-muted">
              {t('land.lede')}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/signup" className={buttonClass({ variant: 'primary', size: 'lg' })}>
                {t('auth.createAnAccount')} <ArrowRight aria-hidden />
              </Link>
              <a href="#try" className={buttonClass({ variant: 'secondary', size: 'lg' })}>
                {t('land.nav.try')}
              </a>
            </div>
            <p className="mt-6 flex items-center gap-2 text-xs text-fg-subtle">
              <Languages className="size-3.5" aria-hidden /> {t('land.reads')}
            </p>
          </div>
          <RegisterPreview />
        </section>

        <section id="how" className="border-t border-border bg-surface/40">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <h2 className="text-xl font-semibold tracking-[-0.01em] text-fg">{t('land.nav.how')}</h2>
            <p className="mt-2 max-w-2xl text-sm text-fg-muted">
              {t('land.how.sub')}
            </p>
            <ol className="mt-10 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((s, i) => (
                <li key={s.title} className="flex flex-col gap-3 bg-canvas p-5">
                  <div className="flex items-center justify-between text-fg-subtle [&_svg]:size-4">
                    {s.icon}
                    <span className="font-mono text-xs">0{i + 1}</span>
                  </div>
                  <h3 className="text-md font-medium text-fg">{t(s.title)}</h3>
                  <p className="text-sm leading-6 text-fg-muted">{t(s.body)}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="try" className="border-t border-border">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <h2 className="text-xl font-semibold tracking-[-0.01em] text-fg">{t('land.nav.try')}</h2>
            <p className="mt-2 max-w-2xl text-sm text-fg-muted">
              {t('land.try.sub')}
            </p>
            <div className="mt-8">
              <Suspense fallback={<Skeleton className="h-96 w-full" />}>
                <EngineDemo />
              </Suspense>
            </div>
          </div>
        </section>

        <section id="trust" className="border-t border-border bg-surface/40">
          <div className="mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[1fr_380px]">
            <div>
              <h2 className="text-xl font-semibold tracking-[-0.01em] text-fg">{t('land.trust.title')}</h2>
              <p className="mt-2 max-w-2xl text-sm text-fg-muted">
                {t('land.trust.sub')}
              </p>
              <ul className="mt-10 grid gap-8 sm:grid-cols-2">
                {TRUST.map((point) => (
                  <li key={point.title} className="flex gap-3">
                    <span className="mt-0.5 text-signal [&_svg]:size-4">{point.icon}</span>
                    <div>
                      <h3 className="text-sm font-medium text-fg">{t(point.title)}</h3>
                      <p className="mt-1 text-sm leading-6 text-fg-muted">{t(point.body)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <FieldVideo />
          </div>
        </section>

        <section className="border-t border-border">
          <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-4 py-16 sm:px-6 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-xl font-semibold tracking-[-0.01em] text-fg">{t('land.start.title')}</h2>
              <p className="mt-1 text-sm text-fg-muted">{t('land.start.sub')}</p>
            </div>
            <Link to="/signup" className={buttonClass({ variant: 'primary', size: 'lg' })}>
              {t('auth.createAnAccount')} <ArrowRight aria-hidden />
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-xs text-fg-subtle sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-3">
            <Logo />
            <LanguageSwitcher compact />
          </div>
          <p>{t('land.footer')}</p>
        </div>
      </footer>
    </div>
  );
}
