/** Register the service worker (production builds only) and keep it fresh. */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        // Installed PWAs stay alive for days on iOS/Android; check for a new
        // version whenever the app comes back to the foreground.
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') reg.update().catch(() => {});
        });
      })
      .catch(() => {
        /* PWA features are optional; the site works without them. */
      });
  });
}

export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isIos(): boolean {
  const ua = navigator.userAgent;
  // iPadOS 13+ reports as Mac; touch points tell them apart.
  return /iphone|ipad|ipod/i.test(ua) || (ua.includes('Mac') && navigator.maxTouchPoints > 1);
}
