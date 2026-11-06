import { useEffect, useState } from 'react';
import { Animated, Platform, Pressable, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { Chip, colors, Row } from '@/components/ui';
import { countryList, PRICE_LEVELS, type BrandGroups, type PriceLevel } from '@/lib/fixtures';
import { BrandBadge, DropButton, EstIcon, PanelHead, Token, TypeIcon } from './EstUi';

/** Brands to search in: all, the brands of one origin or one country of manufacturing (set by the DGM or SM Estimation), or any few brands –
 * a button with the chosen brands' badges, opening a panel of brand tiles */
export function BrandFilter({ brands, groups, value, onChange, label = 'Brands', counts }: { brands: string[]; groups: BrandGroups; value: string[]; onChange: (v: string[]) => void; label?: string; counts?: Record<string, number> }) {
  const toggle = (b: string) => onChange(value.includes(b) ? value.filter((x) => x !== b) : [...value, b]);
  const countries = countryList(groups);
  const logos = groups.logos ?? {};
  const wide = useWindowDimensions().width >= 760;
  const groupChips = (title: string, icon: 'globe' | 'factory', inGroup: (b: string, c: string) => boolean) => {
    const chips = countries.map((c) => ({ c, inR: brands.filter((b) => inGroup(b, c)) })).filter((x) => x.inR.length);
    if (!chips.length) return null;
    return (
      <View style={{ marginBottom: 8 }}>
        <PanelHead icon={icon}>{title}</PanelHead>
        <Row gap={6} wrap>
          {chips.map(({ c, inR }) => {
            const on = inR.every((b) => value.includes(b));
            return <Chip key={c} label={`${FLAG[c] ?? ''}${FLAG[c] ? ' ' : ''}${c} ${inR.length}`} tone={on ? colors.blue : undefined} on={on} onPress={() => onChange(on ? value.filter((b) => !inR.includes(b)) : [...new Set([...value, ...inR])])} />;
          })}
        </Row>
      </View>
    );
  };
  const shown = value.length ? value : brands.slice(0, 4);
  return (
    <DropButton label={label} active={!!value.length} width={wide ? 720 : 360} panel={() => (
      <View>
        {groupChips('Origin', 'globe', (b, c) => groups.origins[b] === c)}
        {groupChips('Made in', 'factory', (b, c) => (groups.madeIn[b] ?? []).includes(c))}
        <PanelHead right={<Text onPress={() => onChange([])} style={{ color: colors.blue, fontWeight: '700', fontSize: 12.5 }}>All brands</Text>}>{value.length ? `${label} – ${value.length} of ${brands.length}` : `${label} – all ${brands.length}`}</PanelHead>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {brands.map((b) => {
            const on = value.includes(b);
            return (
              <Pressable key={b} onPress={() => toggle(b)} style={{ width: wide ? '32.5%' : '100%', flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: on ? '#2563eb' : colors.line, backgroundColor: on ? '#eff6ff' : '#fff' }}>
                <BrandBadge brand={b} logo={logos[b]} size={24} />
                <Text style={{ flex: 1, fontSize: 12.5, fontWeight: '600', color: colors.ink }} numberOfLines={1}>{b}</Text>
                {counts?.[b] != null ? <Text style={{ fontSize: 11.5, color: colors.muted }}>{counts[b].toLocaleString('en-US')}</Text> : null}
              </Pressable>
            );
          })}
        </View>
      </View>
    )}>
      <View style={{ flexDirection: 'row' }}>{shown.slice(0, 4).map((b, i) => <View key={b} style={{ marginLeft: i ? -6 : 0 }}><BrandBadge brand={b} logo={logos[b]} size={20} /></View>)}</View>
      <Text style={{ fontSize: 12, fontWeight: '700', color: colors.muted }}>{value.length ? `${value.length} brand${value.length > 1 ? 's' : ''}` : `All ${brands.length}`}</Text>
    </DropButton>
  );
}
const FLAG: Record<string, string> = { Europe: '🇪🇺', China: '🇨🇳', India: '🇮🇳', Singapore: '🇸🇬', Australia: '🇦🇺', USA: '🇺🇸', Turkey: '🇹🇷', Vietnam: '🇻🇳', Japan: '🇯🇵', Korea: '🇰🇷', Taiwan: '🇹🇼', Malaysia: '🇲🇾', Thailand: '🇹🇭', 'Sri Lanka': '🇱🇰', Germany: '🇩🇪', Italy: '🇮🇹', Spain: '🇪🇸', UK: '🇬🇧' };
const DOLLARS: Record<PriceLevel, string> = { budget: '$', mid: '$$', upper_mid: '$$$', high: '$$$$', top: '$$$$$' };

/** Price levels to search in: all, or any of Budget / Mid / Upper Mid / High / Top (products without a level drop out once one is chosen) */
export function PriceFilter({ value, onChange, counts }: { value: PriceLevel[]; onChange: (v: PriceLevel[]) => void; counts?: Partial<Record<PriceLevel, number>> }) {
  const names = PRICE_LEVELS.filter((l) => value.includes(l.v)).map((l) => l.label);
  return (
    <DropButton label="Price levels" active={!!value.length} width={280} panel={() => (
      <View style={{ gap: 6 }}>
        <PanelHead icon="price" right={value.length ? <Text onPress={() => onChange([])} style={{ color: colors.blue, fontWeight: '700', fontSize: 12.5 }}>All levels</Text> : null}>Price levels</PanelHead>
        {PRICE_LEVELS.map((l) => {
          const on = value.includes(l.v);
          return (
            <Pressable key={l.v} onPress={() => onChange(on ? value.filter((x) => x !== l.v) : [...value, l.v])} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 9, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: on ? '#16a34a' : colors.line, backgroundColor: on ? '#f0fdf4' : '#fff' }}>
              <Text style={{ width: 48, color: '#16a34a', fontWeight: '800', letterSpacing: -1 }}>{DOLLARS[l.v]}</Text>
              <Text style={{ flex: 1, fontWeight: '600', color: colors.ink, fontSize: 13 }}>{l.label}</Text>
              {counts?.[l.v] != null ? <Text style={{ fontSize: 11.5, color: colors.muted }}>{counts[l.v]!.toLocaleString('en-US')}</Text> : null}
            </Pressable>
          );
        })}
        <Text style={{ fontSize: 11.5, color: colors.muted }}>Products without a level drop out once a level is chosen.</Text>
      </View>
    )}>
      <EstIcon name="price" size={18} />
      <Text style={{ fontSize: 13, fontWeight: '600', color: colors.ink }} numberOfLines={1}>{names.length ? (names.length > 2 ? `${names.length} levels` : names.join(' · ')) : 'All prices'}</Text>
    </DropButton>
  );
}

/** The fixture type, as small pictures */
export function TypeFilter({ value, onChange, types }: { value: string; onChange: (v: string) => void; types: string[] }) {
  return (
    <DropButton label="Type" active={!!value} width={440} panel={(close) => (
      <View>
        <PanelHead right={value ? <Text onPress={() => { onChange(''); close(); }} style={{ color: colors.blue, fontWeight: '700', fontSize: 12.5 }}>All types</Text> : null}>Type</PanelHead>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {types.map((t) => (
            <Pressable key={t} onPress={() => { onChange(t === value ? '' : t); close(); }} style={{ width: 94, alignItems: 'center', gap: 4, paddingVertical: 8, paddingHorizontal: 4, borderRadius: 9, borderWidth: 1, borderColor: t === value ? '#2563eb' : colors.line, backgroundColor: t === value ? '#eff6ff' : '#fff' }}>
              <TypeIcon type={t} size={30} />
              <Text style={{ fontSize: 11.5, fontWeight: '600', color: colors.ink, textAlign: 'center' }} numberOfLines={2}>{t}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    )}>
      {value ? <TypeIcon type={value} size={20} /> : <EstIcon name="types" size={18} />}
      <Text style={{ fontSize: 13, fontWeight: '600', color: colors.ink }} numberOfLines={1}>{value || 'All types'}</Text>
    </DropButton>
  );
}

/** The search box of a toolbar */
export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <View style={{ flexGrow: 1, flexBasis: 260, minWidth: 200, flexDirection: 'row', alignItems: 'center', gap: 8, height: 38, paddingHorizontal: 10, borderRadius: 8, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0' }}>
      <EstIcon name="search" size={17} />
      <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={colors.faint} autoCapitalize="none" autoCorrect={false} style={{ flex: 1, fontSize: 14, color: colors.ink, paddingVertical: 0, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) } as object} />
      {value ? <Text onPress={() => onChange('')} style={{ color: colors.muted, fontWeight: '700', paddingHorizontal: 4 }}>×</Text> : null}
    </View>
  );
}

/** The chosen filters as tokens, with Clear all */
export function FilterTokens({ type, onType, brands, onBrands, levels, onLevels, logos }: { type?: string; onType?: (v: string) => void; brands: string[]; onBrands: (v: string[]) => void; levels: PriceLevel[]; onLevels: (v: PriceLevel[]) => void; logos?: Record<string, string> }) {
  if (!type && !brands.length && !levels.length) return null;
  return (
    <Row gap={6} wrap style={{ alignItems: 'center' }}>
      {type && onType ? <Token onClear={() => onType('')}><TypeIcon type={type} size={14} /><Text style={{ fontSize: 12, color: '#1e3a8a' }}>{type}</Text></Token> : null}
      {brands.length ? <Token onClear={() => onBrands([])}><BrandBadge brand={brands[0]} logo={logos?.[brands[0]]} size={14} /><Text style={{ fontSize: 12, color: '#1e3a8a' }}>{brands[0]}{brands.length > 1 ? ` + ${brands.length - 1}` : ''}</Text></Token> : null}
      {levels.length ? <Token onClear={() => onLevels([])}><Text style={{ fontSize: 12, color: '#15803d', fontWeight: '800' }}>$</Text><Text style={{ fontSize: 12, color: '#1e3a8a' }}>{PRICE_LEVELS.filter((l) => levels.includes(l.v)).map((l) => l.label).join(' · ')}</Text></Token> : null}
      <Text onPress={() => { onType?.(''); onBrands([]); onLevels([]); }} style={{ fontSize: 12, color: colors.blue, fontWeight: '700' }}>Clear all</Text>
    </Row>
  );
}

/** A product's price level, shown to everyone */
export function PriceTag({ level }: { level?: PriceLevel }) {
  if (!level) return null;
  return (
    <View style={{ alignSelf: 'flex-start', borderRadius: 999, borderWidth: 1, borderColor: colors.green, paddingHorizontal: 7, paddingVertical: 1 }}>
      <Text style={{ fontSize: 11, fontWeight: '700', color: colors.green }}>{`${DOLLARS[level]} ${PRICE_LEVELS.find((x) => x.v === level)?.label}`}</Text>
    </View>
  );
}

/** Warnings on a product (its brand's and its own) as small blinking tags; in the supervisor mode the own ones can be removed */
export function WarningTags({ warnings, onRemove, still }: { warnings?: { text: string; brand: boolean }[]; onRemove?: (text: string, brand: boolean) => void; still?: boolean }) {
  const [op] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (still || !warnings?.length) return;
    const a = Animated.loop(Animated.sequence([
      Animated.timing(op, { toValue: 0.35, duration: 700, useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(op, { toValue: 1, duration: 700, useNativeDriver: Platform.OS !== 'web' }),
    ]));
    a.start();
    return () => a.stop();
  }, [op, still, warnings?.length]);
  if (!warnings?.length) return null;
  return (
    <Row gap={4} wrap>
      {warnings.map((w) => (
        <Animated.View key={`${w.brand}:${w.text}`} style={{ opacity: op, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#FEF2F2', borderColor: '#DC2626', borderWidth: 1, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 1 }}>
          <Text style={{ fontSize: 11, fontWeight: '700', color: '#B91C1C' }}>{`⚠ ${w.text}${onRemove && w.brand ? ' (brand)' : ''}`}</Text>
          {onRemove ? <Text onPress={() => onRemove(w.text, w.brand)} style={{ fontSize: 12, fontWeight: '800', color: '#B91C1C' }}>×</Text> : null}
        </Animated.View>
      ))}
    </Row>
  );
}
