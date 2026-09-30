import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { TextInput } from 'react-native';
import { Card, colors, Empty, ListRow, Muted, Pill, Screen, Section, styles } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { reportsFor } from '@/lib/roles';

/** Reports tab (Section 9.7): only the reports the role may run are listed – others are hidden, not greyed out. */
export default function Reports() {
  const me = useMe();
  const [q, setQ] = useState('');
  const list = reportsFor(me.role).filter((r) => !q.trim() || r.title.toLowerCase().includes(q.trim().toLowerCase()));
  const areas = Array.from(new Set(list.map((r) => r.area)));
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Reports' }} />
      <TextInput value={q} onChangeText={setQ} placeholder="Search reports" placeholderTextColor={colors.faint} style={styles.input} />
      {areas.map((a) => (
        <Section key={a} title={a}>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {list
              .filter((r) => r.area === a)
              .map((r) => (
                <ListRow key={r.key} title={r.title} right={<Pill label={r.scope ?? ''} tone={colors.blue} />} onPress={() => router.push(`/reports/${r.key}`)} />
              ))}
          </Card>
        </Section>
      ))}
      {!list.length ? <Empty title="No reports for your role" /> : null}
      <Muted style={{ marginTop: 12 }}>Your role&apos;s scope is applied automatically and cannot be widened by filters. Every run and download is logged.</Muted>
    </Screen>
  );
}
