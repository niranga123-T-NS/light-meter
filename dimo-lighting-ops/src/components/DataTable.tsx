import type { ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Card, colors, Empty, Row } from './ui';

export type Column<T> = {
  h: string;
  w: number;
  right?: boolean;
  /** Text, or any element */
  v: (row: T) => ReactNode;
  tone?: (row: T) => string | undefined;
  bold?: boolean;
};

/** A scrollable table for the desktop-style finance screens; rows can be pressed. */
export function DataTable<T>({
  columns,
  rows,
  keyOf,
  onPress,
  edge,
  emptyTitle = 'Nothing here',
  footer,
  rowStyle,
}: {
  columns: Column<T>[];
  rows: T[];
  keyOf: (row: T, i: number) => string;
  onPress?: (row: T) => void;
  edge?: (row: T) => string | undefined;
  emptyTitle?: string;
  footer?: (string | ReactNode)[];
  rowStyle?: (row: T) => object | undefined;
}) {
  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      <ScrollView horizontal>
        <View>
          <Row gap={0} style={{ backgroundColor: colors.bg, borderBottomWidth: 1, borderBottomColor: colors.line }}>
            {columns.map((c, ci) => (
              <Text key={`${c.h}${ci}`} style={[cell, { width: c.w, fontWeight: '700', textAlign: c.right ? 'right' : 'left', color: colors.muted }]}>
                {c.h}
              </Text>
            ))}
          </Row>
          {rows.map((r, i) => {
            const line = (
              <Row
                gap={0}
                style={[
                  { borderBottomWidth: 1, borderBottomColor: colors.line, borderLeftWidth: edge ? 4 : 0, borderLeftColor: edge?.(r) ?? 'transparent' },
                  rowStyle?.(r),
                ]}
              >
                {columns.map((c, ci) => {
                  const v = c.v(r);
                  return typeof v === 'string' || typeof v === 'number' || v == null ? (
                    <Text
                      key={`${c.h}${ci}`}
                      style={[cell, { width: c.w, textAlign: c.right ? 'right' : 'left', fontVariant: c.right ? ['tabular-nums'] : undefined }, c.bold && { fontWeight: '700' }, c.tone?.(r) ? { color: c.tone(r) } : null]}
                    >
                      {v ?? ''}
                    </Text>
                  ) : (
                    <View key={`${c.h}${ci}`} style={[cell, { width: c.w, overflow: 'hidden', alignItems: c.right ? 'flex-end' : 'flex-start' }]}>
                      {v}
                    </View>
                  );
                })}
              </Row>
            );
            return onPress ? (
              <Pressable key={keyOf(r, i)} onPress={() => onPress(r)} style={({ pressed }) => (pressed ? { backgroundColor: colors.soft } : null)}>
                {line}
              </Pressable>
            ) : (
              <View key={keyOf(r, i)}>{line}</View>
            );
          })}
          {footer && rows.length ? (
            <Row gap={0} style={{ backgroundColor: colors.soft, borderLeftWidth: edge ? 4 : 0, borderLeftColor: 'transparent' }}>
              {columns.map((c, i) => (
                <Text key={`${c.h}${i}`} style={[cell, { width: c.w, fontWeight: '700', textAlign: c.right ? 'right' : 'left', fontVariant: ['tabular-nums'] }]}>
                  {footer[i] ?? ''}
                </Text>
              ))}
            </Row>
          ) : null}
        </View>
      </ScrollView>
      {!rows.length ? <Empty title={emptyTitle} /> : null}
    </Card>
  );
}

const cell = { paddingVertical: 8, paddingHorizontal: 8, fontSize: 13, color: colors.text } as const;
