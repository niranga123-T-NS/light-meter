import { exportExcel, exportPdf } from './export';
import { fmtDate } from './format';
import { AGE_BANDS, type StockLine } from './stock';

type Row = Record<string, unknown>;

/** The ageing report: one line per material, quantity (and value where it can be seen) per age band */
export async function exportStock(kind: 'pdf' | 'excel', asAt: string, lines: StockLine[], values: boolean, filterText: string, generatedBy: string) {
  const col = (header: string, get: (l: StockLine) => unknown, align?: 'right') => ({ header, value: (r: Row) => get(r as unknown as StockLine) as string | number, align });
  const columns = [
    col('Material', (l) => l.material),
    col('Part no.', (l) => l.mpn ?? ''),
    col('Description', (l) => l.description ?? ''),
    col('Category', (l) => [l.category, l.sub_category].filter(Boolean).join(' › ')),
    col('Brand', (l) => l.brand ?? ''),
    col('UOM', (l) => l.uom ?? ''),
    col('Qty', (l) => l.qty, 'right'),
    ...(values ? [col('Value (LKR)', (l) => Math.round(Number(l.value ?? 0)), 'right')] : []),
    ...AGE_BANDS.map((b) => col(`${b.short} qty`, (l) => Number(l[`q${b.key}` as const]) || '', 'right')),
    ...(values ? AGE_BANDS.map((b) => col(`${b.short} LKR`, (l) => Math.round(Number(l[`v${b.key}` as const] ?? 0)) || '', 'right')) : []),
  ];
  const meta = {
    key: 'stock_ageing',
    title: `Stock ageing (SAP) as at ${fmtDate(asAt)}`,
    filters: filterText,
    generatedBy,
    landscape: true,
    paper: values ? ('A3' as const) : ('A4' as const),
  };
  const totals: Record<string, string | number> = { Material: `${lines.length} items`, Qty: lines.reduce((a, l) => a + Number(l.qty), 0) };
  if (values) totals['Value (LKR)'] = Math.round(lines.reduce((a, l) => a + Number(l.value ?? 0), 0));
  const sections = [{ rows: lines as unknown as Row[], totals }];
  return kind === 'pdf' ? exportPdf(meta, columns, sections) : exportExcel(meta, columns, sections);
}
