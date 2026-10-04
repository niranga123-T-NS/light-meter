import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, ErrorBanner, Loading, Muted, Notice, Row, Screen, Section } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { fmtDate } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { ROLE_LABELS } from '@/lib/roles';
import { rpc, supabase } from '@/lib/supabase';

type Person = { id: string; full_name: string; role: keyof typeof ROLE_LABELS };

// Order of the groups on the list; GM / DGM and System Admin are never invited
const GROUPS: (keyof typeof ROLE_LABELS)[] = [
  'asm_building',
  'asm_infra',
  'operations_exec',
  'sm_estimation',
  'am_estimation',
  'estimation_exec',
  'design_manager',
  'lighting_designer',
  'lighting_engineer',
  'senior_elec_engineer',
  'assistant_engineer',
];

/** SM Projects selects who is invited to a Monday sales meeting (by Sunday 10:00). */
export default function InviteToMeeting() {
  const { date } = useLocalSearchParams<{ date: string }>();
  const me = useMe();
  const dialog = useDialog();
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const { data, error } = useLoad(async () => {
    const [p, m] = await Promise.all([
      supabase.from('profiles').select('id, full_name, role').eq('active', true).not('role', 'in', '(gm,sys_admin)').order('full_name'),
      supabase.from('sales_meetings').select('id').eq('meeting_date', date).maybeSingle(),
    ]);
    const invited = m.data
      ? (((await supabase.from('sales_meeting_invitees').select('person_id').eq('meeting_id', m.data.id)).data ?? []) as { person_id: string }[]).map(
          (x) => x.person_id,
        )
      : [];
    return { people: ((p.data ?? []) as Person[]).filter((x) => x.id !== me.id), invited };
  }, [date]);
  if (me.role !== 'sm_projects')
    return (
      <Screen>
        <Notice>Only SM Projects invites the team.</Notice>
      </Screen>
    );
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  // Until changed: the saved list, or (first time) all sales persons
  const sel =
    picked ?? new Set(data.invited.length ? data.invited : data.people.filter((x) => x.role === 'asm_building' || x.role === 'asm_infra').map((x) => x.id));
  const toggle = (id: string) => {
    const n = new Set(sel);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setPicked(n);
  };
  const groups = [...GROUPS, ...[...new Set(data.people.map((p) => p.role))].filter((r) => !GROUPS.includes(r))];

  return (
    <Screen maxWidth={800}>
      <Stack.Screen options={{ title: 'Invite to the sales meeting' }} />
      <Card>
        <Text style={{ fontSize: 17, fontWeight: '700', color: colors.ink }}>Monday {fmtDate(date)} · 08:30 – 12:00</Text>
        <Muted>Select who is invited – anyone except GM / DGM and System Admin. Invite by Sunday 10:00; GM / DGM are told if it is not done by 15:00.</Muted>
        <Row wrap gap={8} style={{ marginTop: 8 }}>
          <Button
            title={`Send invitations (${sel.size})`}
            disabled={!sel.size}
            onPress={() =>
              dialog.run(async () => {
                const id = await rpc<string>('invite_sales_meeting', { p_date: date, p_people: [...sel] });
                router.replace(`/meeting/${id}`);
              }, 'Invitations sent')
            }
          />
          <Button variant="ghost" title="Cancel" onPress={() => router.back()} />
        </Row>
      </Card>
      {groups.map((r) => {
        const list = data.people.filter((p) => p.role === r);
        if (!list.length) return null;
        return (
          <Section key={r} title={ROLE_LABELS[r] ?? r}>
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              {list.map((p) => {
                const on = sel.has(p.id);
                return (
                  <Pressable
                    key={p.id}
                    onPress={() => toggle(p.id)}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderBottomWidth: 1, borderBottomColor: colors.line }}
                  >
                    <View
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 5,
                        borderWidth: 2,
                        borderColor: on ? colors.brand : colors.faint,
                        backgroundColor: on ? colors.brand : 'transparent',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {on ? <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>✓</Text> : null}
                    </View>
                    <Text style={{ color: colors.ink, fontSize: 15 }}>{p.full_name}</Text>
                  </Pressable>
                );
              })}
            </Card>
          </Section>
        );
      })}
    </Screen>
  );
}
