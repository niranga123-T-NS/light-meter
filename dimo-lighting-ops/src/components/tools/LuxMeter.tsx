import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { DataTable } from '@/components/DataTable';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, ErrorBanner, Loading, Muted, Notice, Row } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { CAL_DAYS, deviceName, surveyStats, useLightSensor, type Calibration, type LuxSurvey } from '@/lib/lux';
import { supabase } from '@/lib/supabase';

/** Lux meter: the phone's light sensor, calibrated against a reference meter – live, spot readings and room surveys.
 *  Works in the Android app; elsewhere the saved surveys can be seen and shared. */
export function LuxMeter() {
  const me = useMe();
  const dialog = useDialog();
  const people = usePeople();
  const android = Platform.OS === 'android';
  const device = deviceName();
  const [hold, setHold] = useState<number | null>(null);
  const sensor = useLightSensor(android);
  const { data, error, reload } = useLoad(async () => {
    const [c, s] = await Promise.all([
      android ? supabase.from('lux_calibrations').select('*').eq('user_id', me.id).eq('device', device).order('created_at', { ascending: false }).limit(1) : Promise.resolve({ data: [], error: null }),
      supabase.from('lux_surveys').select('id, code, title, kind, phase, target, stats, created_by, created_at').order('created_at', { ascending: false }).limit(200),
    ]);
    if (s.error) throw new Error(s.error.message);
    return { cal: ((c.data ?? [])[0] ?? null) as Calibration | null, surveys: (s.data ?? []) as LuxSurvey[] };
  }, [android, device]);

  const cal = data?.cal ?? null;
  const calAge = cal ? (Date.parse(new Date().toISOString()) - Date.parse(cal.created_at)) / 86400000 : null;
  const calOk = cal != null && calAge != null && calAge <= CAL_DAYS;
  const lux = sensor.raw != null ? sensor.raw * (cal?.factor ?? 1) : null;
  const shown = hold ?? lux;
  const f = cal?.factor ?? 1;
  const range = sensor.range && Number.isFinite(sensor.range.min) ? { min: sensor.range.min * f, max: sensor.range.max * f } : null;

  const calibrate = async () => {
    if (sensor.raw == null) return dialog.toast('No reading from the light sensor yet', 'error');
    const raw = sensor.raw;
    const r = await dialog.prompt({
      title: 'Calibrate this phone',
      message: `Put the phone beside the reference lux meter’s sensor, both facing up, under steady light (not direct sunlight). The phone reads ${Math.round(raw)} lx uncorrected. Enter what the reference meter shows.`,
      fields: [
        { key: 'ref', label: 'Reference meter reading (lx)', required: true },
        { key: 'meter', label: 'Reference meter (make, model)', required: true, hint: 'e.g. Testo 545, Konica Minolta T-10' },
      ],
      confirmLabel: 'Save calibration',
    });
    if (!r) return;
    await dialog.run(async () => {
      const ref = Number(r.ref.replace(/,/g, ''));
      if (!(ref > 0)) throw new Error('Enter the reference reading in lux');
      if (raw < 20) throw new Error('Calibrate under more light – at least 100 lx on the reference meter');
      const factor = ref / raw;
      if (factor < 0.1 || factor > 10) throw new Error(`The phone and the meter differ ${factor.toFixed(1)} times – check both are side by side, facing up`);
      const { error: e } = await supabase.from('lux_calibrations').insert({ device, factor: Math.round(factor * 10000) / 10000, reference: r.meter.trim(), ref_lux: ref, phone_lux: Math.round(raw * 10) / 10 });
      if (e) throw new Error(e.message);
      await reload();
    }, 'Calibrated');
  };
  const saveSpot = async () => {
    if (!calOk) return dialog.toast('Calibrate the phone first', 'error');
    if (shown == null) return dialog.toast('No reading yet', 'error');
    const value = Math.round(shown);
    const r = await dialog.prompt({
      title: `Save ${value} lx`,
      fields: [
        { key: 'title', label: 'Where', required: true, hint: 'e.g. ABC Hotels – lobby reception desk' },
        { key: 'phase', label: 'Lighting', type: 'select', options: [{ value: 'check', label: 'Check' }, { value: 'before', label: 'Before (existing)' }, { value: 'after', label: 'After (new)' }], initial: 'check' },
        { key: 'notes', label: 'Notes', type: 'multiline' },
      ],
      confirmLabel: 'Save',
    });
    if (!r) return;
    await dialog.run(async () => {
      const readings = [{ r: 0, c: 0, lux: value }];
      const { error: e } = await supabase.from('lux_surveys').insert({ title: r.title.trim(), kind: 'spot', phase: r.phase || 'check', readings, stats: surveyStats(readings), factor: cal?.factor, device, calibrated_at: cal?.created_at, notes: r.notes || null });
      if (e) throw new Error(e.message);
      await reload();
    }, 'Saved');
  };

  return (
    <View style={{ gap: 10 }}>
      {!android ? (
        <Notice tone={colors.amber}>The lux meter works only in the Android app – it uses the phone’s light sensor. Open Sales Tools → Lux meter on an Android phone to measure. Surveys made there are listed below to view and share.</Notice>
      ) : !data ? (
        error ? <ErrorBanner message={error} /> : <Loading />
      ) : sensor.available === false ? (
        <Notice tone={colors.amber}>This phone has no light sensor the app can read.</Notice>
      ) : (
        <>
          <Card style={{ gap: 4 }}>
            <Row wrap style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ flexShrink: 1 }}>
                <Text style={{ fontWeight: '700', color: colors.ink }}>{device}</Text>
                <Muted>{cal ? `Calibrated ${fmtDate(cal.created_at)} against ${cal.reference} · factor ${cal.factor}` : 'Not calibrated'}</Muted>
              </View>
              <Button small variant={calOk ? 'ghost' : 'primary'} title={cal ? 'Calibrate again' : 'Calibrate'} onPress={calibrate} />
            </Row>
            {!calOk ? <Notice tone={colors.amber}>{cal ? `The calibration is more than ${CAL_DAYS} days old – calibrate again before saving readings.` : 'Phone sensors can be 20–50% off. Calibrate once against a reference lux meter before saving readings.'}</Notice> : null}
          </Card>
          <Card style={{ alignItems: 'center', gap: 6, paddingVertical: 22 }}>
            <Muted>{hold != null ? 'HELD' : 'Live – hold the phone flat, sensor facing up (top edge, next to the camera)'}</Muted>
            <Text style={{ fontSize: 64, fontWeight: '800', color: calOk ? colors.ink : colors.muted }}>{shown != null ? Math.round(shown).toLocaleString('en-LK') : '—'}</Text>
            <Text style={{ fontSize: 18, color: colors.muted }}>lux{!calOk ? ' (not calibrated)' : sensor.steady ? ' · steady' : ''}</Text>
            {range ? <Muted>{`min ${Math.round(range.min)} · max ${Math.round(range.max)} lx`}</Muted> : null}
            <Row gap={8} wrap style={{ justifyContent: 'center' }}>
              <Button small variant="secondary" title={hold != null ? 'Release' : 'Hold'} onPress={() => setHold(hold != null ? null : lux)} />
              <Button small variant="secondary" title={range ? 'Reset min / max' : 'Track min / max'} onPress={sensor.track} />
              <Button small title="Save spot reading" onPress={saveSpot} />
            </Row>
          </Card>
          <Button title="+ New room survey (grid)" onPress={() => (calOk ? router.push('/tools/lux/new') : dialog.toast('Calibrate the phone first', 'error'))} />
        </>
      )}
      {data ? (
        <DataTable
          rows={data.surveys}
          keyOf={(s) => s.id}
          onPress={(s) => router.push(`/tools/lux/${s.id}`)}
          emptyTitle="No surveys yet"
          columns={[
            { h: 'Survey', w: 260, grow: true, v: (s) => `${s.title}\n${s.code ?? ''}${s.created_by !== me.id ? ` · ${people[s.created_by]?.full_name ?? ''}` : ''}` },
            { h: 'Kind', w: 110, v: (s) => `${s.kind === 'grid' ? 'Room grid' : 'Spot'}\n${s.phase === 'before' ? 'Before' : s.phase === 'after' ? 'After' : 'Check'}` },
            { h: 'Average', w: 90, right: true, v: (s) => (s.stats?.eav != null ? `${Math.round(s.stats.eav)} lx` : '—') },
            { h: 'Uo', w: 60, right: true, v: (s) => (s.kind === 'grid' && s.stats?.uo != null ? s.stats.uo.toFixed(2) : '—') },
            { h: 'Target', w: 80, right: true, v: (s) => (s.target ? `${s.target} lx` : '—') },
            { h: 'Measured', w: 140, v: (s) => fmtDateTime(s.created_at) },
          ]}
        />
      ) : !android && error ? (
        <ErrorBanner message={error} />
      ) : null}
    </View>
  );
}
