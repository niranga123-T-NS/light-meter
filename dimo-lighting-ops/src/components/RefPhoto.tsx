import { Image, type ImageContentFit } from 'expo-image';
import { useState } from 'react';
import { Text, View, type ImageStyle, type StyleProp } from 'react-native';
import { colors } from '@/components/ui';

/** A reference photo (upload or Google Drive). A Drive photo that is not shared "Anyone with the link" cannot load – says so. */
export function RefPhoto({ uri, drive, style, fit = 'cover', hint }: { uri?: string; drive?: boolean; style: StyleProp<ImageStyle>; fit?: ImageContentFit; hint?: boolean }) {
  const [bad, setBad] = useState<string | null>(null);
  if (!uri || bad === uri)
    return (
      <View style={[style as object, { backgroundColor: colors.soft, alignItems: 'center', justifyContent: 'center', padding: 8 }]}>
        <Text style={{ color: colors.faint, textAlign: 'center', fontSize: 12 }}>{!uri ? 'No photo' : drive && hint ? 'Cannot open this Drive photo – share it as "Anyone with the link"' : 'Photo not available'}</Text>
      </View>
    );
  return <Image source={{ uri }} style={style} contentFit={fit} transition={150} onError={() => setBad(uri)} />;
}
