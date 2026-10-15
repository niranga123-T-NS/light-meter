import * as Linking from 'expo-linking';
import { useState } from 'react';
import { View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { AcademyTeam } from '@/components/tools/AcademyTeam';
import { Button, Card, H2, Muted, Segmented } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { ACADEMY_TEAM_VIEWERS, academyCfg, academyLink } from '@/lib/academy';

export const ACADEMY_LESSONS = 65;

/** Lighting Academy on the phone: the lessons open in the phone's browser, signed in so progress is saved */
export function Academy() {
  const me = useMe();
  const dialog = useDialog();
  const [view, setView] = useState<'lessons' | 'team'>('lessons');
  const team = ACADEMY_TEAM_VIEWERS.includes(me.role);
  const open = () => dialog.run(async () => { await Linking.openURL(academyLink(await academyCfg(me.full_name))); });
  return (
    <View style={{ gap: 8 }}>
      {team ? <Segmented value={view} onChange={setView} options={[{ value: 'lessons', label: 'Lessons' }, { value: 'team', label: 'Team progress' }]} /> : null}
      {view === 'team' && team ? (
        <AcademyTeam total={ACADEMY_LESSONS} />
      ) : (
        <Card style={{ gap: 8 }}>
          <H2>Lighting Academy</H2>
          <Muted>{`${ACADEMY_LESSONS} short lessons in six modules – basics & selling, lighting techniques, fixture construction, LED chips, lighting controls, LMS & KNX – with live graphics and a quick check. They open in your phone’s browser; your progress is saved.`}</Muted>
          <Button title="Open the Lighting Academy ↗" onPress={open} />
          <Muted>If it says “signed out” after an hour, open it again from here.</Muted>
        </Card>
      )}
    </View>
  );
}
