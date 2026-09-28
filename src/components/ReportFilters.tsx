// Shared report filters (date range, owner, territory, stage) for the dashboard and exports.
import { useState } from 'react';
import { View } from 'react-native';

import { addDaysIso, todayIso } from '@/lib/format';
import { stageOptions, territoryOptions, userOptions } from '@/lib/options';
import type { ReportFilters } from '@/lib/types';

import { DateField, SelectField } from './form';
import { Button, Chip, Row, space } from './ui';

export function presetRange(key: string): { from: string; to: string } {
  const today = todayIso();
  const [y, m] = today.split('-').map(Number);
  switch (key) {
    case '7d': return { from: addDaysIso(today, -6), to: today };
    case '30d': return { from: addDaysIso(today, -29), to: today };
    case 'quarter': {
      const qStart = Math.floor((m - 1) / 3) * 3 + 1;
      return { from: `${y}-${String(qStart).padStart(2, '0')}-01`, to: today };
    }
    case 'ytd': return { from: `${y}-01-01`, to: today };
    case 'last_month': {
      const first = `${y}-${String(m).padStart(2, '0')}-01`;
      const prevEnd = addDaysIso(first, -1);
      return { from: `${prevEnd.slice(0, 7)}-01`, to: prevEnd };
    }
    default: return { from: `${today.slice(0, 7)}-01`, to: today };
  }
}

const PRESETS = [
  { key: 'month', label: 'This month' }, { key: 'last_month', label: 'Last month' }, { key: '30d', label: '30 days' },
  { key: 'quarter', label: 'Quarter' }, { key: 'ytd', label: 'Year to date' },
];

export function ReportFilterBar({ value, onChange, showStage = true }: { value: ReportFilters; onChange: (f: ReportFilters) => void; showStage?: boolean }) {
  const [custom, setCustom] = useState(false);
  const active = PRESETS.find((p) => {
    const r = presetRange(p.key);
    return r.from === value.from && r.to === value.to;
  })?.key;
  return (
    <View style={{ gap: space.sm }}>
      <Row wrap>
        {PRESETS.map((p) => (
          <Chip key={p.key} label={p.label} selected={!custom && active === p.key} onPress={() => { setCustom(false); onChange({ ...value, ...presetRange(p.key) }); }} />
        ))}
        <Chip label="Custom" selected={custom || !active} onPress={() => setCustom(true)} />
      </Row>
      {custom ? (
        <Row wrap style={{ alignItems: 'flex-start' }}>
          <View style={{ flex: 1, minWidth: 150 }}><DateField label="From" quick={false} value={value.from} onChange={(d) => onChange({ ...value, from: d })} /></View>
          <View style={{ flex: 1, minWidth: 150 }}><DateField label="To" quick={false} value={value.to} onChange={(d) => onChange({ ...value, to: d })} /></View>
        </Row>
      ) : null}
      <Row wrap style={{ alignItems: 'flex-start' }}>
        <View style={{ flex: 1, minWidth: 160 }}>
          <SelectField label="Owner" value={value.owner_id} options={userOptions(['salesperson', 'manager', 'admin'])} onChange={(x) => onChange({ ...value, owner_id: x })} placeholder="Everyone" />
        </View>
        <View style={{ flex: 1, minWidth: 160 }}>
          <SelectField label="Territory" value={value.territory_id} options={territoryOptions()} onChange={(x) => onChange({ ...value, territory_id: x })} placeholder="All territories" />
        </View>
        {showStage ? (
          <View style={{ flex: 1, minWidth: 160 }}>
            <SelectField label="Stage" value={value.stage_id} options={stageOptions()} onChange={(x) => onChange({ ...value, stage_id: x })} placeholder="All stages" />
          </View>
        ) : null}
      </Row>
      {value.owner_id || value.territory_id || value.stage_id ? (
        <Button small variant="ghost" title="Clear owner / territory / stage" onPress={() => onChange({ from: value.from, to: value.to })} />
      ) : null}
    </View>
  );
}
