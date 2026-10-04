import { Notice } from '@/components/ui';
import type { MapProps } from './SalesMap.types';

/** The sales map is in the web app only (the phone apps show this note). */
export function SalesMap(_: MapProps) {
  return <Notice>The map is available in the web app – open dimo-lighting-ops.vercel.app in a browser.</Notice>;
}

export const mapEscape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
