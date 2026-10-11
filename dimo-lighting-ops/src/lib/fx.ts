// Exchange rates (USD, EUR, GBP): Central Bank indicative, Commercial Bank report, Sri Lanka Customs weekly schedule.

export const FX_CCY = ['USD', 'EUR', 'GBP'] as const;
export type Ccy = (typeof FX_CCY)[number];
export type FxSource = 'cbsl' | 'combank' | 'customs';

export type FxRate = {
  source: FxSource;
  rate_date: string;
  valid_to: string | null;
  currency: Ccy;
  mid: number | null;
  cross_usd: number | null;
  tt_buy: number | null;
  tt_sell: number | null;
  lc_sell: number | null;
  sell_1m: number | null;
  sell_2m: number | null;
  sell_3m: number | null;
  buy_7d: number | null;
  buy_1m: number | null;
  buy_2m: number | null;
  buy_3m: number | null;
  doc_id: string | null;
  ref: string | null;
  entered_by: string | null;
  at: string;
  prev?: FxRate | null;
};
export type FxBoard = {
  today: string;
  cbsl: { date: string | null; rows: FxRate[] };
  combank: { date: string | null; rows: FxRate[] };
  customs: { date: string | null; rows: FxRate[]; next: FxRate[] | null };
  history: { s: FxSource; d: string; c: Ccy; mid: number | null; sell: number | null; buy: number | null; f3: number | null }[];
};

export const FX_SEES = ['gm', 'sm_projects', 'sm_estimation', 'am_estimation', 'estimation_exec', 'operations_exec', 'sys_admin'];
export const FX_UPLOAD = ['operations_exec'];

export const SOURCE_LABEL: Record<FxSource, string> = {
  cbsl: 'Central Bank (CBSL) indicative',
  combank: 'Commercial Bank of Ceylon',
  customs: 'Sri Lanka Customs',
};

export const rateOf = (rows: FxRate[] | undefined, c: Ccy) => rows?.find((r) => r.currency === c);
export const fmtRate = (v: number | null | undefined, dp = 2) =>
  v == null ? '—' : Number(v).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
export const fmtCross = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : Number(v).toFixed(4));

/** Cross rates from LKR rates of one source: EUR/USD, GBP/USD, EUR/GBP */
export function crossFromLkr(get: (c: Ccy) => number | null | undefined) {
  const u = get('USD'), e = get('EUR'), g = get('GBP');
  return {
    EURUSD: u && e ? e / u : null,
    GBPUSD: u && g ? g / u : null,
    EURGBP: e && g ? e / g : null,
  };
}

// ---- The Commercial Bank "Indicative Exchange Rates" report (PDF text, one table row per line) ----

export type CombankRow = {
  mid?: number;
  cross_usd?: number;
  tt_sell: number;
  lc_sell?: number;
  sell_1m?: number;
  sell_2m?: number;
  sell_3m: number;
  tt_buy: number;
  buy_7d?: number;
  buy_1m?: number;
  buy_2m?: number;
  buy_3m?: number;
};
export type CombankReport = { date: string | null; rates: Partial<Record<Ccy, CombankRow>>; missing: Ccy[] };

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const num = (s: string) => Number(s.replace(/,/g, ''));

/**
 * Reads the bank's report: "Indicative Exchange Rates as at October 09, 2026", then
 *   Bank Selling Rates:  CCY  Middle/Cross  TT  LC  1 Month  2 Months  3 Months
 *   Bank Buying Rates:   CCY  TT  7 Days  10 Days  14 Days  1 Month  2 Months  3 Months
 */
export function parseCombankReport(text: string): CombankReport {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let date: string | null = null;
  const dm = text.match(/as\s+at\s+([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/i);
  if (dm) {
    const m = MONTHS.indexOf(dm[1].toLowerCase());
    if (m >= 0) date = `${dm[3]}-${String(m + 1).padStart(2, '0')}-${dm[2].padStart(2, '0')}`;
  }
  let part: 'sell' | 'buy' | null = null;
  const sell: Partial<Record<Ccy, number[]>> = {};
  const buy: Partial<Record<Ccy, number[]>> = {};
  for (const l of lines) {
    if (/selling\s+rates/i.test(l)) part = 'sell';
    else if (/buying\s+rates/i.test(l)) part = 'buy';
    const m = l.match(/^(USD|EUR|GBP)\b\s+(.*)$/);
    if (!m || !part) continue;
    const vals = (m[2].match(/\d[\d,]*\.\d+/g) ?? []).map(num);
    (part === 'sell' ? sell : buy)[m[1] as Ccy] = vals;
  }
  const rates: Partial<Record<Ccy, CombankRow>> = {};
  const missing: Ccy[] = [];
  for (const c of FX_CCY) {
    const s = sell[c], b = buy[c];
    if (!s || s.length < 6 || !b || b.length < 7) {
      missing.push(c);
      continue;
    }
    rates[c] = {
      ...(c === 'USD' ? { mid: s[0] } : { cross_usd: s[0] }),
      tt_sell: s[1], lc_sell: s[2], sell_1m: s[3], sell_2m: s[4], sell_3m: s[5],
      tt_buy: b[0], buy_7d: b[1], buy_1m: b[4], buy_2m: b[5], buy_3m: b[6],
    };
  }
  return { date, rates, missing };
}
