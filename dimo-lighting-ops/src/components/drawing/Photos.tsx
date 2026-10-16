import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { Button, colors, Muted, Row } from '@/components/ui';
import type { Drawing } from '@/lib/drawings';
import { pickImage, readBytes, uuid } from '@/lib/files';
import { fmtDateTime } from '@/lib/format';
import { rpc, supabase } from '@/lib/supabase';

export type DPhoto = { id: string; item_id: string | null; route_id: string | null; stage: string | null; path: string; note: string | null; taken_by: string | null; taken_at: string };

/** Photos of one item or route, each kept with the stage it was taken at. The project team adds them on site (needs a connection). */
export function Photos({
  d,
  stageName,
  photos,
  target,
  canAdd,
  canEdit,
  me,
  people,
  onChange,
}: {
  d: Drawing;
  stageName: (s: string) => string;
  photos: DPhoto[];
  target: { item?: string; route?: string };
  canAdd: boolean;
  canEdit: boolean;
  me: string;
  people: Record<string, { full_name: string } | undefined>;
  onChange: () => Promise<void> | void;
}) {
  const dialog = useDialog();
  const [urls, setUrls] = useState<Record<string, string>>({});
  const key = photos.map((p) => p.path).join('|');
  useEffect(() => {
    if (!photos.length) return;
    let live = true;
    supabase.storage
      .from('drawings')
      .createSignedUrls(photos.map((p) => p.path), 3600)
      .then(({ data }) => {
        if (live && data) setUrls(Object.fromEntries(data.filter((x) => x.signedUrl && x.path).map((x) => [x.path as string, x.signedUrl as string])));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const add = async () => {
    let camera = false;
    if (Platform.OS !== 'web') {
      const r = await dialog.prompt({ title: 'Add a photo', fields: [{ key: 'src', label: 'From', type: 'select', required: true, initial: 'camera', options: [{ value: 'camera', label: 'Camera' }, { value: 'library', label: 'Photo library' }] }] });
      if (!r) return;
      camera = r.src === 'camera';
    }
    const f = await pickImage(camera).catch((e) => {
      dialog.toast(e instanceof Error ? e.message : String(e), 'error');
      return null;
    });
    if (!f) return;
    const n = await dialog.prompt({ title: 'Photo note', fields: [{ key: 'note', label: 'Note (optional)', initial: '' }] });
    if (!n) return;
    await dialog.run(async () => {
      const path = `${d.exec_project_id}/photos/${uuid()}.jpg`;
      const up = await supabase.storage.from('drawings').upload(path, await readBytes(f), { contentType: f.mimeType ?? 'image/jpeg', upsert: false });
      if (up.error) throw new Error(up.error.message);
      await rpc('drawing_photo_add', { p_item: target.item ?? null, p_route: target.route ?? null, p_path: path, p_note: n.note || null });
      await onChange();
    }, 'Photo added');
  };

  return (
    <View style={{ gap: 6 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Text style={{ fontWeight: '700', color: colors.ink }}>{`Photos (${photos.length})`}</Text>
        {canAdd ? <Button small variant="secondary" title="+ Photo" onPress={add} /> : null}
      </Row>
      {photos.length ? (
        <ScrollView horizontal contentContainerStyle={{ gap: 8 }}>
          {photos.map((p) => (
            <View key={p.id} style={{ width: 132, gap: 2 }}>
              <Pressable
                accessibilityLabel="Open the photo"
                onPress={() => {
                  const u = urls[p.path];
                  if (u) void Linking.openURL(u);
                }}
                onLongPress={async () => {
                  if (!(canEdit || p.taken_by === me)) return;
                  if (!(await dialog.confirm('Remove this photo?', undefined, { danger: true, confirmLabel: 'Remove' }))) return;
                  await dialog.run(async () => {
                    const path = await rpc<string>('drawing_photo_delete', { p_id: p.id });
                    await supabase.storage.from('drawings').remove([path]);
                    await onChange();
                  }, 'Removed');
                }}
              >
                {urls[p.path] ? (
                  <Image source={{ uri: urls[p.path] }} style={{ width: 132, height: 99, borderRadius: 6, backgroundColor: colors.line }} contentFit="cover" />
                ) : (
                  <View style={{ width: 132, height: 99, borderRadius: 6, backgroundColor: colors.line }} />
                )}
              </Pressable>
              <Muted numberOfLines={2}>{`${p.stage ? stageName(p.stage) : ''} · ${fmtDateTime(p.taken_at)}${people[p.taken_by ?? '']?.full_name ? ` · ${people[p.taken_by ?? '']?.full_name}` : ''}`}</Muted>
              {p.note ? <Muted numberOfLines={2}>{p.note}</Muted> : null}
            </View>
          ))}
        </ScrollView>
      ) : (
        <Muted>{canAdd ? 'No photos yet – add one at each stage as proof of the work.' : 'No photos yet.'}</Muted>
      )}
      {photos.length && (canEdit || photos.some((p) => p.taken_by === me)) ? <Muted>Tap to open; press and hold to remove.</Muted> : null}
    </View>
  );
}
