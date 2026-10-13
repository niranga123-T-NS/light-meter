import type { useDialog } from '@/components/dialog';
import type { Option } from '@/components/ui';
import { fmtDate } from '@/lib/format';
import { todayIso, type FoOrder, type Handover, type Line, type Shipment } from '@/lib/foreignOrders';
import { supabase } from '@/lib/supabase';

type Dialog = ReturnType<typeof useDialog>;

const rpc = async (fn: string, args: Record<string, unknown>) => {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
};

/** Record a step (Ops): the date it was done, the reference number where there is one, a short note */
export async function recordStep(dialog: Dialog, l: Line, handoverId: string, orderId: string | null) {
  const r = await dialog.prompt({
    title: l.def.label,
    message: `${l.def.node}${l.start ? ` · follows the step done on ${fmtDate(l.start)}` : ''}${l.def.sla_days ? ` · SLA ${l.def.sla_days} working days` : ''}`,
    fields: [
      { key: 'date', label: 'Done on', type: 'date', required: true, initial: l.done?.done_on ?? todayIso() },
      ...(l.def.ref_label ? [{ key: 'ref', label: l.def.ref_label, initial: l.done?.ref ?? '', required: ['po_issued', 'lc_final', 'sap_created'].includes(l.def.key) }] : []),
      { key: 'note', label: 'Note', type: 'multiline', initial: l.done?.note ?? '' },
    ],
    confirmLabel: l.done ? 'Save' : 'Record',
  });
  if (!r) return false;
  return dialog.run(() => rpc('fo_record_step', { p_handover: handoverId, p_order: orderId, p_step: l.def.key, p_date: r.date, p_ref: r.ref ?? null, p_note: r.note || null }), 'Recorded');
}

export async function clearStep(dialog: Dialog, l: Line) {
  if (!l.done) return false;
  if (!(await dialog.confirm(`Clear "${l.def.label}"?`, 'Only for a step recorded by mistake.', { confirmLabel: 'Clear', danger: true }))) return false;
  return dialog.run(() => rpc('fo_clear_step', { p_id: l.done!.id }), 'Cleared');
}

/** New or edited shipment (Ops) – one shipment can carry several import orders */
export async function editShipment(dialog: Dialog, orderOptions: Option[], s?: Shipment | null, selected: string[] = []) {
  const r = await dialog.prompt({
    title: s ? `Edit ${s.code}` : 'New shipment',
    message: 'From the forwarder’s booking confirmation (through Logistics). An ETA change is told to Sales and the SEE.',
    fields: [
      { key: 'order_ids', label: 'Import orders on this shipment', type: 'multiselect', options: orderOptions, required: true, initial: selected.join(',') },
      { key: 'mode', label: 'Mode', type: 'select', options: [{ value: 'sea', label: 'Sea' }, { value: 'air', label: 'Air' }, { value: 'courier', label: 'Courier' }], initial: s?.mode ?? 'sea' },
      { key: 'vessel_flight', label: 'Vessel or flight no.', initial: s?.vessel_flight ?? '', hint: 'e.g. MSC ANNA, or EK 348 for air' },
      { key: 'voyage', label: 'Voyage', initial: s?.voyage ?? '' },
      { key: 'carrier', label: 'Shipping line / airline', initial: s?.carrier ?? '' },
      { key: 'bl_awb', label: 'B/L or AWB no.', initial: s?.bl_awb ?? '' },
      { key: 'containers', label: 'Containers / packages', initial: s?.containers ?? '', hint: 'e.g. 1 × 40′ HC' },
      { key: 'container_nos', label: 'Container nos. (sea)', initial: s?.container_nos ?? '', hint: 'e.g. HLBU1234567 – opens the shipping line’s tracking' },
      { key: 'imo', label: 'Vessel IMO no. (7 digits)', initial: s?.imo ?? '', hint: 'From the booking, or any tracking site – opens MarineTraffic / VesselFinder' },
      { key: 'mmsi', label: 'Vessel MMSI no. (9 digits, if no IMO)', initial: s?.mmsi ?? '' },
      { key: 'forwarder', label: 'Forwarder', initial: s?.forwarder ?? '' },
      { key: 'clearing_agent', label: 'Local clearing agent', initial: s?.clearing_agent ?? '' },
      { key: 'pol', label: 'Port / airport of departure', initial: s?.pol ?? '' },
      { key: 'via', label: 'Via (transhipment)', initial: s?.via ?? '' },
      { key: 'pod', label: 'Port / airport of arrival', initial: s?.pod ?? 'Colombo' },
      { key: 'onboard', label: 'On board (date and time)', initial: s?.onboard_at ? s.onboard_at.slice(0, 16).replace('T', ' ') : '', hint: 'e.g. 2026-10-02 18:40' },
      { key: 'etd', label: 'ETD', type: 'date', initial: s?.etd ?? '' },
      { key: 'eta', label: 'ETA', type: 'date', initial: s?.eta ?? '' },
      { key: 'notes', label: 'Notes', type: 'multiline', initial: s?.notes ?? '' },
    ],
    confirmLabel: s ? 'Save' : 'Add shipment',
  });
  if (!r) return null;
  let id: string | null = null;
  await dialog.run(async () => {
    const onboard = r.onboard.trim() ? new Date(`${r.onboard.trim().replace(' ', 'T')}:00+05:30`) : null;
    if (onboard && Number.isNaN(onboard.getTime())) throw new Error('On board: enter the date and time as 2026-10-02 18:40');
    id = (await rpc('fo_save_shipment', {
      p_id: s?.id ?? null,
      p: { ...r, onboard_at: onboard ? onboard.toISOString() : '', order_ids: r.order_ids.split(',').filter(Boolean) },
    })) as string;
  }, 'Saved');
  return id;
}

export const orderOption = (o: FoOrder, h?: Handover) => ({ value: o.id, label: `${o.code} · ${o.title}${h ? ` – ${h.project_name}` : ''}` });

export { rpc };
