import { useState } from 'react';
import { View } from 'react-native';
import { Segmented } from '@/components/ui';
import type { ExecProject } from '@/lib/execution';
import { HseTab } from './HseTab';
import { MaterialIssues, StoreBalances } from './MaterialStore';
import { SubPlanView } from './SubPlanView';

/** The subcontractor supervisor's Planning tab: the weekly / daily plan, the work permits, the toolbox meetings and issuing material to the crew. */
export function SubPlanningTab({ p }: { p: ExecProject }) {
  const [part, setPart] = useState<'plan' | 'permits' | 'tbt' | 'materials'>('plan');
  return (
    <View style={{ gap: 8 }}>
      <Segmented
        value={part}
        onChange={setPart}
        options={[
          { value: 'plan', label: 'Plan' },
          { value: 'permits', label: 'Work permits' },
          { value: 'tbt', label: 'Toolbox meetings' },
          { value: 'materials', label: 'Materials' },
        ]}
      />
      {part === 'plan' ? (
        <SubPlanView project={p.id} fixedProject />
      ) : part === 'materials' ? (
        <View style={{ gap: 12 }}>
          <MaterialIssues p={p} aeOfProject={false} />
          <StoreBalances p={p} aeOfProject={false} />
        </View>
      ) : (
        <HseTab p={p} mode={part} />
      )}
    </View>
  );
}
