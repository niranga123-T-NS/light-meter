import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { TestingBanner } from '@/components/Testing';
import { Card, colors, ErrorBanner, Loading, Muted, Notice, Pill, Row, Screen, Section, Segmented } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { CHECKS, DISC, KINDS, PTYPES, type Check, type Disc, type Reading } from '@/lib/drawings';
import { fmtDateTime } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';

type Row_ = { exec_project_id: string | null; kind: string; checks: Check[]; readings: Reading[]; updated_by: string | null; updated_at: string };

const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24) || 'check';

/** One line per check; readings as "Label | unit". Keys are kept for unchanged labels so ticks already given stay. */
function parse(text: string, old: [string, string, ...string[]][], reading: boolean) {
  const used = new Set<string>();
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [label, unit] = reading ? l.split('|').map((x) => x.trim()) : [l, ''];
      let key = old.find((o) => o[1].toLowerCase() === label.toLowerCase())?.[0] ?? slug(label);
      while (used.has(key)) key = `${key}_2`;
      used.add(key);
      return reading ? [key, label, unit ?? ''] : [key, label];
    });
}

/**
 * Check templates (SEE): the checks and readings of each item type and DB component – for the company, or for one project
 * (e.g. the consultant's own checklist). New items take them; items not yet tested can be brought in line.
 */
export default function Templates() {
  const { project } = useLocalSearchParams<{ project?: string }>();
  const me = useMe();
  const dialog = useDialog();
  const people = usePeople();
  const [scope, setScope] = useState<'company' | 'project'>(project ? 'project' : 'company');
  const { data, error, reload } = useLoad(async () => {
    const [t, pj] = await Promise.all([
      supabase.from('exec_check_templates').select('*').or(project ? `exec_project_id.is.null,exec_project_id.eq.${project}` : 'exec_project_id.is.null'),
      project ? supabase.from('exec_projects').select('code, name').eq('id', project).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    if (t.error) throw new Error(t.error.message);
    return { rows: (t.data ?? []) as Row_[], project: pj.data as { code: string | null; name: string } | null };
  }, [project]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const canEdit = me.role === 'senior_elec_engineer';
  const target = scope === 'project' && project ? project : null;
  const company = (k: string) => data.rows.find((r) => !r.exec_project_id && r.kind === k);
  const mine = (k: string) => data.rows.find((r) => r.exec_project_id === project && r.kind === k);
  // what is in force for the chosen scope, and where it comes from
  const current = (k: string): { checks: Check[]; readings: Reading[]; from: 'project' | 'company' | 'built-in' } => {
    const pr = target ? mine(k) : undefined, co = company(k);
    if (pr) return { checks: pr.checks, readings: pr.readings, from: 'project' };
    if (co) return { checks: co.checks, readings: co.readings, from: 'company' };
    const b = k.startsWith('part:') ? (PTYPES[k.slice(5)] ? [PTYPES[k.slice(5)].checks, PTYPES[k.slice(5)].readings] : [[], []]) : (CHECKS[k] ?? [[], []]);
    return { checks: b[0] as Check[], readings: b[1] as Reading[], from: 'built-in' };
  };

  const edit = async (k: string, name: string) => {
    const cur = current(k);
    const own = target ? mine(k) : company(k);
    const v = await dialog.prompt({
      title: `${name} – ${target ? `this project (${data.project?.code ?? ''})` : 'company template'}`,
      message: 'One check per line. Readings as “Label | unit”, one per line. Tested / Commissioned needs every check ticked.',
      fields: [
        { key: 'c', label: 'Checks', type: 'multiline', required: true, initial: cur.checks.map((c) => c[1]).join('\n') },
        { key: 'r', label: 'Readings (Label | unit)', type: 'multiline', initial: cur.readings.map((r) => `${r[1]}${r[2] ? ` | ${r[2]}` : ''}`).join('\n') },
        {
          key: 'apply',
          label: 'Items already on the drawings',
          type: 'select',
          required: true,
          initial: 'new',
          options: [
            { value: 'new', label: 'Only new items take it' },
            { value: 'apply', label: 'Also items not yet tested (ticks kept for checks that stay)' },
          ],
        },
        ...(own ? [{ key: 'reset', label: 'Or go back', type: 'select' as const, initial: 'keep', options: [{ value: 'keep', label: 'Keep this template' }, { value: 'reset', label: target ? 'Remove – use the company template' : 'Remove – use the built-in checks' }] }] : []),
      ],
    });
    if (!v) return;
    if (v.reset === 'reset') {
      await dialog.run(async () => {
        await rpc('drawing_template_delete', { p_project: target, p_kind: k });
        await reload();
      }, 'Template removed');
      return;
    }
    const checks = parse(v.c, cur.checks as [string, string][], false);
    const readings = parse(v.r ?? '', cur.readings as [string, string, string][], true);
    if (!checks.length) return dialog.toast('At least one check', 'error');
    await dialog.run(async () => {
      const n = await rpc<number>('drawing_template_save', { p_project: target, p_kind: k, p_checks: checks, p_readings: readings, p_apply: v.apply === 'apply' });
      await reload();
      dialog.toast(v.apply === 'apply' ? `Saved – ${n} item(s) brought in line` : 'Saved – new items take it');
    });
  };

  const row = (k: string, name: string) => {
    const cur = current(k), own = cur.from === (target ? 'project' : 'company') ? (target ? mine(k) : company(k)) : undefined;
    return (
      <Pressable key={k} disabled={!canEdit} onPress={() => edit(k, name)} style={{ paddingVertical: 8, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: colors.line, gap: 2 }}>
        <Row style={{ justifyContent: 'space-between' }} wrap>
          <Text style={{ color: colors.ink, fontWeight: '600', flexShrink: 1 }}>{name}</Text>
          <Pill label={cur.from === 'project' ? 'This project' : cur.from === 'company' ? 'Company template' : 'Built-in'} tone={cur.from === 'built-in' ? colors.grey : cur.from === 'company' ? colors.blue : colors.green} />
        </Row>
        <Muted numberOfLines={2}>{`${cur.checks.length} checks: ${cur.checks.map((c) => c[1]).join(' · ')}${cur.readings.length ? ` · readings: ${cur.readings.map((r) => r[1]).join(', ')}` : ''}`}</Muted>
        {own ? <Muted>{`${people[own.updated_by ?? '']?.full_name ?? ''} · ${fmtDateTime(own.updated_at)}`}</Muted> : null}
      </Pressable>
    );
  };

  const discs = Object.keys(DISC) as Disc[];
  return (
    <Screen maxWidth={900}>
      <Stack.Screen options={{ title: 'Check templates' }} />
      <TestingBanner what="Smart drawings" show />
      <Card style={{ gap: 6 }}>
        <Muted>
          The checks and readings the site team ticks for each item and DB component. The company template applies to every project; a project can have its
          own (for example the consultant&apos;s checklist).
        </Muted>
        {project ? (
          <Segmented<'company' | 'project'>
            value={scope}
            onChange={setScope}
            options={[
              { value: 'project', label: `This project${data.project?.code ? ` (${data.project.code})` : ''}` },
              { value: 'company', label: 'Company' },
            ]}
          />
        ) : null}
        {!canEdit ? <Notice>Only the Senior Electrical Engineer changes the templates.</Notice> : null}
      </Card>
      {discs.map((d) => {
        const kinds = Object.entries(KINDS).filter(([k, v]) => v.d === d && (CHECKS[k] || company(k) || mine(k)));
        if (!kinds.length) return null;
        return (
          <Section key={d} title={DISC[d].name}>
            <Card style={{ padding: 0, overflow: 'hidden' }}>{kinds.map(([k, v]) => row(k, v.name))}</Card>
          </Section>
        );
      })}
      <Section title="DB components">
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <View>{Object.entries(PTYPES).map(([k, v]) => row(`part:${k}`, v.name))}</View>
        </Card>
      </Section>
    </Screen>
  );
}
