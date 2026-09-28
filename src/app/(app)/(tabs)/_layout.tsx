import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';

import { colors } from '@/components/ui';
import { useOutbox } from '@/lib/outbox';
import { useSession } from '@/lib/session';

type IconName = ComponentProps<typeof Ionicons>['name'];
const icon = (name: IconName) => function TabIcon({ color, size }: { color: ColorValue; size: number }) {
  return <Ionicons name={name} color={color as string} size={size} />;
};

export default function TabsLayout() {
  const { isManager } = useSession();
  const attention = useOutbox((s) => Object.values(s.items).filter((i) => i.status === 'needs_attention' || i.status === 'queued').length);
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.primary },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '700' },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Today', tabBarIcon: icon('today-outline'), tabBarBadge: attention || undefined }} />
      <Tabs.Screen name="customers" options={{ title: 'Customers', tabBarIcon: icon('business-outline') }} />
      <Tabs.Screen name="projects" options={{ title: 'Projects', tabBarIcon: icon('construct-outline') }} />
      <Tabs.Screen name="actions" options={{ title: 'Actions', tabBarIcon: icon('checkbox-outline') }} />
      <Tabs.Screen name="dashboard" options={{ title: 'Dashboard', tabBarIcon: icon('stats-chart-outline'), href: isManager ? undefined : null }} />
      <Tabs.Screen name="more" options={{ title: 'More', tabBarIcon: icon('menu-outline') }} />
    </Tabs>
  );
}
