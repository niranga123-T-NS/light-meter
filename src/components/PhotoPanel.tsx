import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { exposureSettings, formatShutter } from '../exposure';
import { luxToEv100 } from '../format';
import { Card, colors, SectionTitle, Segment } from './ui';

const ISO_CHOICES = [100, 200, 400, 800, 1600, 3200] as const;

export function PhotoPanel({ lux, reflected }: { lux: number | null; reflected: boolean }) {
  const [iso, setIso] = useState<(typeof ISO_CHOICES)[number]>(100);
  const ev100 = lux != null && lux > 0 ? luxToEv100(lux) : null;
  const settings = ev100 != null ? exposureSettings(ev100, iso) : [];

  return (
    <>
      <Card style={{ alignItems: 'center' }}>
        <Text style={styles.evValue}>{ev100 != null ? ev100.toFixed(1) : '—'}</Text>
        <Text style={styles.evLabel}>EV at ISO 100</Text>
        <Text style={styles.hint}>
          {reflected
            ? 'Reflected reading (back camera): point at a mid-tone subject.'
            : 'Incident reading: hold the phone at your subject, screen facing the camera position or light.'}
        </Text>
      </Card>

      <Card>
        <SectionTitle title="ISO" />
        <Segment options={ISO_CHOICES} value={iso} onChange={setIso} />
      </Card>

      <Card style={{ gap: 0 }}>
        <View style={[styles.row, styles.header]}>
          <Text style={[styles.cell, styles.headerText]}>Aperture</Text>
          <Text style={[styles.cell, styles.headerText, styles.right]}>Shutter</Text>
        </View>
        {ev100 == null ? (
          <Text style={[styles.hint, { paddingVertical: 16 }]}>Waiting for a light reading…</Text>
        ) : (
          settings.map((s) => (
            <View key={s.aperture} style={[styles.row, !s.inRange && { opacity: 0.35 }]}>
              <Text style={styles.cell}>f/{s.aperture}</Text>
              <Text style={[styles.cell, styles.right, s.handheld ? styles.handheld : styles.tripod]}>
                {s.inRange ? formatShutter(s.shutter) : s.shutter > 1 ? '> 30s' : '< 1/8000'}
              </Text>
            </View>
          ))
        )}
        <Text style={[styles.hint, { marginTop: 12 }]}>
          <Text style={styles.handheld}>■</Text> handheld (1/60s or faster) <Text style={styles.tripod}> ■</Text> use a
          tripod
        </Text>
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  evValue: { color: colors.text, fontSize: 56, fontWeight: '200', fontVariant: ['tabular-nums'] },
  evLabel: { color: colors.muted, fontSize: 14, marginTop: -4 },
  hint: { color: colors.muted, fontSize: 13, lineHeight: 18, textAlign: 'center' },
  row: {
    flexDirection: 'row',
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.raised,
  },
  header: { borderTopWidth: 0, paddingTop: 0 },
  headerText: { color: colors.muted, fontSize: 13, fontWeight: '500' },
  cell: { flex: 1, color: colors.text, fontSize: 17, fontVariant: ['tabular-nums'] },
  right: { textAlign: 'right' },
  handheld: { color: '#8fd14f' },
  tripod: { color: colors.accent },
});
