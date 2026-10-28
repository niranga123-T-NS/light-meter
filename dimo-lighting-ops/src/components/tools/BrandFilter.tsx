import { useEffect, useState } from 'react';
import { Animated, Platform, Text, View } from 'react-native';
import { Chip, colors, Row } from '@/components/ui';
import { countryList, PRICE_LEVELS, type BrandGroups, type PriceLevel } from '@/lib/fixtures';

/** Brands to search in: all, the brands of one origin or one country of manufacturing (set by the DGM or SM Estimation), or any few brands */
export function BrandFilter({ brands, groups, value, onChange, label = 'Brands' }: { brands: string[]; groups: BrandGroups; value: string[]; onChange: (v: string[]) => void; label?: string }) {
  const toggle = (b: string) => onChange(value.includes(b) ? value.filter((x) => x !== b) : [...value, b]);
  const countries = countryList(groups);
  const groupChips = (title: string, inGroup: (b: string, c: string) => boolean) => {
    const chips = countries
      .map((c) => ({ c, inR: brands.filter((b) => inGroup(b, c)) }))
      .filter((x) => x.inR.length);
    if (!chips.length) return null;
    return (
      <Row gap={6} wrap style={{ alignItems: 'center' }}>
        <Text style={{ fontSize: 12, fontWeight: '700', color: colors.muted, width: 70 }}>{title}</Text>
        {chips.map(({ c, inR }) => {
          const on = inR.every((b) => value.includes(b));
          return <Chip key={c} label={`${c} (${inR.length})`} tone={on ? colors.blue : undefined} on={on} onPress={() => onChange(on ? value.filter((b) => !inR.includes(b)) : [...new Set([...value, ...inR])])} />;
        })}
      </Row>
    );
  };
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontSize: 13, color: colors.muted }}>{value.length ? `${label} – ${value.length} of ${brands.length} chosen` : `${label} – all ${brands.length}`}</Text>
      <Row gap={6} wrap>
        <Chip label="All brands" on={!value.length} onPress={() => onChange([])} />
      </Row>
      {groupChips('Origin', (b, c) => groups.origins[b] === c)}
      {groupChips('Made in', (b, c) => (groups.madeIn[b] ?? []).includes(c))}
      <Row gap={6} wrap>
        {brands.map((b) => <Chip key={b} label={b} on={value.includes(b)} onPress={() => toggle(b)} />)}
      </Row>
    </View>
  );
}

/** Price levels to search in: all, or any of Budget / Mid / Upper Mid / High / Top (products without a level drop out once one is chosen) */
export function PriceFilter({ value, onChange }: { value: PriceLevel[]; onChange: (v: PriceLevel[]) => void }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontSize: 13, color: colors.muted }}>{value.length ? `Price levels – ${value.length} chosen (products without a level are left out)` : 'Price levels – all'}</Text>
      <Row gap={6} wrap>
        <Chip label="All levels" on={!value.length} onPress={() => onChange([])} />
        {PRICE_LEVELS.map((l) => {
          const on = value.includes(l.v);
          return <Chip key={l.v} label={l.label} tone={on ? colors.green : undefined} on={on} onPress={() => onChange(on ? value.filter((x) => x !== l.v) : [...value, l.v])} />;
        })}
      </Row>
    </View>
  );
}

/** A product's price level, shown to everyone */
export function PriceTag({ level }: { level?: PriceLevel }) {
  if (!level) return null;
  return (
    <View style={{ alignSelf: 'flex-start', borderRadius: 999, borderWidth: 1, borderColor: colors.green, paddingHorizontal: 7, paddingVertical: 1 }}>
      <Text style={{ fontSize: 11, fontWeight: '700', color: colors.green }}>{PRICE_LEVELS.find((x) => x.v === level)?.label}</Text>
    </View>
  );
}

/** Warnings on a product (its brand's and its own) as small blinking tags; in the supervisor mode the own ones can be removed */
export function WarningTags({ warnings, onRemove, still }: { warnings?: { text: string; brand: boolean }[]; onRemove?: (text: string, brand: boolean) => void; still?: boolean }) {
  const [op] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (still || !warnings?.length) return;
    const a = Animated.loop(Animated.sequence([
      Animated.timing(op, { toValue: 0.35, duration: 700, useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(op, { toValue: 1, duration: 700, useNativeDriver: Platform.OS !== 'web' }),
    ]));
    a.start();
    return () => a.stop();
  }, [op, still, warnings?.length]);
  if (!warnings?.length) return null;
  return (
    <Row gap={4} wrap>
      {warnings.map((w) => (
        <Animated.View key={`${w.brand}:${w.text}`} style={{ opacity: op, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#FEF2F2', borderColor: '#DC2626', borderWidth: 1, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 1 }}>
          <Text style={{ fontSize: 11, fontWeight: '700', color: '#B91C1C' }}>{`⚠ ${w.text}${onRemove && w.brand ? ' (brand)' : ''}`}</Text>
          {onRemove ? <Text onPress={() => onRemove(w.text, w.brand)} style={{ fontSize: 12, fontWeight: '800', color: '#B91C1C' }}>×</Text> : null}
        </Animated.View>
      ))}
    </Row>
  );
}
