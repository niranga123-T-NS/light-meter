// Session, profile and app bootstrap (offline cache, outbox, sync triggers).
import type { Session } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import * as Network from 'expo-network';
import * as WebBrowser from 'expo-web-browser';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';

import { cacheStore, clearCache, loadCache } from './cache';
import { kv } from './kv';
import { initNotifications, registerPushToken, scheduleActionReminders } from './notifications';
import { loadOutbox, outboxStore, setSyncState } from './outbox';
import { errorMessage, supabase } from './supabase';
import { syncNow } from './sync';
import type { Profile, Role } from './types';

interface SessionValue {
  ready: boolean;
  session: Session | null;
  profile: Profile | null;
  role: Role | null;
  isManager: boolean;
  isAdmin: boolean;
  canSell: boolean;
  signIn(email: string, password: string): Promise<string | null>;
  signInWithMicrosoft(): Promise<string | null>;
  signOut(): Promise<void>;
  reloadProfile(): Promise<void>;
  sync(opts?: { includeFailed?: boolean }): Promise<void>;
}

const Ctx = createContext<SessionValue | null>(null);
const PROFILE_KEY = 'dimo:profile:v1';

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const userId = session?.user.id ?? null;

  const loadProfile = useCallback(async (uid: string) => {
    try {
      const [{ data, error }, terr] = await Promise.all([
        supabase.from('profiles').select('id,email,full_name,phone,role,active,business_unit_id').eq('id', uid).single(),
        supabase.from('profile_territories').select('territory_id').eq('user_id', uid),
      ]);
      if (error) throw error;
      const p = { ...(data as Profile), territory_ids: (terr.data ?? []).map((t: { territory_id: string }) => t.territory_id) };
      setProfile(p);
      await kv.setItem(PROFILE_KEY, JSON.stringify(p));
    } catch {
      // offline: use the last known profile for this user
      const raw = await kv.getItem(PROFILE_KEY);
      const cached = raw ? (JSON.parse(raw) as Profile) : null;
      setProfile(cached?.id === uid ? cached : null);
    }
  }, []);

  // Bootstrap: local stores first (instant, offline), then the session
  useEffect(() => {
    let mounted = true;
    (async () => {
      await Promise.all([loadCache(), loadOutbox()]);
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      setSession(data.session);
      if (data.session) await loadProfile(data.session.user.id);
      setReady(true);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      // defer: Supabase calls must not run inside this callback
      if (event === 'SIGNED_IN' && s) setTimeout(() => void loadProfile(s.user.id), 0);
      if (event === 'SIGNED_OUT') setProfile(null);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const sync = useCallback(async (opts?: { includeFailed?: boolean }) => {
    if (!userId) return;
    await syncNow(userId, opts);
  }, [userId]);

  // Sync on sign-in, when the app returns to the foreground and when the network comes back
  useEffect(() => {
    if (!userId || !profile?.active) return;
    void sync();
    void (async () => {
      if (await initNotifications()) {
        await scheduleActionReminders(cacheStore.get().myActions);
        await registerPushToken(userId);
      }
    })();
    const appSub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void sync();
    });
    const netSub = Network.addNetworkStateListener((state) => {
      const online = !!state.isConnected && state.isInternetReachable !== false;
      const wasOnline = outboxStore.get().online;
      setSyncState({ online });
      if (online && !wasOnline) void sync();
    });
    // periodic retry while queued items remain
    const timer = setInterval(() => {
      const hasQueued = Object.values(outboxStore.get().items).some((i) => i.status === 'queued');
      if (hasQueued) void sync();
    }, 2 * 60 * 1000);
    return () => {
      appSub.remove();
      netSub.remove();
      clearInterval(timer);
    };
  }, [userId, profile?.active, sync]);

  const value = useMemo<SessionValue>(() => ({
    ready,
    session,
    profile,
    role: profile?.active ? profile.role : null,
    isManager: !!profile?.active && (profile.role === 'manager' || profile.role === 'admin'),
    isAdmin: !!profile?.active && profile.role === 'admin',
    canSell: !!profile?.active && profile.role !== 'estimator',
    async signIn(email, password) {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      return error ? errorMessage(error) : null;
    },
    async signInWithMicrosoft() {
      // Company sign-in through Supabase's Azure (Microsoft Entra ID) provider, PKCE flow
      if (Platform.OS === 'web') {
        const { error } = await supabase.auth.signInWithOAuth({
          provider: 'azure',
          options: { scopes: 'email', redirectTo: typeof window !== 'undefined' ? window.location.origin : undefined },
        });
        return error ? errorMessage(error) : null;
      }
      const redirectTo = Linking.createURL('sign-in');
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'azure',
        options: { scopes: 'email', redirectTo, skipBrowserRedirect: true },
      });
      if (error || !data.url) return errorMessage(error ?? 'Microsoft sign-in is not configured');
      const res = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (res.type !== 'success') return null;
      const code = new URL(res.url).searchParams.get('code');
      if (!code) return 'Microsoft sign-in did not return a code';
      const exchanged = await supabase.auth.exchangeCodeForSession(code);
      return exchanged.error ? errorMessage(exchanged.error) : null;
    },
    async signOut() {
      const pending = Object.values(outboxStore.get().items).filter((i) => i.status !== 'synced').length;
      if (pending) throw new Error(`${pending} visit(s) are not synced yet. Sync or delete them before signing out.`);
      await supabase.auth.signOut();
      await clearCache();
      await kv.removeItem(PROFILE_KEY);
      setProfile(null);
    },
    reloadProfile: async () => {
      if (userId) await loadProfile(userId);
    },
    sync,
  }), [ready, session, profile, userId, loadProfile, sync]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession must be used inside SessionProvider');
  return v;
}
