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
import { buttonClass } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/feedback';

const EngineDemo = lazy(() => import('./landing/EngineDemo'));

function Nav() {
  const { status, verified } = useAuth();
  const inApp = status === 'signed-in' && verified;
  return (
    <header className="sticky top-0 z-30 border-b border-border/70 bg-canvas/90 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <Logo />
        <nav aria-label="Sections" className="hidden items-center gap-5 text-sm text-fg-muted md:flex">
          <a href="#how" className="hover:text-fg">
            How it works
          </a>
          <a href="#try" className="hover:text-fg">
            Try the engine
          </a>
          <a href="#trust" className="hover:text-fg">
            Security
          </a>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {inApp ? (
            <Link to="/app" className={buttonClass({ variant: 'primary', size: 'sm' })}>
              Open console <ArrowRight aria-hidden />
            </Link>
          ) : (
            <>
              <Link to="/signin" className={buttonClass({ variant: 'ghost', size: 'sm' })}>
                Sign in
              </Link>
              <Link to="/signup" className={buttonClass({ variant: 'primary', size: 'sm' })}>
                Create account
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
        <span className="text-sm font-medium text-fg">Reports</span>
        <span className="text-xs text-fg-subtle">Highest potential first</span>
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
        Illustrative example reports. Scores shown are what the engine returns for these sentences.
      </figcaption>
    </figure>
  );
}

function FieldVideo() {
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
      aria-label="Process plant at dusk"
    />
  );
}

const STEPS = [
  { icon: <ScrollText />, title: 'Report', body: 'Anyone on site describes what they saw, in their own words and language. Photos optional. No names.' },
  { icon: <Gauge />, title: 'Score', body: 'The server reads the narrative for hazardous energy, failed controls and exposure, and scores its serious-injury potential from 0 to 100.' },
  { icon: <ListChecks />, title: 'Review', body: 'HSE officers confirm, escalate, downgrade or dismiss. Every verdict becomes a labelled example the scoring can be checked against.' },
  { icon: <ClipboardCheck />, title: 'Act', body: 'Tier 1 and Tier 2 reports open corrective actions with owners and due dates, tracked until they are closed.' },
];

const TRUST = [
  { icon: <ShieldCheck />, title: 'Server-side scoring', body: 'The score of record is computed by a Cloud Function. Browsers can read the register but cannot write to it.' },
  { icon: <UserX />, title: 'No names on reports', body: 'A report stores an account ID, never a name. Scores attach to installations and activities, not people.' },
  { icon: <FileLock2 />, title: 'Role-based access', body: 'Reviewer, installation manager, HSE officer and administrator — enforced in the security rules and in every service call.' },
  { icon: <ScrollText />, title: 'Append-only audit', body: 'Every verdict, role change and archive is written to an audit log that no one can edit or erase.' },
];

export default function Landing() {
  return (
    <div className="min-h-dvh">
      <Nav />
      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pt-16 pb-20 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:pt-24">
          <div>
            <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs text-fg-muted">
              <span className="size-1.5 rounded-full bg-signal" aria-hidden />
              SIF precursor intelligence for process industries
            </p>
            <h1 className="text-3xl font-semibold tracking-[-0.02em] text-fg sm:text-4xl">
              Score what a safety report could have become, not what it recorded.
            </h1>
            <p className="mt-5 max-w-xl text-md leading-7 text-fg-muted">
              Most near-miss reports end with “no injury”. PRAHARI reads the narrative for the conditions behind serious
              injuries and fatalities — hazardous energy, a failed control, a person in the line of fire — and puts the
              reports with real potential at the top of the queue.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/signup" className={buttonClass({ variant: 'primary', size: 'lg' })}>
                Create an account <ArrowRight aria-hidden />
              </Link>
              <a href="#try" className={buttonClass({ variant: 'secondary', size: 'lg' })}>
                Try the engine
              </a>
            </div>
            <p className="mt-6 flex items-center gap-2 text-xs text-fg-subtle">
              <Languages className="size-3.5" aria-hidden /> Reads English, Hindi, Assamese, Bengali and code-mixed reports.
            </p>
          </div>
          <RegisterPreview />
        </section>

        <section id="how" className="border-t border-border bg-surface/40">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <h2 className="text-xl font-semibold tracking-[-0.01em] text-fg">How it works</h2>
            <p className="mt-2 max-w-2xl text-sm text-fg-muted">
              Four steps, each with an owner. The engine prioritises; people decide.
            </p>
            <ol className="mt-10 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((s, i) => (
                <li key={s.title} className="flex flex-col gap-3 bg-canvas p-5">
                  <div className="flex items-center justify-between text-fg-subtle [&_svg]:size-4">
                    {s.icon}
                    <span className="font-mono text-xs">0{i + 1}</span>
                  </div>
                  <h3 className="text-md font-medium text-fg">{s.title}</h3>
                  <p className="text-sm leading-6 text-fg-muted">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="try" className="border-t border-border">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <h2 className="text-xl font-semibold tracking-[-0.01em] text-fg">Try the engine</h2>
            <p className="mt-2 max-w-2xl text-sm text-fg-muted">
              This is the same scoring code the server runs, executing in your browser. Nothing you type here is sent or
              stored.
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
              <h2 className="text-xl font-semibold tracking-[-0.01em] text-fg">Built to be trusted with a safety register</h2>
              <p className="mt-2 max-w-2xl text-sm text-fg-muted">
                A register people are afraid to write in is worse than none. The design decisions follow from that.
              </p>
              <ul className="mt-10 grid gap-8 sm:grid-cols-2">
                {TRUST.map((t) => (
                  <li key={t.title} className="flex gap-3">
                    <span className="mt-0.5 text-signal [&_svg]:size-4">{t.icon}</span>
                    <div>
                      <h3 className="text-sm font-medium text-fg">{t.title}</h3>
                      <p className="mt-1 text-sm leading-6 text-fg-muted">{t.body}</p>
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
              <h2 className="text-xl font-semibold tracking-[-0.01em] text-fg">Start with your own reports</h2>
              <p className="mt-1 text-sm text-fg-muted">New accounts start as Reviewers. An administrator grants wider access.</p>
            </div>
            <Link to="/signup" className={buttonClass({ variant: 'primary', size: 'lg' })}>
              Create an account <ArrowRight aria-hidden />
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-xs text-fg-subtle sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <Logo />
          <p>
            PRAHARI scores potential, not probability. It supports the judgement of competent people; it does not replace
            it.
          </p>
        </div>
      </footer>
    </div>
  );
}
