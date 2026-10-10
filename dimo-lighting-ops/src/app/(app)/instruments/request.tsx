import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, Platform } from 'react-native';
import { useDialog } from '@/components/dialog';
import { LocationPicker } from '@/components/LocationPicker';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, colors, DateField, ErrorBanner, Field, Grid, Loading, Muted, Notice, Row, Screen, Section, Select, Toggle } from '@/components/ui';
import { useMe } from '@/lib/auth';
import type { ExecProject } from '@/lib/execution';
import { addDaysISO, fmtDate, todayISO } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { calState, instrumentTitle, type Instrument, type InstrumentRequest } from '@/lib/instruments';
import { mapLink, siteFix } from '@/lib/site';
import { rpc, supabase } from '@/lib/supabase';

/** Request an instrument: the project (or one not listed), the dates, and the location of use pinned on the map. */
export default function RequestInstrument() {
  const params = useLocalSearchParams<{ instrument?: string; project?: string }>();
  const dialog = useDialog();
  const me = useMe();
  const [again, setAgain] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inst, setInst] = useState<string | null>(params.instrument ?? null);
  const [project, setProject] = useState<string | null>(params.project ?? null);
  const [notListed, setNotListed] = useState(false);
  const [projectText, setProjectText] = useState('');
  const [purpose, setPurpose] = useState('');
  const [from, setFrom] = useState<string | null>(todayISO());
  const [to, setTo] = useState<string | null>(addDaysISO(todayISO(), 2));
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [address, setAddress] = useState('');
  const [picking, setPicking] = useState(false);
  const [accept, setAccept] = useState(false);
  const { data } = useLoad(async () => {
    const [i, p, r] = await Promise.all([
      supabase.from('instruments').select('*').eq('removed', false).order('name'),
      supabase.from('exec_projects').select('id, name, code, site_lat, site_lng, status').order('name'),
      supabase.from('instrument_requests').select('*').in('status', ['waiting', 'ready', 'issued']),
    ]);
    return {
      instruments: (i.data ?? []) as Instrument[],
      projects: (p.data ?? []) as (Pick<ExecProject, 'id' | 'name' | 'code' | 'status'> & { site_lat: number | null; site_lng: number | null })[],
      live: (r.data ?? []) as InstrumentRequest[],
    };
  });
  if (!data) return <Screen><Loading /></Screen>;
  const i = data.instruments.find((x) => x.id === inst) ?? null;
  const cal = i ? calState(i) : null;
  const out = i ? data.live.find((r) => r.instrument_id === i.id && r.status === 'issued') : null;
  const queue = i ? data.live.filter((r) => r.instrument_id === i.id && r.status !== 'issued') : [];
  const proj = data.projects.find((p) => p.id === project);
  const mineOpen = i ? data.live.filter((r) => r.instrument_id === i.id && r.requested_by === me.id) : [];

  const here = async () => {
    const f = await siteFix();
    if (!f) return dialog.toast('Location not available – allow location access or pick on the map', 'error');
    setPin({ lat: f.lat, lng: f.lng });
  };
  const save = async () => {
    setError(null);
    if (!i) return setError('Choose the instrument');
    if (!notListed && !project) return setError('Choose the project, or tick “Project not listed”');
    if (notListed && !projectText.trim()) return setError('Enter the project');
    if (!from || !to || to < from) return setError('Enter the dates you need it from and to');
    if (!pin) return setError('Pin the location where it will be used');
    if (mineOpen.length && !again) return setError('You already have an open request for this instrument – tick to confirm you need another');
    if (cal && !cal.ok && !accept) return setError('This instrument is not calibrated – tick to confirm you will use it uncalibrated');
    await dialog.run(async () => {
      await rpc('request_instrument', {
        p_instrument: i.id,
        p: {
          exec_project_id: notListed ? null : project,
          project_text: notListed ? projectText.trim() : null,
          purpose,
          need_from: from,
          need_to: to,
          lat: pin.lat,
          lng: pin.lng,
          address,
          accept_uncalibrated: accept,
          confirm_multiple: again,
        },
      });
      router.replace(params.project ? `/execution/${params.project}?tab=qa` : '/instruments');
    }, out || queue.length ? 'Requested – you are told when it is back and ready' : 'Requested – Operations prepares it');
  };

  return (
    <Screen maxWidth={800}>
      <Stack.Screen options={{ title: 'Request an instrument' }} />
      <TestingBanner what="Instruments" />
      <ErrorBanner message={error} />
      <Section title="Instrument">
        <Card>
          <Select
            label="Instrument"
            required
            searchable
            value={inst}
            onChange={(v) => { setInst(v); setAccept(false); setAgain(false); }}
            options={data.instruments.filter((x) => x.condition === 'ok').map((x) => ({ value: x.id, label: `${x.code ?? ''} ${instrumentTitle(x)}`, hint: calState(x).label }))}
          />
          {i && cal ? (
            <>
              {mineOpen.length ? (
                <>
                  <Notice tone={colors.amber}>
                    {`You already have ${mineOpen.length} open request(s) for this instrument (${mineOpen.map((r) => `${fmtDate(r.need_from)} – ${fmtDate(r.need_to)}`).join(', ')}). Another one is allowed but should not be the practice – Operations is told.`}
                  </Notice>
                  <Toggle label="I need another request" value={again} onChange={setAgain} />
                </>
              ) : null}
              {out ? <Notice tone={colors.blue}>{`In use until ${fmtDate(out.due_back)}${queue.length ? ` · ${queue.length} request(s) before you` : ''} – you are told when it comes back.`}</Notice> : queue.length ? <Notice tone={colors.blue}>{`${queue.length} request(s) before you.`}</Notice> : null}
              {!cal.ok ? (
                <>
                  <Notice tone={colors.red}>{`${cal.label}. It can be used, but you and the Operations Executive are alerted, and readings may not be accepted by the client / consultant.`}</Notice>
                  <Toggle label="I will use it uncalibrated" value={accept} onChange={setAccept} />
                </>
              ) : (
                <Muted>{`${cal.label}${i.cal_expiry ? ` until ${fmtDate(i.cal_expiry)}` : ''} – the calibration report is on the instrument’s page.`}</Muted>
              )}
            </>
          ) : null}
        </Card>
      </Section>
      <Section title="Project and dates">
        <Card>
          {!notListed ? (
            <Select
              label="Project"
              required
              searchable
              value={project}
              onChange={(v) => {
                setProject(v);
                const p = data.projects.find((x) => x.id === v);
                if (p?.site_lat != null && p.site_lng != null && !pin) setPin({ lat: p.site_lat, lng: p.site_lng });
              }}
              options={data.projects.filter((p) => p.status === 'active').map((p) => ({ value: p.id, label: `${p.code ?? ''} ${p.name}` }))}
            />
          ) : (
            <Field label="Project (not listed)" required value={projectText} onChangeText={setProjectText} placeholder="Customer, project name, inquiry / quotation no." />
          )}
          <Toggle label="Project not listed – enter it" value={notListed} onChange={setNotListed} />
          <Grid min={220}>
            <DateField label="Needed from" required value={from} onChange={setFrom} />
            <DateField label="Return by" required value={to} onChange={setTo} quick={[1, 2, 7]} />
          </Grid>
          <Field label="Purpose" value={purpose} onChangeText={setPurpose} placeholder="e.g. Lux survey before handover, IR test of feeders" />
        </Card>
      </Section>
      <Section title="Location of use">
        <Card>
          {pin ? (
            <Row gap={8} wrap style={{ alignItems: 'center' }}>
              <Muted>{`Pinned: ${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}${proj && proj.site_lat === pin.lat ? ' (project site)' : ''}`}</Muted>
              <Button small variant="ghost" title="Check on the map" onPress={() => Linking.openURL(mapLink(pin.lat, pin.lng))} />
            </Row>
          ) : (
            <Notice tone={colors.amber}>Pin the location where the instrument will be used.</Notice>
          )}
          <Row gap={8} wrap>
            {Platform.OS === 'web' ? <Button variant="secondary" title={pin ? 'Move the pin' : 'Pin on the map'} onPress={() => setPicking(true)} /> : null}
            <Button variant="secondary" title="Use my location" onPress={here} />
          </Row>
          <Field label="Address / area (optional)" value={address} onChangeText={setAddress} />
        </Card>
      </Section>
      <Row gap={8} style={{ justifyContent: 'flex-end' }}>
        <Button variant="secondary" title="Cancel" onPress={() => router.back()} />
        <Button title="Request" onPress={save} />
      </Row>
      <LocationPicker
        visible={picking}
        title="Where will the instrument be used?"
        query={proj?.name ?? projectText}
        initial={pin}
        onClose={() => setPicking(false)}
        onSave={async (p) => {
          setPin(p);
          setPicking(false);
        }}
      />
    </Screen>
  );
}
