import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { Attachments } from '@/components/Attachments';
import { useDialog } from '@/components/dialog';
import { C_TONE, W_TONE } from '@/components/warrantyTones';
import { Button, Card, colors, Empty, ErrorBanner, KeyValue, ListRow, Loading, Muted, Pill, Row, Screen, Section } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { fmtDate, fmtDateTime, fmtMoney, todayISO } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { daysFrom } from '@/lib/retentions';
import { projectTypeLabel } from '@/lib/roles';
import { rpc, supabase } from '@/lib/supabase';
import type { Manufacturer, Warranty, WarrantyClaim, WarrantyLine, WarrantyRegistration } from '@/lib/types';
import {
  CLAIM_STAGE_LABEL,
  claimStage,
  gapLabel,
  canRaiseClaim,
  isWarrantyDesk,
  lineStage,
  START_BASIS,
  supplierGapDays,
  viaLabel,
  WARRANTY_STAGE_LABEL,
  warrantyStage,
} from '@/lib/warranty';

type Log = { id: number; at: string; user_id: string | null; kind: string; note: string | null; claim_id: string | null };

export default function WarrantyDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const people = usePeople();
  const dialog = useDialog();
  const { data, error, reload } = useLoad(async () => {
    const [{ data: w, error: e }, { data: lines }, { data: claims }, { data: log }, { data: regs }, { data: mfrs }] = await Promise.all([
      supabase.from('warranties').select('*').eq('id', id).single(),
      supabase.from('warranty_lines').select('*').eq('warranty_id', id).order('sort_order'),
      supabase.from('warranty_claims').select('*').eq('warranty_id', id).order('logged_at', { ascending: false }),
      supabase.from('warranty_log').select('*').eq('warranty_id', id).order('at', { ascending: false }).limit(200),
      supabase.from('warranty_registrations').select('*').eq('warranty_id', id).order('due_date'),
      supabase.from('manufacturers').select('*').order('name'),
    ]);
    if (e) throw new Error(e.message);
    return {
      w: w as Warranty,
      lines: (lines ?? []) as WarrantyLine[],
      claims: (claims ?? []) as WarrantyClaim[],
      log: (log ?? []) as Log[],
      regs: (regs ?? []) as WarrantyRegistration[],
      mfrs: (mfrs ?? []) as Manufacturer[],
    };
  }, [id]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const { w, lines, claims } = data;
  const today = todayISO();
  const st = warrantyStage(w, lines, today);
  const desk = isWarrantyDesk(me.role);
  const basis = START_BASIS.find((b) => b.value === w.start_basis)?.label ?? w.start_basis;

  // Coverage timeline: from the start date to the latest end date
  const ends = lines.flatMap((l) => [l.end_date, l.supplier_end ?? l.end_date]);
  const t0 = Date.parse(w.start_date);
  const t1 = Math.max(Date.parse(today), ...ends.map((d) => Date.parse(d))) + 86_400_000 * 30;
  const pct = (d: string) => Math.max(0, Math.min(100, ((Date.parse(d) - t0) / (t1 - t0)) * 100));
  const years: number[] = [];
  for (let y = Number(w.start_date.slice(0, 4)) + 1; Date.parse(`${y}-01-01`) < t1; y++) years.push(y);

  return (
    <Screen maxWidth={960}>
      <Stack.Screen options={{ title: w.code }} />
      <Card style={{ borderLeftWidth: 5, borderLeftColor: W_TONE[st] }}>
        <Row wrap style={{ justifyContent: 'space-between' }}>
          <Text style={{ fontSize: 18, fontWeight: '700' }}>{w.project_name}</Text>
          <Row gap={6}>
            <Pill label={w.source === 'system' ? 'Project in the system' : 'Outside project'} tone={w.source === 'system' ? colors.blue : colors.grey} />
            <Pill label={WARRANTY_STAGE_LABEL[st]} tone={W_TONE[st]} solid />
          </Row>
        </Row>
        <Muted>
          {w.customer}
          {w.site ? ` · ${w.site}` : ''}
          {w.site_contact ? ` · ${w.site_contact}` : ''}
        </Muted>
        <Row wrap style={{ marginTop: 8 }}>
          <KeyValue label="Invoice no." value={w.invoice_no ?? '—'} />
          <KeyValue label="Contract / PO no." value={w.contract_no ?? '—'} />
          {w.contract_value != null ? <KeyValue label="Value" value={fmtMoney(w.contract_value, w.currency)} /> : null}
          <KeyValue label="Warranty starts" value={`${fmtDate(w.start_date)} (${basis})`} />
          {w.delivery_date ? <KeyValue label="Delivery" value={fmtDate(w.delivery_date)} /> : null}
          {w.tc_date ? <KeyValue label="T&C" value={fmtDate(w.tc_date)} /> : null}
          {w.handover_date ? <KeyValue label="Handover" value={fmtDate(w.handover_date)} /> : null}
          <KeyValue label="Category" value={projectTypeLabel(w.category)} />
          <KeyValue label="Owner" value={people[w.owner_id ?? '']?.full_name ?? '—'} />
          <KeyValue label="Project engineer" value={people[w.project_engineer_id ?? '']?.full_name ?? '—'} />
        </Row>
        {w.notes ? <Muted>{w.notes}</Muted> : null}
        <Row wrap gap={8} style={{ marginTop: 8 }}>
          {canRaiseClaim(me.role) && w.status === 'active' ? (
            <Button title={desk ? '+ Log claim' : '+ Raise warranty claim'} onPress={() => router.push({ pathname: '/warranty/claims/new', params: { warranty: w.id } })} />
          ) : null}
          {desk && w.status === 'active' ? <Button variant="secondary" title="Edit" onPress={() => router.push({ pathname: '/warranty/edit', params: { id: w.id } })} /> : null}
          {w.project_id ? <Button variant="ghost" title="Open project" onPress={() => router.push(`/projects/${w.project_id}`)} /> : null}
          {desk && w.status === 'active' ? (
            <Button
              variant="ghost"
              title="Cancel record"
              onPress={async () => {
                const x = await dialog.prompt({ title: 'Cancel this warranty record', fields: [{ key: 'r', label: 'Reason', type: 'multiline', required: true }], danger: true });
                if (x) await dialog.run(async () => { await rpc('cancel_warranty', { p_id: w.id, p_reason: x.r }); await reload(); }, 'Cancelled');
              }}
            />
          ) : null}
        </Row>
      </Card>

      <Section title="Warranty lines">
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {lines.map((l) => {
            const ls = lineStage(l, today);
            const gap = supplierGapDays(l);
            const left = daysFrom(today, l.end_date);
            return (
              <ListRow
                key={l.id}
                highlight={gap && l.end_date >= today ? colors.red : ls === 'expiring' ? colors.amber : undefined}
                title={`${l.product_group}${l.brand ? ` – ${l.brand}` : ''}`}
                subtitle={`${l.quantity != null ? `${Number(l.quantity).toLocaleString('en-US')} · ` : ''}${l.months % 12 ? `${l.months} months` : `${l.months / 12} yrs`} to client · ends ${fmtDate(l.end_date)}${l.supplier_end ? ` · supplier ends ${fmtDate(l.supplier_end)}` : ' · supplier end not entered'} · manufacturer ${data.mfrs.find((m) => m.id === l.manufacturer_id)?.name ?? 'not set'}`}
                onPress={
                  desk && w.status === 'active'
                    ? async () => {
                        const x = await dialog.prompt({
                          title: `Manufacturer for ${l.product_group}`,
                          fields: [{ key: 'm', label: 'Manufacturer', type: 'select', required: true, initial: l.manufacturer_id ?? undefined, options: data.mfrs.filter((m) => m.active).map((m) => ({ value: m.id, label: m.name })) }],
                        });
                        if (x) await dialog.run(async () => { await rpc('set_line_manufacturer', { p_line: l.id, p_manufacturer: x.m }); await reload(); }, 'Manufacturer set');
                      }
                    : undefined
                }
                right={
                  <Row gap={6}>
                    {l.supplier_end ? <Pill label={gapLabel(gap)} tone={gap ? colors.red : colors.green} /> : null}
                    <Pill label={ls === 'expired' ? 'Ended' : `${left} days left`} tone={ls === 'expired' ? colors.grey : ls === 'expiring' ? colors.amber : colors.green} />
                  </Row>
                }
              />
            );
          })}
        </Card>
        {lines.length ? (
          <Card style={{ marginTop: 8 }}>
            <Text style={{ fontWeight: '700', marginBottom: 6 }}>Coverage</Text>
            {lines.map((l) => {
              const gap = supplierGapDays(l);
              return (
                <View key={l.id} style={{ marginBottom: 10 }}>
                  <Text style={{ fontSize: 12 }}>
                    {l.product_group}
                    {l.brand ? ` – ${l.brand}` : ''}
                  </Text>
                  <View style={{ height: 26, backgroundColor: colors.bg, borderRadius: 4, marginTop: 2, position: 'relative' }}>
                    <View style={{ position: 'absolute', top: 3, height: 8, left: 0, width: `${pct(l.end_date)}%`, backgroundColor: colors.blue, borderRadius: 2 }} />
                    {l.supplier_end ? (
                      <View style={{ position: 'absolute', top: 15, height: 8, left: 0, width: `${pct(l.supplier_end)}%`, backgroundColor: colors.green, borderRadius: 2 }} />
                    ) : null}
                    {gap ? (
                      <View style={{ position: 'absolute', top: 15, height: 8, left: `${pct(l.supplier_end as string)}%`, width: `${pct(l.end_date) - pct(l.supplier_end as string)}%`, backgroundColor: colors.red, opacity: 0.6, borderRadius: 2 }} />
                    ) : null}
                    <View style={{ position: 'absolute', top: -2, bottom: -2, width: 2, left: `${pct(today)}%`, backgroundColor: colors.brand }} />
                  </View>
                </View>
              );
            })}
            <Row wrap gap={10}>
              <Muted>Blue: our warranty to the client</Muted>
              <Muted>Green: supplier warranty</Muted>
              <Muted>Red: gap – DIMO pays</Muted>
              <Muted>Red line: today</Muted>
              <Muted>
                Scale {fmtDate(w.start_date)} → {years.length ? years[years.length - 1] : ''}
              </Muted>
            </Row>
          </Card>
        ) : null}
      </Section>

      {data.regs.length ? (
        <Section title="Registration with the manufacturer">
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {data.regs.map((g) => {
              const overdue = !g.registered_on && g.due_date < today;
              return (
                <ListRow
                  key={g.id}
                  highlight={overdue ? colors.red : !g.registered_on ? colors.amber : undefined}
                  title={data.mfrs.find((m) => m.id === g.manufacturer_id)?.name ?? '—'}
                  subtitle={g.registered_on ? `Registered ${fmtDate(g.registered_on)}${g.reference ? ` · ref ${g.reference}` : ''}${g.note ? ` · ${g.note}` : ''}` : `Register by ${fmtDate(g.due_date)} – done manually; record it here`}
                  right={
                    <Row gap={6}>
                      <Pill label={g.registered_on ? 'Registered' : overdue ? 'Overdue' : 'Due'} tone={g.registered_on ? colors.green : overdue ? colors.red : colors.amber} />
                      {desk && !g.registered_on ? (
                        <Button
                          small
                          title="Record"
                          onPress={async () => {
                            const x = await dialog.prompt({
                              title: 'Registered with the manufacturer',
                              message: 'Upload the registration certificate under Documents.',
                              fields: [
                                { key: 'd', label: 'Registration date', type: 'date', required: true, initial: today },
                                { key: 'r', label: 'Manufacturer reference' },
                                { key: 'n', label: 'Note' },
                              ],
                            });
                            if (x) await dialog.run(async () => { await rpc('record_registration', { p_id: g.id, p_on: x.d, p_reference: x.r || null, p_note: x.n || null }); await reload(); }, 'Registration recorded');
                          }}
                        />
                      ) : null}
                    </Row>
                  }
                />
              );
            })}
          </Card>
        </Section>
      ) : null}

      <Section title={`Claims (${claims.length})`}>
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {claims.map((c) => {
            const s = claimStage(c);
            return (
              <ListRow
                key={c.id}
                title={`${c.code} · ${c.description}`}
                subtitle={`${viaLabel(c.reported_via)} · logged ${fmtDate(c.logged_at)} · ${people[c.assignee_id ?? '']?.full_name ?? 'not assigned'}${Number(c.cost_amount) ? ` · cost ${fmtMoney(c.cost_amount, w.currency)}` : ''}`}
                right={<Pill label={CLAIM_STAGE_LABEL[s]} tone={C_TONE[s]} solid />}
                onPress={() => router.push(`/warranty/claims/${c.id}`)}
              />
            );
          })}
          {!claims.length ? <Empty title="No claims" /> : null}
        </Card>
      </Section>

      <Attachments entityType="warranty" entityId={w.id} kinds={['warranty_doc']} title="Documents (handover certificate, T&C report, as-built drawings, warranty certificate, invoice)" canUpload={desk} allowCamera />

      <Section title="History">
        <Card>
          {data.log.map((l) => (
            <Muted key={l.id}>
              {fmtDateTime(l.at)} · {people[l.user_id ?? '']?.full_name ?? 'System'} · {l.note ?? l.kind}
            </Muted>
          ))}
        </Card>
      </Section>
    </Screen>
  );
}
