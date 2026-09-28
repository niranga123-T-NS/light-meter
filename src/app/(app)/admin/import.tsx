// Customer import (administrators): paste CSV copied from Excel. Rows that
// match an existing customer (same normalised name + city) are skipped.
import { Stack } from 'expo-router';
import { useMemo, useState } from 'react';

import { TextField } from '@/components/form';
import { Badge, Banner, Button, Card, ListItem, Muted, Screen, SectionTitle } from '@/components/ui';
import { cacheStore, normalizeName, refreshCache } from '@/lib/cache';
import { newId } from '@/lib/ids';
import { useSession } from '@/lib/session';
import { errorMessage, supabase } from '@/lib/supabase';

const COLUMNS = ['legal_name', 'trading_name', 'category', 'industry', 'address', 'district', 'city', 'country', 'phone', 'email', 'website',
  'strategic_priority', 'status', 'source', 'notes', 'owner_email', 'territory_code'];

/** Minimal CSV/TSV parser (quotes, commas or tabs). */
function parse(text: string): string[][] {
  const delim = text.includes('\t') ? '\t' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) { row.push(cell); cell = ''; } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

type Status = 'new' | 'duplicate' | 'invalid' | 'imported' | 'failed';

export default function ImportCustomers() {
  const { profile } = useSession();
  const [text, setText] = useState('');
  const [results, setResults] = useState<Record<number, { status: Status; message?: string }>>({});
  const [busy, setBusy] = useState(false);

  const preview = useMemo(() => {
    const rows = parse(text);
    if (rows.length < 2) return [];
    const header = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
    const c = cacheStore.get();
    const existing = new Set(c.customers.map((x) => `${normalizeName(x.legal_name)}|${(x.city ?? '').toLowerCase()}`));
    const seen = new Set<string>();
    return rows.slice(1).map((r, i) => {
      const rec: Record<string, string> = {};
      header.forEach((h, j) => { if (COLUMNS.includes(h) && r[j]?.trim()) rec[h] = r[j].trim(); });
      const key = `${normalizeName(rec.legal_name)}|${(rec.city ?? '').toLowerCase()}`;
      let status: Status = 'new';
      if (!rec.legal_name) status = 'invalid';
      else if (existing.has(key) || seen.has(key)) status = 'duplicate';
      seen.add(key);
      return { index: i, rec, status };
    });
  }, [text]);

  const run = async () => {
    setBusy(true);
    const c = cacheStore.get();
    const out: typeof results = {};
    for (const row of preview.filter((r) => r.status === 'new')) {
      const { owner_email, territory_code, ...rest } = row.rec;
      const owner = owner_email ? c.profiles.find((p) => p.email?.toLowerCase() === owner_email.toLowerCase()) : undefined;
      const territory = territory_code ? c.territories.find((t) => t.code.toLowerCase() === territory_code.toLowerCase()) : undefined;
      const { error } = await supabase.from('customers').insert({ id: newId(), ...rest, owner_id: owner?.id ?? profile!.id, territory_id: territory?.id ?? null });
      out[row.index] = error
        ? { status: error.code === '23505' ? 'duplicate' : 'failed', message: errorMessage(error) }
        : { status: 'imported' };
      setResults({ ...out });
    }
    await refreshCache(profile!.id).catch(() => undefined);
    setBusy(false);
  };

  const counts = preview.reduce((acc, r) => ({ ...acc, [results[r.index]?.status ?? r.status]: (acc[results[r.index]?.status ?? r.status] ?? 0) + 1 }), {} as Record<string, number>);

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Import customers' }} />
      <Card>
        <Muted>Copy rows from Excel including the header row and paste below. Recognised columns: {COLUMNS.join(', ')}.</Muted>
        <TextField label="CSV / pasted rows" multiline value={text} onChange={(t) => { setText(t); setResults({}); }} autoCapitalize="none" />
        {preview.length ? <Banner tone="info" message={Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(' · ')} /> : null}
        <Button title={`Import ${preview.filter((r) => r.status === 'new' && !results[r.index]).length} new customers`} onPress={run} loading={busy}
          disabled={!preview.some((r) => r.status === 'new' && !results[r.index])} />
      </Card>
      {preview.length ? <SectionTitle>Preview</SectionTitle> : null}
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {preview.slice(0, 300).map((r) => {
          const st = results[r.index]?.status ?? r.status;
          return (
            <ListItem key={r.index} title={r.rec.legal_name ?? '(no legal_name)'} subtitle={[r.rec.city, r.rec.category, results[r.index]?.message].filter(Boolean).join(' · ')}
              right={<Badge label={st} tone={st === 'imported' ? 'success' : st === 'new' ? 'info' : st === 'duplicate' ? 'warning' : 'danger'} />} />
          );
        })}
      </Card>
    </Screen>
  );
}
