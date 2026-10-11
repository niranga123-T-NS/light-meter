import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { LineAge, lkr, VALUE_ROLES } from '@/components/StockBits';
import { TestingBanner } from '@/components/Testing';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, Empty, ErrorBanner, ListRow, Loading, Muted, Pill, Row, Screen, Section, Select, styles } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { fmtDate, fmtNumber } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { ROLE_SHORT } from '@/lib/roles';
import { AGE_BANDS, bandOf, flagLabel, oldestBand, type Snapshot, type StockLine } from '@/lib/stock';
import { exportStock } from '@/lib/stockExport';
import { rpc } from '@/lib/supabase';

/** All lines of one SAP stock snapshot: search, filter by category / brand / age / flags, export. */
export default function StockList() {
  const me = useMe();
  const dialog = useDialog();
  const params = useLocalSearchParams<{ s?: string; category?: string }>();
  const values = VALUE_ROLES.includes(me.role);
  const [q, setQ] = useState('');
  const [category, setCategory] = useState(params.category ?? '');
  const [brand, setBrand] = useState('');
  const [age, setAge] = useState('');
  const [flag, setFlag] = useState('');
  const [limit, setLimit] = useState(100);
  const { data, error } = useLoad(async () => {
    const snaps = await rpc<Snapshot[]>('stock_snapshot_list');
    const cur = snaps.find((s) => s.id === params.s) ?? snaps[0];
    return { cur, lines: cur ? await rpc<StockLine[]>('stock_lines', { p_snapshot: cur.id }) : [] };
  }, [params.s]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const { cur, lines } = data;
  if (!cur) return <Screen><Empty title="No SAP stock report yet" /></Screen>;

  const uniq = (f: (l: StockLine) => string | null) => [...new Set(lines.map((l) => f(l) || 'Not set'))].sort();
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = lines.filter(
    (l) =>
      (!category || (l.category || 'Not set') === category) &&
      (!brand || (l.brand || 'Not set') === brand) &&
      (!age || oldestBand(l) === Number(age)) &&
      (!flag || (flag === 'new' ? l.prev_qty == null : flag === 'corrected' ? l.corrected : l.flags.includes(flag) && !(flag === 'uncategorised' && l.corrected))) &&
      words.every((w) => [l.material, l.old_material, l.mpn, l.description].some((x) => x?.toLowerCase().includes(w))),
  );
  const filterText = [category && `Category: ${category}`, brand && `Brand: ${brand}`, age && `Oldest stock: ${bandOf(Number(age) as 1).label}`, q && `Search: ${q}`].filter(Boolean).join(' · ') || 'All items';
  const by = `${me.full_name} – ${ROLE_SHORT[me.role]}`;

  return (
    <Screen maxWidth={1100}>
      <Stack.Screen options={{ title: `Stock list – ${fmtDate(cur.as_at)}` }} />
      <TestingBanner what="Stock (SAP)" always />
      <Card>
        <TextInput value={q} onChangeText={setQ} placeholder="Search description, part number or material number" placeholderTextColor={colors.faint} style={styles.input} />
        <Row wrap gap={8}>
          <View style={{ minWidth: 200, flex: 1 }}>
            <Select label="Category" value={category} onChange={setCategory} options={[{ value: '', label: 'All' }, ...uniq((l) => l.category).map((c) => ({ value: c, label: c }))]} />
          </View>
          <View style={{ minWidth: 180, flex: 1 }}>
            <Select label="Brand" value={brand} onChange={setBrand} options={[{ value: '', label: 'All' }, ...uniq((l) => l.brand).map((c) => ({ value: c, label: c }))]} />
          </View>
          <View style={{ minWidth: 170, flex: 1 }}>
            <Select label="Oldest stock" value={age} onChange={setAge} options={[{ value: '', label: 'Any age' }, ...AGE_BANDS.map((b) => ({ value: String(b.key), label: b.label }))]} />
          </View>
          <View style={{ minWidth: 190, flex: 1 }}>
            <Select
              label="Show"
              value={flag}
              onChange={setFlag}
              options={[
                { value: '', label: 'All lines' },
                { value: 'new', label: 'New since last month' },
                { value: 'uncategorised', label: 'No SAP category' },
                { value: 'corrected', label: 'Category corrected' },
                { value: 'sap_na', label: 'SAP #N/A' },
              ]}
            />
          </View>
        </Row>
        <Row wrap gap={8} style={{ alignItems: 'center' }}>
          <Muted>{`${shown.length} of ${lines.length} items · ${fmtNumber(shown.reduce((a, l) => a + Number(l.qty), 0), 2)} units${values ? ` · ${lkr(shown.reduce((a, l) => a + Number(l.value ?? 0), 0))}` : ''}`}</Muted>
          <Button small variant="secondary" title="PDF" onPress={() => dialog.run(() => exportStock('pdf', cur.as_at, shown, values, filterText, by))} />
          <Button small variant="secondary" title="Excel" onPress={() => dialog.run(() => exportStock('excel', cur.as_at, shown, values, filterText, by))} />
        </Row>
      </Card>
      <Section title="Items">
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {shown.length ? (
            shown.slice(0, limit).map((l) => {
              const ob = bandOf(oldestBand(l));
              return (
                <ListRow
                  key={l.material}
                  wrapRight
                  title={l.description ?? l.material}
                  subtitle={
                    <>
                      <Muted>
                        {[l.material, l.mpn ? `part ${l.mpn}` : null, [l.category, l.sub_category].filter(Boolean).join(' › ') + (l.corrected ? ' (corrected)' : ''), l.brand].filter(Boolean).join(' · ')}
                      </Muted>
                      <LineAge line={l} />
                      {l.flags.filter((f) => !(f === 'uncategorised' && l.corrected)).length ? (
                        <Row gap={4} wrap style={{ marginTop: 4 }}>
                          {l.flags.filter((f) => !(f === 'uncategorised' && l.corrected)).map((f) => (
                            <Pill key={f} label={flagLabel[f]?.label ?? f} tone={flagLabel[f]?.tone} />
                          ))}
                          {l.prev_qty == null ? <Pill label="New" tone={colors.blue} /> : null}
                        </Row>
                      ) : l.prev_qty == null ? <Pill label="New" tone={colors.blue} /> : null}
                    </>
                  }
                  right={
                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      <Text style={{ fontWeight: '700', color: colors.ink }}>{`${fmtNumber(l.qty, 2)} ${l.uom ?? ''}`}</Text>
                      {values ? <Muted>{lkr(l.value)}</Muted> : null}
                      <Pill label={ob.label} tone={ob.tone} />
                    </View>
                  }
                  onPress={() => router.push({ pathname: '/stock/[material]', params: { material: l.material, s: cur.id } })}
                />
              );
            })
          ) : (
            <Empty title="No items match" />
          )}
        </Card>
        {shown.length > limit ? <Button variant="secondary" title={`Show more (${shown.length - limit} more)`} onPress={() => setLimit((n) => n + 200)} /> : null}
      </Section>
    </Screen>
  );
}
