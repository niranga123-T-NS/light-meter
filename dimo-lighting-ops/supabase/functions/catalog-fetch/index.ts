// Catalogs: fetch a file from the manufacturer's link so the team does not download and re-upload it.
//  * catalogue – a PDF catalogue / brochure for a brand, kept in the private "catalog" bucket
//  * datasheet – a luminaire's PDF data sheet
//  * ies       – an IES file's text, returned to the app (which reads it and adds it to the IES library)
// Only the Design team, SM Projects, GM / DGM and the System Administrator; https links only, 50 MB at most.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const KEEPERS = ['design_manager', 'lighting_designer', 'lighting_engineer', 'sm_projects', 'gm', 'sys_admin'];
const MAX = 50 * 1024 * 1024;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

function checkUrl(raw: string) {
  let u: URL;
  try {
    u = new URL(String(raw ?? '').trim());
  } catch {
    throw new Error('That is not a web link');
  }
  if (u.protocol !== 'https:') throw new Error('Use the https:// link from the manufacturer’s website');
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || /^(\d+\.){3}\d+$/.test(h) || h.includes(':')) throw new Error('Use the manufacturer’s website link');
  return u;
}

async function download(u: URL, kind: 'pdf' | 'ies') {
  const res = await fetch(u, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (DIMO Lighting Ops catalogue fetch)' } });
  if (!res.ok) throw new Error(`The manufacturer’s site answered ${res.status} – check the link`);
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > MAX) throw new Error('The file is larger than 50 MB');
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > MAX) throw new Error('The file is larger than 50 MB');
  const type = res.headers.get('content-type') ?? '';
  if (kind === 'pdf' && !(type.includes('pdf') || String.fromCharCode(...bytes.slice(0, 5)) === '%PDF-')) throw new Error('The link does not give a PDF – open it and copy the link of the PDF itself');
  const name = decodeURIComponent(new URL(res.url).pathname.split('/').pop() || (kind === 'pdf' ? 'file.pdf' : 'file.ies')).replace(/[^A-Za-z0-9._-]+/g, '_').slice(-120);
  return { bytes, name: kind === 'pdf' && !/\.pdf$/i.test(name) ? `${name}.pdf` : name, finalUrl: res.url };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
  const { data: caller } = await admin.auth.getUser(jwt);
  if (!caller?.user) return json({ error: 'Not signed in' }, 401);
  const { data: me } = await admin.from('profiles').select('role, active').eq('id', caller.user.id).single();
  if (!me?.active || !KEEPERS.includes(me.role)) return json({ error: 'Catalogs are kept by the Design team, SM Projects and GM / DGM' }, 403);
  const body = await req.json().catch(() => ({}));
  try {
    const u = checkUrl(body.url);
    if (body.action === 'ies') {
      const f = await download(u, 'ies');
      if (f.bytes.byteLength > 600000) throw new Error('The IES file is too large (up to 600 KB)');
      const text = Array.from(f.bytes, (b) => String.fromCharCode(b)).join('').replace(/\0/g, '');
      if (!/TILT\s*=/i.test(text)) throw new Error('The link does not give an IES file');
      return json({ text, file_name: /\.ies$/i.test(f.name) ? f.name : `${f.name}.ies` });
    }
    if (body.action === 'catalogue') {
      const brand = Number(body.brand_id);
      if (!brand || !String(body.title ?? '').trim()) throw new Error('Choose the brand and give the catalogue a title');
      const f = await download(u, 'pdf');
      const path = `brands/${brand}/${crypto.randomUUID()}-${f.name}`;
      const up = await admin.storage.from('catalog').upload(path, f.bytes, { contentType: 'application/pdf' });
      if (up.error) throw new Error(up.error.message);
      const { data, error } = await admin
        .from('catalog_files')
        .insert({ brand_id: brand, title: String(body.title).trim(), kind: body.kind ?? 'catalogue', storage_path: path, file_name: f.name, size_bytes: f.bytes.byteLength, source_url: f.finalUrl, year: body.year ?? null, uploaded_by: caller.user.id })
        .select('id')
        .single();
      if (error) throw new Error(error.message);
      return json({ id: data.id, size: f.bytes.byteLength });
    }
    if (body.action === 'datasheet') {
      const { data: lum } = await admin.from('luminaires').select('id').eq('id', body.luminaire_id).maybeSingle();
      if (!lum) throw new Error('Luminaire not found');
      const f = await download(u, 'pdf');
      const path = `datasheets/${lum.id}/${crypto.randomUUID()}-${f.name}`;
      const up = await admin.storage.from('catalog').upload(path, f.bytes, { contentType: 'application/pdf' });
      if (up.error) throw new Error(up.error.message);
      const { error } = await admin.from('luminaires').update({ datasheet_path: path, datasheet_name: f.name, datasheet_url: f.finalUrl, updated_by: caller.user.id, updated_at: new Date().toISOString() }).eq('id', lum.id);
      if (error) throw new Error(error.message);
      return json({ path, size: f.bytes.byteLength });
    }
    throw new Error('Unknown action');
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});
