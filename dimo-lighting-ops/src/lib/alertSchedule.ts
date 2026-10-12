// Alert schedules: the scheduler keeps 5-field schedules in UTC; people see and set them in Sri Lanka time (UTC+5:30)

export type AlertJob = {
  job: string;
  area: string;
  title: string;
  description: string;
  recipients: string | null;
  default_schedule: string;
  schedule: string | null;
  active: boolean | null;
  scheduled: boolean;
  changed_by: string | null;
  changed_at: string | null;
  last_run: { at: string; status: string } | null;
};
export type Freq = 'minutes' | 'hourly' | 'daily';
export type Plan = { freq: Freq; every: number; minute: number; time: string; days: string };

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const OFFSET = 330; // minutes ahead of UTC

/** "1-5" / "0,1" / "*" → day numbers */
function expand(dow: string): number[] {
  if (dow === '*') return [0, 1, 2, 3, 4, 5, 6];
  return [...new Set(dow.split(',').flatMap((p) => {
    const [a, b] = p.split('-').map(Number);
    return Number.isFinite(b) ? Array.from({ length: b - a + 1 }, (_, i) => (a + i) % 7) : [a % 7];
  }))].sort((x, y) => x - y);
}
function compress(days: number[]): string {
  const d = [...new Set(days.map((x) => ((x % 7) + 7) % 7))].sort((x, y) => x - y);
  if (d.length === 7) return '*';
  const out: string[] = [];
  for (let i = 0; i < d.length; i++) {
    let j = i;
    while (j + 1 < d.length && d[j + 1] === d[j] + 1) j++;
    out.push(j - i >= 2 ? `${d[i]}-${d[j]}` : d.slice(i, j + 1).join(','));
    i = j;
  }
  return out.join(',');
}
export const daysLabel = (dow: string) => {
  const d = expand(dow);
  if (d.length === 7) return 'every day';
  if (compress(d) === '1-5') return 'Monday – Friday';
  if (compress(d) === '1-6') return 'Monday – Saturday';
  return d.map((x) => DAY[x]).join(', ');
};
const pad = (n: number) => String(n).padStart(2, '0');

/** A UTC schedule as a plan in Sri Lanka time – null when it is not one of the simple forms */
export function toPlan(cron: string | null): Plan | null {
  if (!cron) return null;
  const f = cron.trim().split(/\s+/);
  if (f.length !== 5 || f[2] !== '*' || f[3] !== '*') return null;
  const [m, h, , , dow] = f;
  const ev = /^\*\/(\d+)$/.exec(m);
  if (ev && h === '*') return { freq: 'minutes', every: Number(ev[1]), minute: 0, time: '09:00', days: dow };
  if (/^\d+$/.test(m) && h === '*') return { freq: 'hourly', every: 60, minute: (Number(m) + 30) % 60, time: '09:00', days: dow };
  if (/^\d+$/.test(m) && /^\d+$/.test(h)) {
    const t = Number(h) * 60 + Number(m) + OFFSET;
    const shift = t >= 1440 ? 1 : 0;
    const local = t % 1440;
    return { freq: 'daily', every: 1440, minute: 0, time: `${pad(Math.floor(local / 60))}:${pad(local % 60)}`, days: dow === '*' ? '*' : compress(expand(dow).map((x) => x + shift)) };
  }
  return null;
}

/** A plan in Sri Lanka time as the UTC schedule */
export function toCron(p: Plan): string {
  if (p.freq === 'minutes') return `*/${p.every} * * * ${p.days}`;
  if (p.freq === 'hourly') return `${(p.minute + 30) % 60} * * * ${p.days}`;
  const [hh, mm] = p.time.split(':').map(Number);
  let t = hh * 60 + mm - OFFSET;
  let shift = 0;
  if (t < 0) {
    t += 1440;
    shift = -1;
  }
  return `${t % 60} ${Math.floor(t / 60)} * * ${p.days === '*' ? '*' : compress(expand(p.days).map((x) => x + shift))}`;
}

/** In plain words, in Sri Lanka time */
export function describe(cron: string | null): string {
  if (!cron) return 'Not scheduled';
  const p = toPlan(cron);
  if (!p) return `Custom (${cron} UTC)`;
  const days = p.days === '*' ? '' : `, ${daysLabel(p.days)}`;
  if (p.freq === 'minutes') return `Every ${p.every} minutes${days}`;
  if (p.freq === 'hourly') return `Every hour at :${pad(p.minute)}${days}`;
  return `${p.days === '*' ? 'Daily' : daysLabel(p.days)} at ${p.time}`;
}

export const DAY_OPTIONS = [
  { value: '*', label: 'Every day' },
  { value: '1-5', label: 'Monday – Friday' },
  { value: '1-6', label: 'Monday – Saturday' },
  ...DAY.map((d, i) => ({ value: String(i), label: `${d} only` })),
];
