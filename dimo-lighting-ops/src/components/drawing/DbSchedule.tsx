import { Text, View } from 'react-native';
import { useDialog, type PromptField } from '@/components/dialog';
import { Button, Chip, colors, Muted, Pill, Row } from '@/components/ui';
import { PART_STEPS, PTYPES, ptypeOf, STATUS_COLOR, type DCircuit, type DItem, type DPart } from '@/lib/drawings';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';

type Ins = { id: string; code: string; name: string; serial_no: string | null; calibrated: boolean; cal_expiry: string | null; here: boolean };

const PART_COL: Record<string, string> = { planned: '#9AA0A8', fitted: STATUS_COLOR.second, tested: STATUS_COLOR.tested, failed: STATUS_COLOR.failed };
const CIRC_COL: Record<string, string> = { planned: '#9AA0A8', tested: STATUS_COLOR.tested, failed: STATUS_COLOR.failed };

/**
 * A distribution board's schedule: its components, each with the checks of its type, and its circuits with the test readings.
 * The board is Tested only when every component and every circuit is tested (the database holds the rule).
 */
export function DbSchedule({
  db,
  items,
  canEdit,
  canUpdate,
  canQa,
  people,
  onChange,
}: {
  db: DItem;
  items: DItem[];
  canEdit: boolean;
  canUpdate: boolean;
  /** the project's AE / the SEE send the tests to the QA test records */
  canQa: boolean;
  people: Record<string, { full_name: string } | undefined>;
  onChange: () => Promise<void> | void;
}) {
  const dialog = useDialog();
  const { data, reload } = useLoad(async () => {
    const [p, c] = await Promise.all([
      supabase.from('exec_drawing_db_parts').select('*').eq('item_id', db.id).order('seq'),
      supabase.from('exec_drawing_circuits').select('*').eq('item_id', db.id).order('seq'),
    ]);
    if (p.error) throw new Error(p.error.message);
    const ins = await rpc<Ins[]>('drawing_instruments', { p_exec: db.exec_project_id }).catch(() => [] as Ins[]);
    return { parts: (p.data ?? []) as DPart[], circuits: (c.data ?? []) as DCircuit[], ins };
  }, [db.id]);
  const parts = data?.parts ?? [], circuits = data?.circuits ?? [], ins = data?.ins ?? [];
  const run = (fn: () => Promise<unknown>, ok?: string) =>
    dialog.run(async () => {
      await fn();
      await reload();
      await onChange();
    }, ok);

  const partFields = (p?: DPart): PromptField[] => [
    { key: 'ptype', label: 'Component', type: 'select', required: true, initial: p?.ptype ?? 'mcb', options: Object.entries(PTYPES).map(([k, v]) => ({ value: k, label: v.name })) },
    { key: 'ref', label: 'Reference (e.g. Q1, F3, CT-R)', initial: p?.ref ?? '' },
    { key: 'rating', label: 'Rating (e.g. 100 A, 30 mA, 200/5 A)', initial: p?.rating ?? '' },
    { key: 'poles', label: 'Poles (SP, DP, TP, TPN, 4P)', initial: p?.poles ?? '' },
    { key: 'make', label: 'Make / model', initial: p?.make ?? '' },
    { key: 'qty', label: 'Quantity', initial: String(p?.qty ?? 1) },
  ];

  const updatePart = async (p: DPart) => {
    const t = ptypeOf(p.ptype);
    const v = await dialog.prompt({
      title: `${t.name}${p.ref ? ` ${p.ref}` : ''}`,
      message: 'Tested needs every check ticked.',
      fields: [
        { key: 'st', label: 'Stage', type: 'select', required: true, initial: p.status, options: PART_STEPS.map(([value, label]) => ({ value, label })) },
        ...(t.checks.length ? [{ key: 'ck', label: 'Checks done', type: 'multiselect' as const, initial: t.checks.filter(([k]) => p.checks?.[k]).map(([k]) => k).join(','), options: t.checks.map(([value, label]) => ({ value, label })) }] : []),
        ...t.readings.map(([k, l, u]) => ({ key: `r_${k}`, label: `${l}${u ? ` (${u})` : ''}`, initial: p.readings?.[k] ?? '' })),
        { key: 'note', label: 'What failed?', type: 'multiline', required: true, when: { key: 'st', in: ['failed'] } },
      ],
    });
    if (!v) return;
    const on = (v.ck ?? '').split(',').filter(Boolean);
    const checks = Object.fromEntries(t.checks.map(([k]) => [k, on.includes(k)]));
    const readings = { ...p.readings, ...Object.fromEntries(t.readings.map(([k]) => [k, v[`r_${k}`] ?? ''])) };
    await run(() => rpc('drawing_db_part_status', { p_id: p.id, p_status: v.st, p_checks: checks, p_readings: readings, p_note: v.st === 'failed' ? v.note : null }), 'Saved');
  };

  const typicalSet = async () => {
    const v = await dialog.prompt({
      title: 'Typical set of components',
      message: 'Adds the usual components of a board in one go – change or remove any of them afterwards.',
      fields: [
        { key: 'inc', label: 'Incomer', type: 'select', required: true, initial: 'mccb', options: [{ value: 'acb', label: 'ACB' }, { value: 'mccb', label: 'MCCB' }, { value: 'isol', label: 'Isolator' }, { value: 'mcb', label: 'MCB' }] },
        { key: 'incr', label: 'Incomer rating (e.g. 100 A TPN)', initial: '' },
        { key: 'mcb', label: 'Outgoing MCBs', initial: '12' },
        { key: 'rcbo', label: 'RCBOs', initial: '0' },
        { key: 'rccb', label: 'RCCBs', initial: '0' },
        { key: 'extra', label: 'Also include', type: 'multiselect', initial: 'spd,encl', options: [{ value: 'meter', label: 'Energy meter with 3 CTs' }, { value: 'spd', label: 'SPD' }, { value: 'cont', label: 'Contactor + timer / photocell' }, { value: 'apfc', label: 'Power factor correction' }, { value: 'busbar', label: 'Busbar' }, { value: 'encl', label: 'Enclosure' }] },
      ],
    });
    if (!v) return;
    const ex = (v.extra ?? '').split(',');
    const rows: Record<string, unknown>[] = [{ ptype: v.inc, ref: 'Incomer', rating: v.incr }];
    const n = (x: string) => Math.max(0, Math.min(96, Math.round(Number(x) || 0)));
    if (n(v.mcb)) rows.push({ ptype: 'mcb', ref: 'Outgoing', qty: n(v.mcb) });
    if (n(v.rcbo)) rows.push({ ptype: 'rcbo', ref: 'Outgoing', qty: n(v.rcbo) });
    if (n(v.rccb)) rows.push({ ptype: 'rccb', qty: n(v.rccb) });
    if (ex.includes('meter')) rows.push({ ptype: 'meter', ref: 'Main meter' }, { ptype: 'ct', ref: 'R / Y / B', qty: 3 });
    if (ex.includes('spd')) rows.push({ ptype: 'spd' });
    if (ex.includes('cont')) rows.push({ ptype: 'cont' }, { ptype: 'timer' });
    if (ex.includes('apfc')) rows.push({ ptype: 'apfc' });
    if (ex.includes('busbar')) rows.push({ ptype: 'busbar' });
    if (ex.includes('encl')) rows.push({ ptype: 'encl' });
    await run(async () => {
      for (const r of rows) await rpc('drawing_db_part_save', { p: { item_id: db.id, ...r } });
    }, `${rows.length} components added`);
  };

  const addCircuits = async () => {
    const v = await dialog.prompt({
      title: 'Add circuits',
      message: 'Numbered from the first number on – e.g. L1/1, L1/2 … Circuits with the same reference are updated.',
      fields: [
        { key: 'pre', label: 'Reference before the number (e.g. L1/ or GF-L)', initial: 'L1/' },
        { key: 'from', label: 'First number', required: true, initial: String(circuits.length + 1) },
        { key: 'n', label: 'How many?', required: true, initial: '6' },
        { key: 'desc', label: 'Description (e.g. Lobby lights)', initial: '' },
        { key: 'dev', label: 'Device (e.g. MCB 10 A type B)', initial: '' },
        { key: 'cable', label: 'Cable (e.g. 2.5 mm² 3C)', initial: '' },
        { key: 'phase', label: 'Phase (L1, L2, L3, 3P)', initial: '' },
        { key: 'zs', label: 'Max Zs (Ω) – from the device table', initial: '', hint: 'Leave empty if not set; a test above it is refused' },
      ],
    });
    if (!v) return;
    const from = Math.round(Number(v.from)), n = Math.round(Number(v.n));
    if (!(from >= 0) || !(n >= 1 && n <= 200)) return dialog.toast('Between 1 and 200 circuits at a time', 'error');
    const rows = Array.from({ length: n }, (_, i) => ({ ref: `${v.pre}${from + i}`, description: v.desc || null, device: v.dev || null, cable: v.cable || null, phase: v.phase || null, zs_max: v.zs || null }));
    await run(() => rpc('drawing_circuits_save', { p_item: db.id, p_rows: rows }), `${n} circuit(s) saved`);
  };

  const editCircuit = async (c: DCircuit) => {
    const v = await dialog.prompt({
      title: `Circuit ${c.ref}`,
      fields: [
        { key: 'desc', label: 'Description', initial: c.description ?? '' },
        { key: 'dev', label: 'Device', initial: c.device ?? '' },
        { key: 'cable', label: 'Cable', initial: c.cable ?? '' },
        { key: 'phase', label: 'Phase', initial: c.phase ?? '' },
        { key: 'zs', label: 'Max Zs (Ω)', initial: c.zs_max == null ? '' : String(c.zs_max) },
      ],
    });
    if (v) await run(() => rpc('drawing_circuits_save', { p_item: db.id, p_rows: [{ ref: c.ref, description: v.desc || null, device: v.dev || null, cable: v.cable || null, phase: v.phase || null, zs_max: v.zs || null }] }), 'Saved');
  };

  const testCircuit = async (c: DCircuit) => {
    const r = c.readings ?? {};
    const v = await dialog.prompt({
      title: `Test – circuit ${c.ref}${c.description ? ` ${c.description}` : ''}`,
      message: `Passes with IR ≥ 1 MΩ, polarity right${c.zs_max ? `, Zs ≤ ${c.zs_max} Ω` : ''} and an RCD (if any) within 300 ms.`,
      fields: [
        { key: 'r1r2', label: 'R1 + R2 (Ω)', initial: String(r.r1r2 ?? '') },
        { key: 'ir', label: 'Insulation resistance (MΩ)', initial: String(r.ir ?? '') },
        { key: 'zs', label: 'Zs (Ω)', initial: String(r.zs ?? '') },
        { key: 'rcd_ms', label: 'RCD trip time (ms) – leave empty if none', initial: String(r.rcd_ms ?? '') },
        { key: 'pol', label: 'Polarity', type: 'select', required: true, initial: r.polarity === false ? 'no' : r.polarity ? 'yes' : '', options: [{ value: 'yes', label: 'Right' }, { value: 'no', label: 'Wrong' }] },
        { key: 'st', label: 'Result', type: 'select', required: true, initial: c.status === 'planned' ? 'tested' : c.status, options: [{ value: 'tested', label: 'Passed' }, { value: 'failed', label: 'Failed' }, { value: 'planned', label: 'Not tested yet' }] },
        { key: 'note', label: 'What failed?', type: 'multiline', required: true, when: { key: 'st', in: ['failed'] } },
        {
          key: 'ins',
          label: 'Test instrument',
          type: 'select',
          searchable: true,
          required: true,
          initial: c.instrument_id ?? ins.find((x) => x.here)?.id ?? '',
          options: ins.map((x) => ({ value: x.id, label: `${x.name} · ${x.code}${x.serial_no ? ` · ${x.serial_no}` : ''}${x.here ? ' · on this project' : ''}${x.calibrated ? '' : ' · NOT CALIBRATED'}` })),
          when: { key: 'st', in: ['tested', 'failed'] },
        },
      ],
    });
    if (!v) return;
    const chosen = ins.find((x) => x.id === v.ins);
    let accept = false;
    if (v.st !== 'planned' && chosen && !chosen.calibrated) {
      accept = await dialog.confirm(`${chosen.name} is not calibrated`, `${chosen.cal_expiry ? `Calibration expired ${fmtDate(chosen.cal_expiry)}. ` : ''}The test is flagged and the Senior Electrical Engineer and Operations are told – the readings may not be accepted. Record it anyway?`, { danger: true, confirmLabel: 'Record it' });
      if (!accept) return;
    }
    await run(
      () => rpc('drawing_circuit_test', { p_id: c.id, p_readings: { r1r2: v.r1r2, ir: v.ir, zs: v.zs, rcd_ms: v.rcd_ms, polarity: v.pol === 'yes' }, p_status: v.st, p_note: v.st === 'failed' ? v.note : null, p_instrument: v.st === 'planned' ? null : v.ins || null, p_accept_uncalibrated: accept }),
      v.st === 'tested' ? 'Circuit passed' : 'Saved',
    );
  };

  const pTested = parts.filter((p) => p.status === 'tested').length, cTested = circuits.filter((c) => c.status === 'tested').length;
  const points = (ref: string) => items.filter((x) => x.drawing_id === db.drawing_id && x.id !== db.id && (x.circuit ?? '').trim().toLowerCase() === ref.trim().toLowerCase()).length;

  return (
    <View style={{ gap: 10 }}>
      <View style={{ gap: 4 }}>
        <Row style={{ justifyContent: 'space-between' }} wrap>
          <Text style={{ fontWeight: '700', color: colors.ink }}>{`Components · ${pTested} of ${parts.length} tested`}</Text>
          {canEdit ? (
            <Row gap={6}>
              <Button small variant="secondary" title="+ Typical set" onPress={typicalSet} />
              <Button
                small
                variant="secondary"
                title="+ Component"
                onPress={async () => {
                  const v = await dialog.prompt({ title: 'Add a component', fields: partFields() });
                  if (v) await run(() => rpc('drawing_db_part_save', { p: { item_id: db.id, ...v } }), 'Added');
                }}
              />
            </Row>
          ) : null}
        </Row>
        {parts.length ? (
          parts.map((p) => {
            const t = ptypeOf(p.ptype), done = t.checks.filter(([k]) => p.checks?.[k]).length;
            return (
              <View key={p.id} style={{ paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.line, gap: 3 }}>
                <Row style={{ justifyContent: 'space-between' }} wrap>
                  <Text style={{ color: colors.ink, fontWeight: '600', flexShrink: 1 }}>{`${t.name}${p.ref ? ` · ${p.ref}` : ''}${p.qty > 1 ? ` × ${p.qty}` : ''}`}</Text>
                  <Pill label={PART_STEPS.find((s) => s[0] === p.status)?.[1] ?? p.status} tone={PART_COL[p.status]} />
                </Row>
                <Muted>{[p.rating, p.poles, p.make, `checks ${done}/${t.checks.length}`, p.status === 'failed' ? p.note : null].filter(Boolean).join(' · ')}</Muted>
                <Row gap={6} wrap>
                  {canUpdate ? <Chip label="Update" onPress={() => updatePart(p)} /> : null}
                  {canEdit ? (
                    <Chip
                      label="Edit"
                      onPress={async () => {
                        const v = await dialog.prompt({ title: t.name, fields: partFields(p) });
                        if (v) await run(() => rpc('drawing_db_part_save', { p: { id: p.id, ...v } }), 'Saved');
                      }}
                    />
                  ) : null}
                  {canEdit ? (
                    <Chip
                      label="Remove"
                      onPress={async () => {
                        if (await dialog.confirm(`Remove ${t.name}${p.ref ? ` ${p.ref}` : ''}?`, undefined, { danger: true, confirmLabel: 'Remove' })) await run(() => rpc('drawing_db_part_delete', { p_id: p.id }), 'Removed');
                      }}
                    />
                  ) : null}
                </Row>
              </View>
            );
          })
        ) : (
          <Muted>{canEdit ? 'No components yet – add the typical set, then adjust it to the schedule.' : 'No components listed yet.'}</Muted>
        )}
      </View>
      <View style={{ gap: 4 }}>
        <Row style={{ justifyContent: 'space-between' }} wrap>
          <Text style={{ fontWeight: '700', color: colors.ink }}>{`Circuit schedule · ${cTested} of ${circuits.length} tested`}</Text>
          {canEdit ? <Button small variant="secondary" title="+ Circuits" onPress={addCircuits} /> : null}
        </Row>
        {circuits.length ? (
          circuits.map((c) => {
            const r = c.readings ?? {}, n = points(c.ref);
            const read = c.status === 'planned' ? null : [r.ir ? `IR ${r.ir} MΩ` : null, r.zs ? `Zs ${r.zs} Ω` : null, r.rcd_ms ? `RCD ${r.rcd_ms} ms` : null, c.instrument_id ? (ins.find((x) => x.id === c.instrument_id)?.name ?? 'instrument') : null, c.uncalibrated ? 'UNCALIBRATED instrument' : null].filter(Boolean).join(' · ');
            return (
              <View key={c.id} style={{ paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.line, gap: 3 }}>
                <Row style={{ justifyContent: 'space-between' }} wrap>
                  <Text style={{ color: colors.ink, fontWeight: '600', flexShrink: 1 }}>{`${c.ref}${c.description ? ` · ${c.description}` : ''}`}</Text>
                  <Pill label={c.status === 'tested' ? 'Passed' : c.status === 'failed' ? 'Failed' : 'Not tested'} tone={CIRC_COL[c.status]} />
                </Row>
                <Muted>
                  {[c.phase, c.device, c.cable, c.zs_max ? `max Zs ${c.zs_max} Ω` : null, `${n} point(s) on the drawing`, read, c.tested_at ? `${people[c.tested_by ?? '']?.full_name ?? ''} ${fmtDateTime(c.tested_at)}` : null, c.status === 'failed' ? c.note : null]
                    .filter(Boolean)
                    .join(' · ')}
                </Muted>
                <Row gap={6} wrap>
                  {canUpdate ? <Chip label="Record test" onPress={() => testCircuit(c)} /> : null}
                  {canEdit ? <Chip label="Edit" onPress={() => editCircuit(c)} /> : null}
                  {canEdit ? (
                    <Chip
                      label="Remove"
                      onPress={async () => {
                        if (await dialog.confirm(`Remove circuit ${c.ref}?`, undefined, { danger: true, confirmLabel: 'Remove' })) await run(() => rpc('drawing_circuit_delete', { p_id: c.id }), 'Removed');
                      }}
                    />
                  ) : null}
                </Row>
              </View>
            );
          })
        ) : (
          <Muted>{canEdit ? 'No circuits yet – add them from the DB schedule; items whose circuit matches a reference count as its points.' : 'No circuits listed yet.'}</Muted>
        )}
        <Muted>The board is Tested only when every component and every circuit has passed.</Muted>
        {canQa && circuits.length ? (
          circuits.some((c) => c.status === 'planned') ? (
            <Muted>Once every circuit is tested, the results go to the QA test records in one step.</Muted>
          ) : circuits.every((c) => c.test_record_id) ? (
            <Muted>These results are in the QA test records.</Muted>
          ) : (
            <Row>
              <Button
                small
                variant="secondary"
                title="Send to the QA test records"
                onPress={async () => {
                  const v = await dialog.prompt({ title: 'Send to the QA test records', message: 'One test record with every circuit’s IR, Zs and RCD – verified by the Senior Electrical Engineer; a failure raises an NCR, as usual.', fields: [{ key: 'w', label: 'Witnessed by (client / consultant)' }] });
                  if (v) await run(() => rpc('drawing_db_to_qa', { p_item: db.id, p_witness: v.w || null }), 'Test record created');
                }}
              />
            </Row>
          )
        ) : null}
      </View>
    </View>
  );
}
