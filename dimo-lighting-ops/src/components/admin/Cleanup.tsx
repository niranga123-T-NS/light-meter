import { useState } from 'react';
import { View } from 'react-native';
import { DataTable } from '@/components/DataTable';
import { useDialog } from '@/components/dialog';
import { Button, colors, ErrorBanner, Field, Loading, Muted, Notice, Pill, Row, Section, Segmented } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { fmtDate } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { ROLE_LABELS } from '@/lib/roles';
import { callFunction, supabase } from '@/lib/supabase';

type Kind = 'project' | 'inquiry' | 'secured' | 'exec' | 'invoice' | 'sub_invoice' | 'lo_invoice' | 'user';
type Sub = 'project' | 'inquiry' | 'secured' | 'exec' | 'invoices' | 'user' | 'log';
type Item = { kind: Kind; id: string; title: string; sub: string; status: string | null; when: string | null };
type Result = { counts: { table: string; rows: number }[]; labels: { kind: string; label: string }[]; files: number | string[]; total: number };

const KIND_NAME: Record<Kind, string> = {
  project: 'project',
  inquiry: 'inquiry',
  secured: 'secured project',
  exec: 'execution project',
  invoice: 'invoice',
  sub_invoice: 'subcontractor invoice',
  lo_invoice: 'local order invoice',
  user: 'user',
};
const LABEL_KIND: Record<string, string> = { projects: 'Projects', inquiries: 'Inquiries', secured_projects: 'Secured projects', exec_projects: 'Execution projects', profiles: 'Users' };
/** "exec_reports" → "Exec reports" */
const tableLabel = (t: string) => (t.charAt(0).toUpperCase() + t.slice(1)).replace(/_/g, ' ');

/** DGM: delete test (dummy) projects, inquiries, secured and execution projects, invoices and users for good, with
 *  everything that hangs off them. Each delete is previewed first (exactly what would go), then confirmed by typing DELETE. */
export function Cleanup() {
  const me = useMe();
  const dialog = useDialog();
  const [sub, setSub] = useState<Sub>('project');
  const [q, setQ] = useState('');
  const { data, error, reload } = useLoad(async () => {
    const [p, i, s, e, ia, si, li, u, log] = await Promise.all([
      supabase.from('projects').select('id, code, name, stage, status, created_at').order('created_at', { ascending: false }),
      supabase.from('inquiries').select('id, code, project_name, customer_name, status, created_at').order('created_at', { ascending: false }),
      supabase.from('secured_projects').select('id, code, project_name, customer, status, created_at').order('created_at', { ascending: false }),
      supabase.from('exec_projects').select('id, code, name, client_name, status, created_at').order('created_at', { ascending: false }),
      supabase.from('invoice_allocations').select('id, invoice_no, invoice_date, amount, note, created_at, secured_projects(code, project_name)').order('id', { ascending: false }),
      supabase.from('sub_invoices').select('id, code, invoice_no, subcontractor, amount, status, created_at').order('created_at', { ascending: false }),
      supabase.from('lo_invoices').select('id, invoice_no, invoice_date, amount, status, added_at').order('added_at', { ascending: false }),
      supabase.from('profiles').select('id, full_name, email, role, active, is_temporary, company, created_at').order('full_name'),
      supabase.from('purge_log').select('*').order('done_at', { ascending: false }).limit(200),
    ]);
    if (p.error) throw new Error(p.error.message);
    const money = (n: unknown) => (n == null ? '' : `LKR ${Math.round(Number(n)).toLocaleString('en-US')}`);
    type R = Record<string, unknown>;
    const rows = (x: { data: unknown }) => (x.data ?? []) as R[];
    const str = (v: unknown) => (v == null ? '' : String(v));
    return {
      project: rows(p).map((r): Item => ({ kind: 'project', id: str(r.id), title: str(r.name), sub: str(r.code), status: [r.stage, r.status].filter(Boolean).join(' · '), when: str(r.created_at) })),
      inquiry: rows(i).map((r): Item => ({ kind: 'inquiry', id: str(r.id), title: str(r.project_name) || str(r.code), sub: [r.code, r.customer_name].filter(Boolean).join(' · '), status: str(r.status), when: str(r.created_at) })),
      secured: rows(s).map((r): Item => ({ kind: 'secured', id: str(r.id), title: str(r.project_name), sub: [r.code, r.customer].filter(Boolean).join(' · '), status: str(r.status), when: str(r.created_at) })),
      exec: rows(e).map((r): Item => ({ kind: 'exec', id: str(r.id), title: str(r.name), sub: [r.code, r.client_name].filter(Boolean).join(' · '), status: str(r.status), when: str(r.created_at) })),
      invoices: [
        ...rows(ia).map((r): Item => {
          const sp = (r.secured_projects ?? {}) as R;
          return { kind: 'invoice', id: str(r.id), title: `Invoice ${str(r.invoice_no) || '(no number)'} · ${money(r.amount)}`, sub: [sp.code, sp.project_name].filter(Boolean).join(' · '), status: 'Project invoice', when: str(r.invoice_date || r.created_at) };
        }),
        ...rows(si).map((r): Item => ({ kind: 'sub_invoice', id: str(r.id), title: `${str(r.code)} · ${str(r.invoice_no)} · ${money(r.amount)}`, sub: str(r.subcontractor), status: `Subcontractor · ${str(r.status)}`, when: str(r.created_at) })),
        ...rows(li).map((r): Item => ({ kind: 'lo_invoice', id: str(r.id), title: `Invoice ${str(r.invoice_no)} · ${money(r.amount)}`, sub: '', status: `Local order · ${str(r.status)}`, when: str(r.invoice_date || r.added_at) })),
      ],
      user: rows(u)
        .filter((r) => !['gm', 'sys_admin'].includes(str(r.role)) && r.id !== me.id)
        .map((r): Item => ({
          kind: 'user',
          id: str(r.id),
          title: str(r.full_name),
          sub: [r.email, r.company].filter(Boolean).join(' · '),
          status: [ROLE_LABELS[str(r.role) as keyof typeof ROLE_LABELS] ?? str(r.role), r.is_temporary ? 'temporary' : null, r.active ? null : 'deactivated'].filter(Boolean).join(' · '),
          when: str(r.created_at),
        })),
      log: rows(log),
    };
  }, []);
  if (me.role !== 'gm') return <Notice>Only the DGM deletes records.</Notice>;
  if (!data) return error ? <ErrorBanner message={error} /> : <Loading />;

  const del = async (it: Item) => {
    const name = KIND_NAME[it.kind];
    let pre: Result | null = null;
    await dialog.run(async () => {
      const { data: r, error: e } = await supabase.rpc('admin_purge', { p_kind: it.kind, p_id: it.id, p_confirm: false });
      if (e) throw new Error(e.message);
      pre = r as Result;
    });
    if (!pre) return;
    const p = pre as Result;
    const names = Object.entries(
      p.labels.reduce<Record<string, string[]>>((acc, l) => {
        (acc[l.kind] ??= []).push(l.label);
        return acc;
      }, {}),
    )
      .map(([k, v]) => `${LABEL_KIND[k] ?? k} (${v.length}): ${v.slice(0, 12).join('; ')}${v.length > 12 ? ` and ${v.length - 12} more` : ''}`)
      .join('\n');
    const top = p.counts
      .slice(0, 14)
      .map((c) => `${tableLabel(c.table)}: ${c.rows}`)
      .join(' · ');
    const r = await dialog.prompt({
      title: `Delete ${name} – ${it.title}`,
      message: `This deletes ${p.total} records for good, from every list and report – it cannot be undone.\n\n${names ? `${names}\n\n` : ''}${top}${p.counts.length > 14 ? ` · and ${p.counts.length - 14} more kinds` : ''}${Number(p.files) ? `\n\n${p.files} attached file(s) are removed from storage.` : ''}${it.kind === 'user' ? '\n\nTheir login is removed too.' : ''}`,
      fields: [{ key: 'ok', label: 'Type DELETE to confirm', required: true }],
      confirmLabel: 'Delete for good',
    });
    if (!r) return;
    if (r.ok.trim() !== 'DELETE') return dialog.toast('Not deleted – type DELETE in capitals to confirm', 'error');
    await dialog.run(async () => {
      const { data: done, error: e } = await supabase.rpc('admin_purge', { p_kind: it.kind, p_id: it.id, p_confirm: true });
      if (e) throw new Error(e.message);
      const files = ((done as Result).files ?? []) as string[];
      if (files.length) await callFunction('admin-users', { action: 'purge_files', paths: files });
      if (it.kind === 'user') await callFunction('admin-users', { action: 'delete_login', user_id: it.id });
      await reload();
    }, `Deleted – ${p.total} records`);
  };

  const s = q.trim().toLowerCase();
  const list = sub === 'log' ? [] : (data[sub] as Item[]).filter((x) => !s || `${x.title} ${x.sub} ${x.status}`.toLowerCase().includes(s));
  const count = (k: Exclude<Sub, 'log'>) => (data[k] as Item[]).length;

  return (
    <View style={{ gap: 10 }}>
      <Notice tone={colors.red}>
        For test (dummy) records only. A delete removes the record and everything linked to it – inquiries, quotations, design and estimation jobs, secured
        and execution records, orders, invoices, approvals, alerts and files – from every person’s lists, for good. Each delete shows exactly what will go
        before you confirm. Real records: archive, close or deactivate them instead.
      </Notice>
      <Segmented
        value={sub}
        onChange={(v) => {
          setSub(v);
          setQ('');
        }}
        options={[
          { value: 'project', label: `Projects (${count('project')})` },
          { value: 'inquiry', label: `Inquiries (${count('inquiry')})` },
          { value: 'secured', label: `Secured (${count('secured')})` },
          { value: 'exec', label: `Execution (${count('exec')})` },
          { value: 'invoices', label: `Invoices (${count('invoices')})` },
          { value: 'user', label: `Users (${count('user')})` },
          { value: 'log', label: 'Deleted log' },
        ]}
      />
      {sub === 'log' ? (
        <Section title="Deleted by the clean-up">
          <DataTable
            rows={data.log}
            keyOf={(l) => String(l.id)}
            emptyTitle="Nothing deleted yet"
            columns={[
              { h: 'When', w: 110, v: (l) => fmtDate(String(l.done_at)) },
              { h: 'What', w: 140, v: (l) => KIND_NAME[l.kind as Kind] ?? String(l.kind) },
              { h: 'Name', w: 300, grow: true, v: (l) => String(l.label ?? '') },
              { h: 'Records', w: 90, right: true, v: (l) => String(((l.counts ?? []) as { rows: number }[]).reduce((t, c) => t + c.rows, 0)) },
              { h: 'Files', w: 60, right: true, v: (l) => String(l.files ?? 0) },
            ]}
          />
        </Section>
      ) : (
        <>
          <Field label="Search" value={q} onChangeText={setQ} placeholder="Name, code, customer or e-mail" />
          {sub === 'user' ? <Muted>Includes temporary staff and subcontractor logins. DGM and System Administrator logins are not listed. Deleting a user also deletes everything they created or own (shown before you confirm); to keep a real person’s work, deactivate them in Users instead.</Muted> : null}
          {sub === 'project' ? <Muted>A project takes its inquiries, secured and execution records with it.</Muted> : null}
          <DataTable
            rows={list}
            keyOf={(x) => `${x.kind}-${x.id}`}
            emptyTitle="Nothing here"
            columns={[
              { h: 'Name', w: 300, grow: true, v: (x) => `${x.title || '—'}${x.sub ? `\n${x.sub}` : ''}` },
              { h: 'Status', w: 200, v: (x) => (x.status ? <Pill label={x.status} tone={colors.grey} /> : '') },
              { h: 'Added', w: 100, v: (x) => (x.when ? fmtDate(x.when) : '') },
              { h: '', w: 110, v: (x) => <Row><Button small variant="ghost" title="Delete…" onPress={() => del(x)} /></Row> },
            ]}
          />
        </>
      )}
    </View>
  );
}
