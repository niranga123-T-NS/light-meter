import { Text, View } from 'react-native';
import { Chip, colors, Row } from '@/components/ui';
import { REGIONS, type Region } from '@/lib/fixtures';

/** Brands to search in: all, a category (European / China / Local / Other, set by the DGM or SM Estimation) or any few brands */
export function BrandFilter({ brands, regions, value, onChange, label = 'Brands' }: { brands: string[]; regions: Record<string, Region>; value: string[]; onChange: (v: string[]) => void; label?: string }) {
  const toggle = (b: string) => onChange(value.includes(b) ? value.filter((x) => x !== b) : [...value, b]);
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontSize: 13, color: colors.muted }}>{value.length ? `${label} – ${value.length} of ${brands.length} chosen` : `${label} – all ${brands.length}`}</Text>
      <Row gap={6} wrap>
        <Chip label="All brands" on={!value.length} onPress={() => onChange([])} />
        {REGIONS.map((r) => {
          const inR = brands.filter((b) => regions[b] === r.v);
          if (!inR.length) return null;
          const on = inR.every((b) => value.includes(b));
          return <Chip key={r.v} label={`${r.label} (${inR.length})`} tone={on ? colors.blue : undefined} on={on} onPress={() => onChange(on ? value.filter((b) => !inR.includes(b)) : [...new Set([...value, ...inR])])} />;
        })}
      </Row>
      <Row gap={6} wrap>
        {brands.map((b) => <Chip key={b} label={b} on={value.includes(b)} onPress={() => toggle(b)} />)}
      </Row>
    </View>
  );
}
