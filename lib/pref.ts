import { useSyncExternalStore } from "react";

// Per-device on/off preferences (sidebar collapsed, zen mode) in localStorage; the server renders them off.
const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
};
const read = (key: string, on: string) => {
  try { return localStorage.getItem(key) === on; } catch { return false; }
};

/** [is it on, set it]; `on`/`off` are the stored strings, so older saved values keep working. */
export function usePref(key: string, on = "on", off = "off") {
  const value = useSyncExternalStore(subscribe, () => read(key, on), () => false);
  const set = (next: boolean) => {
    try { localStorage.setItem(key, next ? on : off); } catch {}
    listeners.forEach((cb) => cb());
  };
  return [value, set] as const;
}
