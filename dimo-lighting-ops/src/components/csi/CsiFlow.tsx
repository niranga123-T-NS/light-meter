import { useEffect, useState } from 'react';
import { Animated, PanResponder, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { cardsFor, CSI_AREAS, CSI_EFFORT, CSI_REPURCHASE, CSI_STAGES, CSI_TOPICS, CSI_VS, moodFace, moodWord, STAGE_FACES, type CsiAnswers, type CsiArea, type CsiContext } from '@/lib/csi';

const C = { bg: '#0b1020', card: '#151b30', line: '#27304d', text: '#f8fafc', mut: '#94a3b8', glow: '#fbbf24', good: '#22c55e', bad: '#ef4444' };
const STEPS = ['Welcome', 'Overall', 'Journey', 'Statements', 'Working with us', 'What matters', 'Compared', 'Recommend', 'What next', 'Thank you'];
const LAST = 8; // the step that sends the answers

/** "Light up DIMO" – the customer satisfaction survey: eight light-themed steps, under 2 minutes, only taps (tablet, link or with the sales person on a call) */
export function CsiFlow({ ctx, onSubmit, byLine }: { ctx: CsiContext; onSubmit: (a: CsiAnswers) => Promise<void>; byLine?: string }) {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [a, setA] = useState<CsiAnswers & { touched: boolean }>({ overall: 50, stage_scores: {}, cards: {}, points: { price: 20, quality: 20, speed: 20, support: 20, after_sales: 20 }, vs_others: null, effort: null, repurchase: null, contact_topics: [], nps: -1, reference_ok: false, quote_ok: false, wish: '', touched: false });
  const cards = cardsFor(ctx.stages);
  const set = (p: Partial<typeof a>) => setA((s) => ({ ...s, ...p }));
  const total = Object.values(a.points).reduce((t, x) => t + x, 0);
  const missing = (s: number): string | null => {
    if (s === 1 && !a.touched) return 'Slide the dimmer to show how you feel';
    if (s === 2 && ctx.stages.some((x) => !a.stage_scores[x])) return 'Tap a face for every step';
    if (s === 3 && cards.some((c) => a.cards[c.key] === undefined)) return 'Answer every card';
    if (s === 4 && (a.effort === null || a.repurchase === null)) return 'Answer both questions';
    if (s === 5 && total !== 100) return `Share exactly 100 points (${total} now)`;
    if (s === 7 && a.nps < 0) return 'Choose a number from 0 to 10';
    return null;
  };
  const next = async () => {
    const m = missing(step);
    if (m) return setErr(m);
    setErr(null);
    if (step === LAST) {
      setBusy(true);
      try {
        const { touched: _t, ...answers } = a;
        await onSubmit(answers);
        setStep(LAST + 1);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
      return;
    }
    setStep(step + 1);
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, minHeight: 640 }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16, maxWidth: 720, width: '100%', alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ color: C.glow, fontWeight: '800', fontSize: 15, letterSpacing: 1 }}>LIGHT UP DIMO</Text>
          {step > 0 && step <= LAST ? <Text style={{ color: C.mut, fontSize: 12 }}>{`${step} / ${LAST} · ${STEPS[step]}`}</Text> : null}
        </View>
        {step > 0 && step <= LAST ? (
          <View style={{ flexDirection: 'row', gap: 4 }}>
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
              <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i <= step ? C.glow : C.line }} />
            ))}
          </View>
        ) : null}

        {step === 0 ? <Welcome ctx={ctx} byLine={byLine} /> : null}
        {step === 1 ? <Dimmer value={a.overall} onChange={(v) => set({ overall: v, touched: true })} customer={ctx.customer} /> : null}
        {step === 2 ? <Journey stages={ctx.stages} scores={a.stage_scores} onChange={(k, v) => set({ stage_scores: { ...a.stage_scores, [k]: v } })} /> : null}
        {step === 3 ? <Cards cards={cards} answers={a.cards} onAnswer={(k, v) => set({ cards: { ...a.cards, [k]: v } })} /> : null}
        {step === 4 ? <Working a={a} set={set} /> : null}
        {step === 5 ? <Points points={a.points} total={total} onChange={(p) => set({ points: p })} /> : null}
        {step === 6 ? <Compare value={a.vs_others} onChange={(v) => set({ vs_others: v })} /> : null}
        {step === 7 ? <Recommend a={a} set={set} /> : null}
        {step === 8 ? <Next a={a} set={set} /> : null}
        {step === 9 ? <Thanks ctx={ctx} /> : null}

        {err ? <Text style={{ color: '#fca5a5', textAlign: 'center' }}>{err}</Text> : null}
        {step <= LAST ? (
          <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'center', marginTop: 4 }}>
            {step > 0 ? <Btn title="◀ Back" ghost onPress={() => { setErr(null); setStep(step - 1); }} /> : null}
            <Btn title={step === 0 ? 'Start ▶' : step === LAST ? (busy ? 'Sending…' : 'Send ✓') : step === 6 && a.vs_others === null ? 'Skip ▶' : 'Next ▶'} onPress={busy ? () => {} : next} />
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function Btn({ title, onPress, ghost }: { title: string; onPress: () => void; ghost?: boolean }) {
  return (
    <Pressable onPress={onPress} style={{ paddingVertical: 12, paddingHorizontal: 22, borderRadius: 999, backgroundColor: ghost ? 'transparent' : C.glow, borderWidth: 1, borderColor: ghost ? C.line : C.glow }}>
      <Text style={{ color: ghost ? C.text : '#111827', fontWeight: '800', fontSize: 15 }}>{title}</Text>
    </Pressable>
  );
}

const H = ({ children }: { children: string }) => <Text style={{ color: C.text, fontSize: 22, fontWeight: '800', textAlign: 'center' }}>{children}</Text>;
const Sub = ({ children }: { children: string }) => <Text style={{ color: C.mut, fontSize: 14, textAlign: 'center' }}>{children}</Text>;

/** A lamp that glows with the value (0–100) */
function Lamp({ value, size = 150 }: { value: number; size?: number }) {
  const f = value / 100;
  return (
    <View style={{ alignItems: 'center', height: size + 40, justifyContent: 'center' }}>
      <View style={{ position: 'absolute', width: size * 1.9, height: size * 1.9, borderRadius: size, backgroundColor: C.glow, opacity: 0.05 + 0.2 * f }} />
      <View style={{ position: 'absolute', width: size * 1.35, height: size * 1.35, borderRadius: size, backgroundColor: C.glow, opacity: 0.08 + 0.3 * f }} />
      <View style={{ width: size, height: size, borderRadius: size, backgroundColor: `rgba(253, 230, 138, ${0.15 + 0.85 * f})`, borderWidth: 3, borderColor: '#fde68a', alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: size * 0.42 }}>{moodFace(value)}</Text>
      </View>
    </View>
  );
}

function Welcome({ ctx, byLine }: { ctx: CsiContext; byLine?: string }) {
  return (
    <View style={{ gap: 14, alignItems: 'center' }}>
      <Lamp value={70} size={120} />
      <H>{`Hello ${ctx.contact}`}</H>
      <Sub>{`Help ${ctx.sales} and the DIMO lighting team see how brightly we shine for ${ctx.customer}${ctx.project ? ` on ${ctx.project}` : ''}.`}</Sub>
      <Text style={{ color: C.text, textAlign: 'center', fontSize: 15 }}>8 quick steps · under 2 minutes · just tap</Text>
      {byLine ? <Text style={{ color: C.glow, textAlign: 'center', fontSize: 13 }}>{byLine}</Text> : null}
    </View>
  );
}

function Dimmer({ value, onChange, customer }: { value: number; onChange: (v: number) => void; customer: string }) {
  const [w, setW] = useState(1);
  const at = (x: number) => onChange(Math.max(0, Math.min(100, Math.round((x / w) * 20) * 5)));
  return (
    <View style={{ gap: 12 }}>
      <H>How satisfied are you with DIMO overall?</H>
      <Sub>{`Slide the dimmer – the brighter, the happier ${customer} is with us.`}</Sub>
      <Lamp value={value} />
      <Text style={{ color: C.text, fontSize: 18, fontWeight: '800', textAlign: 'center' }}>{`${moodWord(value)} · ${value}%`}</Text>
      <View
        testID="csi-dimmer"
        onLayout={(e) => setW(e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(e) => at(e.nativeEvent.locationX)}
        onResponderMove={(e) => at(e.nativeEvent.locationX)}
        style={{ height: 54, borderRadius: 27, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, justifyContent: 'center', overflow: 'hidden' }}
      >
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${value}%`, backgroundColor: C.glow, opacity: 0.25 + 0.6 * (value / 100) }} />
        <View pointerEvents="none" style={{ position: 'absolute', left: `${value}%`, marginLeft: -22, width: 44, height: 44, borderRadius: 22, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 20 }}>💡</Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ color: C.mut }}>Dark – unhappy</Text>
        <Text style={{ color: C.mut }}>Full light – delighted</Text>
      </View>
    </View>
  );
}

function Journey({ stages, scores, onChange }: { stages: string[]; scores: Record<string, number>; onChange: (k: string, v: number) => void }) {
  return (
    <View style={{ gap: 12 }}>
      <H>Your journey with us</H>
      <Sub>Tap a face for each step you went through – each step lights up.</Sub>
      {CSI_STAGES.filter((s) => stages.includes(s.value)).map((s, i, arr) => {
        const v = scores[s.value] ?? 0;
        return (
          <View key={s.value} style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ alignItems: 'center', width: 26 }}>
              <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: v ? C.glow : C.line, opacity: v ? 0.4 + 0.15 * v : 1 }} />
              {i < arr.length - 1 ? <View style={{ flex: 1, width: 3, backgroundColor: v ? C.glow : C.line, opacity: 0.6 }} /> : null}
            </View>
            <View style={{ flex: 1, paddingBottom: 14, gap: 6 }}>
              <Text style={{ color: C.text, fontWeight: '700', fontSize: 15 }}>{`${s.icon}  ${s.label}`}</Text>
              <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                {STAGE_FACES.map((f, k) => (
                  <Pressable key={k} onPress={() => onChange(s.value, k + 1)} style={{ width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: v === k + 1 ? C.glow : C.card, borderWidth: 1, borderColor: v === k + 1 ? C.glow : C.line }}>
                    <Text style={{ fontSize: 24 }}>{f}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function Cards({ cards, answers, onAnswer }: { cards: ReturnType<typeof cardsFor>; answers: Record<string, number>; onAnswer: (k: string, v: -1 | 0 | 1) => void }) {
  const idx = cards.findIndex((c) => answers[c.key] === undefined);
  const card = idx >= 0 ? cards[idx] : null;
  const [pos] = useState(() => new Animated.ValueXY());
  // a swipe or a button throws the card; the effect flies it off and records the answer
  const [thrown, setThrown] = useState<-1 | 0 | 1 | null>(null);
  useEffect(() => {
    if (thrown === null || !card) return;
    Animated.timing(pos, { toValue: { x: thrown * 500, y: thrown === 0 ? -400 : 0 }, duration: 180, useNativeDriver: false }).start(({ finished }) => {
      if (!finished) return;
      pos.setValue({ x: 0, y: 0 });
      onAnswer(card.key, thrown);
      setThrown(null);
    });
  }, [thrown, card, onAnswer, pos]);
  const fly = (v: -1 | 0 | 1) => setThrown((t) => (t === null ? v : t));
  const [pan] = useState(() =>
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 8 || Math.abs(g.dy) > 8,
      onPanResponderMove: Animated.event([null, { dx: pos.x, dy: pos.y }], { useNativeDriver: false }),
      onPanResponderRelease: (_e, g) => {
        if (g.dx > 110) setThrown(1);
        else if (g.dx < -110) setThrown(-1);
        else if (g.dy < -110) setThrown(0);
        else Animated.spring(pos, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start();
      },
    }),
  );
  const rotate = pos.x.interpolate({ inputRange: [-300, 0, 300], outputRange: ['-12deg', '0deg', '12deg'] });
  const done = cards.filter((c) => answers[c.key] !== undefined);
  return (
    <View style={{ gap: 12 }}>
      <H>Do you agree?</H>
      <Sub>Swipe right to agree, left to disagree, up if you are not sure – or use the buttons. Tap an answer below to change it.</Sub>
      <View style={{ height: 210, justifyContent: 'center' }}>
        {card ? (
          <Animated.View {...pan.panHandlers} style={{ transform: [{ translateX: pos.x }, { translateY: pos.y }, { rotate }], backgroundColor: '#fff', borderRadius: 18, padding: 24, minHeight: 170, justifyContent: 'center', borderWidth: 3, borderColor: C.glow }}>
            <Text style={{ color: '#6b7280', fontSize: 12, marginBottom: 8 }}>{`Card ${idx + 1} of ${cards.length}`}</Text>
            <Text style={{ color: '#111827', fontSize: 21, fontWeight: '800' }}>{card.text}</Text>
          </Animated.View>
        ) : (
          <View style={{ alignItems: 'center', gap: 6 }}>
            <Text style={{ fontSize: 40 }}>✨</Text>
            <Text style={{ color: C.text, fontSize: 17, fontWeight: '700' }}>All cards answered – press Next</Text>
          </View>
        )}
      </View>
      {card ? (
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 10 }}>
          <Pick label="👎 Disagree" color={C.bad} onPress={() => fly(-1)} />
          <Pick label="🤷 Not sure" color={C.mut} onPress={() => fly(0)} />
          <Pick label="👍 Agree" color={C.good} onPress={() => fly(1)} />
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
        {done.map((c) => (
          <Pressable key={c.key} onPress={() => onAnswer(c.key, answers[c.key] === 1 ? -1 : answers[c.key] === -1 ? 0 : 1)} style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, backgroundColor: C.card }}>
            <Text style={{ color: answers[c.key] === 1 ? C.good : answers[c.key] === -1 ? '#fca5a5' : C.mut, fontSize: 12 }}>{`${answers[c.key] === 1 ? '👍' : answers[c.key] === -1 ? '👎' : '🤷'} ${c.text.slice(0, 22)}…`}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function Pick({ label, color, onPress }: { label: string; color: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ paddingVertical: 10, paddingHorizontal: 14, borderRadius: 999, borderWidth: 2, borderColor: color }}>
      <Text style={{ color: C.text, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}

function Points({ points, total, onChange }: { points: Record<CsiArea, number>; total: number; onChange: (p: Record<CsiArea, number>) => void }) {
  const left = 100 - total;
  const step = (k: CsiArea, d: number) => {
    const v = Math.max(0, Math.min(100, points[k] + d));
    if (d > 0 && left <= 0) return;
    onChange({ ...points, [k]: v });
  };
  return (
    <View style={{ gap: 12 }}>
      <H>What matters most to you?</H>
      <Sub>Share 100 points – more points for what is most important when you choose a lighting partner.</Sub>
      <Text style={{ color: left === 0 ? C.good : C.glow, textAlign: 'center', fontSize: 18, fontWeight: '800' }}>{left === 0 ? '✓ All 100 points shared' : left > 0 ? `${left} points left` : `${-left} points too many`}</Text>
      {CSI_AREAS.map((ar) => (
        <View key={ar.value} style={{ backgroundColor: C.card, borderRadius: 14, padding: 12, gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={{ fontSize: 22 }}>{ar.icon}</Text>
            <Text style={{ color: C.text, flex: 1, fontWeight: '700', fontSize: 15 }}>{ar.label}</Text>
            <Pressable onPress={() => step(ar.value, -5)} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.line, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: C.text, fontSize: 22 }}>−</Text></Pressable>
            <Text style={{ color: C.glow, width: 44, textAlign: 'center', fontSize: 20, fontWeight: '800' }}>{points[ar.value]}</Text>
            <Pressable onPress={() => step(ar.value, 5)} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: left > 0 ? C.glow : C.line, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#111827', fontSize: 22 }}>+</Text></Pressable>
          </View>
          <View style={{ height: 6, borderRadius: 3, backgroundColor: C.line }}>
            <View style={{ height: 6, borderRadius: 3, width: `${points[ar.value]}%`, backgroundColor: C.glow }} />
          </View>
        </View>
      ))}
    </View>
  );
}

function Compare({ value, onChange }: { value: number | null; onChange: (v: number) => void }) {
  return (
    <View style={{ gap: 14 }}>
      <H>Compared with other lighting suppliers…</H>
      <Sub>…that you have worked with, DIMO is:</Sub>
      <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
        {CSI_VS.map((o, i) => (
          <Pressable key={o.value} onPress={() => onChange(o.value)} style={{ width: 120, paddingVertical: 14, borderRadius: 16, alignItems: 'center', gap: 6, backgroundColor: value === o.value ? C.glow : C.card, borderWidth: 1, borderColor: value === o.value ? C.glow : C.line }}>
            <Text style={{ fontSize: 26, opacity: 0.35 + 0.16 * i }}>💡</Text>
            <Text style={{ color: value === o.value ? '#111827' : C.text, fontWeight: '700' }}>{o.label}</Text>
          </Pressable>
        ))}
      </View>
      <Sub>Optional – skip if you have not worked with others.</Sub>
    </View>
  );
}

function Recommend({ a, set }: { a: CsiAnswers; set: (p: Partial<CsiAnswers>) => void }) {
  const col = (n: number) => (n <= 6 ? '#ef4444' : n <= 8 ? '#f59e0b' : '#22c55e');
  return (
    <View style={{ gap: 14 }}>
      <H>Would you recommend DIMO to a colleague?</H>
      <Sub>0 = not at all · 10 = definitely</Sub>
      <View style={{ flexDirection: 'row', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
          <Pressable key={n} onPress={() => set({ nps: n })} style={{ width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: a.nps === n ? col(n) : C.card, borderWidth: 2, borderColor: col(n) }}>
            <Text style={{ color: C.text, fontWeight: '800', fontSize: 17 }}>{n}</Text>
          </Pressable>
        ))}
      </View>
      {a.nps >= 9 ? (
        <View style={{ gap: 8, backgroundColor: C.card, borderRadius: 14, padding: 14 }}>
          <Text style={{ color: C.glow, fontWeight: '800', fontSize: 16, textAlign: 'center' }}>Thank you! 🌟 May we share your success?</Text>
          <Toggle on={a.reference_ok} label="You may show our project as a DIMO reference" onPress={() => set({ reference_ok: !a.reference_ok })} />
          <Toggle on={a.quote_ok} label="You may quote my answers with my name" onPress={() => set({ quote_ok: !a.quote_ok })} />
        </View>
      ) : null}
    </View>
  );
}

function Toggle({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 }}>
      <View style={{ width: 26, height: 26, borderRadius: 6, borderWidth: 2, borderColor: C.glow, backgroundColor: on ? C.glow : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
        {on ? <Text style={{ color: '#111827', fontWeight: '900' }}>✓</Text> : null}
      </View>
      <Text style={{ color: C.text, flex: 1, fontSize: 15 }}>{label}</Text>
    </Pressable>
  );
}

function Working({ a, set }: { a: CsiAnswers; set: (p: Partial<CsiAnswers>) => void }) {
  return (
    <View style={{ gap: 14 }}>
      <H>How easy is DIMO to work with?</H>
      <View style={{ flexDirection: 'row', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
        {CSI_EFFORT.map((o) => (
          <Pressable key={o.value} onPress={() => set({ effort: o.value })} style={{ width: 92, paddingVertical: 10, borderRadius: 16, alignItems: 'center', gap: 4, backgroundColor: a.effort === o.value ? C.glow : C.card, borderWidth: 1, borderColor: a.effort === o.value ? C.glow : C.line }}>
            <Text style={{ fontSize: 28 }}>{o.face}</Text>
            <Text style={{ color: a.effort === o.value ? '#111827' : C.text, fontWeight: '700', fontSize: 13 }}>{o.label}</Text>
          </Pressable>
        ))}
      </View>
      <H>Will you choose DIMO for your next lighting project?</H>
      <View style={{ flexDirection: 'row', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
        {CSI_REPURCHASE.map((o, i) => (
          <Pressable key={o.value} onPress={() => set({ repurchase: o.value })} style={{ width: 120, paddingVertical: 12, borderRadius: 16, alignItems: 'center', gap: 4, backgroundColor: a.repurchase === o.value ? C.glow : C.card, borderWidth: 1, borderColor: a.repurchase === o.value ? C.glow : C.line }}>
            <Text style={{ fontSize: 22, opacity: 0.3 + 0.17 * i }}>💡</Text>
            <Text style={{ color: a.repurchase === o.value ? '#111827' : C.text, fontWeight: '700' }}>{o.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function Next({ a, set }: { a: CsiAnswers; set: (p: Partial<CsiAnswers>) => void }) {
  const on = (t: string) => a.contact_topics.includes(t);
  return (
    <View style={{ gap: 12 }}>
      <H>Can we help you with anything next?</H>
      <Sub>Tap any that interest you – we will contact you. Optional.</Sub>
      <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
        {CSI_TOPICS.map((t) => (
          <Pressable key={t.value} onPress={() => set({ contact_topics: on(t.value) ? a.contact_topics.filter((x) => x !== t.value) : [...a.contact_topics, t.value] })} style={{ paddingVertical: 10, paddingHorizontal: 14, borderRadius: 999, backgroundColor: on(t.value) ? C.glow : C.card, borderWidth: 1, borderColor: on(t.value) ? C.glow : C.line }}>
            <Text style={{ color: on(t.value) ? '#111827' : C.text, fontWeight: '700' }}>{`${t.icon} ${t.label}`}</Text>
          </Pressable>
        ))}
      </View>
      <H>If you could change one thing at DIMO…</H>
      <Sub>What would it be? Type it – or tap the microphone on your keyboard and just say it. Optional.</Sub>
      <TextInput
        value={a.wish}
        onChangeText={(w) => set({ wish: w })}
        multiline
        maxLength={1000}
        placeholder="My one wish…"
        placeholderTextColor={C.mut}
        style={{ minHeight: 100, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.card, color: C.text, padding: 14, fontSize: 16, textAlignVertical: 'top' }}
      />
    </View>
  );
}

function Thanks({ ctx }: { ctx: CsiContext }) {
  const ini = ctx.sales.split(' ').map((x) => x[0]).join('').slice(0, 2).toUpperCase();
  return (
    <View style={{ gap: 14, alignItems: 'center' }}>
      <Lamp value={100} size={130} />
      <H>{`Thank you, ${ctx.contact}!`}</H>
      <Sub>Your answers have been sent. They help us light up every project better.</Sub>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderRadius: 16, padding: 14 }}>
        <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: '#c8102e', alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 17 }}>{ini}</Text>
        </View>
        <View>
          <Text style={{ color: C.text, fontWeight: '800' }}>{ctx.sales}</Text>
          <Text style={{ color: C.mut }}>{`DIMO Lighting${ctx.sales_phone ? ` · ${ctx.sales_phone}` : ''}`}</Text>
          <Text style={{ color: C.mut, fontSize: 12 }}>Your DIMO contact</Text>
        </View>
      </View>
    </View>
  );
}
