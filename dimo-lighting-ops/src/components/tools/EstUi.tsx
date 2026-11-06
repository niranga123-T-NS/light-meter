import { useRef, useState, type ReactNode } from 'react';
import { Image, Modal, Platform, Pressable, ScrollView, Text, useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { colors } from '@/components/ui';

/** Small coloured icons of the Estimation tab (catalog, BOQ match, supply orders, the filters and the actions) */
export const EST_ICONS = {
  catalog: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="18" rx="1" fill="#2563eb"/><rect x="11" y="3" width="5" height="18" rx="1" fill="#60a5fa"/><rect x="17" y="5" width="4" height="16" rx="1" transform="rotate(10 19 13)" fill="#93c5fd"/></svg>',
  boq: '<svg viewBox="0 0 24 24"><rect x="4" y="2" width="16" height="20" rx="2" fill="#16a34a"/><path d="M8 8h8M8 12h8M8 16h5" stroke="#fff" stroke-width="2"/></svg>',
  supply: '<svg viewBox="0 0 24 24"><path d="M3 8l9-5 9 5v9l-9 5-9-5z" fill="#d97706"/><path d="M3 8l9 5 9-5M12 13v9" stroke="#fde68a" stroke-width="1.5" fill="none"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="10" cy="10" r="6.5" fill="none" stroke="#2563eb" stroke-width="2.5"/><path d="M15 15l6 6" stroke="#2563eb" stroke-width="3" stroke-linecap="round"/></svg>',
  photo: '<svg viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="14" rx="3" fill="#7c3aed"/><circle cx="12" cy="13" r="4" fill="#ede9fe"/><rect x="8" y="3" width="8" height="4" rx="1" fill="#7c3aed"/></svg>',
  match: '<svg viewBox="0 0 24 24"><path d="M4 8h13m-3-3 3 3-3 3M20 16H7m3-3-3 3 3 3" stroke="#0d9488" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  shield: '<svg viewBox="0 0 24 24"><path d="M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z" fill="#c8102e"/><path d="M8 12l3 3 5-6" stroke="#fff" stroke-width="2" fill="none"/></svg>',
  price: '<svg viewBox="0 0 24 24"><rect x="3" y="14" width="4" height="7" rx="1" fill="#86efac"/><rect x="10" y="9" width="4" height="12" rx="1" fill="#22c55e"/><rect x="17" y="4" width="4" height="17" rx="1" fill="#15803d"/></svg>',
  globe: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="#bfdbfe" stroke="#2563eb" stroke-width="1.5"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" stroke="#2563eb" stroke-width="1.3" fill="none"/></svg>',
  factory: '<svg viewBox="0 0 24 24"><path d="M2 21V10l6 4V10l6 4V6h4l2 15z" fill="#64748b"/></svg>',
  info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="#64748b" stroke-width="2"/><path d="M12 11v6M12 7v.5" stroke="#64748b" stroke-width="2.4" stroke-linecap="round"/></svg>',
  open: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6" stroke="#2563eb" stroke-width="2.2" fill="none" stroke-linecap="round"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20l4-1 11-11-3-3L5 16z" fill="#f59e0b"/></svg>',
  del: '<svg viewBox="0 0 24 24"><path d="M5 7h14l-1 14H6zM9 4h6v3H9z" fill="#dc2626"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" stroke="#fff" stroke-width="3" stroke-linecap="round"/></svg>',
  refresh: '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5" stroke="#475569" stroke-width="2.4" fill="none" stroke-linecap="round"/></svg>',
  award: '<svg viewBox="0 0 24 24"><circle cx="12" cy="9" r="6" fill="#f59e0b"/><path d="M8 14l-2 8 6-3 6 3-2-8" fill="#c8102e"/></svg>',
  xls: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3" fill="#16a34a"/><path d="M8 7l8 10M16 7l-8 10" stroke="#fff" stroke-width="2.4"/></svg>',
  types: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="8" height="8" rx="2" fill="#94a3b8"/><rect x="13" y="3" width="8" height="8" rx="2" fill="#cbd5e1"/><rect x="3" y="13" width="8" height="8" rx="2" fill="#cbd5e1"/><rect x="13" y="13" width="8" height="8" rx="2" fill="#94a3b8"/></svg>',
  logo: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="3" fill="#e0e7ff" stroke="#6366f1" stroke-width="1.5"/><circle cx="9" cy="10" r="2" fill="#6366f1"/><path d="M5 18l5-5 3 3 3-4 3 6" fill="#a5b4fc"/></svg>',
} as const;
export type EstIconName = keyof typeof EST_ICONS;

/** The fixture types as small pictures */
export const TYPE_ICONS: Record<string, string> = {
  Floodlight: '<rect x="9" y="6" width="14" height="12" rx="2" fill="#475569"/><rect x="11" y="8" width="10" height="8" rx="1" fill="#fde68a"/><path d="M16 18v6M11 26h10" stroke="#475569" stroke-width="2"/>',
  Panel: '<rect x="4" y="8" width="24" height="16" rx="2" fill="#e2e8f0" stroke="#94a3b8"/><rect x="7" y="11" width="18" height="10" fill="#fef9c3"/>',
  Downlight: '<ellipse cx="16" cy="12" rx="11" ry="4" fill="#cbd5e1"/><ellipse cx="16" cy="12" rx="6" ry="2.2" fill="#fde68a"/><path d="M10 14l-4 12h20l-4-12" fill="#fef9c3" opacity=".6"/>',
  'High bay': '<path d="M16 3v5" stroke="#64748b" stroke-width="2"/><path d="M8 18a8 8 0 0 1 16 0z" fill="#475569"/><rect x="10" y="8" width="12" height="5" rx="1" fill="#64748b"/><path d="M9 19l-3 9h20l-3-9" fill="#fef9c3" opacity=".7"/>',
  'Street light': '<path d="M8 30V8q0-4 4-4h10" fill="none" stroke="#64748b" stroke-width="2.4"/><rect x="18" y="3" width="10" height="4" rx="2" fill="#475569"/><path d="M19 7l-2 6h12l-2-6" fill="#fde68a"/>',
  Linear: '<rect x="3" y="13" width="26" height="6" rx="3" fill="#94a3b8"/><rect x="5" y="15" width="22" height="2" fill="#fef9c3"/>',
  'Track / spot': '<rect x="3" y="5" width="26" height="3" rx="1.5" fill="#475569"/><path d="M11 8v4M21 8v4" stroke="#475569" stroke-width="2"/><rect x="7" y="12" width="8" height="9" rx="2" fill="#334155" transform="rotate(-15 11 16)"/><rect x="17" y="12" width="8" height="9" rx="2" fill="#334155" transform="rotate(15 21 16)"/>',
  Emergency: '<rect x="4" y="9" width="24" height="14" rx="2" fill="#16a34a"/><path d="M9 16h9m-3-3 3 3-3 3" stroke="#fff" stroke-width="2" fill="none"/><circle cx="22" cy="13" r="1.8" fill="#fff"/><path d="M22 15v5" stroke="#fff" stroke-width="2"/>',
  'Tri-proof / batten': '<rect x="3" y="11" width="26" height="10" rx="5" fill="#cbd5e1" stroke="#94a3b8"/><rect x="6" y="14" width="20" height="4" rx="2" fill="#fef9c3"/>',
  'Ceiling light': '<rect x="6" y="6" width="20" height="3" rx="1" fill="#94a3b8"/><path d="M5 10h22a11 9 0 0 1-22 0z" fill="#e2e8f0" stroke="#94a3b8"/><path d="M9 12h14a7 5 0 0 1-14 0z" fill="#fef9c3"/>',
  'Wall / bulkhead': '<rect x="3" y="4" width="3" height="24" fill="#cbd5e1"/><ellipse cx="16" cy="16" rx="9" ry="7" fill="#e2e8f0" stroke="#94a3b8"/><ellipse cx="16" cy="16" rx="6" ry="4" fill="#fde68a"/>',
  'Outdoor landscape': '<path d="M16 30V14" stroke="#64748b" stroke-width="2.2"/><rect x="11" y="6" width="10" height="8" rx="2" fill="#475569"/><rect x="13" y="8" width="6" height="4" rx="1" fill="#fde68a"/><path d="M4 30q4-6 8-1M28 30q-4-6-8-1" fill="none" stroke="#22c55e" stroke-width="2"/>',
  'Tube / lamp': '<rect x="3" y="13" width="26" height="6" rx="3" fill="#fef9c3" stroke="#cbd5e1"/><rect x="1" y="14" width="3" height="4" fill="#94a3b8"/><rect x="28" y="14" width="3" height="4" fill="#94a3b8"/>',
  'Strip / neon': '<path d="M4 22q6-12 12-4t12-6" fill="none" stroke="#f472b6" stroke-width="3" stroke-linecap="round"/>',
};

export function EstIcon({ name, size = 18 }: { name: EstIconName; size?: number }) {
  return <SvgXml xml={EST_ICONS[name]} width={size} height={size} />;
}
export function TypeIcon({ type, size = 22 }: { type: string; size?: number }) {
  return <SvgXml xml={`<svg viewBox="0 0 32 32">${TYPE_ICONS[type] ?? TYPE_ICONS.Panel}</svg>`} width={size} height={size} />;
}

// a brand without a logo gets a badge with its initials, in a colour of its own
const BADGE_COLOURS = ['#0ea5e9', '#f97316', '#dc2626', '#16a34a', '#1e3a8a', '#0284c7', '#7c3aed', '#0891b2', '#b91c1c', '#a16207', '#2563eb', '#111827', '#ea580c', '#9333ea', '#0f766e', '#be123c', '#4d7c0f', '#c026d3'];
const badgeColour = (b: string) => BADGE_COLOURS[[...b].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % BADGE_COLOURS.length];
export const brandInitials = (b: string) => {
  const w = b.replace(/\(.*?\)/g, '').trim().split(/[\s-]+/).filter(Boolean);
  return (w.length > 1 ? w[0][0] + w[1][0] : (w[0] ?? '?').slice(0, 2)).toUpperCase();
};

/** A brand's small logo (uploaded in the catalog supervisor mode), or its initials */
export function BrandBadge({ brand, logo, size = 22 }: { brand: string; logo?: string | null; size?: number }) {
  if (logo)
    return (
      <View style={{ width: size, height: size, borderRadius: 5, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
        <Image source={{ uri: logo }} style={{ width: size - 2, height: size - 2 }} resizeMode="contain" accessibilityLabel={brand} />
      </View>
    );
  return (
    <View style={{ width: size, height: size, borderRadius: 5, backgroundColor: badgeColour(brand), alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: '#fff' }}>
      <Text style={{ color: '#fff', fontWeight: '800', fontSize: Math.round(size * 0.4), letterSpacing: -0.3 }}>{brandInitials(brand)}</Text>
    </View>
  );
}

/** A ScreenTip: hover on the web, long-press on a phone or iPad */
export function Tip({ title, text, children, style, onPress, disabled }: { title: string; text?: string; children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; disabled?: boolean }) {
  const [show, setShow] = useState(false);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  const on = () => { if (t.current) clearTimeout(t.current); t.current = setTimeout(() => setShow(true), 450); };
  const off = () => { if (t.current) clearTimeout(t.current); setShow(false); };
  return (
    <Pressable
      onPress={() => { off(); onPress?.(); }}
      onHoverIn={on}
      onHoverOut={off}
      onLongPress={() => { setShow(true); if (t.current) clearTimeout(t.current); t.current = setTimeout(() => setShow(false), 3000); }}
      disabled={disabled}
      accessibilityLabel={title}
      style={[{ position: 'relative' }, style, disabled && { opacity: 0.4 }]}
    >
      {children}
      {show ? (
        <View pointerEvents="none" style={{ position: 'absolute', top: '100%', right: 0, marginTop: 6, width: 240, zIndex: 50, backgroundColor: '#0f172a', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, ...(Platform.OS === 'web' ? { boxShadow: '0 10px 24px rgba(0,0,0,.3)' } : { elevation: 6 }) }}>
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12.5 }}>{title}</Text>
          {text ? <Text style={{ color: '#cbd5e1', fontSize: 12, marginTop: 2, lineHeight: 17 }}>{text}</Text> : null}
        </View>
      ) : null}
    </Pressable>
  );
}

/** A square icon button with a ScreenTip */
export function IconBtn({ icon, title, text, onPress, on, disabled }: { icon: EstIconName; title: string; text?: string; onPress?: () => void; on?: boolean; disabled?: boolean }) {
  return (
    <Tip title={title} text={text} onPress={onPress} disabled={disabled} style={{ width: 34, height: 34, borderRadius: 8, borderWidth: 1, borderColor: on ? colors.brand : '#d1d5db', backgroundColor: on ? '#fff1f2' : '#fff', alignItems: 'center', justifyContent: 'center' }}>
      <EstIcon name={icon} size={17} />
    </Tip>
  );
}

/** Tabs with an icon each */
export function IconTabs<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string; icon: EstIconName; badge?: number }[]; onChange: (v: T) => void }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', backgroundColor: '#fff', borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10, padding: 3, gap: 2, alignSelf: 'flex-start' }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value} onPress={() => onChange(o.value)} style={{ flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 11, paddingVertical: 6, borderRadius: 7, backgroundColor: on ? colors.ink : 'transparent' }}>
            <EstIcon name={o.icon} size={17} />
            <Text style={{ fontSize: 13.5, fontWeight: '600', color: on ? '#fff' : '#334155' }}>{o.label}</Text>
            {o.badge ? <Text style={{ fontSize: 11, fontWeight: '700', color: on ? '#fff' : colors.muted }}>{o.badge}</Text> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/** A filter button that opens a panel under it (a sheet on a phone) */
export function DropButton({ children, active, panel, width = 420, label }: { children: ReactNode; active?: boolean; panel: (close: () => void) => ReactNode; width?: number; label: string }) {
  const ref = useRef<View>(null);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const win = useWindowDimensions();
  const open = () => ref.current?.measureInWindow((x, y, w, h) => setAt({ x: x + w, y: y + h + 4 }));
  const narrow = win.width < 640;
  const w = Math.min(width, win.width - 16);
  return (
    <>
      <Pressable ref={ref} onPress={open} accessibilityLabel={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 7, height: 38, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: active ? '#2563eb' : colors.line, backgroundColor: active ? '#eff6ff' : '#fff' }}>
        {children}
        <Text style={{ color: colors.faint, fontSize: 11 }}>▾</Text>
      </Pressable>
      <Modal visible={!!at} transparent animationType="fade" onRequestClose={() => setAt(null)}>
        <Pressable style={{ flex: 1, backgroundColor: narrow ? 'rgba(15,23,42,.35)' : 'transparent' }} onPress={() => setAt(null)}>
          <Pressable
            onPress={() => {}}
            style={[
              { position: 'absolute', backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#cbd5e1', padding: 12, ...(Platform.OS === 'web' ? { boxShadow: '0 18px 40px rgba(15,23,42,.25)' } : { elevation: 10 }) },
              narrow ? { left: 8, right: 8, bottom: 8, maxHeight: win.height * 0.75 } : { width: w, left: Math.max(8, Math.min((at?.x ?? 0) - w, win.width - w - 8)), top: at?.y ?? 0, maxHeight: win.height - (at?.y ?? 0) - 12 },
            ]}
          >
            <ScrollView>{panel(() => setAt(null))}</ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

/** A heading in a panel, with an icon */
export function PanelHead({ icon, children, right }: { icon?: EstIconName; children: ReactNode; right?: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8, marginTop: 2 }}>
      {icon ? <EstIcon name={icon} size={16} /> : null}
      <Text style={{ fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.muted, fontWeight: '700', flex: 1 }}>{children}</Text>
      {right}
    </View>
  );
}

/** A chosen filter as a small token with × */
export function Token({ children, onClear }: { children: ReactNode; onClear: () => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, height: 24, paddingLeft: 6, paddingRight: 2, borderRadius: 999, backgroundColor: '#eff6ff', borderWidth: 1, borderColor: '#bfdbfe' }}>
      {children}
      <Pressable onPress={onClear} hitSlop={8} accessibilityLabel="Clear" style={{ paddingHorizontal: 4 }}>
        <Text style={{ color: colors.muted, fontWeight: '700' }}>×</Text>
      </Pressable>
    </View>
  );
}

/** The bar the search and its filters sit in */
export function ToolBar({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, backgroundColor: '#fff', borderWidth: 1, borderColor: '#d1d5db', borderRadius: 12, padding: 6 }}>{children}</View>;
}

/** A small bar of segments: green done, amber part, grey to do */
export function Segments({ done, part = 0, total = 5 }: { done: number; part?: number; total?: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 3 }}>
      {Array.from({ length: total }, (_, i) => <View key={i} style={{ width: 18, height: 6, borderRadius: 3, backgroundColor: i < done ? '#16a34a' : i < done + part ? '#f59e0b' : '#e2e8f0' }} />)}
    </View>
  );
}
