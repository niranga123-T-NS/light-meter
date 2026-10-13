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

const SEA = { key: 'mode', in: ['sea'] };
const AIR = { key: 'mode', in: ['air'] };
const COURIER = { key: 'mode', in: ['courier'] };
const NOT_COURIER = { key: 'mode', in: ['sea', 'air'] };

/** New or edited shipment (Ops) – one shipment can carry several import orders. Only the fields of the chosen mode are shown. */
export async function editShipment(dialog: Dialog, orderOptions: Option[], s?: Shipment | null, selected: string[] = [], mode?: string | null, loading?: string | null) {
  const m = s?.mode ?? mode ?? 'sea';
  const onboard = s?.onboard_at ? s.onboard_at.slice(0, 16).replace('T', ' ') : '';
  const r = await dialog.prompt({
    title: s ? `Edit ${s.code}` : 'New shipment',
    message: 'From the forwarder’s booking confirmation (through Logistics). Choose sea, air or courier first – only its details are asked. An ETA change is told to Sales and the SEE.',
    fields: [
      { key: 'order_ids', label: 'Import orders on this shipment', type: 'multiselect', options: orderOptions, required: true, initial: selected.join(',') },
      { key: 'mode', label: 'Mode', type: 'select', required: true, options: [{ value: 'sea', label: 'Sea freight' }, { value: 'air', label: 'Air freight' }, { value: 'courier', label: 'Courier' }], initial: m },
      // sea
      { key: 'vessel', label: 'Vessel name', initial: m === 'sea' ? s?.vessel_flight ?? '' : '', hint: 'e.g. MSC ANNA', when: SEA },
      { key: 'voyage', label: 'Voyage no.', initial: s?.voyage ?? '', when: SEA },
      { key: 'line', label: 'Shipping line', initial: m === 'sea' ? s?.carrier ?? '' : '', hint: 'e.g. MSC, Maersk, CMA CGM', when: SEA },
      { key: 'bl', label: 'B/L no.', initial: m === 'sea' ? s?.bl_awb ?? '' : '', when: SEA },
      { key: 'containers', label: 'Containers', initial: m === 'sea' ? s?.containers ?? '' : '', hint: 'e.g. 1 × 40′ HC, or LCL 6 CBM', when: SEA },
      { key: 'container_nos', label: 'Container nos.', initial: s?.container_nos ?? '', hint: 'e.g. HLBU1234567 – opens the shipping line’s tracking', when: SEA },
      { key: 'mmsi', label: 'Vessel MMSI no. (9 digits)', initial: s?.mmsi ?? '', hint: 'For the automatic positions (morning and evening) – shown on the vessel’s VesselFinder / MarineTraffic page', when: SEA },
      { key: 'imo', label: 'Vessel IMO no. (7 digits)', initial: s?.imo ?? '', hint: 'Opens MarineTraffic / VesselFinder', when: SEA },
      { key: 'pol_sea', label: 'Port of loading', initial: m === 'sea' ? s?.pol ?? loading ?? '' : '', hint: 'e.g. Hamburg, Shanghai', when: SEA },
      { key: 'via_sea', label: 'Transhipment port(s)', initial: m === 'sea' ? s?.via ?? '' : '', hint: 'e.g. Jebel Ali – several with commas', when: SEA },
      { key: 'pod_sea', label: 'Port of discharge', initial: m === 'sea' ? s?.pod ?? 'Colombo' : 'Colombo', when: SEA },
      // air
      { key: 'flight', label: 'Flight no.', initial: m === 'air' ? s?.vessel_flight ?? '' : '', hint: 'e.g. EK 348 – the flight date is the ETD', when: AIR },
      { key: 'airline', label: 'Airline', initial: m === 'air' ? s?.carrier ?? '' : '', when: AIR },
      { key: 'awb', label: 'AWB no.', initial: m === 'air' ? s?.bl_awb ?? '' : '', hint: 'e.g. 176-12345675', when: AIR },
      { key: 'pieces', label: 'Pieces and weight', initial: m === 'air' ? s?.containers ?? '' : '', hint: 'e.g. 12 pcs, 840 kg', when: AIR },
      { key: 'pol_air', label: 'Airport of departure', initial: m === 'air' ? s?.pol ?? loading ?? '' : '', hint: 'e.g. FRA, Frankfurt', when: AIR },
      { key: 'via_air', label: 'Transit airport(s)', initial: m === 'air' ? s?.via ?? '' : '', hint: 'e.g. DXB', when: AIR },
      { key: 'pod_air', label: 'Airport of arrival', initial: m === 'air' ? s?.pod ?? 'Colombo (CMB)' : 'Colombo (CMB)', when: AIR },
      // courier
      { key: 'courier', label: 'Courier company', initial: m === 'courier' ? s?.carrier ?? '' : '', hint: 'e.g. DHL, FedEx, UPS', when: COURIER },
      { key: 'tracking', label: 'Tracking no.', initial: m === 'courier' ? s?.bl_awb ?? '' : '', when: COURIER },
      { key: 'parcels', label: 'Parcels and weight', initial: m === 'courier' ? s?.containers ?? '' : '', hint: 'e.g. 2 boxes, 14 kg', when: COURIER },
      { key: 'from', label: 'Sent from (city, country)', initial: m === 'courier' ? s?.pol ?? '' : '', when: COURIER },
      // all
      { key: 'forwarder', label: 'Forwarder', initial: s?.forwarder ?? '', when: NOT_COURIER },
      { key: 'clearing_agent', label: 'Local clearing agent', initial: s?.clearing_agent ?? '' },
      { key: 'onboard', label: 'On board (date and time)', initial: m === 'sea' ? onboard : '', hint: 'e.g. 2026-10-02 18:40', when: SEA },
      { key: 'departed', label: 'Departed (date and time)', initial: m === 'air' ? onboard : '', hint: 'e.g. 2026-10-02 18:40', when: AIR },
      { key: 'etd', label: 'ETD', type: 'date', initial: s?.etd ?? '' },
      { key: 'eta', label: 'ETA', type: 'date', initial: s?.eta ?? '' },
      { key: 'notes', label: 'Notes', type: 'multiline', initial: s?.notes ?? '' },
    ],
    confirmLabel: s ? 'Save' : 'Add shipment',
  });
  if (!r) return null;
  let id: string | null = null;
  await dialog.run(async () => {
    const sea = r.mode === 'sea';
    const air = r.mode === 'air';
    const ob = (sea ? r.onboard : air ? r.departed : '').trim();
    const when = ob ? new Date(`${ob.replace(' ', 'T')}:00+05:30`) : null;
    if (when && Number.isNaN(when.getTime())) throw new Error(`${sea ? 'On board' : 'Departed'}: enter the date and time as 2026-10-02 18:40`);
    const p = {
      order_ids: r.order_ids.split(',').filter(Boolean),
      mode: r.mode,
      vessel_flight: sea ? r.vessel : air ? r.flight : '',
      voyage: sea ? r.voyage : '',
      carrier: sea ? r.line : air ? r.airline : r.courier,
      bl_awb: sea ? r.bl : air ? r.awb : r.tracking,
      containers: sea ? r.containers : air ? r.pieces : r.parcels,
      container_nos: sea ? r.container_nos : '',
      imo: sea ? r.imo : '',
      mmsi: sea ? r.mmsi : '',
      forwarder: r.mode === 'courier' ? '' : r.forwarder,
      clearing_agent: r.clearing_agent,
      pol: sea ? r.pol_sea : air ? r.pol_air : r.from,
      via: sea ? r.via_sea : air ? r.via_air : '',
      pod: sea ? r.pod_sea : air ? r.pod_air : 'Colombo',
      onboard_at: when ? when.toISOString() : '',
      etd: r.etd,
      eta: r.eta,
      notes: r.notes,
    };
    id = (await rpc('fo_save_shipment', { p_id: s?.id ?? null, p })) as string;
  }, 'Saved');
  return id;
}

export const orderOption = (o: FoOrder, h?: Handover) => ({ value: o.id, label: `${o.code} · ${o.title}${h ? ` – ${h.project_name}` : ''}` });

export { rpc };
