/** The location picker is part of the web map only; the phone apps do not show it. */
export function LocationPicker(_: {
  visible: boolean;
  title: string;
  query: string;
  initial?: { lat: number; lng: number } | null;
  onSave: (p: { lat: number; lng: number }) => Promise<void>;
  onClose: () => void;
}) {
  return null;
}
