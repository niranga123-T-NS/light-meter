import { budgetMonths, fyEnd, fyMonths, fyStart, LINES, type BusinessLine } from './finance';
import { fetchAll } from './mgmtReport';

// Company invoicing against the budget list – every business line and every budgeted project, with or without a sales
// person. Budget months follow the target rule: the project's invoice months, else its value spread evenly from its order
// month (April if none) to March. Invoiced = invoices recorded in the app (allocations), by the secured project's line.

export type LineInvoicing = { line: BusinessLine | 'none'; label: string; ytdBudget: number; ytdInvoiced: number; fyBudget: number; fyInvoiced: number };
export type CompanyInvoicing = {
  upTo: string;
  total: Omit<LineInvoicing, 'line' | 'label'>;
  lines: LineInvoicing[];
  /** Budget the sales targets leave out: projects with no sales person */
  noSalesPerson: { count: number; fyBudget: number; ytdBudget: number };
};

type Budget = { id: string; business_line: BusinessLine; sales_person_id: string | null; budget_value: number; order_month: string | null; budget_invoices: { month: string; amount: number }[] };

export async function companyInvoicing(fy: number, upTo: string): Promise<CompanyInvoicing> {
  const [b, a, s] = await Promise.all([
    fetchAll('budget_projects', 'id, business_line, sales_person_id, budget_value, order_month, budget_invoices(month, amount)', 'id', (q) => q.eq('fy', fy)),
    fetchAll('invoice_allocations', 'month, amount, secured_id', 'id', (q) => q.gte('month', fyStart(fy)).lte('month', fyEnd(fy))),
    fetchAll('secured_projects', 'id, business_line', 'id'),
  ]);
  for (const r of [b, a, s]) if (r.error) throw new Error(r.error.message);
  const months = fyMonths(fy);
  const ytd = new Set(months.filter((m) => m <= upTo));
  const lineOfSecured = new Map((s.data as { id: string; business_line: BusinessLine | null }[]).map((x) => [x.id, x.business_line]));
  const acc = new Map<string, LineInvoicing>();
  const row = (line: BusinessLine | 'none') => {
    if (!acc.has(line))
      acc.set(line, { line, label: LINES.find((l) => l.value === line)?.label ?? 'No business line', ytdBudget: 0, ytdInvoiced: 0, fyBudget: 0, fyInvoiced: 0 });
    return acc.get(line)!;
  };
  const noSp = { count: 0, fyBudget: 0, ytdBudget: 0 };
  for (const x of b.data as Budget[]) {
    const r = row(x.business_line ?? 'none');
    let fyB = 0;
    let ytdB = 0;
    for (const m of budgetMonths(x, fy)) {
      fyB += m.amount;
      if (ytd.has(m.month)) ytdB += m.amount;
    }
    r.fyBudget += fyB;
    r.ytdBudget += ytdB;
    if (!x.sales_person_id && fyB) {
      noSp.count++;
      noSp.fyBudget += fyB;
      noSp.ytdBudget += ytdB;
    }
  }
  for (const x of a.data as { month: string; amount: number; secured_id: string }[]) {
    const r = row(lineOfSecured.get(x.secured_id) ?? 'none');
    r.fyInvoiced += Number(x.amount);
    if (ytd.has(x.month.slice(0, 7) + '-01')) r.ytdInvoiced += Number(x.amount);
  }
  const lines = LINES.map((l) => acc.get(l.value)).filter((x): x is LineInvoicing => !!x).concat(acc.get('none') ?? []);
  const total = lines.reduce((t, l) => ({ ytdBudget: t.ytdBudget + l.ytdBudget, ytdInvoiced: t.ytdInvoiced + l.ytdInvoiced, fyBudget: t.fyBudget + l.fyBudget, fyInvoiced: t.fyInvoiced + l.fyInvoiced }), {
    ytdBudget: 0,
    ytdInvoiced: 0,
    fyBudget: 0,
    fyInvoiced: 0,
  });
  return { upTo, total, lines, noSalesPerson: noSp };
}
