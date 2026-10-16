import { ACADEMY_SITE } from '@/lib/academy';

export type CsiStage = 'inquiry' | 'design' | 'quotation' | 'delivery' | 'installation' | 'handover' | 'after_sales';
export const CSI_STAGES: { value: CsiStage; label: string; icon: string }[] = [
  { value: 'inquiry', label: 'Inquiry & first contact', icon: '💬' },
  { value: 'design', label: 'Lighting design', icon: '📐' },
  { value: 'quotation', label: 'Quotation', icon: '🧾' },
  { value: 'delivery', label: 'Delivery', icon: '🚚' },
  { value: 'installation', label: 'Site works & installation', icon: '🔧' },
  { value: 'handover', label: 'Testing, commissioning & handover', icon: '✅' },
  { value: 'after_sales', label: 'After-sales & service', icon: '🤝' },
];
export const stageLabel = (s: string) => CSI_STAGES.find((x) => x.value === s)?.label ?? s;

/** The swipe cards – each linked to an importance area (for the importance / satisfaction view) and, when it is about one
 *  step of the job, to that step: a card is asked only when the customer went through its step */
export const CSI_CARDS: { key: string; text: string; area: CsiArea; stages?: CsiStage[] }[] = [
  { key: 'understood', text: 'DIMO understood what we really needed', area: 'support' },
  { key: 'responsive', text: 'Our calls and questions were answered quickly', area: 'speed' },
  { key: 'expert', text: 'DIMO gave us expert technical advice', area: 'support' },
  { key: 'informed', text: 'DIMO kept us informed at every step', area: 'support' },
  { key: 'on_time', text: 'Quotations and proposals came on time', area: 'speed', stages: ['inquiry', 'design', 'quotation'] },
  { key: 'design', text: 'The lighting design met our needs and the standards', area: 'quality', stages: ['design'] },
  { key: 'value', text: 'The price is fair for the quality we get', area: 'price', stages: ['quotation', 'delivery', 'installation', 'after_sales'] },
  { key: 'quality', text: 'The products perform as promised', area: 'quality', stages: ['delivery', 'installation', 'handover', 'after_sales'] },
  { key: 'delivered', text: 'Deliveries arrived complete and on the date promised', area: 'speed', stages: ['delivery'] },
  // project execution on site
  { key: 'programme', text: 'The site work kept to the agreed programme', area: 'speed', stages: ['installation'] },
  { key: 'workmanship', text: 'The installation work is neat and of high quality', area: 'quality', stages: ['installation'] },
  { key: 'site', text: 'The site team worked safely and cleanly', area: 'quality', stages: ['installation'] },
  { key: 'coordination', text: 'DIMO’s site engineer coordinated well with the consultant and other contractors', area: 'support', stages: ['installation'] },
  { key: 'variations', text: 'Changes and variations were handled clearly and fairly', area: 'price', stages: ['installation'] },
  { key: 'documents', text: 'Data sheets, test reports and as-built drawings were complete and on time', area: 'support', stages: ['design', 'delivery', 'handover'] },
  { key: 'handover', text: 'Testing, commissioning and training of our staff were done well', area: 'after_sales', stages: ['handover'] },
  { key: 'snags', text: 'Snags and defects were closed quickly', area: 'after_sales', stages: ['handover', 'after_sales'] },
  { key: 'after', text: 'Problems after the handover are solved quickly', area: 'after_sales', stages: ['after_sales'] },
];
/** The cards for the steps this customer went through */
export const cardsFor = (stages: string[]) => CSI_CARDS.filter((c) => !c.stages || c.stages.some((s) => stages.includes(s)));

export type CsiArea = 'price' | 'quality' | 'speed' | 'support' | 'after_sales';
export const CSI_AREAS: { value: CsiArea; label: string; icon: string }[] = [
  { value: 'price', label: 'Price', icon: '💰' },
  { value: 'quality', label: 'Product quality', icon: '💡' },
  { value: 'speed', label: 'Speed & delivery', icon: '⚡' },
  { value: 'support', label: 'Technical support', icon: '🛠️' },
  { value: 'after_sales', label: 'After-sales service', icon: '🤝' },
];

export const CSI_VS = [
  { value: -2, label: 'Much worse' },
  { value: -1, label: 'Worse' },
  { value: 0, label: 'About the same' },
  { value: 1, label: 'Better' },
  { value: 2, label: 'Much better' },
];

/** How easy DIMO is to work with (1–5) */
export const CSI_EFFORT = [
  { value: 1, label: 'Very hard', face: '😫' },
  { value: 2, label: 'Hard', face: '😕' },
  { value: 3, label: 'OK', face: '😐' },
  { value: 4, label: 'Easy', face: '🙂' },
  { value: 5, label: 'Very easy', face: '😄' },
];
/** Will they choose DIMO for the next lighting project (−2…2) */
export const CSI_REPURCHASE = [
  { value: -2, label: 'Definitely not' },
  { value: -1, label: 'Probably not' },
  { value: 0, label: 'Not sure' },
  { value: 1, label: 'Probably' },
  { value: 2, label: 'Definitely' },
];
/** What the customer wants to be contacted about – a sales lead */
export const CSI_TOPICS = [
  { value: 'new_project', label: 'A new project coming up', icon: '🏗️' },
  { value: 'maintenance', label: 'Maintenance & service', icon: '🛠️' },
  { value: 'upgrade', label: 'Energy-saving LED upgrade', icon: '💡' },
  { value: 'controls', label: 'Lighting controls / smart lighting', icon: '🎛️' },
  { value: 'training', label: 'Training for our staff', icon: '🎓' },
  { value: 'spares', label: 'Spare parts', icon: '📦' },
];
export const topicLabel = (t: string) => CSI_TOPICS.find((x) => x.value === t)?.label ?? t;

export const STAGE_FACES = ['😢', '🙁', '😐', '🙂', '😄'];
export const moodFace = (v: number) => (v >= 90 ? '😄' : v >= 75 ? '😊' : v >= 60 ? '🙂' : v >= 40 ? '😐' : v >= 20 ? '🙁' : '😢');
export const moodWord = (v: number) => (v >= 90 ? 'Delighted' : v >= 75 ? 'Happy' : v >= 60 ? 'Fairly happy' : v >= 40 ? 'Not convinced' : v >= 20 ? 'Unhappy' : 'Very unhappy');

export type CsiAnswers = {
  overall: number;
  stage_scores: Record<string, number>;
  cards: Record<string, -1 | 0 | 1>;
  points: Record<CsiArea, number>;
  vs_others: number | null;
  effort: number | null;
  repurchase: number | null;
  contact_topics: string[];
  nps: number;
  reference_ok: boolean;
  quote_ok: boolean;
  wish: string;
};

export type CsiContext = { code: string; status: 'open' | 'completed' | 'cancelled' | 'expired' | 'not_found'; customer: string; project: string | null; contact: string; sales: string; sales_phone: string | null; stages: CsiStage[] };

export type CsiSurvey = {
  id: string;
  code: string;
  token: string;
  sales_person_id: string;
  organization_id: string;
  project_id: string | null;
  contact_name: string;
  contact_role: string | null;
  stages: CsiStage[];
  channel: 'link' | 'tablet' | 'call';
  /** sales: started by the sales person · execution: started by the project's SEE */
  team: 'sales' | 'execution';
  status: 'open' | 'completed' | 'cancelled';
  expires_at: string;
  filled_by: 'customer' | 'sales' | null;
  overall: number | null;
  stage_scores: Record<string, number> | null;
  cards: Record<string, number> | null;
  points: Record<string, number> | null;
  vs_others: number | null;
  effort: number | null;
  repurchase: number | null;
  contact_topics: string[];
  nps: number | null;
  reference_ok: boolean | null;
  quote_ok: boolean | null;
  wish: string | null;
  completed_at: string | null;
  alert: boolean;
  follow_up_note: string | null;
  followed_up_at: string | null;
  created_at: string;
  organizations?: { name: string } | null;
  projects?: { name: string } | null;
};

/** The link the customer opens (no login) */
export const csiLink = (token: string) => `${ACADEMY_SITE}/survey/${token}`;

/** Net promoter score of a set of answers: % promoters (9–10) − % detractors (0–6) */
export function npsOf(list: { nps: number | null }[]) {
  const xs = list.map((x) => x.nps).filter((x): x is number => x != null);
  if (!xs.length) return null;
  return Math.round((100 * (xs.filter((x) => x >= 9).length - xs.filter((x) => x <= 6).length)) / xs.length);
}
