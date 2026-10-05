// Address → map point (OpenStreetMap Nominatim, Sri Lanka only). Only a precise hit is used – a building, office or
// shop, or a house on a street – so a vague result (a town or a long road) never becomes the place visits are checked against.
type Hit = { lat: string; lon: string; display_name: string; class?: string; category?: string; place_rank?: number };

export async function geocodeAddress(q: string): Promise<{ lat: number; lng: number; label: string } | null> {
  const text = q.trim();
  if (text.length < 6) return null;
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=3&countrycodes=lk&q=${encodeURIComponent(text)}`;
    const hits = (await (await fetch(url, { headers: { Accept: 'application/json' } })).json()) as Hit[];
    const good = hits.find((h) => (h.place_rank ?? 0) >= 28 || ['building', 'amenity', 'office', 'shop', 'tourism'].includes(h.category ?? h.class ?? ''));
    return good ? { lat: Number(good.lat), lng: Number(good.lon), label: good.display_name } : null;
  } catch {
    return null;
  }
}
