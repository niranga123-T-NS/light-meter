import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { supabase } from '@/lib/supabase';
import type { BrandLine } from '@/lib/types';
import { Button, Card, colors, Field, Muted, Notice, Row, Select } from './ui';

type Brand = { name: string; origin: string; level: string; country: string | null };

/**
 * Brands and origin per main product group (5.7). Brands come from the maintained brand master list;
 * a mismatch with the client's stated level / origin is highlighted (the server asks for a justification on release).
 */
export function BrandEditor({
  value,
  onChange,
  expectedLevel,
  expectedOrigin,
  readOnly,
}: {
  value: BrandLine[];
  onChange: (v: BrandLine[]) => void;
  expectedLevel?: string | null;
  expectedOrigin?: string | null;
  readOnly?: boolean;
}) {
  const [brands, setBrands] = useState<Brand[]>([]);
  useEffect(() => {
    supabase.from('brands').select('name, origin, level, country').eq('active', true).order('name').then(({ data }) => setBrands((data ?? []) as Brand[]));
  }, []);
  const mismatch = value.some((l) => {
    const b = brands.find((x) => x.name === l.brand);
    return b && ((expectedLevel && b.level !== expectedLevel) || (expectedOrigin && expectedOrigin !== 'no_preference' && b.origin !== expectedOrigin));
  });
  return (
    <View>
      {expectedLevel || expectedOrigin ? (
        <Muted>
          Client expects: {expectedLevel ?? 'any level'} · {expectedOrigin?.replace('_', ' ') ?? 'any origin'}
        </Muted>
      ) : null}
      {value.map((l, i) => (
        <Card key={i} style={{ marginVertical: 4, backgroundColor: colors.soft }}>
          <Row gap={8} wrap>
            <View style={{ flex: 1, minWidth: 160 }}>
              <Field label="Product group" editable={!readOnly} value={l.group} onChangeText={(t) => onChange(value.map((x, j) => (j === i ? { ...x, group: t } : x)))} />
            </View>
            <View style={{ flex: 1, minWidth: 160 }}>
              <Select
                label="Brand"
                disabled={readOnly}
                value={l.brand}
                options={brands.map((b) => ({ value: b.name, label: b.name, hint: `${b.origin} · ${b.level}` }))}
                onChange={(v) => onChange(value.map((x, j) => (j === i ? { ...x, brand: v, origin: brands.find((b) => b.name === v)?.origin } : x)))}
              />
            </View>
          </Row>
          {!readOnly ? <Button small variant="ghost" title="Remove" onPress={() => onChange(value.filter((_, j) => j !== i))} /> : null}
        </Card>
      ))}
      {!readOnly ? <Button small variant="secondary" title="+ Product group" onPress={() => onChange([...value, { group: '', brand: '' }])} /> : null}
      {mismatch ? <Notice tone={colors.amber}>Some brands do not match the client&apos;s stated level or origin – a justification is needed at release.</Notice> : null}
      {!brands.length ? <Muted>No brands in the master list yet – ask the System Administrator to add them.</Muted> : null}
    </View>
  );
}
