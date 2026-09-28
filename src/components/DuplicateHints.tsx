// Possible duplicates shown while creating a customer or project, so the
// same organisation / project is not entered twice. Uses the offline cache
// immediately and the server's similarity search when online.
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import { cacheStore, normalizeName } from '@/lib/cache';
import { supabase } from '@/lib/supabase';

import { Badge, Banner, Button, Muted, Row } from './ui';

interface Candidate { id: string; code?: string; name: string; detail?: string | null; visible: boolean; exact: boolean }

export function DuplicateHints({ kind, name, place, onUse }: {
  kind: 'customer' | 'project'; name: string; place?: string | null; onUse?: (id: string, label: string) => void;
}) {
  const [remote, setRemote] = useState<Candidate[]>([]);
  const key = normalizeName(name);

  const local = useMemo<Candidate[]>(() => {
    if (key.length < 3) return [];
    const c = cacheStore.get();
    const rows = kind === 'customer'
      ? c.customers.map((x) => ({ id: x.id, code: x.code, name: x.legal_name, alt: x.trading_name, detail: x.city }))
      : c.projects.map((x) => ({ id: x.id, code: x.code, name: x.name, alt: (x.aliases ?? []).join(' '), detail: x.district }));
    return rows
      .filter((r) => {
        const n = normalizeName(r.name);
        const a = normalizeName(r.alt);
        return n === key || a.includes(key) || n.includes(key) || (n.length > 3 && key.includes(n));
      })
      .slice(0, 5)
      .map((r) => ({ id: r.id, code: r.code, name: r.name, detail: r.detail, visible: true, exact: normalizeName(r.name) === key }));
  }, [kind, key]);

  useEffect(() => {
    if (key.length < 3) return;
    const t = setTimeout(async () => {
      const fn = kind === 'customer' ? 'find_similar_customers' : 'find_similar_projects';
      const args = kind === 'customer' ? { q: name, p_city: place || null } : { q: name, p_district: place || null };
      const { data } = await supabase.rpc(fn, args);
      if (!data) return;
      setRemote((data as { id: string; code: string; legal_name?: string; name?: string; city?: string; district?: string; owner_name?: string; visible: boolean; score: number }[])
        .map((r) => ({ id: r.id, code: r.code, name: r.legal_name ?? r.name ?? '', detail: [r.city ?? r.district, r.owner_name].filter(Boolean).join(' · '),
          visible: r.visible, exact: r.score >= 1 })));
    }, 500);
    return () => clearTimeout(t);
  }, [kind, key, name, place]);

  const shownRemote = key.length < 3 ? [] : remote;
  const all = [...local, ...shownRemote.filter((r) => !local.some((l) => l.id === r.id))];
  if (all.length === 0) return null;
  return (
    <View style={{ gap: 6 }}>
      <Banner tone="warning" message={`Possible existing ${kind}${all.length > 1 ? 's' : ''} – please check before creating a new one.`} />
      {all.map((c) => (
        <Row key={c.id} style={{ justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <Muted numberOfLines={1}>{c.name}</Muted>
            <Muted style={{ fontSize: 11 }}>{[c.code, c.detail].filter(Boolean).join(' · ')}</Muted>
          </View>
          {c.exact ? <Badge label="Same name" tone="danger" /> : null}
          {onUse && c.visible ? <Button small variant="secondary" title="Use this" onPress={() => onUse(c.id, c.name)} /> : null}
          {!c.visible ? <Badge label="Other territory" /> : null}
        </Row>
      ))}
    </View>
  );
}
