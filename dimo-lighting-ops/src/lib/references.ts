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
  /** Uploaded files (ref/<id>/<file>) or Google Drive files (gdrive:<file id>) – the first is the cover */
  photos: string[];
  /** The full photo album – a Google Drive folder */
  album_url: string | null;
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
export const MAX_PHOTOS = 12;

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

// ---------------------------------------------------------------------------
// Google Drive: photos shared "Anyone with the link" are shown straight from Drive (no Drive login or API key needed)
export const isDrive = (p: string) => p.startsWith('gdrive:');
/** The image of a shared Drive file, scaled by Drive to the width asked */
export const driveImage = (fileId: string, width = 1920) => `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w${width}`;
/** The Drive page of a photo (to open the original) */
export const driveView = (p: string) => `https://drive.google.com/file/d/${encodeURIComponent(p.slice(7))}/view`;

const ID = '[A-Za-z0-9_-]{20,80}';
/** The file id in a Drive / Google Photos-style share link: …/file/d/<id>/…, …open?id=<id>, …uc?id=<id>, …/d/<id> or a bare id */
export function driveFileId(link: string): string | null {
  const t = link.trim();
  const m = t.match(new RegExp(`/file/d/(${ID})`)) ?? t.match(new RegExp(`[?&]id=(${ID})`)) ?? t.match(new RegExp(`googleusercontent\\.com/d/(${ID})`)) ?? t.match(new RegExp(`^(${ID})$`));
  return m && !/\/folders\//.test(t) ? m[1] : null;
}
/** A Drive folder link (the album), tidied to https://drive.google.com/drive/folders/<id> */
export function driveFolderUrl(link: string): string | null {
  const m = link.trim().match(new RegExp(`drive\\.google\\.com/.*folders/(${ID})`));
  return m ? `https://drive.google.com/drive/folders/${m[1]}` : null;
}
/** Sorts pasted text (one link per line, or separated by spaces) into Drive photos, an album folder and lines not understood */
export function parseDriveLinks(text: string) {
  const photos: string[] = [];
  const bad: string[] = [];
  let album: string | null = null;
  for (const line of text.split(/[\s,]+/).filter(Boolean)) {
    const folder = driveFolderUrl(line);
    if (folder) { album = folder; continue; }
    const id = driveFileId(line);
    if (id) { if (!photos.includes(`gdrive:${id}`)) photos.push(`gdrive:${id}`); } else bad.push(line);
  }
  return { photos, album, bad };
}

const urlCache = new Map<string, { url: string; exp: number }>();

/** Short-lived links to the photos in the private "references" bucket (cached for most of an hour) */
export async function photoUrls(paths: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const p of paths) if (isDrive(p)) out[p] = driveImage(p.slice(7));
  const need = paths.filter((p) => {
    if (isDrive(p)) return false;
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
  const files = paths.filter((p) => !isDrive(p));
  if (files.length) await supabase.storage.from('references').remove(files);
}
