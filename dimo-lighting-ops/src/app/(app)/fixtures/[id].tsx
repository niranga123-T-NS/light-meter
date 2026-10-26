import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Image, Text, View } from 'react-native';
import { Thumb } from '@/components/tools/FixtureLibrary';
import { Card, colors, ErrorBanner, Loading, Muted, Notice, Row, Screen, Section } from '@/components/ui';
import { cctText, ctrlText, fixtureImage, fmt, loadFixtures, wattText } from '@/lib/fixtures';
import { useLoad } from '@/lib/hooks';

/** One product of the fixture library: photo, full specification, catalogue page and the other models of its family */
export default function FixturePage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, error } = useLoad(() => loadFixtures(), []);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const p = data.products.find((x) => x.id === decodeURIComponent(id));
  if (!p) return <Screen><Notice>Product not found.</Notice></Screen>;
  const family = data.products.filter((x) => x.cat === p.cat && (x.fam ?? x.title) === (p.fam ?? p.title));
  const uri = fixtureImage(p);
  const rows: [string, string | undefined][] = [
    ['Type', p.type],
    ['Power', p.w != null ? `${wattText(p)}${p.wMin ? ' (range of the family)' : ''}${p.steps?.length ? ` (selectable ${p.steps.join(' / ')} W)` : ''}` : undefined],
    ['Lumens', p.lm ? `${p.lmMin && p.lmMin < p.lm ? `${fmt(p.lmMin)} – ` : ''}${fmt(p.lm)} lm${p.lmEst ? ' – estimated from the catalogue lm/W' : ''}${p.lm2 ? ` (standard version ${fmt(p.lm2)} lm)` : ''}` : 'not in the catalogue'],
    ['Efficacy', p.eff ? `${p.eff} lm/W` : undefined],
    ['CCT', cctText(p)],
    ['CRI', p.cri ? `${p.cri}` : undefined],
    ['UGR', p.ugr ? `<${p.ugr}` : undefined],
    ['IP / IK', [p.ip && `IP${p.ip}`, p.ik && `IK${String(p.ik).padStart(2, '0')}`].filter(Boolean).join(' / ') || undefined],
    ['Beam / optic', p.beam],
    ['Control', p.control || ctrlText(p)],
    ['Size (mm)', p.size],
    ['Input voltage', p.voltage],
    ['Surge', p.surge],
    ['LEDs', p.leds],
    ['Housing', p.housing],
    ['Optical cover', p.cover],
    ['Mounting', p.mounting],
    ['Operating temp.', p.temp],
    ['Emergency', [p.emergency && `Mode: ${p.emergency}`, p.aut?.length && `autonomy ${p.aut.join(' / ')} h`, p.visibility && `visibility ${p.visibility}`].filter(Boolean).join(' · ') || undefined],
    ['Warranty', p.warranty ? `${p.warranty} years` : undefined],
    ['LED life', p.life ? `${fmt(p.life)} h` : undefined],
    ['Options', p.extras],
    ['Notes', p.note],
    ['More information', p.url],
  ];
  return (
    <Screen maxWidth={1000}>
      <Stack.Screen options={{ title: `${p.brand} ${p.code}` }} />
      <Row gap={16} wrap style={{ alignItems: 'flex-start' }}>
        <View style={{ width: 300, height: 260, borderRadius: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
          {uri ? <Image source={{ uri }} style={{ width: 290, height: 250 }} resizeMode="contain" /> : <Muted>No photo</Muted>}
        </View>
        <View style={{ flex: 1, minWidth: 260, gap: 6 }}>
          <Text style={{ fontSize: 22, fontWeight: '800', color: colors.ink }}>{`${p.brand} ${p.code}`}</Text>
          <Text style={{ fontSize: 15, color: colors.text }}>{p.title}</Text>
          <Muted>{`${p.src}${p.page ? ` · catalogue page ${p.page}` : ''}`}</Muted>
          {(p.shared ?? 0) > 1 ? <Muted>{`The photo is the family photo – it represents ${p.shared} models (all sizes and wattages of ${p.fam || 'this family'}).`}</Muted> : null}
          {p.flag ? <Notice tone={colors.amber}>{`To check: ${p.flag}`}</Notice> : null}
        </View>
      </Row>
      <Section title="Specification">
        <Card style={{ padding: 0 }}>
          {rows.filter(([, v]) => v).map(([k, v]) => (
            <Row key={k} gap={12} style={{ paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderColor: '#F3F4F6' }}>
              <Text style={{ width: 140, color: colors.muted }}>{k}</Text>
              <Text style={{ flex: 1, color: colors.ink }}>{v}</Text>
            </Row>
          ))}
        </Card>
      </Section>
      {family.length > 1 ? (
        <Section title={`Same family – ${family.length} models`}>
          {family.map((x) => (
            <Card key={x.id} onPress={x.id === p.id ? undefined : () => router.replace(`/fixtures/${encodeURIComponent(x.id)}`)} style={{ padding: 8, opacity: x.id === p.id ? 0.6 : 1 }}>
              <Row gap={10} style={{ alignItems: 'center' }}>
                <Thumb p={x} size={40} />
                <Text style={{ flex: 1, fontWeight: '600', color: colors.ink }}>{x.code}</Text>
                <Muted>{[wattText(x), x.lm && `${fmt(x.lm)} lm`, x.size].filter(Boolean).join(' · ')}</Muted>
              </Row>
            </Card>
          ))}
        </Section>
      ) : null}
    </Screen>
  );
}
