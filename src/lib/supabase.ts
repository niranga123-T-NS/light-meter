import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import { kv } from './kv';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';

export const isConfigured = !!url && !!key;

export const supabase = createClient(url || 'http://localhost:54321', key || 'missing-key', {
  auth: {
    storage: kv,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === 'web',
    flowType: 'pkce',
  },
});

// Refresh tokens only while the app is in the foreground (native).
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}

/** Human readable message from a Supabase / network error. */
export function errorMessage(e: unknown): string {
  if (!e) return 'Unknown error';
  if (typeof e === 'string') return e;
  const err = e as { message?: string; details?: string; hint?: string };
  return [err.message, err.details && err.details !== err.message ? err.details : null].filter(Boolean).join(' – ') || String(e);
}

/** Throw on a Supabase error, otherwise return data. */
export function unwrap<T>(res: { data: T; error: unknown }): T {
  if (res.error) throw res.error;
  return res.data;
}
