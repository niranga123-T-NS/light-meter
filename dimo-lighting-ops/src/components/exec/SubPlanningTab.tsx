import { useState } from 'react';
import { View } from 'react-native';
import { Segmented } from '@/components/ui';
import type { ExecProject } from '@/lib/execution';
import { HseTab } from './HseTab';
import { SubPlanView } from './SubPlanView';

/** The subcontractor supervisor's Planning tab: the weekly / daily plan, the work permits and the toolbox meetings. */
export function SubPlanningTab({ p }: { p: ExecProject }) {
  const [part, setPart] = useState<'plan' | 'permits' | 'tbt'>('plan');
  return (
    <View style={{ gap: 8 }}>
      <Segmented
        value={part}
        onChange={setPart}
        options={[
          { value: 'plan', label: 'Plan' },
          { value: 'permits', label: 'Work permits' },
          { value: 'tbt', label: 'Toolbox meetings' },
        ]}
      />
      {part === 'plan' ? <SubPlanView project={p.id} fixedProject /> : <HseTab p={p} mode={part} />}
    </View>
  );
}
