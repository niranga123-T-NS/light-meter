import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import type { MasterValue, Profile } from './types';

/**
 * Loads data when the screen gains focus and exposes a reload function.
 * Keeps the previous data while reloading so lists don't flash.
 */
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const loaderRef = useRef(loader);
  useEffect(() => {
    loaderRef.current = loader;
  });
  const depKey = JSON.stringify(deps);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await loaderRef.current());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
      // depKey re-runs the loader when the caller's inputs change
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [reload, depKey]),
  );

  return { data, error, loading, reload, setData };
}

// ---------------------------------------------------------------------------
// Master lists (cached for the session)
// ---------------------------------------------------------------------------
let masterCache: MasterValue[] | null = null;
let masterPromise: Promise<MasterValue[]> | null = null;

export function loadMasters(force = false): Promise<MasterValue[]> {
  if (masterCache && !force) return Promise.resolve(masterCache);
  if (!masterPromise || force) {
    masterPromise = cached('masters', async () => {
      const { data, error } = await supabase
        .from('master_lists')
        .select('list_name, value, grp, tags, sort_order')
        .eq('active', true)
        .order('sort_order');
      if (error) throw new Error(error.message);
      return data as MasterValue[];
    }).then((v) => {
      masterCache = v;
      return v;
    });
  }
  return masterPromise;
}

export function useMasters() {
  const [values, setValues] = useState<MasterValue[]>(masterCache ?? []);
  useEffect(() => {
    loadMasters().then(setValues).catch(() => undefined);
  }, []);
  return {
    list: (name: string) => values.filter((v) => v.list_name === name),
    values: (name: string) => values.filter((v) => v.list_name === name).map((v) => v.value),
    all: values,
  };
}

// ---------------------------------------------------------------------------
// People (names and pictures appear across lists)
// ---------------------------------------------------------------------------
let peopleCache: Record<string, Profile> | null = null;

export function usePeople() {
  const [people, setPeople] = useState<Record<string, Profile>>(peopleCache ?? {});
  useEffect(() => {
    if (peopleCache) return;
    supabase
      .from('profiles')
      .select('*')
      .then(({ data }) => {
        const map = Object.fromEntries((data ?? []).map((p) => [p.id, p as Profile]));
        peopleCache = map;
        setPeople(map);
      });
  }, []);
  return people;
}

export function clearPeopleCache() {
  peopleCache = null;
}

// ---------------------------------------------------------------------------
// Offline cache: keeps the last successful result so field forms still work without signal
// ---------------------------------------------------------------------------
export async function cached<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const storageKey = `dimo.cache.${key}`;
  try {
    const value = await loader();
    AsyncStorage.setItem(storageKey, JSON.stringify(value)).catch(() => undefined);
    return value;
  } catch (e) {
    const raw = await AsyncStorage.getItem(storageKey);
    if (raw) return JSON.parse(raw) as T;
    throw e;
  }
}
