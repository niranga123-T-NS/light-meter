import AsyncStorage from '@react-native-async-storage/async-storage';
import { Link, router, usePathname } from 'expo-router';
import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDialog } from '@/components/dialog';
import { useAuth, useMe } from '@/lib/auth';
import { showBrowserNotification } from '@/lib/push';
import { TestingTag } from './Testing';
import { colourSide, navFor, navGrouped, NavItem, ROLE_SHORT, SIDE_COLUMN } from '@/lib/roles';
import { rpc, supabase } from '@/lib/supabase';
import type { AppNotification } from '@/lib/types';
import { BrandLogo } from './BrandLogo';
import { Avatar, Badge, colors } from './ui';
import { BUILD_ID, BUILD_TIME } from './UpdateBanner';

type Counts = { approvals: number; notifications: number; delayed: number };
const CountsContext = createContext<{ counts: Counts; refresh: () => void }>({
  counts: { approvals: 0, notifications: 0, delayed: 0 },
  refresh: () => undefined,
});

export function useShellCounts() {
  return useContext(CountsContext);
}

const POPUP_KINDS = ['meeting_action', 'meeting_invite', 'meeting_invite_approval', 'project_change', 'invoice_request', 'design_note_important', 'eng_job', 'eng_job_hold', 'hse_report', 'hse_action', 'exec_plan_addition', 'exec_access', 'exec_request', 'exec_programme', 'invoice_ready'];

/** Badge counts for the approvals tab, notification bell and delayed inquiries; live via Realtime. */
export function CountsProvider({ children }: { children: ReactNode }) {
  const me = useMe();
  // (the dialog API is a new object on every render – kept in a ref so the Realtime channel is not re-subscribed)
  const dialogApi = useDialog();
  const dialog = useRef(dialogApi);
  useEffect(() => {
    dialog.current = dialogApi;
  });
  const [counts, setCounts] = useState<Counts>({ approvals: 0, notifications: 0, delayed: 0 });

  const refresh = useCallback(async () => {
    const [appr, notes, delayed] = await Promise.all([
      rpc<unknown[]>('my_pending_approvals').catch(() => []),
      supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('recipient_id', me.id).is('read_at', null).is('cleared_at', null),
      supabase.from('inquiries').select('id', { count: 'exact', head: true }).eq(SIDE_COLUMN[colourSide(me.role)], 'red').not('status', 'in', '(won,lost,cancelled)'),
    ]);
    setCounts({ approvals: appr?.length ?? 0, notifications: notes.count ?? 0, delayed: delayed.count ?? 0 });
  }, [me.id, me.role]);

  useEffect(() => {
    const first = setTimeout(refresh, 0);
    const timer = setInterval(refresh, 60_000);
    const channel = supabase
      .channel(`notifications:${me.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${me.id}` }, (payload) => {
        const n = payload.new as AppNotification;
        if (new Date((payload.new as { deliver_after: string }).deliver_after) <= new Date()) {
          showBrowserNotification(n.title, n.body, n.url);
          // Sales meeting follow-ups also pop up in the app
          if (POPUP_KINDS.includes(n.kind)) {
            dialog.current.confirm(n.title, n.body ?? undefined, { confirmLabel: 'Open' }).then((open) => {
              if (open && n.url) router.push(n.url as never);
            });
          }
        }
        refresh();
      })
      .subscribe();
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      supabase.removeChannel(channel);
    };
  }, [me.id, refresh]);

  return <CountsContext.Provider value={{ counts, refresh }}>{children}</CountsContext.Provider>;
}

function isActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Which menu groups a person has open – remembered on this device; every group starts closed. */
function useOpenGroups(userId: string) {
  const key = `dimo.navOpen.${userId}`;
  const [open, setOpen] = useState<Record<string, boolean>>({});
  useEffect(() => {
    AsyncStorage.getItem(key)
      .then((raw) => setOpen(raw ? JSON.parse(raw) : {}))
      .catch(() => undefined);
  }, [key]);
  const set = useCallback(
    (g: string, v: boolean) =>
      setOpen((o) => {
        const n = { ...o, [g]: v };
        AsyncStorage.setItem(key, JSON.stringify(n)).catch(() => undefined);
        return n;
      }),
    [key],
  );
  return [open, set] as const;
}

export function Sidebar() {
  const me = useMe();
  const pathname = usePathname();
  const { counts } = useShellCounts();
  const nav = navFor(me.role, useAuth().realRole, useAuth().sqAccess, useAuth().sqReports);
  const [open, setOpen] = useOpenGroups(me.id);
  const [q, setQ] = useState('');
  const { top, groups } = navGrouped(nav);
  const badgeOf = (i: NavItem) => (i.badgeKey ? counts[i.badgeKey] : 0);
  const match = (i: NavItem) => !q.trim() || i.label.toLowerCase().includes(q.trim().toLowerCase());
  return (
    <View style={{ width: 236, backgroundColor: '#15171C', paddingTop: 18 }}>
      <View style={{ paddingHorizontal: 18, marginBottom: 18 }}>
        <BrandLogo width={150} />
        <Text style={{ color: '#9CA3AF', fontSize: 12, marginTop: 8 }}>Lighting Operations</Text>
      </View>
      {nav.length > 20 ? (
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Find a menu…"
          placeholderTextColor="#6B7280"
          accessibilityLabel="Find a menu"
          style={{ marginHorizontal: 12, marginBottom: 8, backgroundColor: '#1F2228', borderWidth: 1, borderColor: '#2A2D34', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, color: '#E5E7EB', fontSize: 13 }}
        />
      ) : null}
      <ScrollView style={{ flex: 1 }}>
        {top.filter(match).map((item) => (
          <SideLink key={item.href} item={item} active={isActive(pathname, item.href)} badge={badgeOf(item)} />
        ))}
        {top.length ? <View style={{ height: 1, backgroundColor: '#2A2D34', marginHorizontal: 14, marginVertical: 6 }} /> : null}
        {groups.map((g) => {
          const items = g.items.filter(match);
          if (!items.length) return null;
          const here = items.some((i) => isActive(pathname, i.href));
          // closed unless opened; the group of the page you are on opens by itself (until you close it); a search opens them all
          const isOpen = q.trim() ? true : open[g.key] ?? here;
          const badge = items.reduce((t, i) => t + badgeOf(i), 0);
          return (
            <View key={g.key}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: isOpen }}
                onPress={() => setOpen(g.key, !isOpen)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingLeft: 14, paddingRight: 14, marginTop: 2 }}
              >
                <Text style={{ color: '#6B7280', width: 12, fontSize: 10 }}>{isOpen ? '▾' : '▸'}</Text>
                <Text style={{ color: here ? '#E5E7EB' : '#9CA3AF', flex: 1, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.3, textTransform: 'uppercase' }} numberOfLines={1}>
                  {g.label}
                </Text>
                {!isOpen && badge ? <Badge count={badge} /> : null}
                <Text style={{ color: '#6B7280', fontSize: 11 }}>{items.length}</Text>
              </Pressable>
              {isOpen ? items.map((item) => <SideLink key={item.href + item.label} item={item} active={isActive(pathname, item.href)} badge={badgeOf(item)} />) : null}
            </View>
          );
        })}
      </ScrollView>
      <Pressable onPress={() => router.push('/profile')} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderTopWidth: 1, borderTopColor: '#2A2D34' }}>
        <Avatar name={me.full_name} path={me.avatar_path} size={34} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#fff', fontWeight: '600' }} numberOfLines={1}>
            {me.full_name}
          </Text>
          <Text style={{ color: '#9CA3AF', fontSize: 12 }}>{ROLE_SHORT[me.role]}</Text>
        </View>
      </Pressable>
      <Text style={{ color: '#6B7280', fontSize: 10, paddingHorizontal: 14, paddingBottom: 8 }}>
        Version {BUILD_ID}
        {BUILD_TIME ? ` · ${BUILD_TIME}` : ''}
      </Text>
    </View>
  );
}

function SideLink({ item, active, badge }: { item: NavItem; active: boolean; badge: number }) {
  return (
    <Link href={item.href as never} asChild>
      <Pressable
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingVertical: 10,
          paddingHorizontal: 18,
          backgroundColor: active ? '#262A33' : 'transparent',
          borderLeftWidth: 3,
          borderLeftColor: active ? colors.brand : 'transparent',
        }}
      >
        <Text style={{ color: active ? '#fff' : '#9CA3AF', width: 18, textAlign: 'center' }}>{item.icon}</Text>
        <Text style={{ color: active ? '#fff' : '#D1D5DB', flex: 1, fontWeight: active ? '600' : '400' }}>{item.label}</Text>
        {item.testing || item.pilot ? <TestingTag dark always={item.pilot} /> : null}
        <Badge count={badge} />
      </Pressable>
    </Link>
  );
}

export function BottomBar() {
  const me = useMe();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { counts } = useShellCounts();
  const nav = navFor(me.role, useAuth().realRole, useAuth().sqAccess, useAuth().sqReports);
  const main = nav.slice(0, 4);
  const moreActive = !main.some((m) => isActive(pathname, m.href)) && pathname !== '/';
  return (
    <View style={{ flexDirection: 'row', backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: colors.line, paddingBottom: insets.bottom }}>
      {main.map((item) => (
        <TabButton key={item.href} icon={item.icon} label={item.label} active={isActive(pathname, item.href)} badge={item.badgeKey ? counts[item.badgeKey] : 0} onPress={() => router.navigate(item.href as never)} />
      ))}
      <TabButton icon="☰" label="More" active={moreActive} badge={counts.approvals} onPress={() => router.navigate('/more')} />
    </View>
  );
}

function TabButton({ icon, label, active, badge, onPress }: { icon: string; label: string; active: boolean; badge: number; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ flex: 1, alignItems: 'center', paddingTop: 8, paddingBottom: 6 }}>
      <View>
        <Text style={{ fontSize: 18, color: active ? colors.brand : colors.muted }}>{icon}</Text>
        {badge ? (
          <View style={{ position: 'absolute', top: -4, right: -14 }}>
            <Badge count={badge} />
          </View>
        ) : null}
      </View>
      <Text style={{ fontSize: 11, color: active ? colors.brand : colors.muted, fontWeight: active ? '700' : '500' }} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Search box + notification bell shown in every screen header (Section 2 global search). */
export function HeaderActions() {
  const { counts } = useShellCounts();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginRight: Platform.OS === 'web' ? 16 : 0 }}>
      <Pressable accessibilityLabel="Search" onPress={() => router.push('/search')} hitSlop={8}>
        <Text style={{ fontSize: 18, color: colors.ink }}>⌕</Text>
      </Pressable>
      <Pressable accessibilityLabel="Notifications" onPress={() => router.push('/notifications')} hitSlop={8}>
        <Text style={{ fontSize: 18, color: colors.ink }}>🔔</Text>
        {counts.notifications ? (
          <View style={{ position: 'absolute', top: -6, right: -10 }}>
            <Badge count={counts.notifications} />
          </View>
        ) : null}
      </Pressable>
    </View>
  );
}
