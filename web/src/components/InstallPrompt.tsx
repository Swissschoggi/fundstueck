import { useEffect, useState } from 'react';
import { isIos, isStandalone } from '../lib/pwa';
import { Icon } from './Icon';
import styles from './InstallPrompt.module.css';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'fundstueck.installPromptDismissedAt';
const SNOOZE_MS = 14 * 24 * 3600 * 1000;

function recentlyDismissed(): boolean {
  try {
    const at = Number(window.localStorage.getItem(DISMISS_KEY));
    return Number.isFinite(at) && at > 0 && Date.now() - at < SNOOZE_MS;
  } catch {
    return false;
  }
}

/**
 * Small "install the app" hint on phones. Android/Chrome gets a real install
 * button; iOS Safari has no install API, so it gets Add to Home Screen steps.
 */
export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIos, setShowIos] = useState(false);

  useEffect(() => {
    if (isStandalone() || recentlyDismissed()) return;

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', () => setDeferred(null));

    const mobile = window.matchMedia('(max-width: 767px)').matches;
    if (isIos() && mobile) setShowIos(true);

    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  const dismiss = () => {
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
    setDeferred(null);
    setShowIos(false);
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice.catch(() => undefined);
    setDeferred(null);
  };

  if (!deferred && !showIos) return null;

  return (
    <aside className={styles.banner} role="region" aria-label="Install app">
      <Icon name="install_mobile" size={20} />
      <div className={styles.text}>
        {deferred ? (
          <span>Install Fundstück for quick access and a full-screen app experience.</span>
        ) : (
          <span>
            Install: tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.
          </span>
        )}
      </div>
      {deferred && (
        <button type="button" className={styles.action} onClick={install}>
          Install
        </button>
      )}
      <button type="button" className={styles.close} onClick={dismiss} aria-label="Dismiss">
        <Icon name="close" size={18} />
      </button>
    </aside>
  );
}
