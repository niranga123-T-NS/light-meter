import type { Session } from '@supabase/supabase-js';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from './supabase';
import type { Profile, Role } from './types';

type AuthState = {
  session: Session | null;
  profile: Profile | null;
  role: Role | null;
  loading: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  reloadProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadProfile = useCallback(async (s: Session | null) => {
    if (!s) {
      setProfile(null);
      return;
    }
    const { data, error: e } = await supabase.from('profiles').select('*').eq('id', s.user.id).maybeSingle();
    if (e) setError(e.message);
    else if (!data) setError('Your account has no profile yet. Ask the System Administrator to assign your role.');
    else if (!data.active) setError('Your account has been deactivated.');
    else setError(null);
    setProfile(data && data.active ? (data as Profile) : null);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      await loadProfile(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      loadProfile(s);
    });
    return () => sub.subscription.unsubscribe();
  }, [loadProfile]);

  const value = useMemo<AuthState>(
    () => ({
      session,
      profile,
      role: profile?.role ?? null,
      loading,
      error,
      signIn: async (email, password) => {
        const { error: e } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (e) throw new Error(e.message);
      },
      signOut: async () => {
        await supabase.auth.signOut();
        setProfile(null);
      },
      resetPassword: async (email) => {
        const { error: e } = await supabase.auth.resetPasswordForEmail(email.trim());
        if (e) throw new Error(e.message);
      },
      reloadProfile: () => loadProfile(session),
    }),
    [session, profile, loading, error, loadProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** The signed-in user's profile. Only use inside the signed-in part of the app. */
export function useMe() {
  const { profile } = useAuth();
  if (!profile) throw new Error('Not signed in');
  return profile;
}
