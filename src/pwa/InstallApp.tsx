import { useEffect, useState } from 'react';
import { CheckCircle2, Download } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { useI18n } from '@/i18n';

import { clearInstallPrompt, onInstallPromptChange, pendingInstallPrompt } from './register';

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

const isIos = (): boolean => /iphone|ipad|ipod/i.test(navigator.userAgent);

/**
 * "Install app": the browser's own install prompt where it offers one
 * (Chrome, Edge, Android), and plain instructions where it does not (Safari).
 */
export function InstallApp() {
  const { t } = useI18n();
  const [prompt, setPrompt] = useState(pendingInstallPrompt);
  const [installed, setInstalled] = useState(isStandalone);

  useEffect(() => onInstallPromptChange(() => setPrompt(pendingInstallPrompt())), []);

  if (installed) {
    return (
      <p className="flex items-center gap-2 text-sm text-fg-muted">
        <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden />
        {t('settings.installed')}
      </p>
    );
  }

  if (!prompt) return <p className="text-sm text-fg-muted">{isIos() ? t('settings.installIos') : t('settings.installOther')}</p>;

  const install = async () => {
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    clearInstallPrompt();
    if (outcome === 'accepted') {
      setInstalled(true);
      toast.success(t('settings.installDone'));
    }
  };

  return (
    <Button onClick={() => void install()}>
      <Download aria-hidden /> {t('settings.install')}
    </Button>
  );
}
