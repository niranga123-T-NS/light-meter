import { Link, router, usePathname } from 'expo-router';
import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDialog } from '@/components/dialog';
import { useMe } from '@/lib/auth';
import { showBrowserNotification } from '@/lib/push';
import { TestingTag } from './Testing';
import { navFor, NavItem, ROLE_SHORT } from '@/lib/roles';
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

const POPUP_KINDS = ['meeting_action', 'meeting_invite', 'meeting_invite_approval', 'project_change', 'invoice_request', 'design_note_important', 'eng_job', 'eng_job_hold', 'hse_report', 'hse_action', 'exec_plan_addition', 'exec_access'];

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
      supabase.from('inquiries').select('id', { count: 'exact', head: true }).eq('sla_colour', 'red').not('status', 'in', '(won,lost,cancelled)'),
    ]);
    setCounts({ approvals: appr?.length ?? 0, notifications: notes.count ?? 0, delayed: delayed.count ?? 0 });
  }, [me.id]);

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

export function Sidebar() {
  const me = useMe();
  const pathname = usePathname();
  const { counts } = useShellCounts();
  const nav = navFor(me.role);
  return (
    <View style={{ width: 236, backgroundColor: '#15171C', paddingTop: 18 }}>
      <View style={{ paddingHorizontal: 18, marginBottom: 18 }}>
        <BrandLogo width={150} />
        <Text style={{ color: '#9CA3AF', fontSize: 12, marginTop: 8 }}>Lighting Operations</Text>
      </View>
      <ScrollView style={{ flex: 1 }}>
        {nav.map((item) => (
          <SideLink key={item.href} item={item} active={isActive(pathname, item.href)} badge={item.badgeKey ? counts[item.badgeKey] : 0} />
        ))}
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
        {item.testing ? <TestingTag dark /> : null}
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
  const nav = navFor(me.role);
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
