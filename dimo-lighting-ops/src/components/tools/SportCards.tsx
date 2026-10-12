import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Button, Card, colors, Grid, Muted, Row, Segmented } from '@/components/ui';
import type { Standard } from '@/lib/standards';

const OUTDOOR = /\(outdoor\)|cricket|rugby|hockey \(field\)|beach|baseball|^elle$|equestrian|cycling track|motor sport|lawn bowls|pétanque|golf|skate park|multi-use games/i;
/** Indoor or outdoor, from the sport's name */
export const sportSetting = (category: string) => (OUTDOOR.test(category) ? 'outdoor' : 'indoor');

const CLASS_TINT: Record<string, string> = { I: '#C8102E', II: '#1D4ED8', III: '#475569' };
const CLASS_HINT: Record<string, string> = { I: 'International / national competition', II: 'Regional and club competition', III: 'Training, schools, recreation' };

/** Sports as cards: one mini table per sport (Class I–III × average lux, uniformity, Ra), indoor and outdoor apart */
export function SportCards({ rows }: { rows: Standard[] }) {
  const [where, setWhere] = useState<'all' | 'indoor' | 'outdoor'>('all');
  const sports = new Map<string, Standard[]>();
  for (const r of rows) sports.set(r.category, [...(sports.get(r.category) ?? []), r]);
  const all = [...sports.entries()].map(([name, list]) => ({ name, setting: sportSetting(name), list: [...list].sort((a, b) => String(a.vals?.cls ?? '').length - String(b.vals?.cls ?? '').length) }));
  const count = (s: 'indoor' | 'outdoor') => all.filter((x) => x.setting === s).length;
  const sections = (['indoor', 'outdoor'] as const).filter((s) => where === 'all' || where === s);

  return (
    <View style={{ gap: 10 }}>
      <Segmented
        value={where}
        onChange={setWhere}
        options={[
          { value: 'all', label: `All sports (${all.length})` },
          { value: 'indoor', label: `Indoor (${count('indoor')})` },
          { value: 'outdoor', label: `Outdoor (${count('outdoor')})` },
        ]}
      />
      <Row gap={14} wrap>
        {Object.keys(CLASS_TINT).map((c) => (
          <Row key={c} gap={6} style={{ alignItems: 'center' }}>
            <View style={{ backgroundColor: CLASS_TINT[c], borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1 }}>
              <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{c}</Text>
            </View>
            <Text style={{ fontSize: 12, color: colors.muted }}>{CLASS_HINT[c]}</Text>
          </Row>
        ))}
      </Row>
      {sections.map((s) => (
        <View key={s} style={{ gap: 8 }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: colors.muted, letterSpacing: 0.6, marginTop: 4 }}>{s === 'indoor' ? 'INDOOR SPORTS' : 'OUTDOOR SPORTS'}</Text>
          <Grid min={260} max={3}>
            {all
              .filter((x) => x.setting === s)
              .map((x) => (
                <Card key={x.name} style={{ gap: 6, padding: 12 }}>
                  <Text style={{ fontWeight: '700', fontSize: 14, color: colors.ink }}>{x.name.replace(/ \((indoor|outdoor)\)$/i, '')}</Text>
                  <View style={{ borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 8, overflow: 'hidden' }}>
                    <Row style={{ backgroundColor: '#F3F4F6', paddingVertical: 5, paddingHorizontal: 8 }}>
                      <Text style={[th, { flex: 1.1 }]}>Class</Text>
                      <Text style={[th, { flex: 1, textAlign: 'right' }]}>Em lx</Text>
                      <Text style={[th, { flex: 0.8, textAlign: 'right' }]}>Uo</Text>
                      <Text style={[th, { flex: 0.8, textAlign: 'right' }]}>Ra</Text>
                    </Row>
                    {x.list.map((r, i) => {
                      const cls = String(r.vals?.cls ?? '');
                      return (
                        <Pressable key={r.id} onPress={() => router.push(`/tools/standard/${r.id}`)} style={({ pressed }) => ({ backgroundColor: pressed ? '#FDECEF' : i % 2 ? '#FAFAFA' : '#fff' })}>
                          <Row style={{ paddingVertical: 6, paddingHorizontal: 8, alignItems: 'center', borderTopWidth: 1, borderTopColor: '#F1F1F1' }}>
                            <View style={{ flex: 1.1 }}>
                              <View style={{ alignSelf: 'flex-start', backgroundColor: CLASS_TINT[cls] ?? colors.muted, borderRadius: 4, paddingHorizontal: 7, paddingVertical: 1 }}>
                                <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{cls || '—'}</Text>
                              </View>
                            </View>
                            <Text style={[td, { flex: 1, fontWeight: '700' }]}>{r.vals?.em ?? '—'}</Text>
                            <Text style={[td, { flex: 0.8 }]}>{r.vals?.uo ?? '—'}</Text>
                            <Text style={[td, { flex: 0.8 }]}>{r.vals?.ra ?? '—'}</Text>
                          </Row>
                        </Pressable>
                      );
                    })}
                  </View>
                  {x.list[0]?.notes ? <Muted>{x.list[0].notes}</Muted> : null}
                  <Row gap={6} wrap>
                    <Button small variant="ghost" title="Details & share" onPress={() => router.push(`/tools/standard/${x.list[0].id}`)} />
                    <Button small variant="ghost" title="Use in DLux" onPress={() => router.push(`/tools/calc/new?std=${x.list[0].id}`)} />
                  </Row>
                </Card>
              ))}
          </Grid>
        </View>
      ))}
    </View>
  );
}

const th = { fontSize: 11, fontWeight: '700' as const, color: '#4B5563' };
const td = { fontSize: 13, color: '#111827', textAlign: 'right' as const };
