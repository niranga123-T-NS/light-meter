import { Muted, Notice } from '@/components/ui';
import { fmtDateTime } from '@/lib/format';
import type { RouteMapProps } from './RouteMap.types';

/** The route map is in the web app; the phone apps show the route as a list. */
export function RouteMap(p: RouteMapProps) {
  const last = [...p.positions].sort((a, b) => b.at.localeCompare(a.at))[0];
  return (
    <>
      <Notice>The route map is in the web app – open dimo-lighting-ops.vercel.app in a browser.</Notice>
      <Muted>
        {[
          ...p.factories.map((f) => `Factory${f.location ? ` (${f.location})` : ''}`),
          p.pol,
          ...p.vias,
          p.pod,
          p.site ? `Site: ${p.site}` : null,
        ]
          .filter(Boolean)
          .join(' → ')}
      </Muted>
      {last ? <Muted>{`Last known position: ${last.place} · ${fmtDateTime(last.at)}`}</Muted> : null}
    </>
  );
}
