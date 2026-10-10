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

  // Only the latest call may set the result: an older call finishing later must not overwrite it
  const seq = useRef(0);
  const reload = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    try {
      const value = await loaderRef.current();
      if (mine !== seq.current) return;
      setData(value);
      setError(null);
    } catch (e) {
      if (mine !== seq.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mine === seq.current) setLoading(false);
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
let peopleAt = 0;
let peopleLoading: Promise<Record<string, Profile> | null> | null = null;
const PEOPLE_TTL = 10 * 60 * 1000;

// Names load only once signed in: an empty / failed load (e.g. before the session is restored) is never kept, and a new
// sign-in or session refresh loads them again.
function loadPeople() {
  if (!peopleLoading)
    peopleLoading = Promise.resolve(supabase.from('profiles').select('*'))
      .then(({ data, error }) => {
        if (error || !data?.length) return null;
        peopleCache = Object.fromEntries(data.map((p) => [p.id, p as Profile]));
        peopleAt = Date.now();
        return peopleCache;
      })
      .catch(() => null)
      .finally(() => {
        peopleLoading = null;
      });
  return peopleLoading;
}
supabase.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') peopleCache = null;
});

export function usePeople() {
  const [people, setPeople] = useState<Record<string, Profile>>(peopleCache ?? {});
  useEffect(() => {
    let live = true;
    if (peopleCache && Date.now() - peopleAt < PEOPLE_TTL) return;
    loadPeople().then((map) => {
      if (live && map) setPeople(map);
    });
    return () => {
      live = false;
    };
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
