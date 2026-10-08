import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { AnswerRow, allAnswered } from '@/components/exec/HseBits';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, colors, DateField, ErrorBanner, Field, KeyValue, Loading, Muted, Notice, Row, Screen, Section, Select } from '@/components/ui';
import { fmtDate, todayISO } from '@/lib/format';
import { formName, loadHseForms, qtyNum, type Answer, type HseEquipment, type HseRecord } from '@/lib/hse';
import { useLoad } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';

/** Fill a DIMO equipment checklist (or the first-aid kit) for one registered piece of equipment. */
export default function HseCheck() {
  const { equipment } = useLocalSearchParams<{ equipment: string }>();
  const dialog = useDialog();
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [contractor, setContractor] = useState<string | null>(null);
  const [permit, setPermit] = useState<string | null>(null);
  const [trip, setTrip] = useState<string | null>(null);
  const { data } = useLoad(async () => {
    const { data: e } = await supabase.from('hse_equipment').select('*').eq('id', equipment).single();
    const eq = e as HseEquipment;
    const [forms, last, permits] = await Promise.all([
      loadHseForms(),
      supabase.from('hse_records').select('*').eq('equipment_id', equipment).order('created_at', { ascending: false }).limit(1),
      supabase.from('hse_records').select('*').eq('exec_project_id', eq.exec_project_id).eq('form_code', 'PTW-03').in('status', ['active', 'submitted']),
    ]);
    return { eq, form: forms.find((f) => f.code === eq.form_code)!, last: ((last.data ?? [])[0] ?? null) as HseRecord | null, permits: (permits.data ?? []) as HseRecord[] };
  }, [equipment]);
  if (!data) return <Screen><Loading /></Screen>;
  const { eq, form: f } = data;
  const kit = f.kind === 'kit';
  const hotWork = f.items[0]?.text.startsWith('Hot work permit');
  const set = (no: string, a: Answer) => setAnswers((s) => ({ ...s, [no]: a }));
  // First-aid kit: start from the last count so only changes are typed
  const kitStart = () => setAnswers(Object.fromEntries(f.items.map((it) => [it.no, { avail: data.last?.answers[it.no]?.avail ?? '', exp: data.last?.answers[it.no]?.exp ?? '', mfg: data.last?.answers[it.no]?.mfg ?? '' }])));
  const fails = kit
    ? f.items.filter((it) => Number(answers[it.no]?.avail ?? 0) < qtyNum(it.req) || (answers[it.no]?.exp && String(answers[it.no]?.exp) < todayISO()))
    : f.items.filter((it) => answers[it.no]?.a === 'no');

  const save = async () => {
    setError(null);
    if (!kit) {
      const miss = allAnswered(f.items, answers);
      if (miss) return setError(`Answer point ${miss.no}: ${miss.text}`);
    } else {
      const miss = f.items.find((it) => answers[it.no]?.avail === undefined || answers[it.no]?.avail === '');
      if (miss) return setError(`Enter the available quantity of ${miss.text}`);
    }
    if (fails.length && !(await dialog.confirm('Not accepted', `${fails.length} point(s) failed. The ${kit ? 'kit is to be refilled' : 'equipment is taken out of use'}, an HSE report with a corrective action is raised and the Senior Electrical Engineer told.`, { confirmLabel: 'Submit', danger: true }))) return;
    await dialog.run(async () => {
      const id = await rpc<string>('save_hse_checklist', {
        p_exec: eq.exec_project_id,
        p: { equipment_id: eq.id, answers, permit_id: permit, header: { contractor: contractor ?? eq.contractor ?? '', trip_value_tested: trip ?? '' } },
      });
      router.replace(`/execution/hse/form/${id}`);
    }, fails.length ? 'Recorded – not accepted' : 'Recorded – accepted');
  };

  return (
    <Screen maxWidth={860}>
      <Stack.Screen options={{ title: `${f.code} ${formName(f)}` }} />
      <TestingBanner what="HSE checklists" />
      <ErrorBanner message={error} />
      <Card style={{ gap: 4 }}>
        <Text style={{ fontWeight: '700', fontSize: 16, color: colors.ink }}>{`${f.doc_no} · ${f.title}`}</Text>
        <Muted>{`Checklist · Issue ${f.issue} · ${fmtDate(f.issue_date)}`}</Muted>
        <Row wrap>
          <KeyValue label="Equipment" value={eq.name} />
          <KeyValue label={f.id_label ?? 'Serial No'} value={eq.serial_no ?? '—'} />
          <KeyValue label="First deployed" value={fmtDate(eq.first_deployed)} />
          <KeyValue label="Frequency" value={`Every ${eq.frequency_days} days`} />
          <KeyValue label="Last check" value={eq.last_checked_at ? fmtDate(eq.last_checked_at) : 'First check'} />
        </Row>
        <Field label="Contractor's name" value={contractor ?? eq.contractor ?? ''} onChangeText={setContractor} />
        {hotWork ? (
          <Select
            label="Hot work permit (PTW-03)"
            value={permit}
            onChange={(v) => {
              setPermit(v || null);
              if (v) set(f.items[0].no, { a: 'yes', r: data.permits.find((x) => x.id === v)?.code });
            }}
            options={[{ value: '', label: '— none —' }, ...data.permits.map((x) => ({ value: x.id, label: `${x.code} · ${String(x.header.location ?? '')} (${x.status === 'active' ? 'active' : 'waiting'})` }))]}
          />
        ) : null}
        {f.extra.trip_test ? <DateField label="Quarterly ELCB trip-value test done on (if done now)" value={trip} onChange={setTrip} /> : null}
      </Card>
      <Section title={kit ? 'Items' : 'Inspection points'} right={kit && data.last ? <Button small variant="ghost" title="Start from last count" onPress={kitStart} /> : undefined}>
        <Card>
          {kit
            ? f.items.map((it) => {
                const a = answers[it.no] ?? {};
                const short = a.avail !== undefined && a.avail !== '' && Number(a.avail) < qtyNum(it.req);
                const expired = !!a.exp && String(a.exp) < todayISO();
                return (
                  <View key={it.no} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.line, gap: 4 }}>
                    <Text style={{ fontWeight: '600', color: short || expired ? colors.red : colors.ink }}>{`${it.no}  ${it.text} – required ${it.req}`}</Text>
                    <Muted>{it.purpose}</Muted>
                    <Row gap={8} wrap>
                      <View style={{ width: 110 }}>
                        <Field label="Available qty" value={String(a.avail ?? '')} onChangeText={(v) => set(it.no, { ...a, avail: v.replace(/[^0-9.]/g, '') })} keyboardType="numeric" />
                      </View>
                      <View style={{ width: 170 }}>
                        <DateField label="Manuf. date" quick={[]} value={a.mfg || null} onChange={(v) => set(it.no, { ...a, mfg: v ?? '' })} />
                      </View>
                      <View style={{ width: 170 }}>
                        <DateField label="Expiry date" quick={[]} value={a.exp || null} onChange={(v) => set(it.no, { ...a, exp: v ?? '' })} />
                      </View>
                    </Row>
                    {short ? <Muted style={{ color: colors.red }}>Short – refill</Muted> : null}
                    {expired ? <Muted style={{ color: colors.red }}>Expired – replace</Muted> : null}
                  </View>
                );
              })
            : f.items.map((it) => <AnswerRow key={it.no} item={it} value={answers[it.no]} onChange={(a) => set(it.no, a)} />)}
        </Card>
      </Section>
      {fails.length ? <Notice tone={colors.red}>{`Not accepted: ${fails.map((x) => x.no).join(', ')}. ${kit ? 'Refill / replace before use.' : 'The equipment must not be used until rectified and re-inspected.'}`}</Notice> : null}
      <Row gap={8} style={{ justifyContent: 'flex-end' }}>
        <Button variant="secondary" title="Cancel" onPress={() => router.back()} />
        <Button title="Submit checklist" onPress={save} />
      </Row>
    </Screen>
  );
}
