import { Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, Muted, Pill, Row, Section } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { fmtDateTime } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';

type Note = { id: number; design_job_id: string; note: string; important: boolean; created_by: string; created_at: string };

/** Special notes from the Design team: written on the design job, read by Estimation, Sales and management on the inquiry. */
export function DesignNotes({ inquiryId, jobId, canAdd }: { inquiryId: string; jobId?: string; canAdd?: boolean }) {
  const me = useMe();
  const people = usePeople();
  const dialog = useDialog();
  const { data, reload } = useLoad(async () => {
    const q = supabase.from('design_notes').select('*').eq('inquiry_id', inquiryId).order('created_at', { ascending: false });
    const { data: rows } = await q;
    return (rows ?? []) as Note[];
  }, [inquiryId]);
  const notes = data ?? [];
  // Read-only places show the section only when there is something to read
  if (!canAdd && !notes.length) return null;

  const add = async () => {
    const r = await dialog.prompt({
      title: 'Special note from Design',
      message: 'Assumptions, exclusions, client instructions or anything Estimation and Sales must know. The sales person and the estimator are told.',
      fields: [
        { key: 'n', label: 'Note', type: 'multiline', required: true },
        {
          key: 'imp',
          label: 'Priority',
          type: 'select',
          required: true,
          initial: 'normal',
          options: [
            { value: 'normal', label: 'Normal' },
            { value: 'important', label: 'Important – pops up for them' },
          ],
        },
      ],
      confirmLabel: 'Add note',
    });
    if (!r || !jobId) return;
    await dialog.run(async () => {
      await rpc('add_design_note', { p_job: jobId, p_note: r.n, p_important: r.imp === 'important' });
      await reload();
    }, 'Note added – Estimation and Sales notified');
  };
  const remove = async (n: Note) => {
    if (!(await dialog.confirm('Remove this note?', n.note, { confirmLabel: 'Remove' }))) return;
    await dialog.run(async () => {
      await rpc('remove_design_note', { p_id: n.id });
      await reload();
    }, 'Removed');
  };
  const canRemove = (n: Note) => n.created_by === me.id || me.role === 'design_manager' || me.role === 'gm';

  return (
    <Section title="Special notes from Design" right={canAdd ? <Button small title="+ Note" onPress={add} /> : undefined}>
      <Card style={{ gap: 8 }}>
        {notes.map((n) => (
          <View key={n.id} style={{ borderLeftWidth: 3, borderLeftColor: n.important ? colors.red : colors.line, paddingLeft: 10, gap: 2 }}>
            <Row wrap gap={6} style={{ alignItems: 'center' }}>
              {n.important ? <Pill label="Important" tone={colors.red} /> : null}
              <Muted>{`${people[n.created_by]?.full_name ?? '—'} · ${fmtDateTime(n.created_at)}${jobId && n.design_job_id !== jobId ? ' · earlier revision' : ''}`}</Muted>
              {canAdd && canRemove(n) ? <Button small variant="ghost" title="Remove" onPress={() => remove(n)} /> : null}
            </Row>
            <Text style={{ color: colors.ink }}>{n.note}</Text>
          </View>
        ))}
        {!notes.length ? <Muted>No notes yet – add anything Estimation and Sales must know about this design.</Muted> : null}
      </Card>
    </Section>
  );
}
