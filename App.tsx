import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useKeepAwake } from 'expo-keep-awake';
import { CameraPosition, categorize, useLightLevel } from './src/useLightLevel';
import { formatValue, logFraction, luxToEv100, Unit, unitLabel } from './src/format';
import { useHistory } from './src/history';
import { LiveChart } from './src/components/LiveChart';
import { HistoryPanel } from './src/components/HistoryPanel';
import { PhotoPanel } from './src/components/PhotoPanel';
import { Button, Card, colors, SectionTitle, Segment, Stat } from './src/components/ui';

type Tab = 'meter' | 'history' | 'photo';
const TABS: readonly Tab[] = ['meter', 'history', 'photo'];
const TAB_LABELS: Record<Tab, string> = { meter: 'Meter', history: 'History', photo: 'Photo' };

// Live graph: one sample every 250 ms, 30 s window.
const SAMPLE_MS = 250;
const CHART_CAPACITY = 120;

type Stats = { min: number; max: number; sum: number; count: number };
const emptyStats: Stats = { min: Infinity, max: -Infinity, sum: 0, count: 0 };

export default function App() {
  useKeepAwake();
  const [tab, setTab] = useState<Tab>('meter');
  const [paused, setPaused] = useState(false);
  const [unit, setUnit] = useState<Unit>('lux');
  const [cameraPosition, setCameraPosition] = useState<CameraPosition>('front');
  const [calibration, setCalibration] = useState(1);
  const [stats, setStats] = useState<Stats>(emptyStats);
  const [samples, setSamples] = useState<number[]>([]);
  const [savedFlash, setSavedFlash] = useState(false);
  const history = useHistory();

  const { status, lux, source, message } = useLightLevel({ paused, cameraPosition, calibration });

  // Sample the latest reading on a fixed clock so the graph has an even time axis
  // (the Android sensor only reports when the value changes).
  const latest = useRef<number | null>(null);
  latest.current = status === 'running' ? lux : null;
  useEffect(() => {
    const id = setInterval(() => {
      const v = latest.current;
      if (v == null) return;
      setSamples((s) => (s.length >= CHART_CAPACITY ? [...s.slice(1), v] : [...s, v]));
      setStats((s) => ({ min: Math.min(s.min, v), max: Math.max(s.max, v), sum: s.sum + v, count: s.count + 1 }));
    }, SAMPLE_MS);
    return () => clearInterval(id);
  }, []);

  const resetStats = () => {
    setStats(emptyStats);
    setSamples([]);
  };

  const saveReading = () => {
    if (lux == null || !source) return;
    history.add(lux, source);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1200);
  };

  const category = lux != null ? categorize(lux) : null;
  const ev100 = lux != null && lux > 0 ? luxToEv100(lux) : null;
  const failed = status === 'unavailable' || status === 'denied' || status === 'error';

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Text style={styles.title}>Light Meter</Text>
        <Pressable onPress={() => setUnit(unit === 'lux' ? 'fc' : 'lux')} hitSlop={12}>
          <Text style={styles.unitToggle}>{unit === 'lux' ? 'lux' : 'fc'} ⇄</Text>
        </Pressable>
      </View>
      <View style={styles.tabs}>
        <Segment options={TABS} value={tab} onChange={setTab} label={(t) => TAB_LABELS[t]} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {tab === 'meter' && (
          <>
            <View style={styles.readoutCard}>
              <Text style={styles.subtitle}>
                {source === 'camera'
                  ? `Estimating from ${cameraPosition} camera exposure`
                  : Platform.OS === 'ios'
                    ? 'Camera-based meter'
                    : 'Ambient light sensor'}
              </Text>
              {failed ? (
                <Text style={styles.message}>{message}</Text>
              ) : (
                <>
                  <Text style={[styles.value, paused && styles.dimmed]} adjustsFontSizeToFit numberOfLines={1}>
                    {lux != null ? formatValue(lux, unit) : '—'}
                  </Text>
                  <Text style={styles.unit}>{unitLabel(unit)}</Text>
                  {category && (
                    <View style={styles.categoryRow}>
                      <View style={[styles.dot, { backgroundColor: category.color }]} />
                      <Text style={styles.categoryLabel}>{category.label}</Text>
                      <Text style={styles.categoryHint}> · {category.hint}</Text>
                    </View>
                  )}
                  {status === 'paused' && <Text style={styles.heldTag}>HOLD</Text>}
                  {status === 'starting' && <Text style={styles.categoryHint}>Starting…</Text>}
                </>
              )}

              <View style={styles.meterTrack}>
                <View
                  style={[
                    styles.meterFill,
                    {
                      width: `${lux != null ? logFraction(lux) * 100 : 0}%`,
                      backgroundColor: category?.color ?? '#444',
                    },
                  ]}
                />
              </View>
              <View style={styles.meterScale}>
                {['1', '10', '100', '1k', '10k', '100k'].map((t) => (
                  <Text key={t} style={styles.scaleText}>
                    {t}
                  </Text>
                ))}
              </View>
            </View>

            <View style={styles.row}>
              <Button label={paused ? 'Resume' : 'Hold'} onPress={() => setPaused(!paused)} primary />
              <Button
                label={savedFlash ? 'Saved ✓' : 'Save reading'}
                onPress={saveReading}
                disabled={lux == null || failed}
              />
            </View>

            <Card>
              <SectionTitle title="Last 30 seconds" />
              <LiveChart
                samples={samples}
                capacity={CHART_CAPACITY}
                startLabel={`−${(CHART_CAPACITY * SAMPLE_MS) / 1000}s`}
                endLabel="now"
              />
            </Card>

            <View style={styles.row}>
              <Stat label="Min" value={stats.count ? formatValue(stats.min, unit) : '—'} />
              <Stat label="Avg" value={stats.count ? formatValue(stats.sum / stats.count, unit) : '—'} />
              <Stat label="Max" value={stats.count ? formatValue(stats.max, unit) : '—'} />
              <Stat label="EV₁₀₀" value={ev100 != null ? ev100.toFixed(1) : '—'} />
            </View>
            <View style={styles.row}>
              <Button label="Reset graph & stats" onPress={resetStats} />
            </View>

            {Platform.OS === 'ios' && (
              <Card>
                <SectionTitle
                  title="Camera"
                  hint="Front: hold the phone where you want to measure, screen facing the light (like a light meter dome). Back: point at the scene to meter the light it reflects."
                />
                <Segment
                  options={['front', 'back'] as const}
                  value={cameraPosition}
                  onChange={(p) => {
                    setCameraPosition(p);
                    resetStats();
                  }}
                  label={(p) => (p === 'front' ? 'Front (incident)' : 'Back (reflected)')}
                />
              </Card>
            )}

            <Card>
              <SectionTitle
                title={`Calibration ×${calibration.toFixed(2)}`}
                hint="Phone sensors vary. Compare against a reference lux meter and adjust until they match."
              />
              <View style={styles.row}>
                <Button label="−" onPress={() => setCalibration((c) => Math.max(0.1, +(c - 0.05).toFixed(2)))} />
                <Button label="Reset" onPress={() => setCalibration(1)} />
                <Button label="+" onPress={() => setCalibration((c) => Math.min(10, +(c + 0.05).toFixed(2)))} />
              </View>
            </Card>
          </>
        )}

        {tab === 'history' && (
          <HistoryPanel entries={history.entries} unit={unit} onRemove={history.remove} onClear={history.clear} />
        )}

        {tab === 'photo' && (
          <PhotoPanel lux={failed ? null : lux} reflected={source === 'camera' && cameraPosition === 'back'} />
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'ios' ? 64 : 48,
  },
  title: { color: colors.text, fontSize: 28, fontWeight: '700' },
  unitToggle: { color: colors.accent, fontSize: 16, fontWeight: '600' },
  tabs: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4 },
  content: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 40, gap: 16 },
  subtitle: { color: colors.muted, fontSize: 13, marginBottom: 4 },
  readoutCard: { backgroundColor: colors.card, borderRadius: 20, padding: 24, alignItems: 'center' },
  value: { color: colors.text, fontSize: 88, fontWeight: '200', fontVariant: ['tabular-nums'] },
  dimmed: { opacity: 0.6 },
  unit: { color: '#b7bcc8', fontSize: 18, marginTop: -4 },
  categoryRow: { flexDirection: 'row', alignItems: 'center', marginTop: 14 },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
  categoryLabel: { color: colors.text, fontSize: 16, fontWeight: '600' },
  categoryHint: { color: colors.muted, fontSize: 14, marginTop: 4 },
  heldTag: { color: colors.accent, fontWeight: '700', letterSpacing: 2, marginTop: 8 },
  message: { color: colors.textSoft, fontSize: 16, textAlign: 'center', lineHeight: 22, paddingVertical: 24 },
  meterTrack: {
    alignSelf: 'stretch',
    height: 10,
    backgroundColor: colors.raised,
    borderRadius: 5,
    marginTop: 24,
    overflow: 'hidden',
  },
  meterFill: { height: '100%', borderRadius: 5 },
  meterScale: { alignSelf: 'stretch', flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  scaleText: { color: colors.faint, fontSize: 11 },
  row: { flexDirection: 'row', gap: 8 },
});
