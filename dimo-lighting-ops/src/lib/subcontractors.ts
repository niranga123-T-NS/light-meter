import { supabase, rpc } from '@/lib/supabase';

/** A subcontractor on a project's register – every subcontractor field picks from it */
export type ExecSubcontractor = { id: string; exec_project_id: string; name: string; trade: string | null; contact_name: string | null; phone: string | null; email: string | null; active: boolean };

export async function loadSubcontractors(projectId: string) {
  const { data } = await supabase.from('exec_subcontractors').select('*').eq('exec_project_id', projectId).order('name');
  return (data ?? []) as ExecSubcontractor[];
}

/** Value of the “add a new one” choice in subcontractor dropdowns */
export const NEW_SUB = '__new_sub';

/** Dropdown options: the active register (plus a current value no longer on it), and “+ New subcontractor…” for who keeps the list */
export function subOptions(list: ExecSubcontractor[], opts: { current?: string | null; canAdd?: boolean } = {}) {
  const names = list.filter((s) => s.active).map((s) => s.name);
  const out = names.map((n) => ({ value: n, label: `${n}${list.find((s) => s.name === n)?.trade ? ` · ${list.find((s) => s.name === n)?.trade}` : ''}` }));
  if (opts.current && !names.some((n) => n.toLowerCase() === opts.current!.toLowerCase())) out.push({ value: opts.current, label: `${opts.current} (not on the list)` });
  if (opts.canAdd) out.push({ value: NEW_SUB, label: '+ New subcontractor…' });
  return out;
}

type Prompt = (o: { title: string; message?: string; fields: { key: string; label: string; required?: boolean }[]; confirmLabel?: string }) => Promise<Record<string, string> | null>;

/** Add a subcontractor to the project's register (asks for the name and trade); returns the name, or null if cancelled */
export async function addSubcontractor(prompt: Prompt, projectId: string): Promise<string | null> {
  const r = await prompt({
    title: 'New subcontractor on this project',
    fields: [
      { key: 'name', label: 'Company name', required: true },
      { key: 'trade', label: 'Trade / scope (e.g. Cabling, Mast erection)' },
      { key: 'contact_name', label: 'Contact person' },
      { key: 'phone', label: 'Phone' },
    ],
    confirmLabel: 'Add',
  });
  if (!r) return null;
  await rpc('save_exec_subcontractor', { p_exec: projectId, p: r });
  return r.name.trim();
}

/** Who keeps a project's subcontractor list */
export const canKeepSubs = (role: string) => role === 'senior_elec_engineer' || role === 'sm_projects' || role === 'assistant_engineer';
