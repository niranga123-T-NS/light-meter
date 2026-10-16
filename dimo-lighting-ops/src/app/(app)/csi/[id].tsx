import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Linking, Platform, Share, Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, ErrorBanner, KeyValue, Loading, Muted, Notice, Pill, Progress, Row, Screen, Section } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { CSI_AREAS, CSI_CARDS, CSI_EFFORT, CSI_REPURCHASE, CSI_STAGES, CSI_VS, csiLink, topicLabel, moodFace, moodWord, STAGE_FACES, type CsiSurvey } from '@/lib/csi';
import { fmtDate } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';

/** One CSI: share the link while it is open; the answers, the alert and the follow-up call once it is completed */
export default function CsiDetail() {
  const { id, share } = useLocalSearchParams<{ id: string; share?: string }>();
  const me = useMe();
  const people = usePeople();
  const dialog = useDialog();
  const { data, error, reload } = useLoad(async () => {
    const { data: row, error: e } = await supabase.from('csi_surveys').select('*, organizations(name), projects(name)').eq('id', id).maybeSingle();
    if (e) throw new Error(e.message);
    if (!row) throw new Error('Survey not found');
    return row as CsiSurvey;
  }, [id]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const s = data, mine = s.sales_person_id === me.id;
  const link = csiLink(s.token);
  const sales = people[s.sales_person_id]?.full_name ?? 'your DIMO contact';
  const message = `Dear ${s.contact_name}, thank you for working with DIMO Lighting. Could you give us 2 minutes and light up how we did? ${link} – ${sales}`;
  const copy = async () => {
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(link);
      dialog.toast('Link copied');
    } else await Share.share({ message });
  };
  const whatsapp = () => Linking.openURL(`https://wa.me/?text=${encodeURIComponent(message)}`);
  const email = () => Linking.openURL(`mailto:?subject=${encodeURIComponent('DIMO Lighting – how did we do?')}&body=${encodeURIComponent(message)}`);
  const cancel = async () => {
    if (!(await dialog.confirm('Cancel this survey?', 'The link stops working.', { confirmLabel: 'Cancel survey', danger: true }))) return;
    if (await dialog.run(() => rpc('csi_cancel', { p_id: s.id }), 'Survey cancelled')) reload();
  };
  const followUp = async () => {
    const r = await dialog.prompt({ title: 'Follow-up call', message: 'What was agreed with the customer?', fields: [{ key: 'note', label: 'Note', type: 'multiline', required: true, maxLength: 1000, initial: s.follow_up_note ?? '' }], confirmLabel: 'Save' });
    if (!r) return;
    if (await dialog.run(() => rpc('csi_follow_up', { p_id: s.id, p_note: r.note }), 'Follow-up recorded')) reload();
  };
  const canFollow = s.status === 'completed' && (mine || me.role === 'sm_projects');

  return (
    <Screen maxWidth={860}>
      <Stack.Screen options={{ title: s.code ?? 'CSI' }} />
      <Card>
        <Row wrap>
          <KeyValue label="Customer" value={s.organizations?.name ?? '—'} />
          <KeyValue label="Project" value={s.projects?.name ?? '— (customer)'} />
          <KeyValue label="Answered by" value={`${s.contact_name}${s.contact_role ? ` · ${s.contact_role}` : ''}`} />
          <KeyValue label="Sales person" value={people[s.sales_person_id]?.full_name ?? '—'} />
          <KeyValue label="Status" value={s.status === 'completed' ? `Completed ${fmtDate(s.completed_at)}${s.filled_by === 'sales' ? ' (on a call)' : ''}` : s.status === 'open' ? `Open · expires ${fmtDate(s.expires_at)}` : 'Cancelled'} />
        </Row>
      </Card>

      {s.status === 'open' ? (
        <Section title={share ? 'Send it to the customer' : 'Waiting for the answers'}>
          <Card style={{ gap: 10 }}>
            <Text selectable style={{ color: colors.blue }}>{link}</Text>
            <Row wrap gap={8}>
              <Button title={Platform.OS === 'web' ? 'Copy link' : 'Share'} onPress={copy} />
              <Button variant="secondary" title="WhatsApp" onPress={whatsapp} />
              <Button variant="secondary" title="E-mail" onPress={email} />
            </Row>
            {mine ? (
              <Row wrap gap={8}>
                <Button variant="ghost" title="📱 Hand my tablet instead" onPress={() => router.push(`/survey/${s.token}`)} />
                <Button variant="ghost" title="☎ Fill on a call" onPress={() => router.push(`/survey/${s.token}?by=sales`)} />
                <Button variant="danger" small title="Cancel survey" onPress={cancel} />
              </Row>
            ) : null}
            <Muted>No login needed. The link works once and expires on {fmtDate(s.expires_at)}.</Muted>
          </Card>
        </Section>
      ) : null}

      {s.status === 'completed' ? (
        <>
          {s.alert ? (
            <Notice tone={s.followed_up_at ? colors.green : colors.red}>
              {s.followed_up_at ? `Low score – followed up ${fmtDate(s.followed_up_at)}` : 'Low score – call the customer within 48 hours and record what was agreed.'}
            </Notice>
          ) : null}
          <Section title="Overall">
            <Card style={{ gap: 8 }}>
              <Row gap={14} style={{ alignItems: 'center' }}>
                <Text style={{ fontSize: 54 }}>{moodFace(s.overall ?? 0)}</Text>
                <View style={{ flex: 1, gap: 6 }}>
                  <Text style={{ fontSize: 22, fontWeight: '800' }}>{`${s.overall} / 100 · ${moodWord(s.overall ?? 0)}`}</Text>
                  <Progress pct={s.overall ?? 0} colour={(s.overall ?? 0) >= 75 ? colors.green : (s.overall ?? 0) >= 60 ? colors.amber : colors.red} />
                  <Muted>{`Would recommend: ${s.nps} / 10 · ${(s.nps ?? 0) >= 9 ? 'promoter' : (s.nps ?? 0) >= 7 ? 'passive' : 'detractor'}`}</Muted>
                </View>
              </Row>
              <Row wrap gap={6}>
                {s.effort != null ? <Pill label={`Easy to work with: ${CSI_EFFORT.find((x) => x.value === s.effort)?.face} ${CSI_EFFORT.find((x) => x.value === s.effort)?.label}`} tone={s.effort >= 4 ? colors.green : s.effort <= 2 ? colors.red : colors.grey} /> : null}
                {s.repurchase != null ? <Pill label={`Choose DIMO next time: ${CSI_REPURCHASE.find((x) => x.value === s.repurchase)?.label}`} tone={s.repurchase > 0 ? colors.green : s.repurchase < 0 ? colors.red : colors.grey} /> : null}
                {s.vs_others != null ? <Pill label={`vs other suppliers: ${CSI_VS.find((x) => x.value === s.vs_others)?.label}`} tone={s.vs_others > 0 ? colors.green : s.vs_others < 0 ? colors.red : colors.grey} /> : null}
                {s.reference_ok ? <Pill label="OK to use as a reference" tone={colors.green} /> : null}
                {s.quote_ok ? <Pill label="OK to quote their words" tone={colors.green} /> : null}
              </Row>
            </Card>
          </Section>

          {s.contact_topics?.length ? (
            <Section title="Wants to hear from us about">
              <Card style={{ gap: 6 }}>
                <Row wrap gap={6}>
                  {s.contact_topics.map((t) => <Pill key={t} label={topicLabel(t)} tone={colors.blue} solid />)}
                </Row>
                <Muted>A sales lead – contact the customer and record it in a visit.</Muted>
              </Card>
            </Section>
          ) : null}

          <Section title="The journey">
            <Card style={{ gap: 6 }}>
              {CSI_STAGES.filter((st) => s.stages.includes(st.value)).map((st) => {
                const v = s.stage_scores?.[st.value];
                return (
                  <Row key={st.value} gap={8} style={{ alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={{ flex: 1 }}>{`${st.icon} ${st.label}`}</Text>
                    <Text style={{ fontSize: 22 }}>{v ? STAGE_FACES[v - 1] : '—'}</Text>
                  </Row>
                );
              })}
            </Card>
          </Section>

          <Section title="What they said">
            <Card style={{ gap: 6 }}>
              {CSI_CARDS.filter((c) => s.cards?.[c.key] != null).map((c) => {
                const v = s.cards![c.key];
                return (
                  <Row key={c.key} gap={8} style={{ alignItems: 'center' }}>
                    <Text style={{ width: 26, fontSize: 18 }}>{v === 1 ? '👍' : v === -1 ? '👎' : '🤷'}</Text>
                    <Text style={{ flex: 1, color: v === -1 ? colors.red : colors.text }}>{c.text}</Text>
                  </Row>
                );
              })}
            </Card>
          </Section>

          <Section title="What matters most to them (100 points)">
            <Card style={{ gap: 8 }}>
              {CSI_AREAS.map((a) => ({ ...a, p: s.points?.[a.value] ?? 0 })).sort((x, y) => y.p - x.p).map((a) => (
                <View key={a.value} style={{ gap: 3 }}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Text>{`${a.icon} ${a.label}`}</Text>
                    <Text style={{ fontWeight: '700' }}>{a.p}</Text>
                  </Row>
                  <Progress pct={a.p} />
                </View>
              ))}
            </Card>
          </Section>

          {s.wish ? (
            <Section title="Their one wish">
              <Card>
                <Text style={{ fontStyle: 'italic' }}>{`“${s.wish}”`}</Text>
              </Card>
            </Section>
          ) : null}

          <Section title="Follow-up">
            <Card style={{ gap: 8 }}>
              {s.follow_up_note ? (
                <>
                  <Text>{s.follow_up_note}</Text>
                  <Muted>{`${fmtDate(s.followed_up_at)}`}</Muted>
                </>
              ) : (
                <Muted>{s.alert ? 'Not followed up yet.' : 'Optional – a thank-you call keeps the relationship warm.'}</Muted>
              )}
              {canFollow ? <Button variant={s.alert && !s.followed_up_at ? 'primary' : 'secondary'} title={s.follow_up_note ? 'Update the follow-up' : 'Record the follow-up call'} onPress={followUp} /> : null}
            </Card>
          </Section>
        </>
      ) : null}
    </Screen>
  );
}
