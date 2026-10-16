import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { AreaPicker } from '@/components/exec/AreaPicker';
import { SiteLocationCard } from '@/components/exec/SiteLocationCard';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, colors, DateField, ErrorBanner, Field, Loading, Muted, Notice, Row, Screen, Section, Segmented } from '@/components/ui';
import { useMe } from '@/lib/auth';
import type { ExecProject } from '@/lib/execution';
import { fmtDateTime } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';

type Switch = { id: string; reason: string; status: string; requested_by: string | null; requested_at: string; decided_by: string | null; decided_at: string | null; decision_note: string | null };

/** Execution details of a project: the project areas (any of the 18, combined), site and dates, and whether it uses smart drawings. */
export default function ExecutionDetails() {
  const dialog = useDialog();
  const me = useMe();
  const people = usePeople();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState<{ areas: string[]; site_address: string; start_date: string | null; end_date: string | null; sd: '' | 'yes' | 'no' } | null>(null);
  const { data: loaded, reload } = useLoad(async () => {
    const [{ data }, sw] = await Promise.all([
      supabase.from('exec_projects').select('*').eq('id', id).maybeSingle(),
      supabase.from('exec_drawing_switches').select('*').eq('exec_project_id', id).order('requested_at', { ascending: false }).limit(1),
    ]);
    return { p: data as ExecProject | null, sw: ((sw.data ?? []) as Switch[])[0] ?? null };
  }, [id]);
  const existing = loaded?.p;
  if (!existing) return <Screen><Loading /></Screen>;
  const sw = loaded?.sw ?? null;
  const pending = sw?.status === 'pending' ? sw : null;
  const v = f ?? { areas: existing.areas, site_address: existing.site_address ?? '', start_date: existing.start_date, end_date: existing.end_date, sd: existing.smart_drawings == null ? '' : existing.smart_drawings ? 'yes' : 'no' };
  const set = (x: Partial<typeof v>) => setF({ ...v, ...x });

  const save = async () => {
    setError(null);
    if (!v.areas.length) return setError('Choose at least one project area');
    if (!v.sd) return setError('Choose whether the project uses smart drawings');
    await dialog.run(async () => {
      await rpc('update_exec_project', {
        p_id: id,
        p: { areas: v.areas, site_address: v.site_address, start_date: v.start_date ?? '', end_date: v.end_date ?? '', lat: existing.lat ?? '', lng: existing.lng ?? '', ...(existing.smart_drawings ? {} : { smart_drawings: v.sd === 'yes' }) },
      });
      router.back();
    }, 'Saved');
  };

  return (
    <Screen maxWidth={860}>
      <Stack.Screen options={{ title: 'Execution details' }} />
      <TestingBanner what="The execution module" />
      <ErrorBanner message={error} />
      <Section title={`Project areas (${v.areas.length} chosen)`}>
        <Card>
          <Muted>One project can combine several areas; each area brings its own checks and handover list.</Muted>
          <AreaPicker value={v.areas} onChange={(areas) => set({ areas })} />
        </Card>
      </Section>
      <Section title="Site and dates">
        <Card>
          <Field label="Site address" multiline value={v.site_address} onChangeText={(site_address) => set({ site_address })} />
          <Row wrap gap={8}>
            <DateField label="Start" value={v.start_date} onChange={(start_date) => set({ start_date })} quick={[0]} />
            <DateField label="Planned finish" value={v.end_date} onChange={(end_date) => set({ end_date })} quick={[]} />
          </Row>
        </Card>
      </Section>
      <Section title="Smart drawings · testing">
        <Card style={{ gap: 8 }}>
          <Muted>
            Mark up the project&apos;s drawings with every item and cable route, and follow the installation, checks and tests on them. Choose it for this project or not –
            it can be switched on later; stopping it once it is in use needs SM Projects&apos; approval.
          </Muted>
          {existing.smart_drawings ? (
            <>
              <Notice tone={colors.green}>In use on this project.</Notice>
              {pending ? (
                <View style={{ gap: 6 }}>
                  <Notice tone={colors.amber}>{`Stop requested by ${people[pending.requested_by ?? '']?.full_name ?? '—'} · ${fmtDateTime(pending.requested_at)}: ${pending.reason} – waiting for SM Projects.`}</Notice>
                  <Row wrap gap={8}>
                    {me.role === 'sm_projects' ? (
                      <>
                        <Button
                          small
                          title="Approve – stop smart drawings"
                          onPress={async () => {
                            if (await dialog.confirm('Stop smart drawings on this project?', 'What was recorded stays readable; nothing can be added or changed.', { confirmLabel: 'Approve' }))
                              await dialog.run(async () => {
                                await rpc('decide_drawings_off', { p_id: pending.id, p_approve: true, p_note: null });
                                await reload();
                              }, 'Smart drawings stopped');
                          }}
                        />
                        <Button
                          small
                          variant="secondary"
                          title="Keep them in use"
                          onPress={async () => {
                            const r = await dialog.prompt({ title: 'Keep smart drawings in use', fields: [{ key: 'n', label: 'Why (goes to the Senior Electrical Engineer)', type: 'multiline', required: true }] });
                            if (r)
                              await dialog.run(async () => {
                                await rpc('decide_drawings_off', { p_id: pending.id, p_approve: false, p_note: r.n });
                                await reload();
                              }, 'Kept in use');
                          }}
                        />
                      </>
                    ) : null}
                    {me.role === 'senior_elec_engineer' ? (
                      <Button
                        small
                        variant="secondary"
                        title="Withdraw the request"
                        onPress={() =>
                          dialog.run(async () => {
                            await rpc('withdraw_drawings_off', { p_id: pending.id });
                            await reload();
                          }, 'Withdrawn')
                        }
                      />
                    ) : null}
                  </Row>
                </View>
              ) : (
                <>
                  {sw?.status === 'rejected' ? <Muted>{`Last request to stop was not approved${sw.decision_note ? `: ${sw.decision_note}` : ''}.`}</Muted> : null}
                  {me.role === 'senior_elec_engineer' ? (
                    <Row>
                      <Button
                        small
                        variant="secondary"
                        title="Ask to stop using smart drawings"
                        onPress={async () => {
                          const r = await dialog.prompt({
                            title: 'Stop smart drawings on this project?',
                            message: 'SM Projects approves it. What was recorded stays readable.',
                            fields: [{ key: 'why', label: 'Why', type: 'multiline', required: true }],
                          });
                          if (r)
                            await dialog.run(async () => {
                              await rpc('request_drawings_off', { p_exec: id, p_reason: r.why });
                              await reload();
                            }, 'Sent to SM Projects');
                        }}
                      />
                    </Row>
                  ) : null}
                </>
              )}
            </>
          ) : (
            <>
              {existing.smart_drawings === false ? <Muted>{`Not used on this project${sw?.status === 'approved' ? ` – stopped ${fmtDateTime(sw.decided_at ?? sw.requested_at)} (${sw.reason})` : ''}. Choose “Use” to switch them back on.`}</Muted> : null}
              <Segmented<'yes' | 'no'>
                value={(v.sd || undefined) as 'yes' | 'no'}
                onChange={(sd) => set({ sd })}
                options={[
                  { value: 'yes', label: 'Use smart drawings' },
                  { value: 'no', label: 'Do not use' },
                ]}
              />
              {!v.sd ? <Muted style={{ color: colors.red }}>Choose one – it is needed to save the details.</Muted> : null}
            </>
          )}
        </Card>
      </Section>
      <SiteLocationCard p={existing} onChange={reload} />
      <Row gap={8} style={{ justifyContent: 'flex-end' }}>
        <Button variant="secondary" title="Cancel" onPress={() => router.back()} />
        <Button title="Save" onPress={save} />
      </Row>
    </Screen>
  );
}
