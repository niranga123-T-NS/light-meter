import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Image, Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { BrandFilter, PriceFilter, PriceTag, WarningTags } from '@/components/tools/BrandFilter';
import { Thumb } from '@/components/tools/FixtureLibrary';
import { Button, Card, Chip, colors, ErrorBanner, Field, ListRow, Loading, Muted, Notice, Pill, Row, Screen, Section, Select, Toggle, useWide } from '@/components/ui';
import { useMe } from '@/lib/auth';
import {
  BOQ_PROJECT_KIND, boqLines, certList, CERTS, CHIP_BRANDS, DEFAULT_SETTINGS, DRIVER_BRANDS, linePictures, MAKER_DEFAULT, readSettings, refillLine, detectColumns, exportBoqExcel, lineSpec, lineStatus, loadBoqMatches, matchLine, previousLines, readBoqFile, recompare, saveBoqMatch,
  type BoqColumns, type BoqPic, type BoqProject, type BoqLine, type BoqMatchRow, type BoqSettings, type BoqSheet, type LineResult,
} from '@/lib/boqMatch';
import { pickDocument } from '@/lib/files';
import { cctText, loadCatalog, PARAMS, searchFixtures, STATUS_STYLE, wattText, type Fixture, type Level, type Match, type ParamKey, type Spec } from '@/lib/fixtures';
import { fmtDateTime } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { fingerprintWeb, likeness, loadVisionIndex, rankByPhoto } from '@/lib/photoSearch';
import { rpc, supabase } from '@/lib/supabase';

type Step = 'upload' | 'check' | 'results' | 'save';
const EDIT_ROLES = ['gm', 'sm_projects', 'sm_estimation', 'am_estimation', 'estimation_exec'];
const LEVEL_TONE: Record<Level, string> = { must: colors.brand, important: colors.ink, nice: colors.muted };
const GRADE: Record<LineResult['grade'] | 'chosen' | 'nomatch', { label: string; tone: string }> = {
  all: { label: 'Meets all values', tone: colors.green },
  close: { label: 'Close – small deviations', tone: colors.amber },
  none: { label: 'No match – closest shown', tone: colors.red },
  few: { label: 'Few values – check by hand', tone: colors.amber },
  empty: { label: 'No values to match', tone: colors.grey },
  chosen: { label: 'Chosen', tone: colors.blue },
  nomatch: { label: 'No suitable option', tone: colors.red },
};
const colLetter = (i: number) => (i < 0 ? '' : String.fromCharCode(65 + (i % 26)));

/** BOQ match: upload the client's BOQ Excel, check what was read, pick the best catalogue option per line, save and export */
export default function BoqMatchScreen() {
  // ?c=1: an inquiry not in the system (boq_projects) instead of an estimation job
  const { id, m, c } = useLocalSearchParams<{ id: string; m?: string; c?: string }>();
  const custom = c === '1';
  const where = custom ? 'inquiry' : 'estimate';
  const me = useMe();
  const dialog = useDialog();
  const wide = useWide();
  const canEdit = EDIT_ROLES.includes(me.role);

  const { data, error, reload } = useLoad(async () => {
    const [{ data: row, error: e }, saved, lib] = await Promise.all([
      custom
        ? supabase.from('boq_projects').select('*').eq('id', id).single()
        : supabase.from('estimation_jobs').select('id, inquiry_id, source, revision, inquiries(code, project_name)').eq('id', id).single(),
      loadBoqMatches(custom ? { custom: id } : { job: id }),
      loadCatalog(),
    ]);
    if (e) throw new Error(e.message);
    type Job = { id: string; inquiry_id: string | null; source: string; revision: number; inquiries: { code: string; project_name: string } | null; kind?: BoqProject['kind'] };
    const p = row as unknown as BoqProject;
    const job: Job = custom ? { id: p.id, inquiry_id: null, source: 'custom', revision: 0, inquiries: { code: p.ref, project_name: p.project_name }, kind: p.kind } : (row as unknown as Job);
    return { job, saved, all: lib.products, groups: lib.groups };
  }, [id, custom]);

  const [step, setStep] = useState<Step>('upload');
  const [matchId, setMatchId] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [sheets, setSheets] = useState<BoqSheet[]>([]);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [cols, setCols] = useState<BoqColumns | null>(null);
  const [lines, setLines] = useState<BoqLine[]>([]);
  const [pics, setPics] = useState<Record<number, BoqPic>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [manualFor, setManualFor] = useState<BoqLine | null>(null);
  // the picture likeness of each line from the last Find (used again when dropped options are replaced)
  const photoCache = useRef(new Map<number, Map<string, number>>());
  const [n, setN] = useState(3);
  const [settings, setSettings] = useState<BoqSettings>(DEFAULT_SETTINGS);
  const [filter, setFilter] = useState<'all' | 'ready' | 'check' | 'skip'>('all');
  const [cur, setCur] = useState(0);
  const [allOptions, setAllOptions] = useState(true);
  const [opened, setOpened] = useState<string | null>(null);

  const all = useMemo(() => data?.all ?? [], [data]);
  const brands = useMemo(() => [...new Set(all.map((p) => p.brand))].sort(), [all]);
  const groups = data?.groups ?? { origins: {}, madeIn: {} };
  const fit = useMemo(() => lines.filter((l) => l.kind === 'fitting'), [lines]);
  const specs = useMemo(() => new Map(lines.map((l) => [l.row, lineSpec(l, settings)])), [lines, settings]);

  if (!data) return error ? <ErrorBanner message={error} /> : <Loading />;
  const { job, saved } = data;
  const sheet = sheets[sheetIdx];

  // open a saved match (from the list, or ?m= in the link)
  const openSaved = (s: BoqMatchRow) => {
    setMatchId(s.id); setFileName(s.file_name); setSheets([]); setLines(s.lines); setPics(s.images ?? {}); setN(s.options); setSettings(readSettings(s.settings)); setCur(0); setStep('results'); setOpened(s.id);
  };
  if (m && opened !== m) {
    const s = saved.find((x) => x.id === m);
    if (s) openSaved(s);
  }

  const pick = async () => {
    const f = await pickDocument();
    if (!f) return;
    await dialog.run(async () => {
      const sh = await readBoqFile(f);
      if (!sh.length) throw new Error('The file has no data');
      // the sheet with the most lighting words first
      const score = (s: BoqSheet) => s.rows.filter((r) => /light|luminaire|downlight|led/i.test(r.join(' '))).length;
      const best = sh.reduce((b, s, i) => (score(s) > score(sh[b]) ? i : b), 0);
      setFileName(f.name); setSheets(sh); setSheetIdx(best); setCols(detectColumns(sh[best].rows)); setMatchId(null); setLines([]); setPics({});
    });
  };
  const chooseSheet = (i: number) => { setSheetIdx(i); setCols(detectColumns(sheets[i].rows)); };

  const read = async () => {
    if (!sheet || !cols) return;
    if (cols.desc < 0) return dialog.alert('Choose the description column');
    const prev = await previousLines(custom ? { custom: job.id } : { inquiry: job.inquiry_id! }).catch(() => []);
    const ls = boqLines(sheet.rows, cols, prev);
    setLines(ls);
    setPics(linePictures(ls, sheet.pics));
    setStep('check');
  };

  // lines with the client's picture are also compared by how the products look (website: the same photo reader as Search by photo)
  const find = async () => {
    const withPic = Platform.OS === 'web' ? lines.filter((l) => l.kind === 'fitting' && pics[l.row]) : [];
    const photos = new Map<number, Map<string, number>>();
    if (withPic.length) {
      try {
        setBusy('Loading the photo reader (about 18 MB, the first time only)…');
        const ix = await loadVisionIndex();
        for (const [k, l] of withPic.entries()) {
          setBusy(`Comparing the pictures… ${k + 1} of ${withPic.length}`);
          const q = await fingerprintWeb(pics[l.row].src, ix.query);
          photos.set(l.row, new Map(rankByPhoto(ix, all, q, {}, 100000).map((h) => [h.img, h.score])));
        }
      } catch (e) {
        dialog.toast(`Pictures not compared: ${e instanceof Error ? e.message : String(e)} – matched on the text`, 'error');
      } finally {
        setBusy(null);
      }
    }
    photoCache.current = photos;
    const next = lines.map((l) => {
      if (l.kind !== 'fitting') return { ...l, options: [], look: undefined };
      // options dropped earlier stay out; products picked by hand stay in
      if (l.dropped?.length || l.manual?.length) return { ...l, ...refillLine(all, { ...l, options: l.manual ?? [] }, settings, n, photos.get(l.row)) };
      const r = matchLine(all, l, settings, n, photos.get(l.row));
      return { ...l, options: r.matches.map((x) => x.p.id), look: r.look };
    });
    setLines(next); setCur(0); setStep('results');
  };

  const setLine = (row: number, patch: Partial<BoqLine>) => setLines((ls) => ls.map((l) => (l.row === row ? { ...l, ...patch } : l)));

  // choosing a fitting: what it must come with – driver and LED chip brand, test certificates (for this line or the whole BOQ)
  const askReq = async (l: BoqLine, p: Fixture, choose: boolean) => {
    const r0 = l.req;
    const warn = (p.warnings ?? []).map((w) => `⚠ ${w.text}`).join('   ');
    const r = await dialog.prompt({
      title: `${p.brand} ${p.code} – line ${l.item || l.row + 1}`,
      message: `${warn ? `${warn}\n\n` : ''}What must this fitting come with? "${MAKER_DEFAULT}" = as the manufacturer supplies it.`,
      fields: [
        { key: 'driver', label: '1 · Driver brand', type: 'select', required: true, initial: r0?.driver ?? MAKER_DEFAULT, options: [MAKER_DEFAULT, ...DRIVER_BRANDS].map((v) => ({ value: v, label: v })) },
        { key: 'chip', label: '2 · LED chip brand', type: 'select', required: true, initial: r0?.chip ?? MAKER_DEFAULT, options: [MAKER_DEFAULT, ...CHIP_BRANDS].map((v) => ({ value: v, label: v })) },
        { key: 'certs', label: '3 · Test certificates needed (none, one or many)', type: 'multiselect', initial: r0?.certs.join(',') ?? '', options: [...CERTS, 'Other'].map((v) => ({ value: v, label: v })) },
        { key: 'other', label: 'Other certificates – one per line, with a description', type: 'multiline', initial: r0?.other.join('\n') ?? '', hint: 'e.g. IK10 impact test – independent lab report' },
        { key: 'scope', label: 'Use the same for', type: 'select', initial: 'line', options: [{ value: 'line', label: 'This line only' }, { value: 'all', label: 'Every line of this BOQ' }] },
      ],
      confirmLabel: choose ? 'Choose this fitting' : 'Save',
    });
    if (!r) return;
    const req = { driver: r.driver, chip: r.chip, certs: r.certs ? r.certs.split(',').filter(Boolean) : [], other: r.other.split('\n').map((x) => x.trim()).filter(Boolean) };
    setLines((ls) => ls.map((x) => (x.row === l.row ? { ...x, req, ...(choose ? { chosen: p.id, noMatch: false } : {}) } : r.scope === 'all' && x.kind === 'fitting' ? { ...x, req } : x)));
  };
  const choose = (l: BoqLine, p: Fixture) => (l.chosen === p.id ? setLine(l.row, { chosen: null }) : askReq(l, p, true));
  // the dropped options are replaced by the next best; the others stay
  const refill = (l: BoqLine, drop: string[]) => setLine(l.row, refillLine(all, { ...l, dropped: [...(l.dropped ?? []), ...drop] }, settings, n, photoCache.current.get(l.row)));
  // a product picked by hand from the catalogue (when the automatic options do not fit)
  const pickManual = (l: BoqLine, p: Fixture) => {
    setManualFor(null);
    const ids = [p.id, ...l.options.filter((id) => id !== p.id)];
    setLine(l.row, { options: ids, manual: [...new Set([...(l.manual ?? []), p.id])], dropped: (l.dropped ?? []).filter((id) => id !== p.id), look: undefined });
    askReq({ ...l, options: ids }, p, true);
  };
  const correct = async (l: BoqLine) => {
    const pic = pics[l.row];
    const r = await dialog.prompt({
      title: `Line ${l.item || l.row + 1}`,
      message: 'Correct or add values the way they would be written in a BOQ (e.g. "downlight 10W 900lm 3000K IP44 DALI"). The client\'s description in the export is not changed.',
      fields: [
        { key: 'text', label: 'Text to read the values from', type: 'multiline', initial: l.text },
        { key: 'kind', label: 'This line is', type: 'select', initial: l.kind, options: [{ value: 'fitting', label: 'A light fitting – match it' }, { value: 'skip', label: 'Not a light fitting – skip' }, { value: 'heading', label: 'A section heading' }] },
        ...(pic ? [{ key: 'pic', label: 'The picture beside this line', type: 'select' as const, initial: 'keep', options: [{ value: 'keep', label: 'Is this fitting – use it' }, { value: 'drop', label: 'Is not this fitting – remove it' }] }] : []),
      ],
    });
    if (!r) return;
    setLine(l.row, { text: r.text || l.desc, kind: r.kind as BoqLine['kind'] });
    if (r.pic === 'drop') setPics((ps) => { const x = { ...ps }; delete x[l.row]; return x; });
  };

  const save = () =>
    dialog.run(async () => {
      const sid = await saveBoqMatch({ id: matchId, target: custom ? { custom: job.id } : { job: job.id }, file_name: fileName, sheet: sheet?.name ?? saved.find((s) => s.id === matchId)?.sheet ?? '', options: n, settings, lines, images: pics });
      setMatchId(sid);
      await reload();
    }, custom ? 'Saved to this inquiry' : 'Saved to this estimate');

  const noMatch = fit.filter((l) => l.noMatch);
  const askDesign = async () => {
    const q = `BOQ ${fileName}: no suitable catalogue fitting for ${noMatch.length} line${noMatch.length > 1 ? 's' : ''} – please advise:\n` + noMatch.map((l) => `• ${l.item ? `${l.item} – ` : ''}${l.desc}${l.qty ? ` (${l.qty} ${l.unit})` : ''}`).join('\n');
    if (await dialog.confirm('Ask Design', `${q}\n\nThe estimation clock stops until the designer answers.`)) await dialog.run(() => rpc('ask_clarification', { p_job: job.id, p_question: q }), 'Sent to the designer');
  };

  const steps: { s: Step; label: string }[] = [{ s: 'upload', label: '1 Upload' }, { s: 'check', label: '2 Check lines' }, { s: 'results', label: '3 Options' }, { s: 'save', label: '4 Save' }];
  const order = steps.map((x) => x.s);
  const header = (
    <Row gap={6} wrap>
      {steps.map((x) => {
        const i = order.indexOf(x.s), at = order.indexOf(step);
        const reachable = i < at || (i > at && lines.length > 0 && (x.s !== 'results' && x.s !== 'save' ? true : fit.some((l) => l.options.length)));
        return <Chip key={x.s} label={`${x.label}${i < at ? ' ✓' : ''}`} on={x.s === step} onPress={reachable ? () => setStep(x.s) : undefined} />;
      })}
    </Row>
  );

  return (
    <Screen maxWidth={1280}>
      <Stack.Screen options={{ title: 'BOQ match' }} />
      <Row gap={8} wrap style={{ justifyContent: 'space-between' }}>
        <View style={{ gap: 2, flexShrink: 1 }}>
          <Text style={{ fontSize: 17, fontWeight: '800', color: colors.ink }}>{`${job.inquiries?.code ?? ''} · ${job.inquiries?.project_name ?? ''}`}</Text>
          {job.kind ? <Pill label={`${BOQ_PROJECT_KIND[job.kind]} – BOQ match only`} tone={colors.amber} /> : null}
          <Muted>{fileName ? `BOQ match › ${fileName}${sheet ? ` › ${sheet.name}` : ''}` : 'BOQ match – the best catalogue options for every line of the client\'s BOQ'}</Muted>
        </View>
        <Row gap={6}>
          <Button small variant="ghost" title="All BOQ matches" onPress={() => router.push('/estimating/boq')} />
          {custom ? null : <Button small variant="ghost" title="Back to the estimate" onPress={() => router.push(`/estimation/${job.id}`)} />}
        </Row>
      </Row>
      <View style={{ marginTop: 10 }}>{header}</View>

      {step === 'upload' ? (
        <UploadStep
          {...{ where, canEdit, saved, fileName, sheets, sheetIdx, cols, n, setN, setCols, chooseSheet, pick, read, openSaved }}
        />
      ) : null}

      {step === 'check' ? (
        <View style={{ gap: 12, marginTop: 12 }}>
          <View style={{ flexDirection: wide ? 'row' : 'column', gap: 12, alignItems: 'flex-start' }}>
            <View style={{ flex: 1, gap: 8, width: '100%' }}>
              <Row gap={6} wrap>
                {(['all', 'ready', 'check', 'skip'] as const).map((f) => {
                  const cnt = f === 'all' ? lines.filter((l) => l.kind !== 'heading').length : lines.filter((l) => lineStatus(l, specs.get(l.row)!) === f).length;
                  return <Chip key={f} label={`${{ all: 'All', ready: 'Ready', check: 'Check', skip: 'Not a fitting' }[f]} ${cnt}`} on={filter === f} onPress={() => setFilter(f)} />;
                })}
              </Row>
              <Card style={{ padding: 0, overflow: 'hidden' }}>
                {lines.filter((l) => l.kind !== 'heading' && (filter === 'all' || lineStatus(l, specs.get(l.row)!) === filter)).map((l) => (
                  <CheckRow key={l.row} l={l} pic={pics[l.row]} spec={specs.get(l.row)!} onPress={canEdit ? () => correct(l) : undefined} />
                ))}
              </Card>
              <Muted>Tap a line to correct the text the values are read from, or to mark it as a fitting / not a fitting. Dashed = not found; the line still matches on the other values.</Muted>
            </View>
            <View style={{ width: wide ? 330 : '100%', gap: 10 }}>
              <Card style={{ gap: 8 }}>
                <Text style={{ fontWeight: '700', color: colors.ink }}>How strict – for all lines</Text>
                <Muted>Same rules as Find a match. Tap to change.</Muted>
                {PARAMS.filter((p) => !['aut', 'warranty', 'life', 'ik'].includes(p.key)).map((p) => {
                  const lv = settings.levels[p.key] ?? p.level;
                  const nextLv: Level = lv === 'must' ? 'important' : lv === 'important' ? 'nice' : 'must';
                  return (
                    <Pressable key={p.key} onPress={() => setSettings((s) => ({ ...s, levels: { ...s.levels, [p.key]: nextLv } }))} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={{ width: 96, fontSize: 13, fontWeight: '700', color: colors.ink }}>{p.label.replace(/ \(.*\)/, '')}</Text>
                      <Pill label={lv === 'must' ? 'Must' : lv === 'important' ? 'Important' : 'Nice'} tone={LEVEL_TONE[lv]} solid />
                      <Muted style={{ marginLeft: 'auto', fontSize: 12 }}>{p.tol}</Muted>
                    </Pressable>
                  );
                })}
              </Card>
              <Card style={{ gap: 6 }}>
                <BrandFilter brands={brands} groups={groups} value={settings.brands} onChange={(v) => setSettings((s) => ({ ...s, brands: v }))} />
                <PriceFilter value={settings.priceLevels} onChange={(v) => setSettings((s) => ({ ...s, priceLevels: v }))} />
              </Card>
              <Button title={busy ?? `Find ${n} option${n > 1 ? 's' : ''} for ${fit.length} lines →`} onPress={find} disabled={!fit.length || !!busy} />
              {Object.keys(pics).length ? <Muted style={{ textAlign: 'center' }}>{Platform.OS === 'web' ? `${Object.keys(pics).length} lines have the client's picture – compared with the catalogue photos too` : 'The pictures are compared with the catalogue on the website; here the lines are matched on the text'}</Muted> : null}
              <Muted style={{ textAlign: 'center' }}>In the app, from the catalogue library – no internet search, no AI</Muted>
            </View>
          </View>
        </View>
      ) : null}

      {step === 'results' ? <ResultsStep {...{ all, lines, pics, specs, settings, n, cur, setCur, setLine, canEdit, wide, correct, choose, refill, editReq: (l: BoqLine, p: Fixture) => askReq(l, p, false), manual: setManualFor, toSave: () => setStep('save') }} /> : null}
      {manualFor ? <ManualPick all={all} line={manualFor} onPick={(p) => pickManual(manualFor, p)} onClose={() => setManualFor(null)} /> : null}

      {step === 'save' ? (
        <View style={{ gap: 12, marginTop: 12 }}>
          <Row gap={10} wrap>
            {[
              { n: fit.length, t: 'Fitting lines', d: `${lines.filter((l) => l.kind === 'skip').length} non-lighting lines skipped`, tone: colors.ink },
              { n: fit.filter((l) => l.chosen).length, t: 'Option chosen', d: 'Shown as "Chosen" in the Excel', tone: colors.green },
              { n: noMatch.length, t: 'No suitable option', d: 'Flagged for Design', tone: colors.red },
              { n: fit.filter((l) => !l.chosen && !l.noMatch).length, t: 'Not decided yet', d: 'Option 1 is the best match', tone: colors.amber },
            ].map((s) => (
              <Card key={s.t} style={{ flexGrow: 1, flexBasis: 200, gap: 2 }}>
                <Text style={{ fontSize: 26, fontWeight: '800', color: s.tone }}>{s.n}</Text>
                <Text style={{ fontWeight: '700', color: colors.ink }}>{s.t}</Text>
                <Muted>{s.d}</Muted>
              </Card>
            ))}
          </Row>
          <Card style={{ gap: 10 }}>
            <Text style={{ fontWeight: '700', color: colors.ink }}>Excel that comes out</Text>
            <Muted>{`"${fileName.replace(/\.[^.]+$/, '')} – DIMO options.xlsx": the client's Item, Description, Unit and Qty unchanged${Object.keys(pics).length ? ' with the client\'s pictures' : ''}, then Chosen with the product photo, the deviations, the driver, LED chip, test certificates and warnings of the chosen product${allOptions ? ` and Options 1–${n}` : ''}. A second sheet lists the chosen products with their data and catalogue page.`}</Muted>
            <Toggle label={`Include all ${n} options (off = the chosen product only)`} value={allOptions} onChange={setAllOptions} />
            <Row gap={8} wrap>
              {canEdit ? <Button title={matchId ? 'Save changes' : `Save to this ${where}`} onPress={save} /> : null}
              <Button variant="secondary" title="Download Excel" onPress={() => dialog.run(() => exportBoqExcel(fileName, all, lines, settings, n, allOptions, pics))} />
              {canEdit && noMatch.length && job.source === 'design' ? <Button variant="secondary" title={`Ask Design about ${noMatch.length} line${noMatch.length > 1 ? 's' : ''}`} onPress={askDesign} /> : null}
            </Row>
            {noMatch.length && job.source !== 'design' ? <Muted>{`${noMatch.length} line${noMatch.length > 1 ? 's have' : ' has'} no suitable option – listed as "No suitable option – to Design" in the Excel.`}</Muted> : null}
          </Card>
        </View>
      ) : null}
    </Screen>
  );
}

function UploadStep(p: {
  where: string; canEdit: boolean; saved: BoqMatchRow[]; fileName: string; sheets: BoqSheet[]; sheetIdx: number; cols: BoqColumns | null; n: number;
  setN: (n: number) => void; setCols: (c: BoqColumns) => void; chooseSheet: (i: number) => void; pick: () => void; read: () => void; openSaved: (s: BoqMatchRow) => void;
}) {
  const wide = useWide();
  const sheet = p.sheets[p.sheetIdx];
  const width = sheet ? Math.min(12, Math.max(...sheet.rows.slice(0, 60).map((r) => r.length))) : 0;
  const head = sheet && p.cols && p.cols.header >= 0 ? sheet.rows[p.cols.header] : [];
  const colOpts = [{ value: '-1', label: '– none –' }, ...Array.from({ length: width }, (_, i) => ({ value: `${i}`, label: `${colLetter(i)}${head[i] ? ` · ${head[i]}` : ''}` }))];
  const set = (k: keyof BoqColumns, v: string) => p.cols && p.setCols({ ...p.cols, [k]: Number(v) });
  const tint = (i: number) => (p.cols ? (i === p.cols.desc ? '#DBEAFE' : i === p.cols.qty ? '#DCFCE7' : i === p.cols.unit ? '#FEF3C7' : i === p.cols.item ? '#FEE2E2' : undefined) : undefined);
  const preview = sheet ? sheet.rows.slice(Math.max(0, (p.cols?.header ?? -1) + 1), (p.cols?.header ?? -1) + 16) : [];
  const nLines = sheet && p.cols && p.cols.desc >= 0 ? boqLines(sheet.rows, p.cols).filter((l) => l.kind === 'fitting').length : 0;
  return (
    <View style={{ gap: 12, marginTop: 12 }}>
      {p.saved.length ? (
        <Section title={`Saved BOQ matches of this ${p.where}`}>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {p.saved.map((s) => (
              <ListRow key={s.id} title={`${s.file_name}${s.sheet ? ` › ${s.sheet}` : ''}`} subtitle={`${s.lines.filter((l) => l.kind === 'fitting').length} lines · ${s.lines.filter((l) => l.chosen).length} chosen · saved ${fmtDateTime(s.updated_at)}`} right={<Button small variant="secondary" title="Open" onPress={() => p.openSaved(s)} />} />
            ))}
          </Card>
        </Section>
      ) : null}
      {p.canEdit ? (
        <View style={{ flexDirection: wide ? 'row' : 'column', gap: 12, alignItems: 'flex-start' }}>
          <View style={{ width: wide ? 340 : '100%', gap: 10 }}>
            <Card style={{ gap: 8 }}>
              <Text style={{ fontWeight: '700', color: colors.ink }}>BOQ file</Text>
              {p.fileName ? <Text style={{ fontWeight: '700', color: colors.ink }}>{p.fileName}</Text> : <Muted>Excel (.xlsx) or CSV. Read in the app from the cells – no internet search, no AI.</Muted>}
              <Button title={p.fileName ? 'Choose another file' : 'Upload BOQ (Excel, CSV or PDF)'} variant={p.fileName ? 'secondary' : 'primary'} onPress={p.pick} />
            </Card>
            {p.sheets.length > 1 ? (
              <Card style={{ gap: 8 }}>
                <Text style={{ fontWeight: '700', color: colors.ink }}>Sheet</Text>
                <Row gap={6} wrap>{p.sheets.map((s, i) => <Chip key={s.name} label={`${s.name} (${s.rows.length})`} on={i === p.sheetIdx} onPress={() => p.chooseSheet(i)} />)}</Row>
              </Card>
            ) : null}
            {p.cols ? (
              <Card style={{ gap: 6 }}>
                <Text style={{ fontWeight: '700', color: colors.ink }}>Columns (found automatically – change if wrong)</Text>
                <Select label="Description" value={`${p.cols.desc}`} onChange={(v) => set('desc', v)} options={colOpts} />
                <Select label="Quantity" value={`${p.cols.qty}`} onChange={(v) => set('qty', v)} options={colOpts} />
                <Select label="Unit" value={`${p.cols.unit}`} onChange={(v) => set('unit', v)} options={colOpts} />
                <Select label="Item no." value={`${p.cols.item}`} onChange={(v) => set('item', v)} options={colOpts} />
                <Select label="Header row" value={`${p.cols.header}`} onChange={(v) => set('header', v)} options={[{ value: '-1', label: 'No header row' }, ...Array.from({ length: Math.min(40, sheet?.rows.length ?? 0) }, (_, i) => ({ value: `${i}`, label: `Row ${i + 1}: ${(sheet?.rows[i] ?? []).filter(Boolean).slice(0, 3).join(' · ').slice(0, 50)}` }))]} />
              </Card>
            ) : null}
            {p.cols ? (
              <Card style={{ gap: 8 }}>
                <Text style={{ fontWeight: '700', color: colors.ink }}>Options per line</Text>
                <Row gap={6}>{[1, 2, 3, 4, 5].map((k) => <Chip key={k} label={`${k}`} on={p.n === k} onPress={() => p.setN(k)} />)}</Row>
              </Card>
            ) : null}
          </View>
          {sheet && p.cols ? (
            <View style={{ flex: 1, gap: 8, width: '100%' }}>
              <Card style={{ padding: 0, overflow: 'hidden' }}>
                <View style={{ padding: 10, borderBottomWidth: 1, borderColor: colors.line }}>
                  <Text style={{ fontWeight: '800', color: colors.ink }}>{`Preview – sheet "${sheet.name}"`}</Text>
                  <Muted>{`${sheet.rows.length} rows · ${nLines} look like light fittings${sheet.pics && Object.keys(sheet.pics).length ? ` · ${Object.keys(sheet.pics).length} pictures` : ''} · coloured columns are read`}</Muted>
                </View>
                {preview.map((r, ri) => (
                  <View key={ri} style={{ flexDirection: 'row', borderBottomWidth: 1, borderColor: colors.line }}>
                    {Array.from({ length: Math.min(width, 6) }, (_, ci) => (
                      <Text key={ci} numberOfLines={1} style={{ flex: ci === p.cols!.desc ? 4 : 1, padding: 6, fontSize: 12, color: colors.text, backgroundColor: tint(ci) }}>{r[ci] ?? ''}</Text>
                    ))}
                  </View>
                ))}
              </Card>
              <Row gap={8} style={{ justifyContent: 'flex-end' }}>
                <Muted style={{ flexShrink: 1 }}>Section headings are kept as groups; cables, boards, switches and labour are skipped. A revised BOQ keeps the choices of unchanged lines.</Muted>
                <Button title={`Read ${nLines} lines →`} onPress={p.read} />
              </Row>
            </View>
          ) : null}
        </View>
      ) : !p.saved.length ? (
        <Notice>{`No BOQ match saved on this ${p.where} yet. The estimation team uploads the BOQ.`}</Notice>
      ) : null}
    </View>
  );
}

const CHIP_KEYS: ParamKey[] = ['type', 'size', 'w', 'lm', 'cct', 'cri', 'ugr', 'ip', 'beam', 'control', 'aut'];
const UNIT: Partial<Record<ParamKey, (v: string) => string>> = { w: (v) => `${v} W`, lm: (v) => `${v} lm`, cct: (v) => `${v} K`, cri: (v) => `CRI ${v}`, ugr: (v) => `UGR<${v}`, ip: (v) => `IP${v}`, aut: (v) => `${v} h` };

/** The client's picture of a line */
function ClientPic({ pic, size }: { pic?: BoqPic; size: number }) {
  if (!pic) return null;
  return <Image source={{ uri: pic.src }} style={{ width: size, height: size, borderRadius: 6, backgroundColor: colors.soft }} resizeMode="contain" />;
}

function CheckRow({ l, pic, spec, onPress }: { l: BoqLine; pic?: BoqPic; spec: Spec; onPress?: () => void }) {
  const st = lineStatus(l, spec);
  const tone = st === 'ready' ? colors.green : st === 'check' ? colors.amber : colors.grey;
  return (
    <Pressable onPress={onPress} style={{ padding: 10, borderBottomWidth: 1, borderColor: colors.line, gap: 6, backgroundColor: l.kind === 'skip' ? '#FAFAFA' : '#fff' }}>
      <Row gap={8} style={{ alignItems: 'flex-start' }}>
        <Text style={{ width: 40, fontWeight: '700', color: colors.ink, fontSize: 13 }}>{l.item}</Text>
        <ClientPic pic={pic} size={48} />
        <Text style={{ flex: 1, fontSize: 13, color: l.kind === 'skip' ? colors.muted : colors.text }}>{l.text !== l.desc ? `${l.desc}\n→ read as: ${l.text}` : l.desc}</Text>
        <Text style={{ width: 70, fontSize: 12, color: colors.muted, textAlign: 'right' }}>{[l.qty, l.unit].filter(Boolean).join(' ')}</Text>
        <Pill label={st === 'ready' ? 'Ready' : st === 'check' ? 'Check' : 'Not a fitting'} tone={tone} />
      </Row>
      {l.kind === 'fitting' ? (
        <Row gap={4} wrap style={{ marginLeft: 48 }}>
          {CHIP_KEYS.filter((k) => spec[k]).map((k) => (
            <View key={k} style={{ borderWidth: 1, borderColor: colors.line, backgroundColor: colors.soft, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
              <Text style={{ fontSize: 11, fontWeight: '700', color: colors.ink }}>{(UNIT[k] ?? ((v: string) => v))(spec[k]!.v)}</Text>
            </View>
          ))}
          {(['type', 'lm'] as const).filter((k) => !spec[k]).map((k) => (
            <View key={k} style={{ borderWidth: 1, borderStyle: 'dashed', borderColor: colors.faint, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
              <Text style={{ fontSize: 11, color: colors.muted }}>{k === 'type' ? 'type ?' : 'lumens ?'}</Text>
            </View>
          ))}
        </Row>
      ) : null}
    </Pressable>
  );
}

function ResultsStep(p: {
  all: Fixture[]; lines: BoqLine[]; pics: Record<number, BoqPic>; specs: Map<number, Spec>; settings: BoqSettings; n: number; cur: number; setCur: (i: number) => void;
  setLine: (row: number, patch: Partial<BoqLine>) => void; canEdit: boolean; wide: boolean; correct: (l: BoqLine) => void; toSave: () => void;
  choose: (l: BoqLine, p: Fixture) => void; refill: (l: BoqLine, drop: string[]) => void; editReq: (l: BoqLine, p: Fixture) => void; manual: (l: BoqLine) => void;
}) {
  const fit = p.lines.filter((l) => l.kind === 'fitting');
  const [view, setView] = useState<'all' | 'all_' | 'close' | 'none' | 'chosen'>('all');
  const [drops, setDrops] = useState<{ row: number; ids: string[] }>({ row: -1, ids: [] });
  const grades = useMemo(() => new Map(fit.map((l) => [l.row, gradeOf(p.all, l, p.specs.get(l.row)!)])), [fit, p.all, p.specs]);
  if (!fit.length) return <Notice>No light fittings to match – go back and check the lines.</Notice>;
  const tag = (l: BoqLine) => (l.noMatch ? 'nomatch' : l.chosen ? 'chosen' : grades.get(l.row)!);
  const shown = fit.filter((l) => view === 'all' || (view === 'chosen' ? !!l.chosen : view === 'all_' ? tag(l) === 'all' : view === 'close' ? tag(l) === 'close' || tag(l) === 'few' : tag(l) === view));
  const i = Math.min(p.cur, fit.length - 1);
  const l = fit[i];
  const spec = p.specs.get(l.row)!;
  const opts = l.options.map((id) => p.all.find((x) => x.id === id)).filter(Boolean).map((x) => recompare(p.all, x!.id, spec)!);
  const drop = drops.row === l.row ? drops.ids : [];
  const counts = { all_: fit.filter((x) => tag(x) === 'all').length, close: fit.filter((x) => tag(x) === 'close' || tag(x) === 'few').length, none: fit.filter((x) => tag(x) === 'none' || tag(x) === 'nomatch').length, chosen: fit.filter((x) => x.chosen).length };

  const list = (
    <Card style={{ padding: 0, overflow: 'hidden', width: p.wide ? 300 : '100%' }}>
      <View style={{ padding: 10, gap: 6, borderBottomWidth: 1, borderColor: colors.line }}>
        <Text style={{ fontWeight: '800', color: colors.ink }}>BOQ lines</Text>
        <Row gap={4} wrap>
          <Chip label={`All ${fit.length}`} on={view === 'all'} onPress={() => setView('all')} />
          <Chip label={`Meets all ${counts.all_}`} on={view === 'all_'} onPress={() => setView('all_')} tone={colors.green} />
          <Chip label={`Close ${counts.close}`} on={view === 'close'} onPress={() => setView('close')} tone={colors.amber} />
          <Chip label={`No match ${counts.none}`} on={view === 'none'} onPress={() => setView('none')} tone={colors.red} />
          <Chip label={`Chosen ${counts.chosen}`} on={view === 'chosen'} onPress={() => setView('chosen')} tone={colors.blue} />
        </Row>
      </View>
      <View style={{ maxHeight: p.wide ? 640 : 260 }}>
        {shown.map((x) => {
          const g = GRADE[tag(x)];
          const on = x.row === l.row;
          return (
            <Pressable key={x.row} onPress={() => p.setCur(fit.indexOf(x))} style={{ padding: 8, borderBottomWidth: 1, borderColor: colors.line, borderLeftWidth: 3, borderLeftColor: on ? colors.brand : 'transparent', backgroundColor: on ? '#FEF2F2' : '#fff' }}>
              <Row gap={6} style={{ alignItems: 'flex-start' }}>
                <Text style={{ width: 34, fontSize: 12, fontWeight: '700', color: colors.ink }}>{x.item}</Text>
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={{ fontSize: 12, color: colors.text }}>{x.desc}</Text>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: g.tone }}>{g.label}</Text>
                </View>
              </Row>
            </Pressable>
          );
        })}
      </View>
    </Card>
  );

  return (
    <View style={{ flexDirection: p.wide ? 'row' : 'column', gap: 12, marginTop: 12, alignItems: 'flex-start' }}>
      {list}
      <View style={{ flex: 1, gap: 10, width: '100%' }}>
        <Card style={{ gap: 6 }}>
          <Row gap={8} wrap style={{ justifyContent: 'space-between' }}>
            <ClientPic pic={p.pics[l.row]} size={110} />
            <View style={{ flex: 1, minWidth: 220, gap: 2 }}>
              <Muted>{`Line ${l.item || l.row + 1} · ${[l.qty, l.unit].filter(Boolean).join(' ')} · ${i + 1} of ${fit.length}`}</Muted>
              <Text style={{ fontSize: 15, fontWeight: '800', color: colors.ink }}>{l.desc}</Text>
              {l.text !== l.desc ? <Muted>{`Read as: ${l.text}`}</Muted> : null}
              {p.pics[l.row] ? <Muted style={{ fontSize: 12 }}>{l.look?.length ? "The client's picture – the options are also ranked by how alike they look" : "The client's picture – press Find again on step 2 to compare it (website)"}</Muted> : null}
            </View>
            <Row gap={6}>
              {p.canEdit ? <Button small variant="secondary" title="Change values" onPress={() => p.correct(l)} /> : null}
              <Button small variant="secondary" title="‹ Prev" disabled={i === 0} onPress={() => p.setCur(i - 1)} />
              <Button small variant="secondary" title="Next ›" disabled={i === fit.length - 1} onPress={() => p.setCur(i + 1)} />
            </Row>
          </Row>
        </Card>
        {!opts.length ? <Notice tone={colors.amber}>No options for this line – pick a product by hand, or tap Change values, type the values and press Find again on step 2.</Notice> : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {opts.map((o, k) => (
            <OptionCard
              key={o.p.id} k={k} o={o} look={l.look?.[l.options.indexOf(o.p.id)]} spec={spec} chosen={l.chosen === o.p.id} canEdit={p.canEdit}
              manual={!!l.manual?.includes(o.p.id)} req={l.chosen === o.p.id ? l.req : undefined} dropping={drop.includes(o.p.id)}
              onChoose={() => p.choose(l, o.p)} onReq={() => p.editReq(l, o.p)} onDrop={() => setDrops({ row: l.row, ids: drop.includes(o.p.id) ? drop.filter((x) => x !== o.p.id) : [...drop, o.p.id] })}
            />
          ))}
        </View>
        {p.canEdit ? (
          <Row gap={8} wrap style={{ alignItems: 'center' }}>
            {drop.length ? <Button small title={`Find the next ${drop.length} instead of the dropped →`} onPress={() => { p.refill(l, drop); setDrops({ row: l.row, ids: [] }); }} /> : <Muted style={{ fontSize: 12 }}>Not suitable? Tap Drop on the options to replace them with the next best – the others stay.</Muted>}
            <Button small variant="secondary" title="Pick a product by hand" onPress={() => p.manual(l)} />
            {l.dropped?.length ? <Muted style={{ fontSize: 12 }}>{`${l.dropped.length} dropped – not offered again for this line`}</Muted> : null}
          </Row>
        ) : null}
        <Row gap={8} wrap>
          {(['ok', 'up', 'minor', 'fail'] as const).map((s) => <Pill key={s} label={`${STATUS_STYLE[s].icon} ${STATUS_STYLE[s].label}`} tone={STATUS_STYLE[s].fg} />)}
          <View style={{ flex: 1 }} />
          {p.canEdit ? <Button small variant={l.noMatch ? 'danger' : 'ghost'} title={l.noMatch ? 'Marked: no suitable option ✓' : 'No suitable option – for Design'} onPress={() => p.setLine(l.row, { noMatch: !l.noMatch, chosen: null })} /> : null}
          <Button small title="Save / export →" onPress={p.toSave} />
        </Row>
      </View>
    </View>
  );
}

function gradeOf(all: Fixture[], l: BoqLine, spec: Spec): LineResult['grade'] {
  const first = l.options[0] ? recompare(all, l.options[0], spec) : null;
  if (!first) return 'empty';
  const keys = (Object.keys(spec) as ParamKey[]).filter((k) => spec[k]?.v.trim());
  const st = keys.map((k) => ({ s: first.cells[k]?.status, lv: spec[k]!.level }));
  if (st.some((x) => x.s === 'fail' && x.lv === 'must')) return 'none';
  if (!spec.w?.v.trim() && !spec.lm?.v.trim()) return 'few';
  return st.some((x) => x.s === 'fail' || x.s === 'minor') ? 'close' : 'all';
}

function OptionCard(props: {
  k: number; o: Match; look?: number; spec: Spec; chosen: boolean; canEdit: boolean; manual: boolean; req?: BoqLine['req']; dropping: boolean;
  onChoose: () => void; onReq: () => void; onDrop: () => void;
}) {
  const { k, o, look, spec, chosen, canEdit, onChoose } = props;
  const keys = PARAMS.filter((p) => spec[p.key]?.v.trim() && o.cells[p.key]);
  return (
    <Card style={{ flexGrow: 1, flexBasis: 260, maxWidth: 420, gap: 8, borderWidth: 2, borderColor: chosen ? colors.blue : colors.line }}>
      <Row gap={6} style={{ justifyContent: 'space-between' }}>
        <Text style={{ fontSize: 12, fontWeight: '800', color: colors.muted }}>{`OPTION ${k + 1}`}</Text>
        <Text onPress={() => router.push(`/fixtures/${encodeURIComponent(o.p.id)}`)} style={{ fontSize: 12, color: colors.blue }}>Product page ›</Text>
      </Row>
      <View style={{ alignItems: 'center' }}><Thumb p={o.p} size={200} height={120} /></View>
      <View style={{ gap: 2 }}>
        <Text style={{ fontWeight: '800', color: colors.ink }}>{`${o.p.brand} · ${o.p.code}`}</Text>
        <Muted numberOfLines={2}>{o.p.title}</Muted>
        <PriceTag level={o.p.priceLevel} />
        <WarningTags warnings={o.p.warnings} />
        {props.manual ? <Pill label="Picked by hand" tone={colors.blue} /> : null}
        {look ? <Text style={{ fontSize: 12, fontWeight: '700', color: look >= 0.58 ? colors.green : look >= 0.48 ? colors.amber : colors.muted }}>{`Picture: ${likeness(look)} (${Math.round(look * 100)} %)`}</Text> : null}
        <Muted style={{ fontSize: 12 }}>{[wattText(o.p), o.p.lm ? `${o.p.lm.toLocaleString('en-US')} lm${o.p.lmEst ? ' (est.)' : ''}` : '', cctText(o.p)].filter(Boolean).join(' · ')}</Muted>
      </View>
      {keys.map((p) => {
        const c = o.cells[p.key]!;
        const st = STATUS_STYLE[c.status];
        return (
          <View key={p.key} style={{ flexDirection: 'row', gap: 6, backgroundColor: st.bg, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 4 }}>
            <Text style={{ width: 70, fontSize: 11, fontWeight: '700', color: colors.muted }}>{p.label.replace(/ \(.*\)/, '')}</Text>
            <Text style={{ flex: 1, fontSize: 11, color: st.fg }}>{`${st.icon} ${c.value}${c.dev ? ` · ${c.dev}` : ''}`}</Text>
          </View>
        );
      })}
      {o.p.flag ? <Text style={{ fontSize: 11, color: colors.amber }}>{`⚠ ${o.p.flag}`}</Text> : null}
      {chosen && props.req ? (
        <View style={{ backgroundColor: '#EFF6FF', borderRadius: 6, padding: 6, gap: 2 }}>
          <Text style={{ fontSize: 11, color: '#1E3A8A' }}>{`Driver: ${props.req.driver}`}</Text>
          <Text style={{ fontSize: 11, color: '#1E3A8A' }}>{`LED chip: ${props.req.chip}`}</Text>
          <Text style={{ fontSize: 11, color: '#1E3A8A' }}>{`Certificates: ${certList(props.req).join(', ') || 'not required'}`}</Text>
          {canEdit ? <Text onPress={props.onReq} style={{ fontSize: 11, fontWeight: '700', color: colors.blue }}>Change driver / chip / certificates</Text> : null}
        </View>
      ) : null}
      {props.dropping ? <Text style={{ fontSize: 12, fontWeight: '700', color: colors.red }}>Dropped – press Find the next below</Text> : null}
      {canEdit ? (
        <Row gap={6}>
          <View style={{ flex: 1 }}><Button variant={chosen ? 'primary' : 'secondary'} title={chosen ? 'Chosen ✓' : 'Choose this'} onPress={onChoose} /></View>
          {chosen ? null : <Button variant={props.dropping ? 'danger' : 'ghost'} title={props.dropping ? 'Undo' : 'Drop'} onPress={props.onDrop} />}
        </Row>
      ) : chosen ? <Pill label="Chosen" tone={colors.blue} /> : null}
    </Card>
  );
}

/** Picking a product by hand: search the whole catalogue for a line the automatic options do not fit */
function ManualPick({ all, line, onPick, onClose }: { all: Fixture[]; line: BoqLine; onPick: (p: Fixture) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const hits = useMemo(() => (q.trim() ? searchFixtures(all, q, {}).slice(0, 40) : []), [all, q]);
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(17,24,39,0.45)', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <Card style={{ width: '100%', maxWidth: 760, maxHeight: '92%', gap: 8 }}>
          <Text style={{ fontSize: 16, fontWeight: '800', color: colors.ink }}>{`Pick a product by hand – line ${line.item || line.row + 1}`}</Text>
          <Muted numberOfLines={2}>{line.desc}</Muted>
          <Field label="Search the catalogue" value={q} onChangeText={setQ} placeholder="Code, name or values – e.g. BP-6060, pendant 20w 3000k" autoCapitalize="none" />
          <ScrollView style={{ maxHeight: 460 }}>
            {q.trim() && !hits.length ? <Muted>Nothing found – try fewer words.</Muted> : null}
            {hits.map((p) => (
              <Pressable key={p.id} onPress={() => onPick(p)} style={{ flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderColor: colors.line }}>
                <Thumb p={p} size={52} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ fontWeight: '700', color: colors.ink }}>{`${p.brand} ${p.code}`}</Text>
                  <Muted numberOfLines={1}>{`${p.type} · ${p.title}`}</Muted>
                  <Text style={{ fontSize: 12, color: colors.text }}>{[wattText(p), p.lm ? `${p.lm.toLocaleString('en-US')} lm` : '', cctText(p), p.ip ? `IP${p.ip}` : ''].filter(Boolean).join(' · ')}</Text>
                  <WarningTags warnings={p.warnings} still />
                </View>
                <PriceTag level={p.priceLevel} />
              </Pressable>
            ))}
          </ScrollView>
          <Button variant="secondary" title="Close" onPress={onClose} />
        </Card>
      </View>
    </Modal>
  );
}
