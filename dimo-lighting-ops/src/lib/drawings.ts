// Smart drawings (testing): what can be placed on a drawing, its stages and checks, and the containment / cable routes.
// Positions are fractions of the sheet (0–1); lengths need the sheet's real width in metres (width_m).
import { supabase } from './supabase';

export type Disc = 'light' | 'power' | 'elv' | 'net' | 'hvac' | 'lms' | 'bms' | 'cont' | 'fiber' | 'out';
export type Scope = { services?: boolean; lms?: boolean; bms?: boolean; outdoor?: boolean };

export type Drawing = {
  id: string;
  exec_project_id: string;
  title: string;
  sheet_no: string | null;
  floor: string | null;
  revision: string | null;
  image_path: string;
  pdf_path: string | null;
  width: number;
  height: number;
  width_m: number | null;
  scope: Scope;
  lms: string;
  level_no: number | null;
  archived: boolean;
  uploaded_at: string;
};
export type DItem = {
  id: string;
  drawing_id: string;
  kind: string;
  x: number;
  y: number;
  label: string | null;
  area: string | null;
  circuit: string | null;
  serial: string | null;
  note: string | null;
  status: string;
  checks: Record<string, boolean>;
  readings: Record<string, string>;
  boq_item_id: string | null;
  activity_id: string | null;
  updated_at: string;
  to_check?: boolean;
  riser_id?: string | null;
};
export type Pt = [number, number];
export type DRoute = {
  id: string;
  drawing_id: string;
  kind: string;
  pts: Pt[];
  label: string | null;
  status: string;
  laid: number;
  area: number | null;
  cores: number | null;
  boq_item_id: string | null;
  activity_id: string | null;
  to_check?: boolean;
};
export type DEvent = { id: number; item_id: string | null; route_id: string | null; what: string; from_status: string | null; to_status: string | null; note: string | null; by_id: string | null; at: string };

export const DISC: Record<Disc, { name: string; c: string }> = {
  light: { name: 'Lighting', c: '#C99700' },
  power: { name: 'Power', c: '#D1495B' },
  elv: { name: 'ELV (fire, CCTV, PA, access)', c: '#8E5EC9' },
  net: { name: 'Network & data', c: '#2E86AB' },
  hvac: { name: 'Fans & HVAC', c: '#0B7285' },
  lms: { name: 'Lighting control', c: '#2E9E44' },
  bms: { name: 'BMS', c: '#C0562A' },
  fiber: { name: 'Fibre', c: '#0F9D7A' },
  cont: { name: 'Containment', c: '#7D6B5D' },
  out: { name: 'Outdoor – poles & masts', c: '#3D5A80' },
};

export type Kind = { d: Disc; name: string; code: string; big?: boolean };
export const KINDS: Record<string, Kind> = {
  down: { d: 'light', name: 'Downlight', code: 'DL' },
  downip: { d: 'light', name: 'Downlight IP65', code: 'DLW' },
  lin: { d: 'light', name: 'Linear luminaire', code: 'LN' },
  panel: { d: 'light', name: 'Panel light', code: 'PL' },
  spot: { d: 'light', name: 'Spot / track light', code: 'SP' },
  wall: { d: 'light', name: 'Wall light', code: 'WL' },
  ext: { d: 'light', name: 'External / facade light', code: 'XL' },
  emerg: { d: 'light', name: 'Emergency light', code: 'EM' },
  exit: { d: 'light', name: 'Exit sign', code: 'EX' },
  sw: { d: 'light', name: 'Light switch', code: 'SW' },
  so: { d: 'power', name: 'Socket outlet', code: 'SO' },
  fb: { d: 'power', name: 'Floor box', code: 'FB' },
  fs: { d: 'power', name: 'Fused spur', code: 'FS' },
  is: { d: 'power', name: 'Isolator', code: 'IS' },
  db: { d: 'power', name: 'Distribution board', code: 'DB', big: true },
  mc: { d: 'power', name: 'Machine', code: 'M', big: true },
  ap: { d: 'power', name: 'Appliance', code: 'AP' },
  sd: { d: 'elv', name: 'Smoke / heat detector', code: 'SD' },
  cp: { d: 'elv', name: 'Manual call point', code: 'CP' },
  snd: { d: 'elv', name: 'Sounder / beacon', code: 'SB' },
  fap: { d: 'elv', name: 'Fire alarm panel', code: 'FAP', big: true },
  cc: { d: 'elv', name: 'CCTV camera', code: 'CC' },
  ac: { d: 'elv', name: 'Access card reader', code: 'AC' },
  pa: { d: 'elv', name: 'PA speaker', code: 'PA' },
  dp: { d: 'net', name: 'Data point', code: 'D' },
  wap: { d: 'net', name: 'Wi-Fi access point', code: 'WAP' },
  rack: { d: 'net', name: 'Comms rack', code: 'CR', big: true },
  hcf: { d: 'hvac', name: 'Ceiling fan', code: 'CF' },
  hxf: { d: 'hvac', name: 'Exhaust fan', code: 'XF' },
  hfcu: { d: 'hvac', name: 'Fan coil unit', code: 'FCU', big: true },
  hsac: { d: 'hvac', name: 'Split AC indoor unit', code: 'SAC', big: true },
  hodu: { d: 'hvac', name: 'AC outdoor unit / VRF', code: 'ODU', big: true },
  hahu: { d: 'hvac', name: 'Air handling unit', code: 'AHU', big: true },
  hth: { d: 'hvac', name: 'Thermostat', code: 'TH' },
  lps: { d: 'lms', name: 'Control power supply', code: 'PS', big: true },
  lgw: { d: 'lms', name: 'Router / gateway / controller', code: 'GW', big: true },
  lact: { d: 'lms', name: 'Relay / switch actuator', code: 'ACT', big: true },
  ldim: { d: 'lms', name: 'Dimmer / DALI gateway', code: 'DIM', big: true },
  lpb: { d: 'lms', name: 'Push button / keypad', code: 'PB' },
  lpd: { d: 'lms', name: 'Presence / daylight sensor', code: 'PD' },
  bddc: { d: 'bms', name: 'BMS controller (DDC)', code: 'DDC', big: true },
  bgw: { d: 'bms', name: 'BMS gateway', code: 'BGW', big: true },
  bsen: { d: 'bms', name: 'Room sensor', code: 'TS' },
  bact: { d: 'bms', name: 'Valve / damper actuator', code: 'VA' },
  bvfd: { d: 'bms', name: 'Variable speed drive', code: 'VFD', big: true },
  riser: { d: 'cont', name: 'Riser (through the floors)', code: 'R', big: true },
  pole: { d: 'out', name: 'Street-light / area pole', code: 'P' },
  mast: { d: 'out', name: 'High mast', code: 'HM', big: true },
  fpil: { d: 'out', name: 'Feeder pillar', code: 'FP', big: true },
  bol: { d: 'out', name: 'Bollard', code: 'BL' },
  ept: { d: 'out', name: 'Earth pit', code: 'E' },
};
export const kindOf = (k: string): Kind => KINDS[k] ?? { d: 'power', name: k, code: '?' };
export const scopeOf = (k: string): keyof Scope => (kindOf(k).d === 'lms' ? 'lms' : kindOf(k).d === 'bms' ? 'bms' : kindOf(k).d === 'out' ? 'outdoor' : 'services');

// stages – the key is stored; the words depend on the discipline
export const STATUS_COLOR: Record<string, string> = {
  planned: '#9AA0A8', first: '#2F6FD1', wired: '#D9921A', second: '#D9921A', addr: '#D9921A', prog: '#8E5EC9', p2p: '#8E5EC9', tested: '#12949B', done: '#1E8A4C', failed: '#D33A2C',
  fixed: '#D9921A', laid: '#2F6FD1', term: '#D9921A',
};
const ITEM_STEPS: [string, string][] = [['planned', 'Planned'], ['first', '1st fix'], ['second', '2nd fix'], ['tested', 'Tested'], ['done', 'Commissioned'], ['failed', 'Failed test']];
const BMS_STEPS: [string, string][] = [['planned', 'Planned'], ['first', 'Installed'], ['wired', 'Wired & terminated'], ['p2p', 'Point-to-point checked'], ['tested', 'Commissioned'], ['failed', 'Failed test']];
export const LMS_SYSTEMS: Record<string, { addr: string; steps: [string, string, string, string]; file: string }> = {
  KNX: { addr: 'Physical address', steps: ['Installed', 'Address set', 'Programmed', 'Tested'], file: 'ETS project' },
  DALI: { addr: 'Short address / group', steps: ['Installed', 'Addressed', 'Grouped & scenes set', 'Tested'], file: 'DALI commissioning export' },
  Casambi: { addr: 'Node', steps: ['Installed', 'Paired to the network', 'Scenes & timers set', 'Tested'], file: 'Casambi network backup' },
  Dynalite: { addr: 'Box number / area', steps: ['Installed', 'Box number set', 'Programmed', 'Tested'], file: 'DLight project' },
  DMX: { addr: 'Universe · start channel', steps: ['Installed', 'DMX address set', 'Patched', 'Tested'], file: 'DMX patch sheet' },
  '0–10 V': { addr: 'Zone', steps: ['Installed', 'Wired', 'Zone set', 'Tested'], file: 'Zone & wiring schedule' },
};
const OUT_STEPS: [string, string][] = [['planned', 'Planned'], ['first', 'Foundation cast'], ['wired', 'Erected'], ['second', 'Wired & luminaires fitted'], ['tested', 'Tested & aimed'], ['done', 'Commissioned'], ['failed', 'Failed test']];
const RISER_STEPS: [string, string][] = [['planned', 'Planned'], ['first', 'Opening & sleeves ready'], ['done', 'Fire-stopped & inspected']];
export function stepsFor(kind: string, lms = 'KNX'): [string, string][] {
  const d = kindOf(kind).d;
  if (kind === 'riser') return RISER_STEPS;
  if (d === 'out') return OUT_STEPS;
  if (d === 'bms') return BMS_STEPS;
  if (d === 'lms') {
    const s = (LMS_SYSTEMS[lms] ?? LMS_SYSTEMS.KNX).steps;
    return [['planned', 'Planned'], ['first', s[0]], ['addr', s[1]], ['prog', s[2]], ['tested', s[3]], ['failed', 'Failed test']];
  }
  return ITEM_STEPS;
}
export const stepLabel = (kind: string, st: string, lms?: string) => stepsFor(kind, lms).find((s) => s[0] === st)?.[1] ?? st;
export const WEIGHT: Record<string, number> = { planned: 0, first: 0.4, wired: 0.6, second: 0.75, addr: 0.75, failed: 0.75, prog: 0.85, p2p: 0.85, tested: 0.9, done: 1 };
export const installed = (st: string) => (WEIGHT[st] ?? 0) >= 0.75;

// checks and readings per item type
type Check = [string, string];
type Reading = [string, string, string];
const HV: Check[] = [['iso', 'Isolator within sight, can be locked off'], ['cable', 'Supply cable and gland as the schedule'], ['earth', 'Earthed – refrigerant / duct bonding where needed'], ['ctrl', 'Control wiring (thermostat / BMS) terminated'], ['run', 'Run test with the mechanical contractor – current measured']];
const LUM: Check[] = [['model', 'Make / model as approved'], ['fix', 'Fixed level and secure'], ['term', 'Terminated, earth connected'], ['works', 'Works from its switch / control']];
export const CHECKS: Record<string, [Check[], Reading[]]> = {
  down: [LUM, []], downip: [[...LUM, ['ip', 'Gasket / IP seal intact']], []], lin: [LUM, []], panel: [LUM, []], spot: [LUM, []], wall: [LUM, []], ext: [[...LUM, ['ip', 'Gland / IP seal intact']], []],
  emerg: [[...LUM, ['dur', '3-hour duration test passed']], [['dur', 'Duration', 'h']]], exit: [[...LUM, ['dur', '3-hour duration test passed']], [['dur', 'Duration', 'h']]],
  sw: [[['circuit', 'Switches the right lights'], ['way', '2-way / intermediate correct'], ['height', 'Height and alignment as the drawing'], ['plate', 'Faceplate level, not damaged']], []],
  so: [[['height', 'Height and level as the drawing'], ['polar', 'Polarity correct'], ['earth', 'Earth continuity (R1 + R2)'], ['rcd', 'RCD trip tested'], ['label', 'Circuit labelled on the faceplate']], [['r12', 'R1 + R2', 'Ω']]],
  fb: [[['level', 'Flush with the floor, lid works'], ['polar', 'Polarity correct'], ['earth', 'Earth continuity (R1 + R2)'], ['data', 'Data outlets terminated'], ['label', 'Labelled']], [['r12', 'R1 + R2', 'Ω']]],
  fs: [[['fuse', 'Fuse rating as the schedule'], ['polar', 'Polarity correct'], ['earth', 'Earth continuity'], ['label', 'Labelled with what it feeds']], [['fuse', 'Fuse', 'A']]],
  is: [[['rating', 'Rating as the schedule'], ['lock', 'Can be locked off'], ['label', 'Labelled']], []],
  mc: [[['iso', 'Isolator fixed'], ['cable', 'Supply cable laid'], ['conn', 'Connected, phase rotation checked'], ['test', 'IR and Zs tested'], ['vendor', 'Commissioned by the vendor']], [['a', 'Running current', 'A']]],
  ap: [[['conn', 'Connected'], ['test', 'Tested and working']], []],
  db: [[['fix', 'Fixed, level, glands and gland plate'], ['term', 'All circuits terminated and torqued'], ['label', 'Circuits labelled, DB chart in the door'], ['ir', 'IR and Zs tested'], ['rcd', 'RCDs tested']], []],
  sd: [[['base', 'Base fixed, address set'], ['loop', 'On its loop'], ['test', 'Smoke / heat test from the panel']], []], cp: [[['fix', 'Fixed at the right height'], ['test', 'Tested from the panel']], []],
  snd: [[['fix', 'Fixed'], ['test', 'Sounds / flashes on test']], []], fap: [[['fix', 'Fixed, supply and batteries'], ['loops', 'All loops healthy'], ['cause', 'Cause & effect tested']], []],
  cc: [[['fix', 'Fixed and aimed'], ['poe', 'Network / PoE up'], ['view', 'View agreed with the client']], []], ac: [[['fix', 'Fixed'], ['test', 'Opens the door with a card'], ['fire', 'Releases on fire alarm']], []],
  pa: [[['fix', 'Fixed'], ['zone', 'On its zone'], ['test', 'Heard on test']], []],
  dp: [[['term', 'Terminated T568B at both ends'], ['link', 'Permanent link test passed'], ['label', 'Outlet label = patch-panel port'], ['plate', 'Faceplate fixed']], [['len', 'Length', 'm'], ['next', 'NEXT margin', 'dB']]],
  wap: [[['link', 'Cable tested'], ['poe', 'PoE up on the switch'], ['mount', 'Mounted and secured'], ['label', 'Labelled']], [['len', 'Length', 'm']]],
  rack: [[['fix', 'Fixed and earthed'], ['patch', 'Patching labelled'], ['power', 'Power and UPS']], []],
  hcf: [[['fix', 'Hook / fixing load-tested'], ['reg', 'Regulator wired – every speed works'], ['rot', 'Turns the right way'], ['wobble', 'No wobble']], []],
  hxf: [[['duct', 'Connected to the duct'], ['iso', 'Isolator / fused spur fitted'], ['run', 'Runs, air in the right direction']], [['a', 'Running current', 'A']]],
  hfcu: [HV, [['a', 'Running current', 'A']]], hsac: [HV, [['a', 'Running current', 'A']]],
  hodu: [[...HV, ['rot', 'Phase rotation checked (3-phase)']], [['a', 'Running current', 'A'], ['v', 'Voltage at the unit', 'V']]],
  hahu: [[...HV, ['rot', 'Phase rotation checked (3-phase)']], [['a', 'Running current', 'A'], ['v', 'Voltage at the unit', 'V']]],
  hth: [[['wired', 'Wired to its unit'], ['height', 'Height as the drawing'], ['func', 'Controls its unit']], []],
  bsen: [[['fix', 'Fixed'], ['wired', 'Wired to its controller'], ['p2p', 'Reading seen on the BMS graphic']], []],
  bact: [[['fix', 'Fixed'], ['wired', 'Wired to its controller'], ['stroke', 'Strokes fully open / closed from the BMS']], []],
  bvfd: [[['fix', 'Fixed, supply connected'], ['ctrl', 'Control wired to the BMS'], ['run', 'Runs from the BMS, speed follows']], [['a', 'Running current', 'A']]],
  pole: [
    [['found', 'Foundation as the drawing – bolts set to template'], ['cube', 'Concrete cube test passed'], ['plumb', 'Pole plumb, base nuts torqued, grouted'], ['base', 'Cable, fuse and earth terminated in the base compartment'], ['earth', 'Earth resistance within the limit'], ['aim', 'Luminaire tilt / orientation as the design'], ['works', 'Lights from the feeder pillar / photocell']],
    [['ch', 'Chainage', 'm'], ['ht', 'Pole height', 'm'], ['cube28', 'Cube strength (28 days)', 'N/mm²'], ['grade', 'Specified concrete grade', 'N/mm²'], ['earth', 'Earth resistance', 'Ω'], ['tilt', 'Luminaire tilt', '°']],
  ],
  mast: [
    [['found', 'Foundation as the drawing – bolts set to template'], ['cube', 'Concrete cube test passed'], ['vert', 'Mast vertical within tolerance, base grouted'], ['lower', 'Lowering gear / winch tested up and down'], ['lp', 'Lightning finial and down-conductor fixed'], ['earth', 'Earth resistance within the limit'], ['aim', 'Every head aimed as the aiming schedule'], ['lux', 'Lux readings taken on the grid']],
    [['ch', 'Chainage / grid', 'm'], ['ht', 'Mast height', 'm'], ['cube28', 'Cube strength (28 days)', 'N/mm²'], ['grade', 'Specified concrete grade', 'N/mm²'], ['vert', 'Out of vertical at the top', 'mm'], ['earth', 'Earth resistance', 'Ω'], ['aim', 'Aiming (head: tilt / bearing …)', ''], ['lux', 'Average lux on the grid', 'lx']],
  ],
  fpil: [[['found', 'Plinth cast, pillar fixed'], ['term', 'Incoming and outgoing cables terminated'], ['ir', 'IR and Zs tested'], ['timer', 'Photocell / timer set'], ['earth', 'Earth resistance within the limit'], ['label', 'Circuits labelled']], [['earth', 'Earth resistance', 'Ω']]],
  bol: [[['found', 'Base cast, bollard fixed'], ['term', 'Terminated, IP gland sealed'], ['works', 'Lights from its circuit']], []],
  ept: [[['rod', 'Rod driven, chamber cast'], ['conn', 'Connected and labelled'], ['test', 'Resistance measured']], [['earth', 'Earth resistance', 'Ω']]],
};
/** reading flags for poles, masts and pits (cube below grade, earth above 10 Ω) */
export function readingFlags(it: Pick<DItem, 'kind' | 'readings'>): string[] {
  const r = it.readings ?? {}, n = (k: string) => (r[k] != null && r[k] !== '' && !Number.isNaN(Number(r[k])) ? Number(r[k]) : null);
  const out: string[] = [];
  const cube = n('cube28'), grade = n('grade'), earth = n('earth');
  if (cube != null && grade != null && cube < grade) out.push(`Cube ${cube} below grade ${grade} N/mm²`);
  if (earth != null && earth > 10) out.push(`Earth ${earth} Ω – above 10 Ω`);
  return out;
}

// DB components and their own checks
export const PTYPES: Record<string, { name: string; checks: Check[]; readings: Reading[] }> = {
  acb: { name: 'ACB', checks: [['rating', 'Frame / rating as the schedule'], ['settings', 'Protection settings (Ir, Isd, Ii) as the coordination study'], ['inj', 'Secondary-injection trip test passed'], ['mech', 'Racks in / out, closes and trips by hand'], ['inter', 'Interlocks and auxiliary contacts work'], ['torque', 'Busbar connections torqued']], readings: [['ir', 'Ir setting', 'A'], ['trip', 'Trip time on injection', 's']] },
  mccb: { name: 'MCCB', checks: [['rating', 'Rating as the schedule'], ['settings', 'Thermal / magnetic settings as the schedule'], ['torque', 'Terminals torqued'], ['trip', 'Push-to-trip works'], ['label', 'Labelled']], readings: [['set', 'Setting', 'A']] },
  mcb: { name: 'MCB', checks: [['rating', 'Rating and curve as the schedule'], ['torque', 'Terminals torqued'], ['label', 'Labelled']], readings: [] },
  rcbo: { name: 'RCBO', checks: [['rating', 'Rating, curve and mA as the schedule'], ['torque', 'Terminals torqued'], ['trip', 'Trip test (×1 and ×5) passed'], ['btn', 'Test button works']], readings: [['t1', 'Trip time at ×1', 'ms'], ['t5', 'Trip time at ×5', 'ms']] },
  rccb: { name: 'RCCB', checks: [['rating', 'Rating and mA as the schedule'], ['trip', 'Trip test (×1 and ×5) passed'], ['btn', 'Test button works']], readings: [['t1', 'Trip time at ×1', 'ms'], ['t5', 'Trip time at ×5', 'ms']] },
  isol: { name: 'Isolator / switch-disconnector', checks: [['rating', 'Rating as the schedule'], ['lock', 'Can be padlocked off'], ['torque', 'Terminals torqued']], readings: [] },
  fuse: { name: 'Fuse / switch-fuse', checks: [['rating', 'Fuse rating as the schedule'], ['spare', 'Spare fuses left in the board']], readings: [] },
  meter: { name: 'Energy meter', checks: [['ratio', 'CT ratio programmed in the meter'], ['wiring', 'Voltage and CT wiring to the diagram'], ['phase', 'Phase sequence and power direction right'], ['read', 'Reading checked against a clamp meter'], ['comm', 'Communication to the BMS / EMS (if any)']], readings: [['kw', 'Load seen on the meter', 'kW']] },
  ct: { name: 'Current transformer (CT)', checks: [['ratio', 'Ratio and class as the schedule'], ['pol', 'Polarity – P1 towards the supply'], ['short', 'Shorting link fitted'], ['earth', 'Secondary earthed at one point']], readings: [] },
  vt: { name: 'Voltage transformer (VT)', checks: [['ratio', 'Ratio as the schedule'], ['fuse', 'Primary / secondary fuses fitted'], ['earth', 'Secondary earthed']], readings: [] },
  relay: { name: 'Protection relay', checks: [['settings', 'Settings as the coordination study'], ['inj', 'Secondary-injection test passed'], ['trip', 'Trips its breaker'], ['print', 'Settings printout kept']], readings: [] },
  spd: { name: 'Surge protection device (SPD)', checks: [['type', 'Type / class as the schedule'], ['back', 'Back-up fuse / MCB fitted'], ['earth', 'Earthed with the shortest lead'], ['ind', 'Status window shows healthy']], readings: [] },
  cont: { name: 'Contactor', checks: [['coil', 'Coil voltage right'], ['ctrl', 'Switches from its control (timer, photocell, BMS)'], ['label', 'Labelled']], readings: [] },
  timer: { name: 'Timer / photocell', checks: [['set', 'Times / lux set as agreed'], ['works', 'Switches its contactor']], readings: [] },
  ctrl: { name: 'Control components (relays, indicators, selector)', checks: [['wiring', 'Wired to the control diagram'], ['func', 'Functions tested'], ['lamps', 'Indicator lamps work']], readings: [] },
  apfc: { name: 'Power factor correction (APFC)', checks: [['steps', 'Capacitor steps and ratings as the schedule'], ['ct', 'CT in the right place and phase'], ['target', 'Target power factor set'], ['auto', 'Switches steps in auto'], ['vent', 'Ventilation / fans work']], readings: [['pf', 'Power factor achieved', '']] },
  busbar: { name: 'Busbar', checks: [['torque', 'Joints torqued and marked'], ['ir', 'Insulation resistance tested'], ['shroud', 'Shrouds and barriers fitted']], readings: [['ir', 'Insulation resistance', 'MΩ']] },
  encl: { name: 'Enclosure', checks: [['ip', 'IP rating and gland plate as the schedule'], ['earth', 'Door and enclosure bonded'], ['chart', 'DB chart and danger label fixed']], readings: [] },
  other: { name: 'Other component', checks: [['ok', 'Fitted and tested']], readings: [] },
};
export const ptypeOf = (t: string) => PTYPES[t] ?? PTYPES.other;
export const PART_STEPS: [string, string][] = [['planned', 'Planned'], ['fitted', 'Fitted'], ['tested', 'Tested'], ['failed', 'Failed']];
export type DPart = { id: string; item_id: string; seq: number; ptype: string; ref: string | null; rating: string | null; poles: string | null; make: string | null; qty: number; status: string; checks: Record<string, boolean>; readings: Record<string, string>; note: string | null };
export type DCircuit = { id: string; item_id: string; seq: number; ref: string; description: string | null; phase: string | null; device: string | null; cable: string | null; zs_max: number | null; status: string; readings: Record<string, string | boolean>; note: string | null; tested_by: string | null; tested_at: string | null };
export type DPin = { id: string; item_id: string | null; x: number; y: number; kind: string; title: string; ref_type: string | null; ref_id: string | null; ref_code: string | null; state: string; open: boolean; raised_by: string | null; raised_at: string; closed_at: string | null; close_note: string | null };
export const PIN_KINDS: Record<string, { name: string; c: string; sign: string }> = {
  query: { name: 'Design query', c: '#2F6FD1', sign: '?' },
  snag: { name: 'Snag', c: '#D9921A', sign: 'S' },
  hse: { name: 'HSE', c: '#D33A2C', sign: '!' },
  clash: { name: 'Clash', c: '#8E5EC9', sign: '×' },
  note: { name: 'Note', c: '#646A72', sign: 'i' },
};
export type DTest = { id: string; exec_project_id: string; drawing_id: string | null; kind: 'scene' | 'cne'; seq: number; name: string; area: string | null; cause: string | null; effect: string | null; items: string[]; status: string; result_note: string | null; witness: string | null; tested_by: string | null; tested_at: string | null };
export type Riser = { id: string; exec_project_id: string; name: string; floor_height_m: number; note: string | null };
export type RiserRun = { id: string; riser_id: string; kind: string; label: string | null; from_level: number; to_level: number; status: string; laid: number; area: number | null; cores: number | null; boq_item_id: string | null; activity_id: string | null; note: string | null };
export const checksFor = (kind: string) => CHECKS[kind] ?? [[], []];
export const emptyChecks = (kind: string) => Object.fromEntries(checksFor(kind)[0].map(([k]) => [k, false]));

// routes: containment and cables
export type RouteKind = { d: Disc; name: string; w: number; cap?: number; limit?: number; area?: number; xs?: { w: number; h: number; type: 'ladder' | 'tray' | 'trunk' } | { d: number; type: 'tube' } };
export const ROUTES: Record<string, RouteKind> = {
  ladder: { d: 'cont', name: 'Cable ladder 300 mm', w: 18, cap: 30000, limit: 50, xs: { w: 300, h: 100, type: 'ladder' } },
  tray: { d: 'cont', name: 'Cable tray 300 mm (perforated)', w: 13, cap: 15000, limit: 40, xs: { w: 300, h: 50, type: 'tray' } },
  trunk: { d: 'cont', name: 'Trunking 100 × 50 mm (2 compartments)', w: 11, cap: 5000, limit: 45, xs: { w: 100, h: 50, type: 'trunk' } },
  cond: { d: 'cont', name: 'PVC conduit 20 mm', w: 5, cap: 227, limit: 40, xs: { d: 17, type: 'tube' } },
  pvc25: { d: 'cont', name: 'PVC conduit 25 mm', w: 6, cap: 346, limit: 40, xs: { d: 21, type: 'tube' } },
  gi20: { d: 'cont', name: 'GI conduit 20 mm', w: 5, cap: 227, limit: 40, xs: { d: 17, type: 'tube' } },
  gi: { d: 'cont', name: 'GI conduit 25 mm', w: 6, cap: 380, limit: 40, xs: { d: 22, type: 'tube' } },
  gi32: { d: 'cont', name: 'GI conduit 32 mm', w: 7, cap: 660, limit: 40, xs: { d: 29, type: 'tube' } },
  flex: { d: 'cont', name: 'Flexible conduit 20 mm', w: 5, cap: 200, limit: 40, xs: { d: 16, type: 'tube' } },
  pw: { d: 'power', name: 'Power cable', w: 2.2, area: 60 },
  elv: { d: 'elv', name: 'ELV cable (fire, PA, CCTV)', w: 2.2, area: 40 },
  net: { d: 'net', name: 'Cat 6 cable', w: 2.2, area: 30 },
  fib: { d: 'fiber', name: 'Fibre cable', w: 2.2, area: 50 },
  lmsc: { d: 'lms', name: 'Lighting control cable (KNX / DALI / DMX)', w: 2.2, area: 25 },
  bmsc: { d: 'bms', name: 'BMS bus cable', w: 2.2, area: 30 },
  ug: { d: 'out', name: 'Underground cable (armoured)', w: 2.6, area: 300 },
};
export const routeOf = (k: string): RouteKind => ROUTES[k] ?? { d: 'power', name: k, w: 2.2, area: 60 };
export const isCont = (k: string) => routeOf(k).d === 'cont';
export const CONT_STEPS: [string, string][] = [['planned', 'Planned'], ['fixed', 'Fixed'], ['done', 'Inspected']];
export const CABLE_STEPS: [string, string][] = [['planned', 'Planned'], ['laid', 'Laying'], ['term', 'Terminated'], ['tested', 'Tested'], ['failed', 'Failed test']];

// geometry in sheet units: x in 0..1000, y in 0..1000·h/w (so distances are true to the sheet)
export const toU = (d: Pick<Drawing, 'width' | 'height'>, p: Pt): Pt => [p[0] * 1000, (p[1] * 1000 * d.height) / d.width];
export const fromU = (d: Pick<Drawing, 'width' | 'height'>, p: Pt): Pt => [p[0] / 1000, (p[1] * d.width) / (1000 * d.height)];
export const lenU = (pts: Pt[]) => pts.reduce((t, p, i) => (i ? t + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);
/** metres of a route (null without a scale) */
export const routeMetres = (d: Drawing, r: Pick<DRoute, 'pts'>) => (d.width_m ? (lenU(r.pts.map((p) => toU(d, p))) / 1000) * d.width_m : null);

function segDist(x: number, y: number, a: Pt, b: Pt) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2));
  return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
}
/** the containment a cable runs in, and the share of the cable inside it */
export function runsIn(d: Drawing, cable: DRoute, routes: DRoute[]): Map<string, number> {
  const out = new Map<string, number>();
  const cont = routes.filter((r) => isCont(r.kind)).map((r) => ({ r, pts: r.pts.map((p) => toU(d, p)) }));
  const pts = cable.pts.map((p) => toU(d, p));
  const total = lenU(pts) || 1;
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let t = 1.25; t < L; t += 2.5) {
      const x = a[0] + ((b[0] - a[0]) * t) / L, y = a[1] + ((b[1] - a[1]) * t) / L;
      const hit = cont.find((c) => c.pts.some((q, j) => j > 0 && segDist(x, y, c.pts[j - 1], q) <= routeOf(c.r.kind).w / 2 + 2));
      if (hit) out.set(hit.r.id, (out.get(hit.r.id) ?? 0) + 2.5 / total);
    }
  }
  return out;
}
export const cableArea = (r: DRoute) => Number(r.area ?? routeOf(r.kind).area ?? 30) * (r.cores ?? 1);
export function cablesIn(d: Drawing, cont: DRoute, routes: DRoute[]) {
  return routes.filter((r) => !isCont(r.kind) && runsIn(d, r, routes).has(cont.id));
}
export function fillPct(d: Drawing, cont: DRoute, routes: DRoute[]) {
  const k = routeOf(cont.kind);
  return k.cap ? Math.round((100 * cablesIn(d, cont, routes).reduce((t, r) => t + cableArea(r), 0)) / k.cap) : 0;
}

/** snapping while drawing: existing points, straight runs, onto containment, a fine grid (sheet units) */
export function snap(d: Drawing, routes: DRoute[], draft: Pt[], p: Pt, ortho: boolean, onCont: boolean): Pt {
  const prev = draft.length ? draft[draft.length - 1] : null;
  for (const r of routes)
    for (const q0 of r.pts) {
      const q = toU(d, q0);
      if (Math.hypot(q[0] - p[0], q[1] - p[1]) <= 8 && (!prev || !ortho || Math.abs(q[0] - prev[0]) < 0.5 || Math.abs(q[1] - prev[1]) < 0.5)) return q;
    }
  let x = Math.round(p[0] / 2.5) * 2.5, y = Math.round(p[1] / 2.5) * 2.5;
  if (prev && ortho) {
    if (Math.abs(p[0] - prev[0]) >= Math.abs(p[1] - prev[1])) y = prev[1];
    else x = prev[0];
  }
  if (onCont)
    for (const r of routes) {
      if (!isCont(r.kind)) continue;
      const pts = r.pts.map((q) => toU(d, q));
      const tol = routeOf(r.kind).w / 2 + 5;
      for (let j = 1; j < pts.length; j++) {
        const [a, b] = [pts[j - 1], pts[j]];
        if (Math.abs(a[1] - b[1]) < 0.5 && x >= Math.min(a[0], b[0]) - tol && x <= Math.max(a[0], b[0]) + tol && Math.abs(y - a[1]) <= tol && (!prev || !ortho || Math.abs(p[0] - prev[0]) < Math.abs(p[1] - prev[1]) || Math.abs(prev[1] - a[1]) <= tol)) y = a[1];
        if (Math.abs(a[0] - b[0]) < 0.5 && y >= Math.min(a[1], b[1]) - tol && y <= Math.max(a[1], b[1]) + tol && Math.abs(x - a[0]) <= tol && (!prev || !ortho || Math.abs(p[0] - prev[0]) >= Math.abs(p[1] - prev[1]) || Math.abs(prev[0] - a[0]) <= tol)) x = a[0];
      }
    }
  return [x, y];
}

/** offset polyline (mitred) – ladder rails, trunking lid lines */
export function offsetLine(pts: Pt[], dd: number): Pt[] {
  const n = (a: Pt, b: Pt): Pt => {
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    return [-dy / l, dx / l];
  };
  return pts.map((p, i) => {
    const n1 = i > 0 ? n(pts[i - 1], p) : null, n2 = i < pts.length - 1 ? n(p, pts[i + 1]) : null;
    if (!n1 || !n2) {
      const q = (n1 ?? n2)!;
      return [p[0] + q[0] * dd, p[1] + q[1] * dd];
    }
    let m: Pt = [n1[0] + n2[0], n1[1] + n2[1]];
    const ml = Math.hypot(m[0], m[1]) || 1;
    m = [m[0] / ml, m[1] / ml];
    const k = dd / Math.max(0.3, m[0] * n1[0] + m[1] * n1[1]);
    return [p[0] + m[0] * k, p[1] + m[1] * k];
  });
}

/** cables laid in a cross-section, from the bottom (mm); a tube is a circle */
export type Circle = { r: number; col: string; d: Disc; x: number; y: number; nofit?: boolean };
export function packIn(cs: { r: number; col: string; d: Disc }[], x0: number, x1: number, tube?: { cx: number; R: number }): Circle[] {
  const placed: Circle[] = [];
  for (const c of cs) {
    let pos: { x: number; y: number } | null = null;
    outer: for (let y = c.r; y < (tube ? 2 * tube.R - c.r + 0.01 : 400); y += 0.5)
      for (let x = x0 + c.r; x <= x1 - c.r + 0.01; x += 0.5) {
        if (tube && Math.hypot(x - tube.cx, y - tube.R) > tube.R - c.r + 0.01) continue;
        if (placed.every((p) => Math.hypot(p.x - x, p.y - y) >= p.r + c.r - 0.05)) {
          pos = { x, y };
          break outer;
        }
      }
    placed.push({ ...c, ...(pos ?? { x: 0, y: -1, nofit: true }) });
  }
  return placed;
}
const PER: Partial<Record<Disc, number>> = { power: 60, elv: 40, net: 30, fiber: 50, lms: 25, bms: 30, out: 300 };
export function cableCircles(cs: DRoute[]) {
  const out: { r: number; col: string; d: Disc }[] = [];
  for (const c of cs) {
    // area = outside cross-section of one cable (mm²), cores = cables in the run
    const k = routeOf(c.kind), A = Number(c.area ?? k.area ?? PER[k.d] ?? 30), n = Math.max(1, c.cores ?? 1);
    const r = Math.sqrt(A / Math.PI);
    for (let i = 0; i < Math.min(n, 120); i++) out.push({ r, col: DISC[k.d].c, d: k.d });
  }
  return out.sort((a, b) => b.r - a.r);
}

// files: the drawing image lives in the private "drawings" bucket under <project id>/
export async function signedImage(path: string) {
  const { data, error } = await supabase.storage.from('drawings').createSignedUrl(path, 3600);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}
