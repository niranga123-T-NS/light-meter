export type MapPoint = {
  lat: number;
  lng: number;
  color: string;
  /** Popup content (HTML, already escaped) */
  label: string;
  /** App route opened from the popup's "Open" link */
  href?: string;
  radius?: number;
  hollow?: boolean;
  dashed?: boolean;
  /** Shown as a numbered stop (day route) */
  number?: number;
};

export type MapLine = { coords: [number, number][]; color: string; weight?: number; dashed?: boolean };

export type MapProps = {
  points: MapPoint[];
  lines?: MapLine[];
  /** [lat, lng, weight] */
  heat?: [number, number, number][];
  /** Changes when the selection changes – the map zooms to the data again */
  fitKey: string;
  onOpen?: (href: string) => void;
  height?: number;
};
