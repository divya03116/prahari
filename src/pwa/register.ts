/**
 * Installs the service worker (src/pwa/sw.js) in production builds, and offers
 * a reload when a new version has been downloaded. In development there is no
 * service worker, so a code change is never hidden behind a cached copy.
 */

import { toast } from 'sonner';

import { translate } from '@/i18n';

/** Chrome's install prompt, kept until the person asks to install (see useInstall). */
export interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let installPrompt: InstallPromptEvent | null = null;
const installListeners = new Set<() => void>();

export const pendingInstallPrompt = (): InstallPromptEvent | null => installPrompt;
export function clearInstallPrompt(): void {
  installPrompt = null;
  installListeners.forEach((l) => l());
}
export function onInstallPromptChange(listener: () => void): () => void {
  installListeners.add(listener);
  return () => installListeners.delete(listener);
}

export function registerServiceWorker(): void {
  // The browser offers this once, early; hold on to it for the Install button.
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e as InstallPromptEvent;
    installListeners.forEach((l) => l());
  });
  window.addEventListener('appinstalled', clearInstallPrompt);

  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    // Only a replacement reloads the page; the very first install must not.
    const replacing = Boolean(navigator.serviceWorker.controller);
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!replacing || reloading) return;
      reloading = true;
      window.location.reload();
    });

    const offer = (worker: ServiceWorker) =>
      toast(translate('pwa.updateReady'), {
        duration: Infinity,
        action: { label: translate('crash.reload'), onClick: () => worker.postMessage('skip-waiting') },
      });

    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        if (registration.waiting && navigator.serviceWorker.controller) offer(registration.waiting);
        registration.addEventListener('updatefound', () => {
          const next = registration.installing;
          next?.addEventListener('statechange', () => {
            if (next.state === 'installed' && navigator.serviceWorker.controller) offer(next);
          });
        });
      })
      .catch(() => {
        /* no service worker: the app still works, only not offline */
      });
  });
}
