import type { Session } from '@supabase/supabase-js';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { normPhone } from './execution';
import { clearDeviceData } from './offline';
import { setHighLevelView, supabase } from './supabase';
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
  /** The user's own role, also while viewing as a high level user */
  realRole: Role | null;
  /** High level access (view only) in force now, given by the GM / DGM */
  highLevel: { id: string; ends_at: string } | null;
  highLevelOn: boolean;
  setHighLevelOn: (on: boolean) => void;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [highLevel, setHighLevel] = useState<{ id: string; ends_at: string } | null>(null);
  const [highLevelOn, setOn] = useState(false);
  const setHighLevelOn = useCallback((on: boolean) => {
    setHighLevelView(on);
    setOn(on);
  }, []);

  // High level access: checked on sign-in, every 5 minutes and at its end time; viewing stops when it ends
  const loadHighLevel = useCallback(async (uid: string | null) => {
    const now = new Date().toISOString();
    const { data } = uid
      ? await supabase
          .from('high_level_grants')
          .select('id, ends_at')
          .eq('user_id', uid)
          .is('cancelled_at', null)
          .lte('starts_at', now)
          .gt('ends_at', now)
          .order('ends_at', { ascending: false })
          .limit(1)
      : { data: [] };
    const g = ((data ?? [])[0] as { id: string; ends_at: string } | undefined) ?? null;
    setHighLevel(g);
    if (!g) {
      // ended or cancelled: back to the user's own view
      setHighLevelView(false);
      setOn(false);
    }
  }, []);
  const uid = session?.user.id ?? null;
  useEffect(() => {
    const run = () => {
      loadHighLevel(uid);
    };
    const t0 = setTimeout(run, 0);
    const t = setInterval(run, 5 * 60 * 1000);
    return () => {
      clearTimeout(t0);
      clearInterval(t);
    };
  }, [uid, loadHighLevel]);
  useEffect(() => {
    if (!highLevel) return;
    // at the end time: stop viewing as a high level user
    const t = setTimeout(() => loadHighLevel(uid), Math.max(0, Math.min(Date.parse(highLevel.ends_at) - Date.now() + 1000, 2 ** 31 - 1)));
    return () => clearTimeout(t);
  }, [highLevel, uid, loadHighLevel]);

  const loadProfile = useCallback(async (s: Session | null) => {
    if (!s) {
      setProfile(null);
      return;
    }
    const { data, error: e } = await supabase.from('profiles').select('*').eq('id', s.user.id).maybeSingle();
    if (e) setError(e.message);
    else if (!data) setError('Your account has no profile yet. Ask the System Administrator to assign your role.');
    else if (!data.active) {
      setError('Your access has ended. Ask the Senior Electrical Engineer or the System Administrator if this is wrong.');
      // Access removed: clear data kept on this device and end the session
      await clearDeviceData();
      await supabase.auth.signOut();
    }
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

  // A person from outside (guest) has no view of their own: during the period they always view as a high level user
  const guest = profile?.role === 'guest';
  const viewing = !!highLevel && (highLevelOn || guest);
  useEffect(() => {
    if (guest) setHighLevelView(!!highLevel);
  }, [guest, highLevel]);

  const value = useMemo<AuthState>(
    () => ({
      session,
      profile: profile && viewing ? { ...profile, role: 'gm' as Role } : profile,
      role: profile && viewing ? ('gm' as Role) : (profile?.role ?? null),
      realRole: profile?.role ?? null,
      highLevel,
      highLevelOn: viewing,
      setHighLevelOn,
      loading,
      error,
      signIn: async (email, password) => {
        // Subcontractor supervisors sign in with their mobile number
        const id = email.trim();
        // logins are stored in lower case – a tablet capitalising "Sampath.M…@…" must still match
        const login = id.includes('@') ? id.toLowerCase() : `${normPhone(id)}@users.dimo-lighting-ops.app`;
        const { error: e } = await supabase.auth.signInWithPassword({ email: login, password });
        if (e) throw new Error(e.message);
      },
      signOut: async () => {
        setHighLevelOn(false);
        await supabase.auth.signOut();
        setProfile(null);
      },
      resetPassword: async (email) => {
        const { error: e } = await supabase.auth.resetPasswordForEmail(email.trim());
        if (e) throw new Error(e.message);
      },
      reloadProfile: () => loadProfile(session),
    }),
    [session, profile, loading, error, loadProfile, highLevel, viewing, setHighLevelOn],
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
