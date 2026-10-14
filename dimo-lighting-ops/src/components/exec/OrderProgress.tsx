import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { Card, colors, Loading, Muted, Pill, Row } from '@/components/ui';
import type { MrRouteOrder } from '@/lib/execution';
import { fmtDate } from '@/lib/format';
import { multiLegOpen, route as foRoute, SHORT_STAGES, standing as foStanding, type FlightLeg, type FoOrder, type Handover, type Shipment, type Step, type StepDef } from '@/lib/foreignOrders';
import { useLoad } from '@/lib/hooks';
import { DIC_LIMIT, INVOICE_POINTS, invoiceChain, LO_SHORT, loRoute, loStanding, type InvoicePoint, type LoOrder, type LoRequest, type LoStep, type LoStepDef } from '@/lib/localOrders';
import { supabase } from '@/lib/supabase';

type Progress = { order_id: string; dic_pr: boolean; dic_sel: boolean; invoices: (Record<`${InvoicePoint}_on`, string | null> & { invoice_no: string; kind: string; status: string; received_on: string })[] };
type Card_ = { air?: string | null; transship?: 'open' | 'known' | null; o: MrRouteOrder; stages: string[]; stage: number; now: string; with: string; last: { label: string; on: string } | null; late: boolean; invoices: Progress['invoices']; chain: InvoicePoint[] };

/** The orders made for a material request, as the site sees them: the stage reached, what is being done now and by whom,
 *  the last step done and the invoice approvals (no values) – the same steps Operations records. */
export function OrderProgress({ mrId, orders }: { mrId: string; orders: MrRouteOrder[] }) {
  const { data, error } = useLoad(async () => {
    const lo = orders.filter((x) => x.module === 'lo');
    const fo = orders.filter((x) => x.module === 'fo');
    const loReq = [...new Set(lo.map((x) => x.ref_id))];
    const foH = [...new Set(fo.map((x) => x.ref_id))];
    const [hol, ld, lr, lords, lst, prog, fd, fh, fords, fst] = await Promise.all([
      supabase.from('holidays').select('day'),
      lo.length ? supabase.from('lo_step_defs').select('*').order('seq') : Promise.resolve({ data: [] }),
      lo.length ? supabase.from('lo_requests').select('*').in('id', loReq) : Promise.resolve({ data: [] }),
      lo.length ? supabase.from('lo_orders').select('*').in('request_id', loReq) : Promise.resolve({ data: [] }),
      lo.length ? supabase.from('lo_steps').select('*').in('request_id', loReq) : Promise.resolve({ data: [] }),
      lo.length ? supabase.rpc('mr_order_progress', { p_mr: mrId }) : Promise.resolve({ data: [] }),
      fo.length ? supabase.from('fo_step_defs').select('*').order('seq') : Promise.resolve({ data: [] }),
      fo.length ? supabase.from('fo_handovers').select('*').in('id', foH) : Promise.resolve({ data: [] }),
      fo.length ? supabase.from('fo_orders').select('*').in('handover_id', foH) : Promise.resolve({ data: [] }),
      fo.length ? supabase.from('fo_steps').select('*').in('handover_id', foH) : Promise.resolve({ data: [] }),
    ]);
    const holidays = new Set(((hol.data ?? []) as { day: string }[]).map((x) => x.day));
    // import orders on an air shipment with more than one flight: transshipment
    const foIds = fo.map((x) => x.order_id);
    const so = foIds.length ? (((await supabase.from('fo_shipment_orders').select('shipment_id, order_id').in('order_id', foIds)).data ?? []) as { shipment_id: string; order_id: string }[]) : [];
    const ships = so.length ? (((await supabase.from('fo_shipments').select('*').in('id', so.map((x) => x.shipment_id)).eq('multi_leg', true)).data ?? []) as Shipment[]) : [];
    const legs = ships.length ? (((await supabase.from('fo_flight_legs').select('*').in('shipment_id', ships.map((x) => x.id))).data ?? []) as FlightLeg[]) : [];
    const airLines = foIds.length ? (((await supabase.rpc('fo_air_lines', { p_orders: foIds })).data ?? []) as { order_id: string; line: string | null }[]) : [];
    const transship = (orderId: string): Card_['transship'] => {
      const sh = ships.find((x) => !x.arrived_on && so.some((y) => y.order_id === orderId && y.shipment_id === x.id));
      return sh ? (multiLegOpen(sh, legs.filter((l) => l.shipment_id === sh.id)) ? 'open' : 'known') : null;
    };
    const out: Card_[] = [];
    for (const x of orders) {
      if (x.module === 'lo') {
        const o = ((lords.data ?? []) as LoOrder[]).find((y) => y.id === x.order_id);
        const r = ((lr.data ?? []) as LoRequest[]).find((y) => y.id === x.ref_id);
        if (!o || !r) continue;
        const p = ((prog.data ?? []) as Progress[]).find((y) => y.order_id === o.id);
        const steps = ((lst.data ?? []) as LoStep[]).filter((s) => s.request_id === r.id);
        const lines = loRoute((ld.data ?? []) as LoStepDef[], p?.dic_pr ? DIC_LIMIT + 1 : 0, o, p?.dic_sel ? DIC_LIMIT + 1 : 0, steps, holidays);
        const st = loStanding(lines);
        const done = lines.filter((l) => l.done).sort((a, b) => (a.done!.done_on + a.def.seq).localeCompare(b.done!.done_on + b.def.seq)).at(-1);
        out.push({ o: x, stages: LO_SHORT, stage: st.stage, now: st.now.map((l) => l.def.label).join(' · '), with: st.with, late: st.late, last: done ? { label: done.def.label, on: done.done!.done_on } : null, invoices: p?.invoices ?? [], chain: invoiceChain(r) });
      } else {
        const h = ((fh.data ?? []) as Handover[]).find((y) => y.id === x.ref_id);
        const os = ((fords.data ?? []) as FoOrder[]).filter((y) => y.handover_id === x.ref_id);
        const o = os.find((y) => y.id === x.order_id);
        if (!h || !o) continue;
        const lines = foRoute((fd.data ?? []) as StepDef[], h, o, ((fst.data ?? []) as Step[]).filter((s) => s.handover_id === h.id), os, holidays);
        const st = foStanding(lines);
        const done = lines.filter((l) => l.done).sort((a, b) => (a.done!.done_on + String(a.def.seq).padStart(3, '0')).localeCompare(b.done!.done_on + String(b.def.seq).padStart(3, '0'))).at(-1);
        out.push({ air: airLines.find((y) => y.order_id === o.id)?.line ?? null, transship: transship(o.id), o: x, stages: SHORT_STAGES, stage: st.stage, now: st.now.map((l) => l.def.label).join(' · '), with: st.with, late: st.late, last: done ? { label: done.def.label, on: done.done!.done_on } : null, invoices: [], chain: [] });
      }
    }
    return out;
  }, [mrId, orders.map((o) => o.order_id).join()]);
  if (!data) return error ? <Muted>{error}</Muted> : <Loading />;
  return (
    <View style={{ gap: 8 }}>
      {data.map((c) => {
        const complete = c.stage > c.stages.length;
        return (
          <Card key={c.o.order_id} style={{ gap: 8 }}>
            <Row wrap gap={6} style={{ alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ fontWeight: '700', color: colors.ink, flexShrink: 1 }} onPress={() => router.push(c.o.module === 'lo' ? `/orders/local/${c.o.order_id}` : `/orders/foreign/${c.o.order_id}`)}>
                {`${c.o.code ?? ''} · ${c.o.supplier ?? '—'} ›`}
              </Text>
              <Pill label={complete ? 'Completed' : c.o.delivered ? 'Delivered' : c.late ? 'Late' : `Stage ${c.stage} of ${c.stages.length}`} tone={complete || c.o.delivered ? colors.green : c.late ? colors.red : colors.blue} />
            </Row>
            <Muted>{[c.o.module === 'lo' ? 'Local order' : 'Import order', c.o.po ? `PO ${c.o.po}` : 'PO not issued yet', c.o.expected ? `expected ${fmtDate(c.o.expected)}` : null].filter(Boolean).join(' · ')}</Muted>
            {/* the stages: done, now, to come */}
            <Row wrap gap={4}>
              {c.stages.map((s, k) => {
                const n = k + 1;
                const isDone = n < c.stage;
                const isNow = n === c.stage;
                return (
                  <View
                    key={s}
                    style={{ paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, borderWidth: 1, borderColor: isDone ? colors.green : isNow ? (c.late ? colors.red : colors.blue) : colors.line, backgroundColor: isDone ? '#ECFDF3' : isNow ? '#EFF4FF' : colors.soft }}
                  >
                    <Text style={{ fontSize: 11, fontWeight: isNow ? '700' : '400', color: isDone ? colors.green : isNow ? (c.late ? colors.red : colors.blue) : colors.muted }}>{`${isDone ? '✓ ' : `${n} · `}${s}`}</Text>
                  </View>
                );
              })}
            </Row>
            {complete ? (
              <Text style={{ color: colors.green }}>All steps done.</Text>
            ) : c.now ? (
              <Text style={{ color: colors.ink }}>
                <Text style={{ fontWeight: '700' }}>Now: </Text>
                {`${c.now}${c.with ? ` – with ${c.with}` : ''}`}
              </Text>
            ) : null}
            {c.air ? <Text style={{ color: colors.ink, fontWeight: '600' }}>{c.air}</Text> : null}
            {c.transship ? (
              <Text style={{ color: colors.amber, fontWeight: '600' }}>
                {c.transship === 'open' ? '✈ Transshipment possible – the onward flight is not confirmed yet. Contact Ops for updates.' : '✈ Transshipment – the cargo changes flights on the way. Contact Ops for updates.'}
              </Text>
            ) : null}
            {c.last ? <Muted>{`Last done: ${c.last.label} · ${fmtDate(c.last.on)}`}</Muted> : null}
            {c.invoices.map((i) => {
              const next = c.chain.find((p) => !i[`${p}_on`]);
              return (
                <View key={i.invoice_no} style={{ gap: 4 }}>
                  <Muted>{`${i.kind === 'ipc' ? 'IPC invoice' : i.kind === 'advance' ? 'Advance invoice' : 'Invoice'} ${i.invoice_no} · received ${fmtDate(i.received_on)}`}</Muted>
                  <Row wrap gap={4} style={{ alignItems: 'center' }}>
                    {c.chain.map((p, k) => {
                      const on = i[`${p}_on`];
                      const isNext = p === next;
                      return (
                        <Row key={p} gap={4} style={{ alignItems: 'center' }}>
                          {k ? <Text style={{ color: colors.faint }}>→</Text> : null}
                          <Text style={{ fontSize: 11, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5, borderWidth: 1, borderColor: on ? colors.green : isNext ? colors.blue : colors.line, color: on ? colors.green : isNext ? colors.blue : colors.muted, fontWeight: isNext ? '700' : '400' }}>
                            {`${on ? '✓ ' : ''}${INVOICE_POINTS[p].who}${on ? ` ${fmtDate(on)}` : isNext ? ' · next' : ''}`}
                          </Text>
                        </Row>
                      );
                    })}
                  </Row>
                </View>
              );
            })}
          </Card>
        );
      })}
    </View>
  );
}
