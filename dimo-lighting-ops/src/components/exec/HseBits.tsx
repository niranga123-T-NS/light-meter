import { Text, View } from 'react-native';
import { Field, Row, Segmented, colors } from '@/components/ui';
import { ANSWERS, type Answer, type HseItem } from '@/lib/hse';

/** One inspection point / control: Yes · No · N/A with a remark (a "No" asks for it). */
export function AnswerRow({ item, value, onChange, remark = true, noTone = colors.red }: { item: HseItem; value?: Answer; onChange: (a: Answer) => void; remark?: boolean; noTone?: string }) {
  const no = value?.a === 'no';
  return (
    <View style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.line, gap: 4 }}>
      <Row gap={8} style={{ alignItems: 'flex-start' }}>
        <Text style={{ width: 26, fontWeight: '700', color: colors.muted }}>{item.no}</Text>
        <Text style={{ flex: 1, color: no ? noTone : colors.ink, fontWeight: item.critical ? '600' : '400' }}>
          {item.text}
          {item.critical ? '  ⚠' : ''}
        </Text>
      </Row>
      <View style={{ marginLeft: 34, gap: 4 }}>
        <Segmented value={value?.a ?? ('' as 'yes')} onChange={(a) => onChange({ ...value, a })} options={ANSWERS.map((x) => ({ value: x.value, label: x.label }))} />
        {remark && (no || value?.r) ? <Field label={no ? 'What is wrong (remark)' : 'Remark'} value={value?.r ?? ''} onChangeText={(r) => onChange({ ...value, r })} /> : null}
      </View>
    </View>
  );
}

export const allAnswered = (items: HseItem[], answers: Record<string, Answer>) => items.find((it) => !answers[it.no]?.a);
