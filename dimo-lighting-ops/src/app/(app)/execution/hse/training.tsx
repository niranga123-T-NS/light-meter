import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { useDialog } from '@/components/dialog';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, colors, DateField, ErrorBanner, Field, Grid, Muted, Row, Screen, Section } from '@/components/ui';
import { todayISO } from '@/lib/format';
import { slTime, type Participant } from '@/lib/hse';
import { rpc } from '@/lib/supabase';

/** HSE training attendance record (DIMO-LTD-TR-01): title, time, participants – the man-hours are worked out. */
export default function Training() {
  const { project } = useLocalSearchParams<{ project: string }>();
  const dialog = useDialog();
  const [error, setError] = useState<string | null>(null);
  const [h, setH] = useState<Record<string, string>>({});
  const [day, setDay] = useState<string | null>(todayISO());
  const [from, setFrom] = useState('08:00');
  const [to, setTo] = useState('09:00');
  const [ps, setPs] = useState<Participant[]>([{ name: '' }]);
  const set = (k: string, v: string) => setH((s) => ({ ...s, [k]: v }));
  const setP = (i: number, p: Partial<Participant>) => setPs((s) => s.map((x, k) => (k === i ? { ...x, ...p } : x)));
  const people = ps.filter((x) => x.name.trim());
  const hours = Math.max(0, (Date.parse(slTime(day ?? todayISO(), to)) - Date.parse(slTime(day ?? todayISO(), from))) / 36e5);

  const save = async () => {
    setError(null);
    if (!h.title?.trim()) return setError('Enter the training title');
    if (!day || hours <= 0) return setError('Set the date and the time from and to');
    if (!people.length) return setError('Add the participants');
    await dialog.run(async () => {
      const id = await rpc<string>('save_training', { p_exec: project, p: { header: h, starts_at: slTime(day, from), ends_at: slTime(day, to), participants: people } });
      router.replace(`/execution/hse/form/${id}`);
    }, 'Training recorded');
  };

  return (
    <Screen maxWidth={860}>
      <Stack.Screen options={{ title: 'HSE training' }} />
      <TestingBanner what="HSE training records" />
      <ErrorBanner message={error} />
      <Section title="DIMO-LTD-TR-01 · HSE training attendance record">
        <Card>
          <Field label="Title" required value={h.title ?? ''} onChangeText={(v) => set('title', v)} placeholder="e.g. Working at height, Fire safety, Electrical safety" />
          <Grid min={240}>
            <Field label="Location" value={h.location ?? ''} onChangeText={(v) => set('location', v)} />
            <Field label="Contractor" value={h.contractor ?? ''} onChangeText={(v) => set('contractor', v)} />
          </Grid>
          <Grid min={180}>
            <DateField label="Date" required value={day} onChange={setDay} />
            <Field label="Time from" value={from} onChangeText={setFrom} />
            <Field label="Time to" value={to} onChangeText={setTo} />
          </Grid>
          <Field label="Conducted by – your designation" value={h.designation ?? ''} onChangeText={(v) => set('designation', v)} placeholder="e.g. Assistant Engineer / EHS Officer" />
        </Card>
      </Section>
      <Section title={`Participants (${people.length})`} right={<Button small variant="secondary" title="+ Person" onPress={() => setPs((s) => [...s, { name: '' }])} />}>
        <Card>
          {ps.map((p, i) => (
            <Grid key={i} min={160}>
              <Field label={`Name ${i + 1}`} value={p.name} onChangeText={(v) => setP(i, { name: v })} />
              <Field label="Designation" value={p.position ?? ''} onChangeText={(v) => setP(i, { position: v })} />
              <Field label="Company" value={p.company ?? ''} onChangeText={(v) => setP(i, { company: v })} />
              <Field label="Contact no" value={p.contact ?? ''} onChangeText={(v) => setP(i, { contact: v })} keyboardType="phone-pad" />
            </Grid>
          ))}
          <Text style={{ fontWeight: '700', color: colors.ink }}>{`Total man-hours: ${Math.round(people.length * hours * 10) / 10}`}</Text>
          <Muted>Participants × hours of the session.</Muted>
        </Card>
      </Section>
      <Row gap={8} style={{ justifyContent: 'flex-end' }}>
        <Button variant="secondary" title="Cancel" onPress={() => router.back()} />
        <Button title="Save training" onPress={save} />
      </Row>
    </Screen>
  );
}
