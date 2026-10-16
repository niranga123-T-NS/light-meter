import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, Chip, colors, ErrorBanner, Loading, Muted, Row, Screen, Section } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { asBuiltPdf, cableExcel, cablePdf, cableRows, dbPdf, fillPdf, fillRows, loadPack, progressPdf } from '@/lib/drawingReports';
import { useLoad, usePeople } from '@/lib/hooks';
import { ROLE_SHORT } from '@/lib/roles';

/** Reports from the smart drawings of one project: progress drawing, DB charts and certificates, cable schedule, fill list, as-built pack. */
export default function DrawingReports() {
  const { exec } = useLocalSearchParams<{ exec: string }>();
  const me = useMe();
  const dialog = useDialog();
  const people = usePeople();
  const [floor, setFloor] = useState<string | null>(null);
  const { data: p, error } = useLoad(() => loadPack(exec), [exec]);
  if (!p) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const who = `${me.full_name} – ${ROLE_SHORT[me.role]}`;
  const floors = [...new Set(p.drawings.map((d) => d.floor ?? 'Other sheets'))];
  const sheets = p.drawings.filter((d) => !floor || (d.floor ?? 'Other sheets') === floor);
  const label = floor ?? 'All floors';
  const dbs = p.items.filter((x) => x.kind === 'db' && sheets.some((d) => d.id === x.drawing_id));
  const cables = cableRows(p), fills = fillRows(p);
  const over = fills.filter((f) => f.state === 'OVER THE LIMIT').length, near = fills.filter((f) => f.state === 'Near the limit').length;
  const go = (fn: () => Promise<void>) => dialog.run(fn);

  const block = (title: string, text: string, actions: React.ReactNode) => (
    <Card style={{ gap: 6 }}>
      <Text style={{ fontWeight: '800', color: colors.ink, fontSize: 15 }}>{title}</Text>
      <Muted>{text}</Muted>
      <Row wrap gap={8}>
        {actions}
      </Row>
    </Card>
  );

  return (
    <Screen maxWidth={900}>
      <Stack.Screen options={{ title: 'Drawing reports' }} />
      <TestingBanner what="Smart drawings" show />
      <Card style={{ gap: 6 }}>
        <Muted>{`${p.project.code ?? ''} ${p.project.name} · ${p.drawings.length} drawing(s) · ${p.items.length} items`}</Muted>
        <Muted>Choose the floor for the drawing reports; the cable schedule and the fill list always cover the whole project with its risers.</Muted>
        <Row wrap gap={6}>
          <Chip label="All floors" on={!floor} onPress={() => setFloor(null)} />
          {floors.map((f) => (
            <Chip key={f} label={f} on={floor === f} onPress={() => setFloor(f)} />
          ))}
        </Row>
      </Card>
      <Section title="Reports">
        <View style={{ gap: 10 }}>
          {block(
            'Progress drawing',
            `${sheets.length} sheet(s) coloured by stage, with the summary per service, failed items and open issues. A3 landscape.`,
            <Button title="PDF" disabled={!sheets.length} onPress={() => go(() => progressPdf(p, sheets.map((d) => d.id), who, label))} />,
          )}
          {block(
            'DB chart and test certificate',
            dbs.length ? `${dbs.length} board(s): the DB chart, the components with their checks, and the circuit test certificate with the instrument and signatures.` : 'No distribution boards on these sheets.',
            <>
              <Button title={`All ${dbs.length || ''} boards`.trim()} disabled={!dbs.length} onPress={() => go(() => dbPdf(p, dbs.map((x) => x.id), who, people))} />
              {dbs.slice(0, 12).map((db) => (
                <Button key={db.id} small variant="secondary" title={db.label ?? 'DB'} onPress={() => go(() => dbPdf(p, [db.id], who, people))} />
              ))}
            </>,
          )}
          {block(
            'Cable schedule',
            `${cables.length} cable run(s) on the drawings and in the risers – length from the drawing scale (or the floor height), cables, metres laid, stage, the containment it runs in, BOQ line and who installs it.`,
            <>
              <Button title="PDF" disabled={!cables.length} onPress={() => go(() => cablePdf(p, who))} />
              <Button variant="secondary" title="Excel" disabled={!cables.length} onPress={() => go(() => cableExcel(p, who))} />
            </>,
          )}
          {block(
            'Containment fill list',
            `${fills.length} containment run(s) · ${over} over the limit · ${near} near it. The fullest first, with the cables in each.`,
            <Button title="PDF" disabled={!fills.length} onPress={() => go(() => fillPdf(p, who))} />,
          )}
          {block(
            'As-built pack',
            'The drawings as installed (coloured by service), the installed-items register, DB charts and certificates, lighting-control and BMS points and tests, poles and masts, risers and the issues closed – with sign-off lines. A3 landscape.',
            <Button title="PDF" disabled={!sheets.length} onPress={() => go(() => asBuiltPdf(p, sheets.map((d) => d.id), who, label, people))} />,
          )}
        </View>
      </Section>
    </Screen>
  );
}
