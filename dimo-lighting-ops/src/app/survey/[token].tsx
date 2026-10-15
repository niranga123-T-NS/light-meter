import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { CsiFlow } from '@/components/csi/CsiFlow';
import { type CsiAnswers, type CsiContext } from '@/lib/csi';
import { supabase } from '@/lib/supabase';

/** The customer's survey page – opened from the link (no login) or handed over on the sales person's tablet */
export default function SurveyPage() {
  const { token, by } = useLocalSearchParams<{ token: string; by?: string }>();
  const [ctx, setCtx] = useState<CsiContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    supabase.rpc('csi_context', { p_token: token }).then(({ data, error: e }) => {
      if (!live) return;
      if (e) setError(e.message);
      else setCtx(data as CsiContext);
    });
    return () => {
      live = false;
    };
  }, [token]);
  const submit = async (a: CsiAnswers) => {
    const { error: e } = await supabase.rpc('csi_submit', { p_token: token, a, p_by: by === 'sales' ? 'sales' : 'customer' });
    if (e) throw new Error(e.message);
  };
  const note = (title: string, body: string) => (
    <View style={{ flex: 1, minHeight: 500, backgroundColor: '#0b1020', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 10 }}>
      <Text style={{ fontSize: 46 }}>💡</Text>
      <Text style={{ color: '#f8fafc', fontSize: 22, fontWeight: '800', textAlign: 'center' }}>{title}</Text>
      <Text style={{ color: '#94a3b8', fontSize: 15, textAlign: 'center', maxWidth: 460 }}>{body}</Text>
    </View>
  );
  return (
    <View style={{ flex: 1, backgroundColor: '#0b1020' }}>
      <Stack.Screen options={{ title: 'DIMO – customer survey' }} />
      {error
        ? note('Something went wrong', error)
        : !ctx
          ? note('Opening your survey…', '')
          : ctx.status === 'open'
            ? <CsiFlow ctx={ctx} onSubmit={submit} byLine={by === 'sales' ? `Filled with ${ctx.sales} on a call` : undefined} />
            : ctx.status === 'completed'
              ? note('Already answered – thank you!', 'This survey has been completed. Your DIMO contact has your answers.')
              : ctx.status === 'expired'
                ? note('This link has expired', 'Please ask your DIMO contact for a new survey link.')
                : note('Survey not available', 'This link is not valid any more. Please ask your DIMO contact.')}
    </View>
  );
}
