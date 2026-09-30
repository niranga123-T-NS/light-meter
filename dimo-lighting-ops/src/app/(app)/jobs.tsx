import { useState } from 'react';
import { DesignBoard, EstimationBoard } from '@/components/home/JobBoards';
import { Segmented } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { isDesigner } from '@/lib/roles';

export default function Jobs() {
  const me = useMe();
  const [tab, setTab] = useState<'design' | 'estimation'>('design');
  if (isDesigner(me.role) || me.role === 'design_manager') return <DesignBoard />;
  if (me.role !== 'gm') return <EstimationBoard />;
  const header = (
    <Segmented value={tab} onChange={setTab} options={[{ value: 'design', label: 'Design' }, { value: 'estimation', label: 'Estimation' }]} />
  );
  return tab === 'design' ? <DesignBoard header={header} /> : <EstimationBoard header={header} />;
}
