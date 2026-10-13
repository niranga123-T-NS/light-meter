/** The location picker is part of the web map only; the phone apps do not show it. */
export function LocationPicker(_: {
  visible: boolean;
  title: string;
  query: string;
  initial?: { lat: number; lng: number } | null;
  /** A point anywhere in the world (a ship at sea): worldwide search, wide zoom, no "my location" */
  world?: boolean;
  onSave: (p: { lat: number; lng: number }) => Promise<void>;
  onClose: () => void;
}) {
  return null;
}
