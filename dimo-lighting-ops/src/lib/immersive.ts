import { useSyncExternalStore } from 'react';

/** Full-screen work pages (Design Tools) hide the app's sidebar, banners and bottom bar */
let on = false;
const subs = new Set<() => void>();

export function setImmersive(v: boolean) {
  if (on === v) return;
  on = v;
  subs.forEach((f) => f());
}

export function useImmersive() {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => on,
    () => on,
  );
}
