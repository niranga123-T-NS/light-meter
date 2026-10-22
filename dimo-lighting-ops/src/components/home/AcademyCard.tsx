import { router } from 'expo-router';
import { View } from 'react-native';
import { Body, Card, Muted, Pill, Progress, Row } from '@/components/ui';
import { STATUS_COLOURS, STATUS_LABELS, type AcademyMe } from '@/lib/academy';
import { useLoad } from '@/lib/hooks';
import { rpc } from '@/lib/supabase';

/** Home: the person's Dacademy plan at a glance (only for people with a required path) – opens My Dacademy */
export function AcademyCard() {
  const { data } = useLoad(() => rpc<AcademyMe>('academy_me').catch(() => null), []);
  if (!data?.member || !data.state.items) return null;
  const st = data.state;
  return (
    <Card onPress={() => router.push('/tools?tab=learn')} style={{ gap: 6 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Body style={{ fontWeight: '700' }}>{`🎓 My Dacademy · L${data.level.level} ${data.level.name}`}</Body>
        <Pill solid label={STATUS_LABELS[st.status]} tone={STATUS_COLOURS[st.status]} />
      </Row>
      <Progress pct={(100 * st.done) / st.items} colour={STATUS_COLOURS[st.status]} />
      <View>
        <Muted>{`${st.done} of ${st.items} done · this week ${st.this_week} of ${st.pace} · ${data.points} points · ${data.badges.length} badges${data.streak ? ` · 🔥 ${data.streak} wk` : ''}`}</Muted>
      </View>
    </Card>
  );
}
