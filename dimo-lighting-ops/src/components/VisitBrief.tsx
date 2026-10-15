import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, Field, Muted, Row } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { fmtDate } from '@/lib/format';
import { supabase } from '@/lib/supabase';

export type Brief = { previous: string; promised: string; done: string };
export const EMPTY_BRIEF: Brief = { previous: '', promised: '', done: '' };
export const briefPayload = (b: Brief) => ({ brief_previous: b.previous.trim() || null, brief_promised: b.promised.trim() || null, brief_done: b.done.trim() || null });

type Past = { id: string; code: string | null; checkin_at: string; summary: string | null; outcome: string | null; next_action: string | null; next_action_date: string | null; next_action_done_at: string | null; sales_person_id: string };

const today = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);

/** Before the visit: the earlier visits to this project (or customer) and the promises made, and a short three-part brief –
 *  what was discussed previously, what was promised, what has been done since. */
export function VisitBrief({ organizationId, projectId, value, onChange, excludeVisitId }: { organizationId: string | null; projectId: string | null; value: Brief; onChange: (b: Brief) => void; excludeVisitId?: string }) {
  const me = useMe();
  const dialog = useDialog();
  const [past, setPast] = useState<Past[] | null>(null);
  const [n, setN] = useState(0);
  const [all, setAll] = useState(false);
  useEffect(() => {
    if (!organizationId && !projectId) return;
    let live = true;
    let q = supabase.from('visits').select('id, code, checkin_at, summary, outcome, next_action, next_action_date, next_action_done_at, sales_person_id').eq('status', 'closed').order('checkin_at', { ascending: false }).limit(8);
    q = projectId ? q.eq('project_id', projectId) : q.eq('organization_id', organizationId!);
    q.then(({ data }) => { if (live) setPast(((data ?? []) as Past[]).filter((v) => v.id !== excludeVisitId)); });
    return () => { live = false; };
  }, [organizationId, projectId, excludeVisitId, n]);

  const promises = (past ?? []).filter((v) => v.next_action);
  const open = promises.filter((v) => !v.next_action_done_at);
  const done = promises.filter((v) => v.next_action_done_at);
  const fill = () => {
    const ps = past ?? [];
    onChange({
      previous: value.previous.trim() || ps.slice(0, 2).filter((v) => v.summary).map((v) => `${fmtDate(v.checkin_at)}: ${v.summary}${v.outcome ? ` (${v.outcome})` : ''}`).join('\n'),
      promised: value.promised.trim() || promises.map((v) => `• ${v.next_action}${v.next_action_date ? ` – by ${fmtDate(v.next_action_date)}` : ''}${v.next_action_done_at ? ' ✓' : ''}`).join('\n'),
      done: value.done.trim() || done.map((v) => `• ${v.next_action} – done ${fmtDate(v.next_action_done_at)}`).join('\n'),
    });
  };
  const markDone = (v: Past) =>
    dialog.run(async () => {
      const { error } = await supabase.from('visits').update({ next_action_done_at: new Date().toISOString() }).eq('id', v.id);
      if (error) throw new Error(error.message);
      setN((x) => x + 1);
    }, 'Marked done');

  const shown = all ? past ?? [] : (past ?? []).slice(0, 3);
  return (
    <View style={{ gap: 10 }}>
      <Card style={{ gap: 6 }}>
        <Text style={{ fontWeight: '700' }}>{projectId ? 'Earlier visits to this project' : 'Earlier visits to this customer'}</Text>
        {past === null ? <Muted>Loading…</Muted> : !past.length ? <Muted>No earlier visit reports here – write what you know from calls, e-mails or meetings.</Muted> : null}
        {shown.map((v) => (
          <View key={v.id} style={{ borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 6 }}>
            <Muted>{`${fmtDate(v.checkin_at)}${v.code ? ` · ${v.code}` : ''}${v.outcome ? ` · ${v.outcome}` : ''}`}</Muted>
            {v.summary ? <Text numberOfLines={all ? undefined : 3}>{v.summary}</Text> : null}
          </View>
        ))}
        {(past?.length ?? 0) > 3 ? <Button small variant="ghost" title={all ? 'Show fewer' : `Show all ${past!.length}`} onPress={() => setAll(!all)} /> : null}
      </Card>

      {promises.length ? (
        <Card style={{ gap: 6 }}>
          <Text style={{ fontWeight: '700' }}>{`Promises · ${open.length} open · ${done.length} done`}</Text>
          {promises.map((v) => {
            const late = !v.next_action_done_at && v.next_action_date && v.next_action_date < today();
            return (
              <Row key={v.id} gap={8} style={{ alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 6 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ color: v.next_action_done_at ? colors.green : late ? colors.red : colors.text }}>{`${v.next_action_done_at ? '✓' : late ? '!' : '○'} ${v.next_action}`}</Text>
                  <Muted>{v.next_action_done_at ? `done ${fmtDate(v.next_action_done_at)}` : `${late ? 'overdue – ' : ''}due ${fmtDate(v.next_action_date)}`}{` · promised ${fmtDate(v.checkin_at)}`}</Muted>
                </View>
                {!v.next_action_done_at && v.sales_person_id === me.id ? <Button small variant="secondary" title="Mark done" onPress={() => markDone(v)} /> : null}
              </Row>
            );
          })}
        </Card>
      ) : null}

      <Card style={{ gap: 4 }}>
        <Row gap={8} style={{ alignItems: 'center', justifyContent: 'space-between' }} wrap>
          <Text style={{ fontWeight: '700' }}>Your brief for this visit</Text>
          {past?.length ? <Button small variant="ghost" title="Fill from earlier visits" onPress={fill} /> : null}
        </Row>
        <Field label="Discussed previously" multiline value={value.previous} onChangeText={(t) => onChange({ ...value, previous: t })} maxLength={1500} />
        <Field label="Promised to do" multiline value={value.promised} onChangeText={(t) => onChange({ ...value, promised: t })} maxLength={1500} />
        <Field label="Done since then" multiline value={value.done} onChangeText={(t) => onChange({ ...value, done: t })} maxLength={1500} hint="Keep it short – it is your reminder in front of the customer." />
      </Card>
    </View>
  );
}

/** The brief as written before the visit (read only) */
export function BriefView({ b }: { b: { brief_previous?: string | null; brief_promised?: string | null; brief_done?: string | null } }) {
  if (!b.brief_previous && !b.brief_promised && !b.brief_done) return null;
  const part = (t: string, s?: string | null) => (s ? <View style={{ gap: 2 }}><Muted>{t}</Muted><Text>{s}</Text></View> : null);
  return (
    <Card style={{ gap: 8 }}>
      {part('Discussed previously', b.brief_previous)}
      {part('Promised to do', b.brief_promised)}
      {part('Done since then', b.brief_done)}
    </Card>
  );
}
