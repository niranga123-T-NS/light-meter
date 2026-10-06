import { router, Stack } from 'expo-router';
import { TestingTag } from '@/components/Testing';
import { useShellCounts } from '@/components/AppShell';
import { Avatar, Badge, Card, ListRow, Muted, Screen, Section } from '@/components/ui';
import { useAuth, useMe } from '@/lib/auth';
import { navFor, ROLE_SHORT } from '@/lib/roles';

/** Phone navigation: everything that doesn't fit in the bottom bar. */
export default function More() {
  const me = useMe();
  const { signOut } = useAuth();
  const { counts } = useShellCounts();
  const nav = navFor(me.role).slice(4);
  return (
    <Screen>
      <Stack.Screen options={{ title: 'More' }} />
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <ListRow left={<Avatar name={me.full_name} path={me.avatar_path} size={40} />} title={me.full_name} subtitle={ROLE_SHORT[me.role]} onPress={() => router.push('/profile')} />
      </Card>
      <Section title="Menu">
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {nav.map((n) => (
            <ListRow key={n.href} left={<Muted>{n.icon}</Muted>} title={n.label} right={n.badgeKey ? <Badge count={counts[n.badgeKey]} /> : n.testing ? <TestingTag /> : undefined} onPress={() => router.push(n.href as never)} />
          ))}
          <ListRow left={<Muted>🔔</Muted>} title="Notifications" right={<Badge count={counts.notifications} />} onPress={() => router.push('/notifications')} />
          <ListRow left={<Muted>⌕</Muted>} title="Search" onPress={() => router.push('/search')} />
          <ListRow left={<Muted>⎋</Muted>} title="Sign out" onPress={signOut} />
        </Card>
      </Section>
    </Screen>
  );
}
