import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Button, Chip, colors, Muted, Row, styles } from '@/components/ui';
import { supabase } from '@/lib/supabase';

export type CatalogItem = { id: number; code: string; category: string; subcategory: string; name: string; unit: string; areas: string[]; suits: boolean };

/** Search the materials catalogue (10,000+ items): every word must match; items for the project's areas come first. */
export function CatalogPicker({ visible, areas, onClose, onPick }: { visible: boolean; areas: string[]; onClose: () => void; onPick: (c: CatalogItem) => void }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string | null>(null);
  const [cats, setCats] = useState<{ category: string; items: number; suits: boolean }[]>([]);
  const [rows, setRows] = useState<CatalogItem[]>([]);
  const [doneKey, setDoneKey] = useState('');
  const key = `${q}|${cat ?? ''}`;
  const busy = doneKey !== key;
  useEffect(() => {
    if (!visible || cats.length) return;
    supabase.rpc('material_categories', { p_areas: areas }).then(({ data }) => setCats((data ?? []) as typeof cats));
  }, [visible, areas, cats.length]);
  useEffect(() => {
    if (!visible) return;
    let stop = false;
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc('search_material_catalog', { p_q: q, p_areas: areas, p_category: cat, p_limit: 80 });
      if (!stop) {
        setRows((data ?? []) as CatalogItem[]);
        setDoneKey(`${q}|${cat ?? ''}`);
      }
    }, 250);
    return () => {
      stop = true;
      clearTimeout(t);
    };
  }, [visible, q, cat, areas]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { maxWidth: 820 }]} onPress={() => undefined}>
          <Row style={{ justifyContent: 'space-between', marginBottom: 8 }}>
            <Text style={styles.h2}>Materials catalogue</Text>
            <Button title="Close" variant="ghost" small onPress={onClose} />
          </Row>
          <TextInput
            autoFocus
            value={q}
            onChangeText={setQ}
            placeholder="Search – e.g. street light 60W type II, XLPE 4 core 16, MCB 32A C, gland M25"
            placeholderTextColor={colors.faint}
            style={[styles.input, { marginBottom: 8 }]}
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingBottom: 6 }}>
            <Chip label="All categories" on={!cat} onPress={() => setCat(null)} />
            {cats.map((c) => (
              <Chip key={c.category} label={`${c.suits ? '★ ' : ''}${c.category} (${c.items})`} on={cat === c.category} onPress={() => setCat(cat === c.category ? null : c.category)} />
            ))}
          </ScrollView>
          <ScrollView style={{ maxHeight: 440 }} keyboardShouldPersistTaps="handled">
            {rows.map((r, idx) => {
              const header = idx === 0 || rows[idx - 1].category !== r.category || rows[idx - 1].subcategory !== r.subcategory ? `${r.category} · ${r.subcategory}` : null;
              return (
                <View key={r.id}>
                  {header ? <Text style={styles.groupHeader}>{header}</Text> : null}
                  <Pressable onPress={() => onPick(r)} style={styles.option}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.text }}>{r.name}</Text>
                      <Text style={{ color: colors.muted, fontSize: 11 }}>{`${r.code} · per ${r.unit}${r.suits ? ' · ★ suits this project' : ''}`}</Text>
                    </View>
                  </Pressable>
                </View>
              );
            })}
            {!rows.length && !busy ? <Muted>No matches – try fewer words, or tick “Not in the catalogue” on the item and describe it.</Muted> : null}
            {rows.length === 80 ? <Muted>Showing the first 80 – add words to narrow the search.</Muted> : null}
          </ScrollView>
          <Muted>★ = suits this project’s areas (shown first). 13,000 items: luminaires, poles, cables, switchgear, containment, earthing, controls, AGL and more.</Muted>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
