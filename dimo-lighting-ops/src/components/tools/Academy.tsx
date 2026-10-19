import * as Linking from 'expo-linking';
import { useEffect, useState } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { useDialog } from '@/components/dialog';
import { AcademyTeam } from '@/components/tools/AcademyTeam';
import { Button, Loading, Row, Segmented } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { ACADEMY_COURSES, ACADEMY_SITE, ACADEMY_TEAM_VIEWERS, ACADEMY_TOTAL, type AcademyCourse, academyCfg, academyLink } from '@/lib/academy';

/** Dacademy in the phone app: the chosen course's lessons page inside the app (web view), signed in so progress is saved */
export function Academy() {
  const me = useMe();
  const dialog = useDialog();
  const { height } = useWindowDimensions();
  const [view, setView] = useState<'lessons' | 'team'>('lessons');
  const [link, setLink] = useState<{ path?: string; uri: string } | null>(null);
  const [n, setN] = useState(0);
  const [course, setCourse] = useState<AcademyCourse>('light');
  const path = ACADEMY_COURSES.find((c) => c.value === course)?.path;
  const team = ACADEMY_TEAM_VIEWERS.includes(me.role);
  // a fresh sign-in each time the page is (re)loaded – the sign-in lasts about an hour
  useEffect(() => {
    let live = true;
    academyCfg(me.full_name).then((cfg) => live && setLink({ path, uri: academyLink(cfg, path) }));
    return () => {
      live = false;
    };
  }, [me.full_name, n, path]);
  const uri = link && link.path === path ? link.uri : null; // the chosen course's page only – never the previous one while the new sign-in loads
  const browser = () => dialog.run(async () => { await Linking.openURL(academyLink(await academyCfg(me.full_name), path)); });
  return (
    <View style={{ gap: 8 }}>
      {team ? <Segmented value={view} onChange={setView} options={[{ value: 'lessons', label: 'Lessons' }, { value: 'team', label: 'Team progress' }]} /> : null}
      {view === 'team' && team ? (
        <AcademyTeam total={ACADEMY_TOTAL} />
      ) : (
        <>
          <Segmented value={course} onChange={setCourse} options={ACADEMY_COURSES.map((c) => ({ value: c.value, label: c.label }))} />
          <Row gap={6} wrap>
            <Button small variant="secondary" title="↻ Reload" onPress={() => setN(n + 1)} />
            <Button small variant="ghost" title="Open in the browser ↗" onPress={browser} />
          </Row>
          <View style={{ height: Math.max(520, height - 230), borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: '#e3e5ea' }}>
            {uri ? (
              <WebView
                key={`${course}-${n}`}
                source={{ uri }}
                originWhitelist={[ACADEMY_SITE]}
                startInLoadingState
                renderLoading={() => <Loading label="Opening the Lighting Academy…" />}
                setSupportMultipleWindows={false}
                nestedScrollEnabled
              />
            ) : (
              <Loading />
            )}
          </View>
        </>
      )}
    </View>
  );
}
