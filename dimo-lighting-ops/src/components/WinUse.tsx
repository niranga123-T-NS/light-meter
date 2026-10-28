import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Modal, Pressable, Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, Muted, Row } from '@/components/ui';
import { fmtDate } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { editInquiryWin } from '@/lib/inquiryWin';
import { rpc } from '@/lib/supabase';

export type Followup = {
  id: number;
  project_id: string;
  project: string;
  inquiry_id: string | null;
  inquiry_code: string | null;
  inquiry_name: string | null;
  pct: number | null;
  use_wizard: boolean;
  created_at: string;
  visit_id: string | null;
  escalated: boolean;
};

type Usage = {
  show: boolean;
  uses: number;
  team_avg: number | null;
  open_projects: number;
  scored_projects: number;
  last_used: string | null;
  weeks: number[];
  to_score: { id: string; name: string; pct: number; last_scored: string | null }[];
};

const daysSince = (iso: string | null) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null);

/** A small tablet that blinks until its item is updated (steady outline when the phone asks for reduced motion) */
export function BlinkTablet({ label, tone = colors.red, onPress, small }: { label: string; tone?: string; onPress?: () => void; small?: boolean }) {
  const [a] = useState(() => new Animated.Value(1));
  const [still, setStill] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setStill).catch(() => null);
  }, []);
  useEffect(() => {
    if (still) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(a, { toValue: 0.35, duration: 550, useNativeDriver: true }),
        Animated.timing(a, { toValue: 1, duration: 550, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [a, still]);
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label} – update the win probability`}>
      <Animated.View
        style={{
          opacity: a,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          borderWidth: 1.5,
          borderColor: tone,
          backgroundColor: tone === colors.red ? '#FEF2F2' : '#FFFBEB',
          borderRadius: 99,
          paddingHorizontal: small ? 8 : 10,
          paddingVertical: small ? 3 : 5,
        }}
      >
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: tone }} />
        <Text style={{ color: tone === colors.red ? colors.red : '#92400E', fontWeight: '700', fontSize: small ? 11 : 12 }}>{label}</Text>
      </Animated.View>
    </Pressable>
  );
}

/** Act on one follow-up: the wizard (project) or the inquiry's % – with "No change" to keep it */
export function useFollowupAction(done: () => void) {
  const dialog = useDialog();
  // An explicit choice: closing the dialog leaves the tablet as it is
  return async (f: Followup) => {
    const inq = !!f.inquiry_id;
    const r = await dialog.prompt({
      title: `Win probability – ${inq ? f.inquiry_code : f.project}`,
      message: inq
        ? `${f.project}${f.inquiry_name ? ` · ${f.inquiry_name}` : ''} is at ${f.pct ?? '—'}%. Update it after the visit, or keep it as it is.`
        : `The project is at ${f.pct ?? '—'}%. Score it again with the Win Predictor after the visit, or keep it as it is.`,
      fields: [
        {
          key: 'do',
          label: 'What do you want to do?',
          type: 'select',
          required: true,
          options: [
            { value: 'update', label: inq ? 'Update the win probability' : 'Open the Win Predictor' },
            { value: 'keep', label: `No change – keep ${f.pct ?? '—'}%` },
          ],
        },
      ],
      confirmLabel: 'Continue',
    });
    if (!r) return;
    if (r.do === 'keep') {
      await dialog.run(() => rpc('win_followup_no_change', { p_id: f.id }), 'Kept at the same %');
      return done();
    }
    if (inq) await editInquiryWin(dialog, { id: f.inquiry_id!, code: f.inquiry_code ?? '', inquiry_name: f.inquiry_name, win_probability: f.pct }, () => done());
    else router.push({ pathname: '/projects/wizard', params: { id: f.project_id } });
  };
}

/** Home: the tablets for every project and inquiry visited and not updated yet */
export function VisitTablets() {
  const { data, reload } = useLoad(() => rpc<Followup[]>('my_win_followups'));
  const act = useFollowupAction(reload);
  if (!data?.length) return null;
  const visits = Array.from(new Set(data.map((f) => f.project_id)));
  return (
    <Card style={{ borderColor: '#FCA5A5', gap: 8, marginTop: 12 }}>
      <Text style={{ fontWeight: '700', color: colors.red }}>Visited – update the win probability</Text>
      {visits.map((pid) => {
        const fs = data.filter((f) => f.project_id === pid);
        return (
          <View key={pid} style={{ gap: 6 }}>
            <Muted style={{ fontSize: 12 }}>{`Visit ${fmtDate(fs[0].created_at)} · ${fs[0].project}${fs.some((f) => f.escalated) ? ' · sent to your manager' : ''}`}</Muted>
            <Row wrap gap={6}>
              {fs.map((f) => (
                <BlinkTablet
                  key={f.id}
                  tone={f.inquiry_id ? colors.amber : colors.red}
                  label={f.inquiry_id ? `${f.inquiry_code}${f.inquiry_name ? ` ${f.inquiry_name}` : ''}` : f.project}
                  onPress={() => act(f)}
                />
              ))}
            </Row>
          </View>
        );
      })}
      <Muted style={{ fontSize: 12 }}>Tap a tablet to update it – it stops blinking once updated. Not updated in 3 working days goes to your manager.</Muted>
    </Card>
  );
}

/** Project / inquiry page: the tablets waiting there (the project's own, or one inquiry's) */
export function PageTablets({ projectId, inquiryId }: { projectId: string; inquiryId?: string }) {
  const { data, reload } = useLoad(() => rpc<Followup[]>('my_win_followups'), [projectId, inquiryId]);
  const act = useFollowupAction(reload);
  const fs = (data ?? []).filter((f) => f.project_id === projectId && (inquiryId ? f.inquiry_id === inquiryId : true));
  if (!fs.length) return null;
  return (
    <Row wrap gap={6} style={{ marginBottom: 8 }}>
      {fs.map((f) => (
        <BlinkTablet
          key={f.id}
          tone={f.inquiry_id ? colors.amber : colors.red}
          label={f.inquiry_id ? (inquiryId ? 'Visited – update the win probability' : `${f.inquiry_code} · ${f.pct ?? '—'}%`) : 'Visited – update the win probability'}
          onPress={() => act(f)}
        />
      ))}
    </Row>
  );
}

/** Opening a project or inquiry: once a day, when the wizard has not scored the project in 30 days */
export function useWizardNudge(projectId: string | null | undefined, inquiry?: { id: string; code: string } | null) {
  const dialog = useDialog();
  const asked = useRef<string | null>(null);
  useEffect(() => {
    if (!projectId || asked.current === projectId) return;
    asked.current = projectId;
    (async () => {
      const n = await rpc<{ due: boolean; project: string; pct: number; last_at: string | null; last_pct: number | null; days: number | null }>('wizard_nudge', { p_project: projectId }).catch(() => null);
      if (!n?.due) return;
      await rpc('win_nudge_dismiss', { p_kind: 'project', p_ref: projectId }).catch(() => null);
      const go = await dialog.confirm(
        n.last_at ? `Win Predictor not used here for ${n.days} days` : 'Win Predictor not used on this project yet',
        `${n.project}${inquiry ? ` (${inquiry.code})` : ''} ${n.last_at ? `was last scored on ${fmtDate(n.last_at)} (${n.last_pct}%)` : 'has never been scored with the wizard'}. Its win probability is ${n.pct}%. Score it again so the forecast stays right.`,
        { confirmLabel: 'Open the Win Predictor', cancelLabel: 'Not now' },
      );
      if (go) router.push({ pathname: '/projects/wizard', params: inquiry ? { id: projectId, inquiry: inquiry.id } : { id: projectId } });
    })();
  }, [projectId, inquiry, dialog]);
}

/** Home: "Your Win Predictor use" – once a day for sales people */
export function WinUsagePopup() {
  const { data } = useLoad(() => rpc<Usage>('my_win_usage').catch(() => null));
  const [open, setOpen] = useState(true);
  const [list, setList] = useState(false);
  if (!data?.show || !open) return null;
  const close = () => {
    setOpen(false);
    rpc('win_nudge_dismiss', { p_kind: 'usage' }).catch(() => null);
  };
  const since = daysSince(data.last_used);
  const avg = data.team_avg ?? 0;
  const tone = since == null || since >= 14 ? colors.red : data.uses >= avg ? colors.green : colors.amber;
  const max = Math.max(1, ...data.weeks);
  const WK = ['8w', '7w', '6w', '5w', '4w', '3w', '2w', 'This'];
  return (
    <Modal transparent animationType="slide" visible onRequestClose={close}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(17,24,39,0.35)', justifyContent: 'flex-end' }} onPress={close}>
        <Pressable onPress={() => null} style={{ backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, borderLeftWidth: 5, borderLeftColor: tone, padding: 16, gap: 10, maxWidth: 560, width: '100%', alignSelf: 'center' }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={{ fontWeight: '700', color: colors.ink, fontSize: 16 }}>Your Win Predictor use · last 30 days</Text>
            <Pressable onPress={close} accessibilityLabel="Close"><Text style={{ color: colors.muted, fontSize: 18 }}>✕</Text></Pressable>
          </Row>
          <Row gap={8}>
            {[
              { v: `${data.uses}×`, l: `used (team average ${avg}×)`, c: tone },
              { v: `${data.scored_projects} / ${data.open_projects}`, l: 'open projects scored' },
              { v: since == null ? 'never' : `${since} d`, l: 'since last use', c: since == null || since >= 14 ? colors.red : undefined },
            ].map((s) => (
              <View key={s.l} style={{ flex: 1, backgroundColor: colors.soft, borderWidth: 1, borderColor: colors.line, borderRadius: 8, padding: 8 }}>
                <Text style={{ fontSize: 20, fontWeight: '800', color: s.c ?? colors.ink }}>{s.v}</Text>
                <Muted style={{ fontSize: 11 }}>{s.l}</Muted>
              </View>
            ))}
          </Row>
          <View>
            <Row gap={5} style={{ alignItems: 'flex-end', height: 54 }}>
              {data.weeks.map((n, i) => (
                <View key={i} style={{ flex: 1, height: n ? Math.max(6, (n / max) * 54) : 3, backgroundColor: n ? colors.blue : colors.line, borderTopLeftRadius: 3, borderTopRightRadius: 3 }} />
              ))}
            </Row>
            <Row gap={5}>
              {WK.map((w) => (
                <Text key={w} style={{ flex: 1, textAlign: 'center', fontSize: 9, color: colors.muted }}>{w}</Text>
              ))}
            </Row>
            <Muted style={{ fontSize: 11 }}>Scores saved each week</Muted>
          </View>
          {list ? (
            <View style={{ maxHeight: 240 }}>
              {data.to_score.slice(0, 8).map((p) => (
                <Pressable
                  key={p.id}
                  onPress={() => {
                    close();
                    router.push({ pathname: '/projects/wizard', params: { id: p.id } });
                  }}
                  style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.line }}
                >
                  <Text style={{ color: colors.ink, flex: 1 }} numberOfLines={1}>{p.name}</Text>
                  <Muted>{`${p.pct}% · ${p.last_scored ? `scored ${fmtDate(p.last_scored)}` : 'never scored'}`}</Muted>
                </Pressable>
              ))}
            </View>
          ) : null}
          <Row gap={8} style={{ justifyContent: 'flex-end' }}>
            <Button small variant="secondary" title="Later" onPress={close} />
            {!list && data.to_score.length ? <Button small title="Score a project ›" onPress={() => setList(true)} /> : null}
          </Row>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
