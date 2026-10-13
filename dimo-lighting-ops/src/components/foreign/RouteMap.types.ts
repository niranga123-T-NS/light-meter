export type RouteMapProps = {
  mode: 'sea' | 'air' | 'courier';
  /** factories (one per import order on the shipment) */
  factories: { label: string; location: string | null; lat: number | null; lng: number | null; inland: 'forwarder' | 'manufacturer' | null }[];
  pol: string | null;
  vias: string[];
  pod: string | null;
  /** final delivery location in Sri Lanka */
  site: string | null;
  arrived: boolean;
  positions: { id: string; at: string; place: string; lat: number; lng: number; note: string | null }[];
  /** a factory found by name (so Ops can keep its point) */
  onFactoryFound?: (index: number, p: { lat: number; lng: number }) => void;
  height?: number;
};
