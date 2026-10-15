import * as Linking from 'expo-linking';
import { useEffect, useState } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { useDialog } from '@/components/dialog';
import { AcademyTeam } from '@/components/tools/AcademyTeam';
import { Button, Loading, Row, Segmented } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { ACADEMY_SITE, ACADEMY_TEAM_VIEWERS, academyCfg, academyLink } from '@/lib/academy';

export const ACADEMY_LESSONS = 74;

/** Lighting Academy in the phone app: the lessons page inside the app (web view), signed in so progress is saved */
export function Academy() {
  const me = useMe();
  const dialog = useDialog();
  const { height } = useWindowDimensions();
  const [view, setView] = useState<'lessons' | 'team'>('lessons');
  const [uri, setUri] = useState<string | null>(null);
  const [n, setN] = useState(0);
  const team = ACADEMY_TEAM_VIEWERS.includes(me.role);
  // a fresh sign-in each time the page is (re)loaded – the sign-in lasts about an hour
  useEffect(() => {
    let live = true;
    academyCfg(me.full_name).then((cfg) => live && setUri(academyLink(cfg)));
    return () => {
      live = false;
    };
  }, [me.full_name, n]);
  const browser = () => dialog.run(async () => { await Linking.openURL(academyLink(await academyCfg(me.full_name))); });
  return (
    <View style={{ gap: 8 }}>
      {team ? <Segmented value={view} onChange={setView} options={[{ value: 'lessons', label: 'Lessons' }, { value: 'team', label: 'Team progress' }]} /> : null}
      {view === 'team' && team ? (
        <AcademyTeam total={ACADEMY_LESSONS} />
      ) : (
        <>
          <Row gap={6} wrap>
            <Button small variant="secondary" title="↻ Reload" onPress={() => setN(n + 1)} />
            <Button small variant="ghost" title="Open in the browser ↗" onPress={browser} />
          </Row>
          <View style={{ height: Math.max(520, height - 230), borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: '#e3e5ea' }}>
            {uri ? (
              <WebView
                key={n}
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
