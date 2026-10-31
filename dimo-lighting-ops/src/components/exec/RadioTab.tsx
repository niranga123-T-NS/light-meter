import { requestRecordingPermissionsAsync, setAudioModeAsync, useAudioPlayer, useAudioRecorder } from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Text, Vibration, View } from 'react-native';
import { Button, Card, colors, Empty, ErrorBanner, Field, ListRow, Loading, Muted, Pill, Row, Section, Toggle } from '@/components/ui';
import { useMe } from '@/lib/auth';
import type { ExecProject } from '@/lib/execution';
import { fmtDateTime } from '@/lib/format';
import { usePeople } from '@/lib/hooks';
import { clipUrl, fmtSecs, loadRadio, RADIO_MAX_MS, RADIO_MIN_MS, RADIO_RECORDING, sendText, sendVoice, type RadioMessage } from '@/lib/radio';
import { supabase } from '@/lib/supabase';

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Site radio: a walkie-talkie channel for the project's crew. Hold the button to talk; the clip is sent when you let go
 * and plays on everyone else's phone that has the channel open. Emergency calls also ring the crew's phones (push).
 */
export function RadioTab({ p }: { p: ExecProject }) {
  const me = useMe();
  const people = usePeople();
  const [msgs, setMsgs] = useState<RadioMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [autoPlay, setAutoPlay] = useState(true);
  const [urgent, setUrgent] = useState(false);
  const [text, setText] = useState('');
  const [talking, setTalking] = useState(false);
  const [talkMs, setTalkMs] = useState(0);
  const [sending, setSending] = useState(0);
  const [playingId, setPlayingId] = useState<string | null>(null);

  const player = useAudioPlayer(null);
  const recorder = useAudioRecorder(RADIO_RECORDING);

  // playback queue: incoming voice messages play one after another
  const queue = useRef<RadioMessage[]>([]);
  const busy = useRef(false);
  const talkingRef = useRef(false);
  const autoRef = useRef(autoPlay);
  useEffect(() => {
    autoRef.current = autoPlay;
  }, [autoPlay]);

  const playNext = useCallback(async () => {
    // a clip that cannot be opened is skipped; nothing plays while you are talking
    while (!talkingRef.current && queue.current.length) {
      const m = queue.current.shift()!;
      if (!m.storage_path) continue;
      busy.current = true;
      setPlayingId(m.id);
      try {
        player.replace({ uri: await clipUrl(m.storage_path) });
        player.play();
        return;
      } catch {
        // next one
      }
    }
    busy.current = false;
    setPlayingId(null);
  }, [player]);

  const enqueue = useCallback(
    (m: RadioMessage) => {
      queue.current.push(m);
      if (!busy.current) void playNext();
    },
    [playNext],
  );

  useEffect(() => {
    const sub = player.addListener('playbackStatusUpdate', (s) => {
      if (s.didJustFinish) void playNext();
    });
    return () => sub.remove();
  }, [player, playNext]);

  // loud speaker, even with the phone on silent; other apps' audio is lowered while a message plays
  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'duckOthers', allowsRecording: false, shouldRouteThroughEarpiece: false }).catch(() => {});
  }, []);

  const refresh = useCallback(async () => {
    try {
      const rows = await loadRadio(p.id);
      setMsgs(rows);
      setError(null);
    } catch (e) {
      setError(errText(e));
    }
  }, [p.id]);

  // the channel: first the last messages, then new ones live
  useEffect(() => {
    const first = setTimeout(refresh, 0);
    const channel = supabase
      .channel(`radio:${p.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'radio_messages', filter: `exec_project_id=eq.${p.id}` }, (payload) => {
        const m = payload.new as RadioMessage;
        setMsgs((prev) => (prev?.some((x) => x.id === m.id) ? prev : [m, ...(prev ?? [])].slice(0, 200)));
        if (m.sender_id === me.id) return;
        if (m.urgent) Vibration.vibrate([0, 400, 200, 400, 200, 400]);
        if (m.kind === 'voice' && (autoRef.current || m.urgent)) enqueue(m);
      })
      .subscribe();
    return () => {
      clearTimeout(first);
      supabase.removeChannel(channel);
    };
  }, [p.id, me.id, enqueue, refresh]);

  const playOne = (m: RadioMessage) => {
    if (playingId === m.id) {
      player.pause();
      queue.current = [];
      busy.current = false;
      setPlayingId(null);
      return;
    }
    player.pause();
    queue.current = [m];
    busy.current = false;
    void playNext();
  };

  // ---- push to talk ----
  const started = useRef<Promise<boolean> | null>(null);
  const t0 = useRef(0);
  const micOk = useRef(false);

  const talkStart = () => {
    if (talkingRef.current) return;
    talkingRef.current = true;
    setTalking(true);
    setTalkMs(0);
    setHint(null);
    if (busy.current) player.pause(); // you talk over an incoming message; it carries on after
    started.current = (async () => {
      if (!micOk.current) {
        const perm = await requestRecordingPermissionsAsync();
        if (!perm.granted) {
          setHint('Allow the microphone for DIMO Lighting Ops (phone Settings → Apps → Permissions) to talk on the radio.');
          return false;
        }
        micOk.current = true;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      t0.current = Date.now();
      Vibration.vibrate(30);
      return true;
    })().catch((e) => {
      setError(errText(e));
      return false;
    });
  };

  const talkEnd = async () => {
    if (!talkingRef.current) return;
    const ok = await started.current;
    const ms = ok ? Date.now() - t0.current : 0;
    if (ok) await recorder.stop().catch(() => {});
    talkingRef.current = false;
    setTalking(false);
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true, shouldRouteThroughEarpiece: false }).catch(() => {});
    if (busy.current) player.play();
    else if (queue.current.length) void playNext();
    if (!ok) return;
    if (ms < RADIO_MIN_MS) {
      setHint('Keep the button pressed while you talk, then let go to send.');
      return;
    }
    const uri = recorder.uri;
    if (!uri) return;
    const wasUrgent = urgent;
    setSending((n) => n + 1);
    try {
      await sendVoice(p.id, me.id, uri, Math.min(ms, RADIO_MAX_MS), wasUrgent);
      Vibration.vibrate(15);
      if (wasUrgent) setUrgent(false);
      await refresh();
    } catch (e) {
      setError(`Not sent – ${errText(e)}`);
    } finally {
      setSending((n) => n - 1);
    }
  };

  // timer while talking; let go automatically at the 2-minute limit
  const endRef = useRef(talkEnd);
  useEffect(() => {
    endRef.current = talkEnd;
  });
  useEffect(() => {
    if (!talking) return;
    const tick = setInterval(() => {
      if (!t0.current) return;
      const ms = Date.now() - t0.current;
      setTalkMs(ms);
      if (ms >= RADIO_MAX_MS) void endRef.current();
    }, 200);
    return () => clearInterval(tick);
  }, [talking]);

  const sendTyped = async () => {
    const body = text.trim();
    if (!body) return;
    try {
      await sendText(p.id, body, urgent);
      setText('');
      if (urgent) setUrgent(false);
      await refresh();
    } catch (e) {
      setError(`Not sent – ${errText(e)}`);
    }
  };

  const name = (id: string) => (id === me.id ? 'You' : (people[id]?.full_name ?? 'Crew member'));
  const playing = msgs?.find((m) => m.id === playingId);
  const tone = talking ? colors.red : urgent ? colors.amber : colors.brand;

  return (
    <View style={{ gap: 12 }}>
      <ErrorBanner message={error} />
      <Card>
        <View style={{ alignItems: 'center', gap: 10, paddingVertical: 8 }}>
          <Muted>{`Channel: ${p.code ?? ''} ${p.name} – everyone on the project crew hears you`}</Muted>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Hold to talk"
            onPressIn={talkStart}
            onPressOut={() => void talkEnd()}
            style={({ pressed }) => ({
              width: 180,
              height: 180,
              borderRadius: 90,
              backgroundColor: tone,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 8,
              borderColor: talking ? '#FCA5A5' : '#F3F4F6',
              transform: [{ scale: pressed || talking ? 0.96 : 1 }],
            })}
          >
            <Text style={{ color: '#fff', fontSize: 40 }}>{talking ? '●' : '🎙'}</Text>
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '800', marginTop: 4 }}>
              {talking ? `TALKING ${fmtSecs(talkMs)}` : urgent ? 'HOLD – EMERGENCY' : 'HOLD TO TALK'}
            </Text>
          </Pressable>
          {hint ? <Text style={{ color: colors.amber, textAlign: 'center' }}>{hint}</Text> : null}
          {sending ? <Muted>Sending…</Muted> : null}
          {playing ? (
            <Row>
              <Pill label={`▶ ${name(playing.sender_id)}`} tone={colors.green} solid />
              <Button small variant="secondary" title="Stop" onPress={() => playOne(playing)} />
            </Row>
          ) : null}
        </View>
        <Toggle label="Play incoming voice messages automatically" value={autoPlay} onChange={setAutoPlay} />
        <Toggle label="Emergency – ring the whole crew and the Senior Electrical Engineer" value={urgent} onChange={setUrgent} />
        <Field label="Or type a message" value={text} onChangeText={setText} maxLength={500} placeholder="e.g. Crane arriving at gate 2 in 10 minutes" onSubmitEditing={sendTyped} returnKeyType="send" />
        <Row>
          <Button title="Send" small onPress={sendTyped} disabled={!text.trim()} variant={urgent ? 'danger' : 'primary'} />
        </Row>
      </Card>

      <Section title="Channel">
        {!msgs ? (
          <Loading />
        ) : !msgs.length ? (
          <Empty title="No messages yet" hint="Hold the button and say hello to the crew." />
        ) : (
          msgs.map((m) => (
            <ListRow
              key={m.id}
              highlight={m.urgent ? colors.red : undefined}
              title={name(m.sender_id)}
              subtitle={
                <View>
                  {m.body ? <Text style={{ color: colors.text, fontSize: 15 }}>{m.body}</Text> : null}
                  <Muted>{`${fmtDateTime(m.sent_at)}${m.kind === 'voice' ? ` · voice ${fmtSecs(m.duration_ms ?? 0)}` : ''}`}</Muted>
                </View>
              }
              right={
                <Row gap={6}>
                  {m.urgent ? <Pill label="EMERGENCY" tone={colors.red} solid /> : null}
                  {m.kind === 'voice' ? <Button small variant={playingId === m.id ? 'danger' : 'secondary'} title={playingId === m.id ? '■ Stop' : '▶ Play'} onPress={() => playOne(m)} /> : null}
                </Row>
              }
            />
          ))
        )}
      </Section>
    </View>
  );
}
