import { Logo } from '@/components/brand';

/** Shown instead of the app when .env has not been filled in. */
export default function SetupRequired() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-14 items-center px-4 sm:px-6">
        <Logo />
      </header>
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-4 pb-24">
        <h1 className="text-xl font-semibold text-fg">Firebase is not configured</h1>
        <p className="mt-2 text-sm text-fg-muted">
          Copy <code className="font-mono text-fg">.env.example</code> to <code className="font-mono text-fg">.env</code>, fill in
          the web-app values from Firebase console → Project settings → Your apps, then restart the dev server. To run
          entirely locally, set <code className="font-mono text-fg">VITE_USE_EMULATORS=true</code> and start the emulators.
        </p>
      </main>
    </div>
  );
}
