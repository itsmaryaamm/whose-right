import { useEffect, useState } from 'react';

// Chrome/Android fire this event when the app can be installed.
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
}

let deferred: InstallPromptEvent | null = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e as InstallPromptEvent;
  window.dispatchEvent(new Event('whosright-installable'));
});

const DISMISS_KEY = 'whosright.installDismissed';
const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function InstallBanner() {
  const [canPrompt, setCanPrompt] = useState(deferred !== null);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const on = () => setCanPrompt(true);
    window.addEventListener('whosright-installable', on);
    return () => window.removeEventListener('whosright-installable', on);
  }, []);

  if (dismissed || isStandalone() || (!canPrompt && !isIos())) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="install-banner">
      <img src="/icon-192.png" alt="" width="44" height="44" />
      <div className="install-text">
        <b>Add Who’s Right to your home screen</b>
        {canPrompt ? (
          <span>It opens full-screen, like an app.</span>
        ) : (
          <span>
            Tap{' '}
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="Share">
              <path d="M12 3 V15 M7 8 L12 3 L17 8 M5 12 V20 H19 V12" />
            </svg>{' '}
            Share, then <b>Add to Home Screen</b>.
          </span>
        )}
      </div>
      {canPrompt && (
        <button
          className="btn"
          onClick={async () => {
            await deferred?.prompt();
            deferred = null;
            setCanPrompt(false);
          }}
        >
          Install
        </button>
      )}
      <button className="install-close" onClick={dismiss} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}
