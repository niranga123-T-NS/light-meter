import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { TextInput, View } from 'react-native';
import { Card, colors, Empty, ListRow, Muted, Pill, Screen, Section, styles } from '@/components/ui';
import { human } from '@/lib/format';
import { rpc } from '@/lib/supabase';

type Hit = { kind: string; id: string; title: string; subtitle: string; url: string };
const RECENT_KEY = 'dimo.recentSearch';

/** Global search (Section 2): only records inside the user's scope ever appear. */
export default function Search() {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [recent, setRecent] = useState<Hit[]>([]);

  useEffect(() => {
    AsyncStorage.getItem(RECENT_KEY).then((r) => r && setRecent(JSON.parse(r)));
  }, []);

  useEffect(() => {
    if (q.trim().length < 2) return;
    const t = setTimeout(() => rpc<Hit[]>('global_search', { p_query: q }).then(setHits).catch(() => setHits([])), 250);
    return () => clearTimeout(t);
  }, [q]);

  const open = (h: Hit) => {
    const next = [h, ...recent.filter((r) => r.id !== h.id)].slice(0, 8);
    setRecent(next);
    AsyncStorage.setItem(RECENT_KEY, JSON.stringify(next)).catch(() => undefined);
    router.push(h.url as never);
  };

  const visible = q.trim().length < 2 ? [] : hits;
  const groups = Array.from(new Set(visible.map((h) => h.kind)));
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Search' }} />
      <TextInput
        autoFocus
        value={q}
        onChangeText={setQ}
        placeholder="Customers, units, contacts, projects, inquiries, quotation, tender or invoice numbers…"
        placeholderTextColor={colors.faint}
        style={styles.input}
      />
      {q.trim().length < 2 ? (
        <Section title="Recent">
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {recent.map((h) => (
              <ListRow key={`${h.kind}-${h.id}`} title={h.title} subtitle={h.subtitle} right={<Pill label={human(h.kind)} />} onPress={() => open(h)} />
            ))}
            {!recent.length ? <Muted style={{ padding: 12 }}>Type at least 2 characters – partial words work.</Muted> : null}
          </Card>
        </Section>
      ) : (
        <View>
          {groups.map((g) => (
            <Section key={g} title={`${human(g)}s`}>
              <Card style={{ padding: 0, overflow: 'hidden' }}>
                {visible
                  .filter((h) => h.kind === g)
                  .map((h) => (
                    <ListRow key={`${h.kind}-${h.id}`} title={h.title} subtitle={h.subtitle} onPress={() => open(h)} />
                  ))}
              </Card>
            </Section>
          ))}
          {!visible.length ? <Empty title="No results in your scope" /> : null}
        </View>
      )}
    </Screen>
  );
}
