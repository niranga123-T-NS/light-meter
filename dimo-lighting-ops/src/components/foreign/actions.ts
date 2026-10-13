import type { useDialog } from '@/components/dialog';
import type { Option } from '@/components/ui';
import { fmtDate } from '@/lib/format';
import { todayIso, yesNo, type FoOrder, type Handover, type Line, type OrderValues, type Shipment } from '@/lib/foreignOrders';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/lib/types';

type Dialog = ReturnType<typeof useDialog>;

const rpc = async (fn: string, args: Record<string, unknown>) => {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
};

const salesOptions = (people: Record<string, Profile>): Option[] =>
  Object.values(people)
    .filter((p) => p.active !== false && (p.role === 'asm_building' || p.role === 'asm_infra'))
    .map((p) => ({ value: p.id, label: p.full_name }))
    .sort((a, b) => a.label.localeCompare(b.label));

/** New or edited hand-over (Ops, from the Estimation Manager's e-mail) */
export async function editHandover(dialog: Dialog, people: Record<string, Profile>, projects: Option[], h?: Handover | null) {
  const r = await dialog.prompt({
    title: h ? `Edit ${h.code}` : 'New hand-over',
    message: h ? undefined : 'From the Estimation Manager’s hand-over e-mail (PI and costing). Split it into import orders on the next page.',
    fields: [
      { key: 'project_id', label: 'Project (CRM)', type: 'select', options: [{ value: '', label: '— Not in the CRM —' }, ...projects], initial: h?.project_id ?? '', searchable: true, hint: 'Links the project’s SEE' },
      { key: 'project_name', label: 'Project name', required: true, initial: h?.project_name ?? '' },
      { key: 'client', label: 'Client', required: true, initial: h?.client ?? '' },
      { key: 'sales_person_id', label: 'Sales person', type: 'select', options: salesOptions(people), required: true, initial: h?.sales_person_id ?? '', searchable: true },
      { key: 'received_on', label: 'Hand-over received on', type: 'date', required: true, initial: h?.received_on ?? todayIso() },
      { key: 'pi_ref', label: 'PI no.', initial: h?.pi_ref ?? '' },
      { key: 'client_new', label: 'Client registered in SAP?', type: 'select', options: [{ value: 'no', label: 'Yes – already in SAP' }, { value: 'yes', label: 'No – request the details from Sales' }], initial: h?.client_new ? 'yes' : 'no' },
      ...(h ? [] : [{ key: 'delivery_location', label: 'Final delivery location', required: true, hint: 'Changed later only with SM Projects and SM Estimation approval' }]),
      { key: 'notes', label: 'Notes', type: 'multiline', initial: h?.notes ?? '' },
    ],
    confirmLabel: h ? 'Save' : 'Create hand-over',
  });
  if (!r) return null;
  let id: string | null = null;
  await dialog.run(async () => {
    const proj = projects.find((p) => p.value === r.project_id);
    id = (await rpc('fo_save_handover', {
      p_id: h?.id ?? null,
      p: { ...r, project_name: r.project_name || proj?.label || '', client_new: r.client_new === 'yes' },
    })) as string;
  }, 'Saved');
  return id;
}

/** New or edited import order (Ops) */
export async function editOrder(dialog: Dialog, handoverId: string, o?: FoOrder | null, v?: OrderValues | null) {
  const r = await dialog.prompt({
    title: o ? `Edit ${o.code}` : 'New import order',
    message: 'One import order per manufacturer (or per shipment). Its terms decide which steps it goes through.',
    fields: [
      { key: 'title', label: 'What is ordered', required: true, initial: o?.title ?? '', hint: 'e.g. Façade luminaires, LED drivers, commissioning' },
      { key: 'kind', label: 'Material or service', type: 'select', options: [{ value: 'material', label: 'Material' }, { value: 'service', label: 'Service' }], initial: o?.kind ?? 'material' },
      { key: 'vendor', label: 'Vendor / manufacturer', required: true, initial: o?.vendor ?? '' },
      { key: 'vendor_new', label: 'Vendor registered in SAP?', type: 'select', options: [{ value: 'no', label: 'Yes – already in SAP' }, { value: 'yes', label: 'No – send the registration request' }], initial: o?.vendor_new ? 'yes' : 'no' },
      { key: 'codes_new', label: 'Material codes in SAP?', type: 'select', options: [{ value: 'no', label: 'Yes – all in SAP' }, { value: 'yes', label: 'No – request from MDM' }], initial: o?.codes_new ? 'yes' : 'no' },
      { key: 'incoterm', label: 'Incoterm (material)', type: 'select', options: [{ value: 'EXW', label: 'EXW – Ex works' }, { value: 'FOB', label: 'FOB' }, { value: 'CIF', label: 'CIF – manufacturer’s forwarder' }], initial: o?.incoterm ?? '' },
      { key: 'payment', label: 'Payment', type: 'select', options: [{ value: 'TT', label: 'TT' }, { value: 'LC', label: 'LC' }], initial: o?.payment ?? 'TT', required: true },
      { key: 'duty', label: 'Duty (material)', type: 'select', options: [{ value: 'paid', label: 'Duty paid' }, { value: 'free', label: 'Duty free' }], initial: o?.duty ?? '' },
      { key: 'inland', label: 'Inland transport to the port?', type: 'select', options: yesNo, initial: o?.inland ? 'yes' : 'no' },
      { key: 'required_on', label: 'Required at site by', type: 'date', initial: o?.required_on ?? '' },
      { key: 'pr_nos', label: 'SAP PR nos.', initial: o?.pr_nos ?? '' },
      { key: 'currency', label: 'Currency', initial: v?.currency ?? 'USD', hint: 'e.g. USD, EUR' },
      { key: 'pi_value', label: 'PI value', initial: v?.pi_value != null ? String(v.pi_value) : '' },
      { key: 'lc_amount', label: 'LC amount', initial: v?.lc_amount != null ? String(v.lc_amount) : '' },
      { key: 'duty_lkr', label: 'Duty (LKR)', initial: v?.duty_lkr != null ? String(v.duty_lkr) : '' },
      { key: 'notes', label: 'Notes', type: 'multiline', initial: o?.notes ?? '' },
    ],
    confirmLabel: o ? 'Save' : 'Add import order',
  });
  if (!r) return null;
  let id: string | null = null;
  const num = (s: string) => (s.trim() ? String(Number(s.replace(/,/g, ''))) : '');
  await dialog.run(async () => {
    id = (await rpc('fo_save_order', {
      p_id: o?.id ?? null,
      p: {
        ...r,
        handover_id: handoverId,
        vendor_new: r.vendor_new === 'yes',
        codes_new: r.codes_new === 'yes',
        inland: r.inland === 'yes',
        pi_value: num(r.pi_value),
        lc_amount: num(r.lc_amount),
        duty_lkr: num(r.duty_lkr),
      },
    })) as string;
  }, 'Saved');
  return id;
}

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
      { key: 'vessel_flight', label: 'Vessel or flight', initial: s?.vessel_flight ?? '' },
      { key: 'voyage', label: 'Voyage', initial: s?.voyage ?? '' },
      { key: 'carrier', label: 'Shipping line / airline', initial: s?.carrier ?? '' },
      { key: 'bl_awb', label: 'B/L or AWB no.', initial: s?.bl_awb ?? '' },
      { key: 'containers', label: 'Containers / packages', initial: s?.containers ?? '', hint: 'e.g. 1 × 40′ HC' },
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
