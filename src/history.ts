import { useCallback, useEffect, useState } from 'react';
import { File, Paths } from 'expo-file-system';
import type { LightSource } from './useLightLevel';

export type HistoryEntry = {
  id: string;
  lux: number;
  timestamp: number;
  source: LightSource;
};

const MAX_ENTRIES = 500;
const historyFile = () => new File(Paths.document, 'light-history.json');

async function load(): Promise<HistoryEntry[]> {
  try {
    const file = historyFile();
    if (!file.exists) return [];
    const parsed = JSON.parse(await file.text());
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function save(entries: HistoryEntry[]) {
  try {
    const file = historyFile();
    if (!file.exists) file.create();
    file.write(JSON.stringify(entries));
  } catch (e) {
    console.warn('Could not save light history', e);
  }
}

// Saved readings, newest first, persisted to the app's documents folder.
export function useHistory() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    load().then((loaded) => {
      if (!cancelled) setEntries(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const update = useCallback((fn: (prev: HistoryEntry[]) => HistoryEntry[]) => {
    setEntries((prev) => {
      const next = fn(prev);
      save(next);
      return next;
    });
  }, []);

  const add = useCallback(
    (lux: number, source: LightSource) =>
      update((prev) =>
        [{ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, lux, timestamp: Date.now(), source }, ...prev].slice(
          0,
          MAX_ENTRIES,
        ),
      ),
    [update],
  );
  const remove = useCallback((id: string) => update((prev) => prev.filter((e) => e.id !== id)), [update]);
  const clear = useCallback(() => update(() => []), [update]);

  return { entries, add, remove, clear };
}
