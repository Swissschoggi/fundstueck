/** Stable anonymous id for this browser, used until the person signs in. */
export function getDeviceId(): string {
  const key = 'fundstueck.deviceId';
  try {
    let id = window.localStorage.getItem(key);
    if (!id) {
      id = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
      window.localStorage.setItem(key, id);
    }
    return id;
  } catch {
    return 'anonymous';
  }
}
