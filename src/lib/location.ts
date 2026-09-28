// One-off location capture at check-in / check-out, only with the user's consent.
// No background tracking.
import * as Location from 'expo-location';

export interface Fix { lat: number; lng: number; accuracy: number | null }

export async function captureLocation(): Promise<{ fix?: Fix; error?: string }> {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) return { error: 'no_permission' };
    const pos = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 15000)),
    ]);
    const p = pos ?? (await Location.getLastKnownPositionAsync({ maxAge: 5 * 60000 }));
    if (!p) return { error: 'no_signal' };
    return { fix: { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy ?? null } };
  } catch {
    return { error: 'no_signal' };
  }
}

export function mapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}
