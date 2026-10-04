import { Image, View } from 'react-native';

const FULL = require('../../assets/brand/dimo-logo.png');
const COMPACT = require('../../assets/brand/dimo-logo-compact.png');

/** The official DIMO logo (930 × 486) on a white panel, so it reads on the dark sidebar and sign-in screen. */
export function BrandLogo({
  width,
  tagline = false,
  panel = true,
  align = 'flex-start',
}: {
  width: number;
  tagline?: boolean;
  panel?: boolean;
  align?: 'flex-start' | 'center';
}) {
  const img = <Image source={tagline ? FULL : COMPACT} style={{ width, height: (width * 486) / 930 }} resizeMode="contain" accessibilityLabel="DIMO" />;
  if (!panel) return img;
  return <View style={{ backgroundColor: '#FFFFFF', borderRadius: 10, padding: Math.round(width * 0.06), alignSelf: align }}>{img}</View>;
}
