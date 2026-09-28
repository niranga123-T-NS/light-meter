import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { errorMessage } from './supabase';

interface State<T> { key: string; data?: T; error: string | null }

/** Load data when deps change, with reload and error state. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): {
  data: T | undefined; error: string | null; loading: boolean; reload: () => Promise<void>;
} {
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<State<T>>({ key: '', error: null });
  const waiters = useRef<(() => void)[]>([]);
  const key = `${JSON.stringify(deps)}#${tick}`;

  useEffect(() => {
    let cancelled = false;
    const settle = (next: (prev: State<T>) => State<T>) => {
      if (cancelled) return;
      setState(next);
      waiters.current.splice(0).forEach((w) => w());
    };
    fn().then(
      (data) => settle(() => ({ key, data, error: null })),
      (e) => settle((prev) => ({ key, data: prev.data, error: errorMessage(e) })),
    );
    return () => {
      cancelled = true;
    };
    // fn is recreated every render; deps (in key) decide when to reload
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const reload = useCallback(() => new Promise<void>((resolve) => {
    waiters.current.push(resolve);
    setTick((t) => t + 1);
  }), []);

  return { data: state.data, error: state.error, loading: state.key !== key, reload };
}

/** Reload when the screen comes back into focus (skips the first focus, which already loaded). */
export function useRefreshOnFocus(reload: () => Promise<void>): void {
  const first = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (first.current) {
        first.current = false;
        return;
      }
      void reload();
    }, [reload]),
  );
}
