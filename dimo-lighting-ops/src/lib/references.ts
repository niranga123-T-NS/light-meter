import { Platform } from 'react-native';
import { readBytes, uuid, type PickedFile } from './files';
import { supabase } from './supabase';
import type { Currency, Role } from './types';

/** Project references (Sales Tools → References): completed projects to show clients */
export type ProjectReference = {
  id: string;
  title: string;
  client: string | null;
  architect: string | null;
  interior_designer: string | null;
  mep_consultant: string | null;
  elec_consultant: string | null;
  description: string | null;
  year: number | null;
  value: number | null;
  currency: Currency;
  location: string | null;
  country: string;
  category: string | null;
  applications: string[];
  outdoor_types: string[];
  brands: string[];
  photos: string[];
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export const APPLICATIONS = [
  { value: 'indoor', label: 'Indoor Lighting' },
  { value: 'outdoor', label: 'Outdoor Lighting' },
  { value: 'controls', label: 'Lighting Controls' },
  { value: 'lv', label: 'LV Installations' },
  { value: 'special', label: 'Special Projects' },
];
export const applicationLabel = (v: string) => APPLICATIONS.find((a) => a.value === v)?.label ?? v;
/** Kinds of outdoor lighting – chosen under Outdoor Lighting */
export const OUTDOOR_TYPES = [
  { value: 'airports', label: 'Airports' },
  { value: 'ports', label: 'Ports' },
  { value: 'roads', label: 'Roads' },
  { value: 'sports', label: 'Sports' },
  { value: 'yards', label: 'Yards' },
  { value: 'other', label: 'Other' },
];
/** "Outdoor Lighting – Roads, Sports" when the outdoor kinds are known */
export const applicationText = (a: string, r: { outdoor_types: string[] }) =>
  a === 'outdoor' && r.outdoor_types.length ? `${applicationLabel(a)} – ${r.outdoor_types.map((t) => OUTDOOR_TYPES.find((o) => o.value === t)?.label ?? t).join(', ')}` : applicationLabel(a);
export const MAX_PHOTOS = 4;

/** The people behind the project – each shown only when known (ticked) */
export type PartyKey = 'client' | 'architect' | 'interior_designer' | 'mep_consultant' | 'elec_consultant';
export const PARTIES: { key: PartyKey; label: string }[] = [
  { key: 'client', label: 'Client' },
  { key: 'architect', label: 'Architect' },
  { key: 'interior_designer', label: 'Interior designer' },
  { key: 'mep_consultant', label: 'MEP Consultant' },
  { key: 'elec_consultant', label: 'Electrical Consultant' },
];

/** Only the Lighting Designer adds, edits and removes references; everyone else with Sales Tools sees them */
export const REFERENCE_KEEPERS: Role[] = ['lighting_designer'];
export const keepsReferences = (role: Role) => REFERENCE_KEEPERS.includes(role);

const urlCache = new Map<string, { url: string; exp: number }>();

/** Short-lived links to the photos in the private "references" bucket (cached for most of an hour) */
export async function photoUrls(paths: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const need = paths.filter((p) => {
    const hit = urlCache.get(p);
    if (hit && hit.exp > Date.now()) out[p] = hit.url;
    return !out[p];
  });
  if (need.length) {
    const { data } = await supabase.storage.from('references').createSignedUrls(need, 3600);
    for (const d of data ?? []) {
      if (!d.path || !d.signedUrl) continue;
      out[d.path] = d.signedUrl;
      urlCache.set(d.path, { url: d.signedUrl, exp: Date.now() + 3_000_000 });
    }
  }
  return out;
}

/** On the web, large photos are scaled to at most 1920 px and saved as JPEG – quicker to show, less storage */
async function shrink(file: PickedFile): Promise<{ bytes: ArrayBuffer; type: string }> {
  const raw = await readBytes(file);
  const type = file.mimeType === 'image/png' || file.mimeType === 'image/webp' ? file.mimeType : 'image/jpeg';
  if (Platform.OS !== 'web' || typeof document === 'undefined') return { bytes: raw, type };
  try {
    const blob = new Blob([raw], { type: file.mimeType ?? 'image/jpeg' });
    const bmp = await createImageBitmap(blob);
    const k = Math.min(1, 1920 / Math.max(bmp.width, bmp.height));
    if (k === 1 && raw.byteLength < 1_500_000) return { bytes: raw, type };
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k);
    c.height = Math.round(bmp.height * k);
    c.getContext('2d')?.drawImage(bmp, 0, 0, c.width, c.height);
    const out = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', 0.85));
    return out ? { bytes: await out.arrayBuffer(), type: 'image/jpeg' } : { bytes: raw, type };
  } catch {
    return { bytes: raw, type };
  }
}

export async function uploadPhoto(refId: string, file: PickedFile): Promise<string> {
  const { bytes, type } = await shrink(file);
  if (bytes.byteLength > 10 * 1024 * 1024) throw new Error('Photos can be up to 10 MB');
  const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
  const path = `ref/${refId}/${uuid()}.${ext}`;
  const up = await supabase.storage.from('references').upload(path, bytes, { contentType: type, upsert: false });
  if (up.error) throw new Error(up.error.message);
  return path;
}

export async function removePhotos(paths: string[]) {
  if (paths.length) await supabase.storage.from('references').remove(paths);
}
