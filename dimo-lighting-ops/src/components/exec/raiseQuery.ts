import type { useDialog } from '@/components/dialog';
import type { ExecProject } from '@/lib/execution';
import { rpc } from '@/lib/supabase';

/** Prompt for a design query (project chosen when not given) and raise it; returns the new id. */
export async function raiseQuery(dialog: ReturnType<typeof useDialog>, projects: ExecProject[], project?: string) {
  const res = await dialog.prompt({
    title: 'Design query',
    message: 'The Senior Electrical Engineer screens it and sends it to the Design Manager with a target date.',
    fields: [
      ...(project ? [] : [{ key: 'p', label: 'Project', type: 'select' as const, required: true, options: projects.map((p) => ({ value: p.id, label: `${p.code ?? ''} ${p.name}` })) }]),
      { key: 'q', label: 'Question', type: 'multiline', required: true },
      { key: 'd', label: 'Drawing / document reference' },
      { key: 'b', label: 'Work it holds up' },
    ],
    confirmLabel: 'Raise',
  });
  if (!res) return null;
  let id: string | null = null;
  await dialog.run(async () => {
    id = await rpc<string>('raise_design_query', { p_exec: project ?? res.p, p_question: res.q, p_drawing: res.d || null, p_blocks: res.b || null });
  }, 'Raised');
  return id;
}
