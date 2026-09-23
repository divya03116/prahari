import { useState } from 'react';

import { Button } from '@/components/ui/button';

export function GoogleButton({ onClick, label = 'Continue with Google' }: { onClick: () => Promise<void>; label?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="lg"
      className="w-full"
      loading={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await onClick();
        } finally {
          setBusy(false);
        }
      }}
    >
      {!busy && (
        <svg viewBox="0 0 24 24" aria-hidden className="size-4">
          <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.24 1.4-1.7 4.1-5.5 4.1-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.5 14.6 2.5 12 2.5 6.8 2.5 2.6 6.7 2.6 12s4.2 9.5 9.4 9.5c5.4 0 9-3.8 9-9.2 0-.6-.07-1.1-.16-1.6H12Z" />
        </svg>
      )}
      {label}
    </Button>
  );
}
