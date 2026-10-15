import { createElement, useEffect, useState } from 'react';
import { View } from 'react-native';
import { AcademyTeam } from '@/components/tools/AcademyTeam';
import { Segmented } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { ACADEMY_PATH, ACADEMY_TEAM_VIEWERS, academyCfg } from '@/lib/academy';

export const ACADEMY_LESSONS = 96;

/** Lighting Academy on the website: the lessons page in a frame; it saves progress with the person's sign-in, passed to it here */
export function Academy() {
  const me = useMe();
  const [frame, setFrame] = useState<HTMLIFrameElement | null>(null);
  const [view, setView] = useState<'lessons' | 'team'>('lessons');
  const team = ACADEMY_TEAM_VIEWERS.includes(me.role);
  useEffect(() => {
    const send = async () => {
      const cfg = await academyCfg(me.full_name);
      frame?.contentWindow?.postMessage({ type: 'academy:cfg', cfg }, window.location.origin);
    };
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || !frame || e.source !== frame.contentWindow) return;
      if (e.data?.type === 'academy:ready') send();
    };
    window.addEventListener('message', onMsg);
    frame?.addEventListener('load', send);
    // the sign-in is renewed every hour – pass the fresh one on
    const t = setInterval(send, 10 * 60 * 1000);
    return () => {
      window.removeEventListener('message', onMsg);
      frame?.removeEventListener('load', send);
      clearInterval(t);
    };
  }, [me.full_name, frame]);
  return (
    <View style={{ gap: 8 }}>
      {team ? <Segmented value={view} onChange={setView} options={[{ value: 'lessons', label: 'Lessons' }, { value: 'team', label: 'Team progress' }]} /> : null}
      {view === 'team' && team ? (
        <AcademyTeam total={ACADEMY_LESSONS} />
      ) : (
        createElement('iframe', {
          ref: setFrame,
          src: ACADEMY_PATH,
          title: 'Lighting Academy',
          style: { width: '100%', height: 'calc(100vh - 170px)', minHeight: 560, border: '1px solid #e3e5ea', borderRadius: 12, background: '#f4f5f7' },
        })
      )}
    </View>
  );
}
