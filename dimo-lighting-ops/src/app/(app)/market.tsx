import { Stack } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { Change, lkrT, MARKET, MarketChart, n0, pct, type MarketBoard } from '@/components/MarketRates';
import { Card, colors, ErrorBanner, Loading, Muted, Notice, Row, Screen, Section, Segmented } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { fmtDate } from '@/lib/format';
import { FX_SEES } from '@/lib/fx';
import { useLoad } from '@/lib/hooks';
import { rpc } from '@/lib/supabase';

const PERIODS = { '30': 30, '182': 182, '365': 365 } as const;

/** Market rates: copper, aluminium, steel, PVC and sea freight from China – the price, the change over a week and a month, LKR, and the chart */
export default function MarketScreen() {
  const me = useMe();
  const [days, setDays] = useState<keyof typeof PERIODS>('182');
  const { data, error, loading, reload } = useLoad(async () => rpc<MarketBoard>('market_board', { p_days: 400 }), []);
  if (!FX_SEES.includes(me.role)) return <Screen><Notice>Market rates are shown to the DGM, SM Projects, the Estimation team and the Operations Executive.</Notice></Screen>;
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  return (
    <Screen refreshing={loading} onRefresh={reload} maxWidth={1100}>
      <Stack.Screen options={{ title: 'Market rates' }} />
      <Segmented value={days} options={[{ value: '30', label: '1 month' }, { value: '182', label: '6 months' }, { value: '365', label: '1 year' }]} onChange={setDays} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {data.items.map((m) => {
          const meta = MARKET[m.item];
          return (
            <Card key={m.item} style={{ flexGrow: 1, flexBasis: 420, gap: 6 }}>
              <Row style={{ justifyContent: 'space-between', alignItems: 'baseline' }} wrap>
                <Text style={{ fontSize: 16, fontWeight: '800', color: colors.ink }}>{`${meta.name} `}<Text style={{ fontSize: 12, fontWeight: '600', color: colors.muted }}>{meta.src}</Text></Text>
                <Row gap={10}>
                  <Change v={pct(m.usd, m.week)} label="week" />
                  <Change v={pct(m.usd, m.month)} label="month" />
                </Row>
              </Row>
              {m.usd == null ? (
                <Muted>Not fetched yet.</Muted>
              ) : (
                <>
                  <Row style={{ justifyContent: 'space-between', alignItems: 'baseline' }} wrap>
                    <Text style={{ fontSize: 22, fontWeight: '800', color: colors.ink, fontVariant: ['tabular-nums'] }}>
                      {n0(m.usd)} <Text style={{ fontSize: 12, fontWeight: '600', color: colors.muted }}>{meta.unit ?? 'USD / t'}</Text>
                    </Text>
                    <Text style={{ fontSize: 12, color: colors.muted }}>{meta.unit ? 'weekly · Fridays' : `${m.currency === 'CNY' && m.price != null ? `CNY ${n0(m.price)} / t · ` : ''}LKR ${lkrT(m.usd, m.usd_lkr)}`}</Text>
                  </Row>
                  <MarketChart m={m} days={PERIODS[days]} today={data.today} />
                  <Muted>{`${meta.follows} · ${m.date ? fmtDate(m.date) : ''}`}</Muted>
                </>
              )}
            </Card>
          );
        })}
      </View>
      <Section title="Sources">
        <Card style={{ gap: 4 }}>
          {Object.values(MARKET).map((x) => <Muted key={x.name}>{`${x.name}: ${x.long}.`}</Muted>)}
          <Muted>Fetched every day; CNY prices are converted at the day’s USD/CNY reference rate (ECB) and LKR at the Central Bank USD rate. Steel and PVC are Chinese exchange prices – they follow the Platts assessments but are not the Platts figures.</Muted>
        </Card>
      </Section>
    </Screen>
  );
}
