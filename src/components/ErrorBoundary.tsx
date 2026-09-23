import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

import { Button } from './ui/button';

interface State {
  error: Error | null;
}

/**
 * Last line of defence for render errors. Shows a recoverable screen instead
 * of a blank page, and never shows the stack trace to the user.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; inline?: boolean }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled render error', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    // A failed lazy chunk after a deploy: a reload fetches the new build.
    const chunk = /Failed to fetch dynamically imported module|Importing a module script failed/i.test(this.state.error.message);
    return (
      <div className={this.props.inline ? 'py-24' : 'flex min-h-dvh items-center justify-center px-4'}>
        <div role="alert" className="mx-auto flex max-w-sm flex-col items-center text-center">
          <div className="mb-3 flex size-9 items-center justify-center rounded-md border border-critical-line bg-critical-soft text-critical">
            <AlertTriangle className="size-4" aria-hidden />
          </div>
          <p className="text-sm font-medium text-fg">{chunk ? 'A new version is available' : 'Something went wrong'}</p>
          <p className="mt-1 text-sm text-fg-muted">
            {chunk ? 'Reload to continue with the latest version.' : 'This screen hit an unexpected error. Reloading usually fixes it.'}
          </p>
          <Button className="mt-4" size="sm" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>
      </div>
    );
  }
}
