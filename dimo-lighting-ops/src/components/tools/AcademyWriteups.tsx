import { useState } from 'react';
import { View } from 'react-native';
import { type Column, DataTable } from '@/components/DataTable';
import { useDialog } from '@/components/dialog';
import { Body, Button, Card, ErrorBanner, Loading, Muted, Pill, Row, Segmented, colors } from '@/components/ui';
import type { AcademyWriteup } from '@/lib/academy';
import { fmtDate } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { ROLE_LABELS } from '@/lib/roles';
import { rpc } from '@/lib/supabase';
import type { Role } from '@/lib/types';

const KIND_LABELS: Record<AcademyWriteup['kind'], string> = { ticket: 'Ticket write-up', weekly: 'Weekly write-up', test: 'Graded test', script: 'Script hand-in', notes: 'Capstone notes' };
const kindLabel = (w: AcademyWriteup) => (w.lesson.startsWith('bs_') ? 'Lesson write-up' : KIND_LABELS[w.kind]);

/** Which session and part a lesson id points to, e.g. infra_s12_t3 → "Session 12 · ticket t3", infra_t08 → "Session 8 · test", bs_4_3_w → "BS 7671 · 4.3" */
function lessonLabel(w: AcademyWriteup) {
  const bs = w.lesson.match(/^bs_(\d+)_(\d+)_w$/);
  if (bs) return `BS 7671 · ${bs[1]}.${bs[2]}`;
  const m = w.lesson.match(/^infra_(?:s(\d+)(?:_(\w+))?|t(\d+))$/);
  if (!m) return w.lesson;
  const n = Number(m[1] ?? m[3]);
  const part = m[2] && !['week', 'script', 'notes'].includes(m[2]) ? ` · ${m[2]}` : '';
  return `Session ${n}${part}`;
}

/** The write-up's text, field by field (the test result lists each fault) */
function WriteupBody({ w }: { w: AcademyWriteup }) {
  const b = w.body as Record<string, unknown>;
  if (w.kind === 'test') {
    const faults = (b.faults as { title: string; solved: boolean; minutes: number | null; note?: string }[] | undefined) ?? [];
    return (
      <View style={{ gap: 4 }}>
        <Body>{`Score: ${b.score} of ${b.of} faults fixed`}</Body>
        {faults.map((f, i) => (
          <Muted key={i}>{`${f.solved ? '✓' : '✗'} F${i + 1} ${f.title}${f.minutes != null ? ` – ${f.minutes} min` : ''}${f.note ? `\n   ${f.note}` : ''}`}</Muted>
        ))}
      </View>
    );
  }
  return (
    <View style={{ gap: 6 }}>
      {Object.entries(b)
        .filter(([k]) => k !== 'at')
        .map(([k, v]) => (
          <View key={k}>
            <Muted>{k.charAt(0).toUpperCase() + k.slice(1)}</Muted>
            <Body style={k === 'script' ? { fontFamily: 'monospace', fontSize: 12 } : undefined}>{String(v ?? '')}</Body>
          </View>
        ))}
    </View>
  );
}

/** Dacademy write-ups: the trainer (SM Projects, DGM, System Administrator) reads and marks everyone's; an engineer sees their own marks and feedback */
export function AcademyWriteups({ trainer }: { trainer: boolean }) {
  const dialog = useDialog();
  const [show, setShow] = useState<'open' | 'all'>(trainer ? 'open' : 'all');
  const [sel, setSel] = useState<string | null>(null);
  const { data, error, reload } = useLoad(() => rpc<AcademyWriteup[]>('academy_writeups_list', { p_course: null }), []);
  if (!data) return error ? <ErrorBanner message={error} /> : <Loading />;
  const rows = show === 'open' ? data.filter((w) => w.mark == null) : data;
  const cur = data.find((w) => w.id === sel) ?? null;
  const mark = async (w: AcademyWriteup) => {
    const res = await dialog.prompt({
      title: `Mark: ${w.full_name} – ${lessonLabel(w)}`,
      message: 'A percentage from 0 to 100, and what to do better next time.',
      fields: [
        { key: 'mark', label: 'Mark (%)', required: true, initial: w.mark != null ? String(w.mark) : '' },
        { key: 'feedback', label: 'Feedback', type: 'multiline', initial: w.feedback ?? '', maxLength: 2000 },
      ],
      confirmLabel: 'Save mark',
    });
    if (!res) return;
    const n = Number(res.mark);
    if (!Number.isInteger(n) || n < 0 || n > 100) return dialog.alert('Mark', 'Enter a whole number from 0 to 100.');
    if (await dialog.run(() => rpc('academy_writeup_mark', { p_id: w.id, p_mark: n, p_feedback: res.feedback }), 'Mark saved')) reload();
  };
  return (
    <View style={{ gap: 8 }}>
      <Muted>
        {trainer
          ? 'Ticket and weekly write-ups, graded test results, the Session 16 script and the capstone notes from the Infrastructure course, and lesson write-ups from the Wiring Regulations course. Saving again replaces a write-up and clears its mark.'
          : 'Your write-ups from the Infrastructure course, with your trainer’s marks and feedback.'}
      </Muted>
      {trainer ? <Segmented value={show} onChange={setShow} options={[{ value: 'open', label: `To mark (${data.filter((w) => w.mark == null).length})` }, { value: 'all', label: 'All' }]} /> : null}
      <DataTable
        rows={rows}
        keyOf={(r) => r.id}
        onPress={(r) => setSel(r.id === sel ? null : r.id)}
        rowStyle={(r) => (r.id === sel ? { backgroundColor: '#eef4fb' } : undefined)}
        emptyTitle={trainer ? 'Nothing to mark' : 'No write-ups yet'}
        columns={[
          ...(trainer ? [{ h: 'Engineer', w: 180, grow: true, v: (r: AcademyWriteup) => `${r.full_name}\n${ROLE_LABELS[r.role as Role] ?? r.role}` } satisfies Column<AcademyWriteup>] : []),
          { h: 'Session', w: 140, v: (r: AcademyWriteup) => lessonLabel(r) },
          { h: 'Kind', w: 130, v: (r: AcademyWriteup) => kindLabel(r) },
          { h: 'Saved', w: 100, v: (r: AcademyWriteup) => fmtDate(r.updated_at) },
          { h: 'Mark', w: 80, right: true, v: (r: AcademyWriteup) => (r.mark != null ? `${r.mark}%` : '—') },
        ]}
      />
      {cur ? (
        <Card>
          <Row style={{ justifyContent: 'space-between', alignItems: 'center' }} wrap>
            <Body style={{ fontWeight: '600' }}>{`${cur.full_name} · ${lessonLabel(cur)} · ${kindLabel(cur)}`}</Body>
            {cur.mark != null ? <Pill label={`${cur.mark}%`} tone={cur.mark >= 75 ? colors.green : colors.amber} solid /> : <Pill label="Not marked" />}
          </Row>
          <WriteupBody w={cur} />
          {cur.feedback ? <Muted>{`Feedback from ${cur.marked_by_name ?? 'the trainer'}${cur.marked_at ? ` (${fmtDate(cur.marked_at)})` : ''}: ${cur.feedback}`}</Muted> : null}
          {trainer ? (
            <Row gap={6}>
              <Button small title={cur.mark != null ? 'Change mark' : 'Mark'} onPress={() => mark(cur)} />
            </Row>
          ) : null}
        </Card>
      ) : null}
    </View>
  );
}
