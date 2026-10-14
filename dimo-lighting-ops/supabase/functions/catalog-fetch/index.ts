// Catalogs: read files from the manufacturer's links so the team does not download and re-upload them. Catalogues and data
// sheets are kept as links only – nothing is stored:
//  * check – checks a link gives a PDF before it is saved (its name and size)
//  * pdf   – the PDF of a catalogue (file_id) or a luminaire's data sheet (luminaire_id), read now from the saved link and
//            passed to the app for the viewer or the DIMO watermark; whoever can see the catalogue (checked as the caller)
//  * ies   – an IES file's text, returned to the app (which reads it and adds it to the IES library)
// check and ies: only the Design team, SM Projects, GM / DGM and the System Administrator; https links only, 50 MB at most.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Expose-Headers': 'x-file-name',
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

const UA = { 'User-Agent': 'Mozilla/5.0 (DIMO Lighting Ops catalogue viewer)' };
const fileName = (url: string, kind: 'pdf' | 'ies') => {
  const name = decodeURIComponent(new URL(url).pathname.split('/').pop() || (kind === 'pdf' ? 'file.pdf' : 'file.ies')).replace(/[^A-Za-z0-9._-]+/g, '_').slice(-120);
  return kind === 'pdf' && !/\.pdf$/i.test(name) ? `${name}.pdf` : name;
};
const unavailable = (status: number) => new Error(`Link not available – the manufacturer’s site answered ${status}. Update the link.`);

async function download(u: URL, kind: 'pdf' | 'ies') {
  const res = await fetch(u, { redirect: 'follow', headers: UA }).catch(() => {
    throw new Error('Link not available – the manufacturer’s site did not answer. Update the link.');
  });
  if (!res.ok) throw unavailable(res.status);
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > MAX) throw new Error('The file is larger than 50 MB');
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > MAX) throw new Error('The file is larger than 50 MB');
  const type = res.headers.get('content-type') ?? '';
  if (kind === 'pdf' && !(type.includes('pdf') || String.fromCharCode(...bytes.slice(0, 5)) === '%PDF-')) throw new Error('The link no longer gives a PDF – open it and copy the link of the PDF itself');
  return { bytes, name: fileName(res.url, kind), finalUrl: res.url };
}

/** Checks a link gives a PDF, reading only its start */
async function check(u: URL) {
  const res = await fetch(u, { redirect: 'follow', headers: { ...UA, Range: 'bytes=0-1023' } }).catch(() => {
    throw new Error('The manufacturer’s site did not answer – check the link');
  });
  if (!res.ok) throw new Error(`The manufacturer’s site answered ${res.status} – check the link`);
  const reader = res.body?.getReader();
  const first = reader ? (await reader.read()).value ?? new Uint8Array() : new Uint8Array();
  await reader?.cancel().catch(() => {});
  const type = res.headers.get('content-type') ?? '';
  if (!(type.includes('pdf') || String.fromCharCode(...first.slice(0, 5)) === '%PDF-')) throw new Error('The link does not give a PDF – open it and copy the link of the PDF itself');
  const total = Number((res.headers.get('content-range') ?? '').split('/')[1] || (res.status === 200 ? res.headers.get('content-length') : 0) || 0);
  if (total > MAX) throw new Error('The file is larger than 50 MB – add the manufacturer’s online catalogue link instead');
  return { file_name: fileName(res.url, 'pdf'), final_url: res.url, size: total || null };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
  const { data: caller } = await admin.auth.getUser(jwt);
  if (!caller?.user) return json({ error: 'Not signed in' }, 401);
  const body = await req.json().catch(() => ({}));
  try {
    if (body.action === 'pdf') {
      // read as the caller, so only someone who can see the catalogue or the luminaire gets its PDF
      const user = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${jwt}` } } });
      const q = body.file_id
        ? await user.from('catalog_files').select('source_url').eq('id', body.file_id).maybeSingle()
        : await user.from('luminaires').select('source_url:datasheet_url').eq('id', body.luminaire_id).maybeSingle();
      const src = (q.data as { source_url: string | null } | null)?.source_url;
      if (!src) throw new Error(q.data ? 'No link saved – add the manufacturer’s link' : 'Not found');
      const f = await download(checkUrl(src), 'pdf');
      return new Response(f.bytes, { headers: { ...cors, 'Content-Type': 'application/octet-stream', 'X-File-Name': f.name, 'Cache-Control': 'no-store' } });
    }
    const { data: me } = await admin.from('profiles').select('role, active').eq('id', caller.user.id).single();
    if (!me?.active || !KEEPERS.includes(me.role)) return json({ error: 'Catalogs are kept by the Design team, SM Projects and GM / DGM' }, 403);
    const u = checkUrl(body.url);
    if (body.action === 'check') return json(await check(u));
    if (body.action === 'ies') {
      const f = await download(u, 'ies');
      if (f.bytes.byteLength > 600000) throw new Error('The IES file is too large (up to 600 KB)');
      const text = Array.from(f.bytes, (b) => String.fromCharCode(b)).join('').replace(/\0/g, '');
      if (!/TILT\s*=/i.test(text)) throw new Error('The link does not give an IES file');
      return json({ text, file_name: /\.ies$/i.test(f.name) ? f.name : `${f.name}.ies` });
    }
    throw new Error('Unknown action');
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});
