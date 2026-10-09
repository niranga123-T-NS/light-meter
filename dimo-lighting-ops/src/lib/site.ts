import * as Location from 'expo-location';

/** A GPS fix for the site location / check-in (high accuracy), or null when location access is refused. */
export async function siteFix(): Promise<{ lat: number; lng: number; accuracy: number | null } | null> {
  const perm = await Location.requestForegroundPermissionsAsync();
  if (!perm.granted) return null;
  try {
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    return { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy ?? null };
  } catch {
    const last = await Location.getLastKnownPositionAsync();
    return last ? { lat: last.coords.latitude, lng: last.coords.longitude, accuracy: last.coords.accuracy ?? null } : null;
  }
}

export const mapLink = (lat: number, lng: number) => `https://maps.google.com/?q=${lat},${lng}`;
