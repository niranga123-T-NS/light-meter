// On-demand Excel export: the server returns the rows the user may see
// (export_dataset, which also logs the export), and the workbook is built
// on the device with the same code the scheduled export uses.
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { buildExportWorkbook, exportFileName, type ExportDataset } from '@shared/workbook.ts';

import { cacheStore } from './cache';
import { writeTempFile } from './files';
import { supabase, unwrap } from './supabase';
import type { ReportFilters } from './types';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function clean(filters: ReportFilters): Record<string, string> {
  return Object.fromEntries(Object.entries(filters).filter(([, v]) => !!v)) as Record<string, string>;
}

export function filterLabels(filters: ReportFilters): Record<string, string> {
  const c = cacheStore.get();
  return {
    owner_id: filters.owner_id ? c.profiles.find((p) => p.id === filters.owner_id)?.full_name ?? filters.owner_id : 'All',
    territory_id: filters.territory_id ? c.territories.find((t) => t.id === filters.territory_id)?.name ?? filters.territory_id : 'All',
    stage_id: filters.stage_id ? c.stages.find((s) => s.id === filters.stage_id)?.name ?? filters.stage_id : 'All',
  };
}

export async function exportWorkbook(filters: ReportFilters, generatedByName: string): Promise<{ fileName: string; rows: Record<string, number> }> {
  const data = unwrap(await supabase.rpc('export_dataset', { f: clean(filters), p_channel: 'download' })) as ExportDataset;
  const bytes = buildExportWorkbook(data, { generatedByName, filterLabels: filterLabels(filters) });
  const fileName = exportFileName(data);
  if (Platform.OS === 'web') {
    const blob = new Blob([bytes as BlobPart], { type: XLSX_MIME });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } else {
    const uri = writeTempFile(fileName, bytes);
    await Sharing.shareAsync(uri, { mimeType: XLSX_MIME, UTI: 'org.openxmlformats.spreadsheetml.sheet', dialogTitle: fileName });
  }
  return { fileName, rows: data.row_counts };
}
