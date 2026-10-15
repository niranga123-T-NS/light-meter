import { DataTable } from '@/components/DataTable';
import { ErrorBanner, Loading, Muted } from '@/components/ui';
import { fmtDate } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { ROLE_LABELS } from '@/lib/roles';
import { rpc } from '@/lib/supabase';
import type { AcademyMember } from '@/lib/academy';
import type { Role } from '@/lib/types';

/** Lighting Academy – who has done which part (SM Projects, GM / DGM, System Administrator) */
export function AcademyTeam({ total }: { total: number }) {
  const { data, error } = useLoad(() => rpc<AcademyMember[]>('academy_team'), []);
  if (!data) return error ? <ErrorBanner message={error} /> : <Loading />;
  return (
    <>
      <Muted>{`Lessons completed (2 of 3 or better in the quick check) out of ${total}. Average = the best score per lesson tried.`}</Muted>
      <DataTable
        rows={data}
        keyOf={(r) => r.user_id}
        emptyTitle="Nobody yet"
        columns={[
          { h: 'Name', w: 200, grow: true, v: (r) => `${r.full_name}\n${ROLE_LABELS[r.role as Role] ?? r.role}` },
          { h: 'Lessons done', w: 120, right: true, v: (r) => `${r.lessons_done} / ${total}` },
          { h: 'Progress', w: 90, right: true, v: (r) => `${Math.round((100 * r.lessons_done) / total)}%` },
          { h: 'Average score', w: 110, right: true, v: (r) => (r.avg_best != null ? `${r.avg_best}%` : '—') },
          { h: 'Tries', w: 70, right: true, v: (r) => String(r.attempts) },
          { h: 'Last activity', w: 110, v: (r) => (r.last_at ? fmtDate(r.last_at) : '—') },
        ]}
      />
    </>
  );
}
