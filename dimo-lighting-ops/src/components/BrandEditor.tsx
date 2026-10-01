import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useMe } from '@/lib/auth';
import { brandFields, canAddBrand } from '@/lib/brands';
import { supabase } from '@/lib/supabase';
import type { BrandLine } from '@/lib/types';
import { useDialog } from './dialog';
import { Button, Card, colors, Field, Muted, Notice, Row, Select } from './ui';

type Brand = { name: string; origin: string; level: string; country: string | null; status: string };

/**
 * Brands and origin per main product group (5.7). Brands come from the brand master list, which designers and
 * estimators extend with "+ New brand" (pending until the Design Manager / SM Estimation approve);
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
  const me = useMe();
  const dialog = useDialog();
  const [brands, setBrands] = useState<Brand[]>([]);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    supabase
      .from('brands')
      .select('name, origin, level, country, status')
      .eq('active', true)
      .neq('status', 'rejected')
      .order('name')
      .then(({ data }) => setBrands((data ?? []) as Brand[]));
  }, [version]);

  // Add a brand that is not in the list yet: usable at once, recorded for future use and reviewed by the managers
  const addBrand = async (line: number) => {
    const r = await dialog.prompt({ title: 'New brand', fields: brandFields() });
    if (!r) return;
    await dialog.run(async () => {
      const { data, error } = await supabase
        .from('brands')
        .insert({ name: r.name, manufacturer: r.manufacturer || null, country: r.country || null, origin: r.origin, level: r.level })
        .select('name, origin')
        .single();
      if (error) throw new Error(error.message);
      setVersion((v) => v + 1);
      onChange(value.map((x, j) => (j === line ? { ...x, brand: data.name, origin: data.origin } : x)));
    }, 'Brand added and recorded for future use');
  };
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
                options={brands.map((b) => ({ value: b.name, label: b.name, hint: `${b.origin} · ${b.level}${b.status === 'pending' ? ' · pending approval' : ''}` }))}
                onChange={(v) => onChange(value.map((x, j) => (j === i ? { ...x, brand: v, origin: brands.find((b) => b.name === v)?.origin } : x)))}
              />
            </View>
          </Row>
          {!readOnly ? (
            <Row gap={8} wrap>
              {canAddBrand(me.role) ? <Button small variant="ghost" title="+ New brand" onPress={() => addBrand(i)} /> : null}
              <Button small variant="ghost" title="Remove" onPress={() => onChange(value.filter((_, j) => j !== i))} />
            </Row>
          ) : null}
        </Card>
      ))}
      {!readOnly ? <Button small variant="secondary" title="+ Product group" onPress={() => onChange([...value, { group: '', brand: '' }])} /> : null}
      {mismatch ? <Notice tone={colors.amber}>Some brands do not match the client&apos;s stated level or origin – a justification is needed at release.</Notice> : null}
      {!brands.length ? <Muted>No brands in the list yet – use “+ New brand” to add one.</Muted> : null}
    </View>
  );
}
