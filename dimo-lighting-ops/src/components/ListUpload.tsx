import { useState } from 'react';
import { Text, View } from 'react-native';
import { useDialog } from './dialog';
import { Button, Card, colors, ErrorBanner, Muted, Notice, Pill, Row } from './ui';
import { pickDocument } from '@/lib/files';
import type { ListRow } from '@/lib/finance';

type Check = { row_no: number; errors: string[]; warnings: string[] };

/**
 * Excel list upload: read the file → check every row on the server → preview errors and warnings → save.
 * Rows with errors block the save; fix them in the file and choose it again.
 */
export function ListUpload({
  intro,
  read,
  check,
  save,
  describe,
  onTemplate,
  onSaved,
  saveLabel,
}: {
  intro: string;
  read: (file: NonNullable<Awaited<ReturnType<typeof pickDocument>>>) => Promise<{ rows: ListRow[]; problems: string[] }>;
  check: (rows: ListRow[]) => Promise<Check[]>;
  save: (rows: ListRow[]) => Promise<unknown>;
  describe: (row: ListRow) => string;
  onTemplate: () => Promise<void>;
  onSaved: () => void;
  saveLabel: string;
}) {
  const dialog = useDialog();
  const [state, setState] = useState<{ rows: ListRow[]; checks: Check[]; problems: string[]; file: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const choose = async () => {
    setError(null);
    const file = await pickDocument();
    if (!file) return;
    await dialog.run(async () => {
      const { rows, problems } = await read(file);
      if (!rows.length) throw new Error('No rows found under the headings');
      const checks = await check(rows);
      setState({ rows, checks, problems, file: file.name });
    });
  };
  const errors = state?.checks.filter((c) => c.errors.length) ?? [];
  const warnings = state?.checks.filter((c) => !c.errors.length && c.warnings.length) ?? [];
  const blocked = errors.length > 0 || (state?.problems.length ?? 0) > 0;

  return (
    <Card>
      <ErrorBanner message={error} />
      <Muted>{intro}</Muted>
      <Row wrap gap={8}>
        <Button title="Choose Excel file" icon="⇪" onPress={choose} />
        <Button variant="secondary" title="Download template" onPress={() => dialog.run(onTemplate)} />
      </Row>
      {state ? (
        <View style={{ gap: 8, marginTop: 8 }}>
          <Row wrap gap={6}>
            <Pill label={`${state.file} · ${state.rows.length} rows`} />
            <Pill label={`${state.rows.length - errors.length} OK`} tone={colors.green} />
            {warnings.length ? <Pill label={`${warnings.length} with notes`} tone={colors.amber} /> : null}
            {errors.length ? <Pill label={`${errors.length} need fixing`} tone={colors.red} /> : null}
          </Row>
          {state.problems.map((p) => (
            <Text key={p} style={{ color: colors.red }}>
              {p}
            </Text>
          ))}
          {state.checks
            .filter((c) => c.errors.length || c.warnings.length)
            .map((c) => {
              const row = state.rows.find((r) => r.row_no === c.row_no);
              return (
                <View key={c.row_no} style={{ borderLeftWidth: 4, borderLeftColor: c.errors.length ? colors.red : colors.amber, paddingLeft: 8, paddingVertical: 2 }}>
                  <Text style={{ fontWeight: '600', color: colors.ink }}>
                    Row {c.row_no} · {row ? describe(row) : ''}
                  </Text>
                  {c.errors.map((e) => (
                    <Text key={e} style={{ color: colors.red }}>
                      {e}
                    </Text>
                  ))}
                  {c.warnings.map((w) => (
                    <Muted key={w}>{w}</Muted>
                  ))}
                </View>
              );
            })}
          {blocked ? (
            <Notice tone={colors.red}>Fix the rows in red in the Excel file and choose it again. Nothing has been saved.</Notice>
          ) : (
            <Row wrap gap={8}>
              <Button
                title={saveLabel}
                onPress={() =>
                  dialog.run(async () => {
                    await save(state.rows);
                    setState(null);
                    onSaved();
                  }, 'Saved')
                }
              />
              <Button variant="secondary" title="Cancel" onPress={() => setState(null)} />
            </Row>
          )}
        </View>
      ) : null}
    </Card>
  );
}
