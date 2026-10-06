import { Text, View } from 'react-native';
import { Chip, colors, Row } from '@/components/ui';
import { EXEC_AREAS, type ExecFamily } from '@/lib/execution';

const FAMILIES: ExecFamily[] = ['Building & architectural', 'Electrical', 'Controls & measurement', 'Infrastructure', 'Airport systems'];

/** The 18 project areas grouped by family; any combination. */
export function AreaPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const toggle = (a: string) => onChange(value.includes(a) ? value.filter((x) => x !== a) : [...value, a]);
  return (
    <>
      {FAMILIES.map((fam) => (
        <View key={fam} style={{ gap: 6, marginTop: 8 }}>
          <Text style={{ fontWeight: '700', color: colors.ink }}>{fam}</Text>
          <Row wrap gap={6}>
            {EXEC_AREAS.filter((a) => a.family === fam).map((a) => (
              <Chip key={a.value} label={a.label} on={value.includes(a.value)} onPress={() => toggle(a.value)} />
            ))}
          </Row>
        </View>
      ))}
    </>
  );
}
