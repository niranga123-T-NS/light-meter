import { router, Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, ErrorBanner, Field, Loading, Muted, Notice, Row, Screen, Section, Select } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { amt, fmtMonth, type InvoiceLine, isFinanceDesk, kindLabel, mn, thisMonth } from '@/lib/finance';
import { useLoad, usePeople } from '@/lib/hooks';
import { isSales } from '@/lib/roles';
import { rpc, supabase } from '@/lib/supabase';

type Entry = { amount: string; invoice_no: string; invoice_date: string };

const Tick = ({ on }: { on: boolean }) => (
  <View
    style={{
      width: 22,
      height: 22,
      borderRadius: 5,
      borderWidth: 2,
      borderColor: on ? colors.brand : colors.faint,
      backgroundColor: on ? colors.brand : 'transparent',
      alignItems: 'center',
      justifyContent: 'center',
    }}
  >
    {on ? <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>✓</Text> : null}
  </View>
);

/** Confirm past invoices: tick the scheduled invoices (before this month, not fully invoiced) that were raised. */
export default function ConfirmPastInvoices() {
  const me = useMe();
  const people = usePeople();
  const dialog = useDialog();
  const [person, setPerson] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<string, Entry>>({});
  const allowed = isFinanceDesk(me.role) || isSales(me.role);
  const { data, error, reload } = useLoad(async () => {
    const { data: rows, error: e } = await supabase
      .from('invoice_line_status')
      .select('*')
      .lt('forecast_month', thisMonth())
      .neq('project_status', 'cancelled')
      .order('forecast_month');
    if (e) throw new Error(e.message);
    return ((rows ?? []) as InvoiceLine[]).filter((l) => Number(l.remaining) > 0.5);
  });
  const lines = useMemo(() => (data ?? []).filter((l) => !person || l.sales_person_id === person), [data, person]);
  const byProject = useMemo(() => {
    const m = new Map<string, InvoiceLine[]>();
    for (const l of lines) m.set(l.secured_id, [...(m.get(l.secured_id) ?? []), l]);
    return [...m.values()];
  }, [lines]);
  if (!allowed)
    return (
      <Screen>
        <Notice>Invoices are confirmed by the sales person, Operations, SM Projects or GM / DGM.</Notice>
      </Screen>
    );
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;

  const toggle = (l: InvoiceLine) =>
    setPicked((p) => {
      const n = { ...p };
      if (n[l.id]) delete n[l.id];
      else n[l.id] = { amount: String(Number(l.remaining).toFixed(2)), invoice_no: '', invoice_date: '' };
      return n;
    });
  const setEntry = (id: string, k: keyof Entry, v: string) => setPicked((p) => ({ ...p, [id]: { ...p[id], [k]: v } }));
  const ticked = lines.filter((l) => picked[l.id]);
  const total = ticked.reduce((a, l) => a + (Number(picked[l.id].amount.replace(/,/g, '')) || 0), 0);
  const salesPeople = [...new Set(data.map((l) => l.sales_person_id).filter(Boolean))] as string[];

  const confirm = async () => {
    if (!(await dialog.confirm(`Confirm ${ticked.length} invoice(s)?`, `LKR ${amt(total)} is recorded as invoiced, each in its scheduled month (or the date you entered).`, { confirmLabel: 'Confirm' })))
      return;
    await dialog.run(async () => {
      await rpc('confirm_past_invoices', {
        p_items: ticked.map((l) => ({
          line_id: l.id,
          amount: picked[l.id].amount.replace(/,/g, ''),
          invoice_no: picked[l.id].invoice_no || null,
          invoice_date: picked[l.id].invoice_date || null,
        })),
      });
      setPicked({});
      await reload();
    }, 'Invoices confirmed');
  };

  return (
    <Screen maxWidth={1000}>
      <Stack.Screen options={{ title: 'Confirm past invoices' }} />
      <Card>
        <Muted>
          These scheduled invoices are from earlier months and not (fully) invoiced. Tick the ones that were actually raised and press Confirm – each
          is recorded in its scheduled month for its balance. Change the amount if a different amount was invoiced, and add the invoice number and
          date if you have them (you can add the number later on the project). Leave unticked what was not invoiced – it stays as slipped.
        </Muted>
        <Row wrap gap={8} style={{ marginTop: 8, alignItems: 'flex-end' }}>
          {isFinanceDesk(me.role) ? (
            <View style={{ minWidth: 240 }}>
              <Select
                label="Sales person"
                value={person ?? 'all'}
                onChange={(v) => setPerson(v === 'all' ? null : v)}
                options={[{ value: 'all', label: 'All' }, ...salesPeople.map((id) => ({ value: id, label: people[id]?.full_name ?? '—' }))]}
              />
            </View>
          ) : null}
          <Button
            variant="secondary"
            title={ticked.length === lines.length && lines.length ? 'Untick all' : 'Tick all'}
            disabled={!lines.length}
            onPress={() =>
              setPicked(
                ticked.length === lines.length
                  ? {}
                  : Object.fromEntries(lines.map((l) => [l.id, picked[l.id] ?? { amount: String(Number(l.remaining).toFixed(2)), invoice_no: '', invoice_date: '' }])),
              )
            }
          />
          <Button title={`Confirm ${ticked.length} · LKR ${mn(total)} Mn`} disabled={!ticked.length} onPress={confirm} />
        </Row>
      </Card>

      {!byProject.length ? <Notice tone={colors.green}>No past invoices waiting – everything scheduled before this month is invoiced.</Notice> : null}

      {byProject.map((group) => (
        <Section key={group[0].secured_id} title={`${group[0].project_name}${group[0].customer ? ` · ${group[0].customer}` : ''}`}>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {group.map((l) => {
              const on = !!picked[l.id];
              return (
                <View key={l.id} style={{ borderBottomWidth: 1, borderBottomColor: colors.line, padding: 12, gap: 6 }}>
                  <Pressable onPress={() => toggle(l)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <Tick on={on} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.ink, fontWeight: '600' }}>{`${l.description || kindLabel(l.kind)} · ${fmtMonth(l.forecast_month)}`}</Text>
                      <Muted>
                        {`${people[l.sales_person_id ?? '']?.full_name ?? '—'} · scheduled LKR ${amt(l.amount)}${Number(l.invoiced) > 0 ? ` · already invoiced ${amt(l.invoiced)}` : ''}`}
                      </Muted>
                    </View>
                    <Text style={{ color: colors.ink, fontWeight: '700' }}>{`LKR ${amt(l.remaining)}`}</Text>
                  </Pressable>
                  {on ? (
                    <Row wrap gap={8} style={{ paddingLeft: 32 }}>
                      <View style={{ minWidth: 160, flex: 1 }}>
                        <Field label="Amount invoiced (LKR)" value={picked[l.id].amount} onChangeText={(v) => setEntry(l.id, 'amount', v)} keyboardType="decimal-pad" />
                      </View>
                      <View style={{ minWidth: 160, flex: 1 }}>
                        <Field label="Invoice no. (optional)" value={picked[l.id].invoice_no} onChangeText={(v) => setEntry(l.id, 'invoice_no', v)} />
                      </View>
                      <View style={{ minWidth: 160, flex: 1 }}>
                        <Field
                          label="Invoice date (optional)"
                          value={picked[l.id].invoice_date}
                          onChangeText={(v) => setEntry(l.id, 'invoice_date', v)}
                          placeholder="YYYY-MM-DD · default: end of the month"
                        />
                      </View>
                    </Row>
                  ) : null}
                </View>
              );
            })}
          </Card>
        </Section>
      ))}
      <Row>
        <Button variant="ghost" title="Back" onPress={() => router.back()} />
      </Row>
    </Screen>
  );
}
