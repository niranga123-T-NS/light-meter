import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { AnswerRow, allAnswered } from '@/components/exec/HseBits';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, colors, DateField, ErrorBanner, Field, Grid, Loading, Muted, Notice, Row, Screen, Section, Segmented, Select } from '@/components/ui';
import { fmtDate, todayISO } from '@/lib/format';
import { formName, loadHseForms, slTime, type Answer, type HseEquipment, type HseRecord } from '@/lib/hse';
import { useLoad } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';

/** Request a permit to work: Section A work details, Section B control measures (all Yes / N/A), then the EHS Officer approves. */
export default function PermitRequest() {
  const params = useLocalSearchParams<{ project: string; form: string }>();
  const dialog = useDialog();
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [h, setH] = useState<Record<string, string>>({ shift: 'day' });
  const [readings, setReadings] = useState<Record<string, string>>({});
  const [day, setDay] = useState<string | null>(todayISO());
  const [from, setFrom] = useState('08:00');
  const [to, setTo] = useState('17:00');
  const [equipment, setEquipment] = useState<string | null>(null);
  const [tbt, setTbt] = useState<string | null>(null);
  const { data } = useLoad(async () => {
    const [forms, eq, tbts] = await Promise.all([
      loadHseForms(),
      supabase.from('hse_equipment').select('*').eq('exec_project_id', params.project).neq('status', 'off_site'),
      supabase.from('hse_records').select('*').eq('exec_project_id', params.project).eq('form_code', 'TBT-01').gte('created_at', `${todayISO()}T00:00:00+05:30`),
    ]);
    return { form: forms.find((f) => f.code === params.form)!, equipment: (eq.data ?? []) as HseEquipment[], tbts: (tbts.data ?? []) as HseRecord[] };
  }, [params.project, params.form]);
  if (!data?.form) return <Screen><Loading /></Screen>;
  const f = data.form;
  const questions = f.extra.question_items ?? [];
  const eqs = data.equipment.filter((e) => (f.extra.equipment_forms ?? []).includes(e.form_code));
  const set = (k: string, v: string) => setH((s) => ({ ...s, [k]: v }));
  const blocked = f.items.filter((it) => answers[it.no]?.a === 'no' && !questions.includes(it.no));

  const submit = async () => {
    setError(null);
    if (!h.location?.trim() || !h.description?.trim()) return setError('Enter the work location and the description of the work');
    if (!h.in_charge?.trim() || !h.mobile?.trim()) return setError('Enter the in-charge (foreman / supervisor) and mobile number');
    if (!day) return setError('Choose the date');
    const miss = allAnswered(f.items, answers);
    if (miss) return setError(`Answer control ${miss.no}: ${miss.text}`);
    if (blocked.length) return setError(`Control ${blocked[0].no} must be Yes or N/A before work starts – put it right first`);
    const start = slTime(day, from);
    let end = slTime(day, to);
    if (end <= start) end = new Date(Date.parse(end) + 864e5).toISOString(); // night shift runs past midnight
    await dialog.run(async () => {
      const id = await rpc<string>('request_permit', {
        p_exec: params.project,
        p: { form_code: f.code, answers, starts_at: start, ends_at: end, equipment_id: equipment, tbt_id: tbt, header: { ...h, readings } },
      });
      router.replace(`/execution/hse/form/${id}`);
    }, 'Requested – the EHS Officer approves it before work starts');
  };

  return (
    <Screen maxWidth={860}>
      <Stack.Screen options={{ title: `Permit – ${formName(f)}` }} />
      <TestingBanner what="Permits to work" />
      <ErrorBanner message={error} />
      <Card style={{ gap: 2 }}>
        <Text style={{ fontWeight: '700', fontSize: 16, color: colors.ink }}>{`PERMIT TO WORK · ${f.title}`}</Text>
        <Muted>{`${f.doc_no} · ${f.issue} · issued ${fmtDate(f.issue_date)} · the permit number is given when you submit`}</Muted>
      </Card>
      <Section title="Section A – Work details">
        <Card>
          <Grid min={260}>
            <Field label="Work location" required value={h.location ?? ''} onChangeText={(v) => set('location', v)} />
            <Field label="Permit requesting company" value={h.company ?? ''} onChangeText={(v) => set('company', v)} />
          </Grid>
          <Field label="Description of the work" required multiline value={h.description ?? ''} onChangeText={(v) => set('description', v)} />
          <Grid min={180}>
            <DateField label="Date" required value={day} onChange={setDay} />
            <Field label="Starting time (24h)" value={from} onChangeText={setFrom} placeholder="08:00" />
            <Field label="Finishing time (24h)" value={to} onChangeText={setTo} placeholder="17:00" />
          </Grid>
          <Grid min={260}>
            <Field label="In charge (foreman / supervisor)" required value={h.in_charge ?? ''} onChangeText={(v) => set('in_charge', v)} />
            <Field label="Mobile number" required value={h.mobile ?? ''} onChangeText={(v) => set('mobile', v)} keyboardType="phone-pad" />
          </Grid>
          <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text }}>Work shift</Text>
          <Segmented value={h.shift ?? 'day'} onChange={(v) => set('shift', v)} options={[{ value: 'day', label: 'Day' }, { value: 'night', label: 'Night' }]} />
          {(f.extra.header ?? []).map((x) =>
            x.key === 'tbt_no' && data.tbts.length ? (
              <Select key={x.key} label={x.label} value={tbt} onChange={(v) => { setTbt(v || null); set('tbt_no', data.tbts.find((t) => t.id === v)?.code ?? ''); }}
                options={[{ value: '', label: '— later (the toolbox talk links itself) —' }, ...data.tbts.map((t) => ({ value: t.id, label: `${t.code} · ${String(t.header.activity ?? '').slice(0, 50)}` }))]} />
            ) : (
              <Field key={x.key} label={x.label} value={h[x.key] ?? ''} onChangeText={(v) => set(x.key, v)} />
            ),
          )}
          {f.extra.equipment_forms?.length ? (
            <Select label="Machine / equipment used (its checklist must be in date)" value={equipment} onChange={(v) => setEquipment(v || null)}
              options={[{ value: '', label: '— none —' }, ...eqs.map((e) => ({ value: e.id, label: `${e.name}${e.serial_no ? ` · ${e.serial_no}` : ''} – ${e.status === 'in_use' && e.next_due && e.next_due >= todayISO() ? 'checked' : 'NOT IN DATE'}` }))]} />
          ) : null}
        </Card>
      </Section>
      <Section title="Section B – Control measures">
        <Card>
          {f.items.map((it) => (
            <AnswerRow key={it.no} item={it} value={answers[it.no]} onChange={(a) => setAnswers((s) => ({ ...s, [it.no]: a }))} noTone={questions.includes(it.no) ? colors.ink : colors.red} />
          ))}
          {(f.extra.groups ?? []).map((g) => (
            <View key={g.no} style={{ marginTop: 8 }}>
              <Text style={{ fontWeight: '700', color: colors.ink }}>{`${g.no}  ${g.title}`}</Text>
              {g.items.map((t, i) => (
                <AnswerRow key={t} item={{ no: `${g.no}.${i + 1}`, text: t }} value={answers[`${g.no}.${i + 1}`]} remark={false} noTone={colors.ink}
                  onChange={(a) => setAnswers((s) => ({ ...s, [`${g.no}.${i + 1}`]: a }))} />
              ))}
            </View>
          ))}
          {(f.extra.explain_if_yes ?? []).some((n) => answers[n]?.a === 'yes') ? <Field label='If "YES" explain' required multiline value={h.explain ?? ''} onChangeText={(v) => set('explain', v)} /> : null}
          {f.extra.readings?.length ? (
            <View style={{ marginTop: 8 }}>
              <Text style={{ fontWeight: '700', color: colors.ink }}>Gas test readings (when checked)</Text>
              <Muted>Safe: O2 19.5–23.5 %, flammable gas below 10 % LEL, H2S below 10 ppm, CO below 25 ppm.</Muted>
              <Grid min={150}>
                {f.extra.readings.map((x) => (
                  <Field key={x.key} label={x.label} value={readings[x.key] ?? ''} onChangeText={(v) => setReadings((s) => ({ ...s, [x.key]: v.replace(/[^0-9.]/g, '') }))} keyboardType="numeric" />
                ))}
              </Grid>
            </View>
          ) : null}
        </Card>
      </Section>
      {blocked.length ? <Notice tone={colors.red}>{`Control ${blocked.map((x) => x.no).join(', ')} answered No – work cannot start until it is put right.`}</Notice> : null}
      <Muted>Section C: by submitting you confirm you have inspected the workplace, the precautions above are in place and workers have been briefed.</Muted>
      <Row gap={8} style={{ justifyContent: 'flex-end' }}>
        <Button variant="secondary" title="Cancel" onPress={() => router.back()} />
        <Button title="Request permit" onPress={submit} />
      </Row>
    </Screen>
  );
}
