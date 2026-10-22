import { createElement, useEffect, useState } from 'react';
import { View } from 'react-native';
import { AcademyMePage } from '@/components/tools/AcademyMe';
import { AcademyTeam } from '@/components/tools/AcademyTeam';
import { AcademyWriteups } from '@/components/tools/AcademyWriteups';
import { Segmented } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { ACADEMY_COURSES, ACADEMY_ENGINEERS, ACADEMY_TEAM_VIEWERS, ACADEMY_TRAINERS, type AcademyCourse, academyCfg } from '@/lib/academy';

/** Dacademy on the website: the chosen course's lessons page in a frame; it saves progress with the person's sign-in, passed to it here */
export function Academy() {
  const me = useMe();
  const [frame, setFrame] = useState<HTMLIFrameElement | null>(null);
  const [view, setView] = useState<'me' | 'lessons' | 'team' | 'writeups'>('me');
  const [course, setCourse] = useState<AcademyCourse>(ACADEMY_ENGINEERS.includes(me.role) ? 'infra' : 'light');
  const c = ACADEMY_COURSES.find((x) => x.value === course) ?? ACADEMY_COURSES[0];
  const team = ACADEMY_TEAM_VIEWERS.includes(me.role), trainer = ACADEMY_TRAINERS.includes(me.role);
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
      <Segmented value={view} onChange={setView} options={[{ value: 'me', label: 'My Dacademy' }, { value: 'lessons', label: 'Lessons' }, ...(team ? [{ value: 'team' as const, label: 'Team progress' }] : []), { value: 'writeups', label: trainer ? 'Write-ups to mark' : 'My write-ups' }]} />
      {view === 'me' ? (
        <AcademyMePage />
      ) : view === 'team' && team ? (
        <AcademyTeam />
      ) : view === 'writeups' ? (
        <AcademyWriteups trainer={trainer} />
      ) : (
        <>
          <Segmented value={course} onChange={setCourse} options={ACADEMY_COURSES.map((x) => ({ value: x.value, label: x.label }))} />
          {createElement('iframe', {
          key: c.value,
          ref: setFrame,
          src: c.path,
          title: `Dacademy – ${c.label}`,
          style: { width: '100%', height: 'calc(100vh - 210px)', minHeight: 560, border: '1px solid #e3e5ea', borderRadius: 12, background: '#f4f5f7' },
        })}
        </>
      )}
    </View>
  );
}
