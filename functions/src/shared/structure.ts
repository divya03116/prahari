/**
 * Incident structuring: turns a worker's free-text or voice report (or a camera
 * PPE violation) into structured safety information.
 * Canonical source: functions/src/shared/ — synced into src/shared/.
 *
 * Deliberately extractive and deterministic. Every field is either found in
 * the report itself, computed by the scoring engine from the report, or set to
 * NOT_SPECIFIED. Nothing is invented; the original report is always kept.
 */

import type { Assessment, CapaStep } from './engine.js';
import { HAZARDS as HAZARD_INFO, type HazardType } from './hazards.js';
import { PPE_LABEL, type PpeType } from './ppe.js';

export const NOT_SPECIFIED = 'Not specified';
export const STRUCTURER_VERSION = 'rules-1';

export type ReportSource = 'text' | 'voice' | 'photo' | 'camera';
export const SOURCE_LABEL: Record<ReportSource, string> = {
  text: 'Worker text report',
  voice: 'Worker voice report',
  photo: 'Worker photo (AI check)',
  camera: 'Camera AI detection',
};

export interface StructuredIncident {
  title: string;
  description: string;
  hazardType: string;
  location: string;
  severity: string;
  potentialConsequence: string;
  recommendedAction: string;
  originalReport: string;
  source: ReportSource;
  method: typeof STRUCTURER_VERSION;
}

interface HazardRule {
  hazard: string;
  rx: RegExp;
  /** Builds the short title noun from the match, e.g. "Oil spill". */
  noun: (m: RegExpMatchArray) => string;
  consequence: string;
  action: string;
}

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * Ordered: the first rule that matches decides the hazard type. Consequences
 * and actions are the standard ones for that hazard class, not claims about
 * this particular event.
 */
const HAZARDS: HazardRule[] = [
  {
    hazard: 'PPE non-compliance',
    rx: /\b(?:no|without|not wearing|missing|removed (?:his|her|their)?)\s+(?:a\s+|any\s+|the\s+)?(?:required\s+)?(?:safety\s+)?(helmet|hard ?hat|vest|harness|gloves|goggles|boots|ppe)\b/i,
    noun: (m) => `Missing ${m[1].toLowerCase().replace('hard hat', 'helmet').replace('hardhat', 'helmet')}`,
    consequence: 'More severe injury if an incident occurs while unprotected',
    action: 'Stop the worker and make sure the required PPE is worn before work continues.',
  },
  {
    hazard: 'Unauthorised entry',
    rx: /\b(restricted (?:zone|area)|exclusion zone|no-go (?:zone|area)|danger zone)\b/i,
    noun: () => 'Entry into a restricted zone',
    consequence: 'Contact with the hazard the zone keeps people away from',
    action: 'Get the person out of the zone and find out how they got past the access controls.',
  },
  {
    hazard: 'Gas release',
    rx: /\b(gas|h2s|hydrocarbon|vapou?r|fumes?|smell of gas)\b[^.]*?\b(leak(?:ing|ed)?|release[d]?|escaping|detected)\b|\bgas leak\b/i,
    noun: () => 'Gas release',
    consequence: 'Fire, explosion or toxic exposure',
    action: 'Evacuate and isolate the area, remove ignition sources and check with a gas detector.',
  },
  {
    hazard: 'Fire / explosion',
    rx: /\b(fire|smoke|flames?|burning|explosion|sparks?)\b/i,
    noun: (m) => cap(m[1].toLowerCase()),
    consequence: 'Burns, explosion or smoke inhalation',
    action: 'Raise the alarm, isolate ignition sources, and fight the fire only if trained and safe to do so.',
  },
  {
    hazard: 'Slip / trip',
    rx: /\b(?:(oil|diesel|grease|water|chemical|fuel)\s+(?:is\s+|was\s+|has\s+been\s+|got\s+)?)?(spill(?:ed|age)?|leak(?:ing|ed)? on(?:to)? the floor|slippery|wet floor|puddle)\b/i,
    noun: (m) => (m[1] ? `${cap(m[1].toLowerCase())} spill` : /slip|wet/i.test(m[2]) ? 'Slippery floor' : 'Spill'),
    consequence: 'Slip, trip or fall injury',
    action: 'Restrict access to the area and clean up the spill.',
  },
  {
    hazard: 'Fall from height',
    rx: /\b(scaffold(?:ing)?|ladder|at height|roof|open edge|floor opening|fall(?:ing)? from|guard ?rail)\b/i,
    noun: (m) => `${cap(m[1].toLowerCase())} hazard`,
    consequence: 'Serious injury or fatality from a fall',
    action: 'Stop work at height and restore fall protection before resuming.',
  },
  {
    hazard: 'Slip / trip / fall',
    rx: /\b(lying on the ground|possible fall|fell (?:down|over)|collapsed|tripped)\b/i,
    noun: () => 'Person down',
    consequence: 'Injury from the fall, made worse if nobody notices',
    action: 'Check on the worker now, give first aid if needed, and find out why they fell.',
  },
  {
    hazard: 'Struck by / dropped object',
    rx: /\b(suspended load|crane|dropped object|falling object|under the load|lifting)\b/i,
    noun: (m) => `${cap(m[1].toLowerCase())} hazard`,
    consequence: 'Struck-by injury or fatality',
    action: 'Clear people from the drop zone and stop the lift until it is controlled.',
  },
  {
    hazard: 'Electrical',
    rx: /\b(live (?:wire|cable|panel)|exposed (?:wire|cable)|electric(?:al)? shock|electrocution|sparking panel)\b/i,
    noun: (m) => cap(m[1].toLowerCase()),
    consequence: 'Electric shock or electrocution',
    action: 'Keep people away, isolate the supply and have an electrician make it safe.',
  },
  {
    hazard: 'Caught in machinery',
    rx: /\b(rotating (?:part|shaft|equipment)|guard (?:removed|missing)|unguarded|conveyor|coupling)\b/i,
    noun: (m) => cap(m[1].toLowerCase()),
    consequence: 'Entanglement, crush or amputation injury',
    action: 'Stop and isolate the machine, and refit the guard before restarting.',
  },
  {
    hazard: 'Vehicle / mobile plant',
    rx: /\b(forklift|vehicle|truck|reversing|car|bus|motorcycle|train)\b/i,
    noun: (m) => `${cap(m[1].toLowerCase())} hazard`,
    consequence: 'Struck-by or crush injury',
    action: 'Separate people from the vehicle route and use a banksman.',
  },
  {
    hazard: 'Chemical exposure',
    rx: /\b(acid|caustic|corrosive|chemical)\b/i,
    noun: (m) => `${cap(m[1].toLowerCase())} exposure`,
    consequence: 'Chemical burns or poisoning',
    action: 'Keep people away and contain the release using the correct PPE and spill kit.',
  },
  {
    hazard: 'Confined space',
    rx: /\bconfined space\b/i,
    noun: () => 'Confined space entry',
    consequence: 'Asphyxiation or toxic exposure',
    action: 'Stop the entry; test the atmosphere and put a standby person in place.',
  },
  {
    hazard: 'Distraction',
    rx: /\b(mobile phone|on (?:the|a|his|her|their) phone|texting)\b/i,
    noun: () => 'Phone use at work',
    consequence: 'Loss of attention near moving plant or other hazards',
    action: 'Stop phone use in the work area; take calls only in designated safe areas.',
  },
  {
    hazard: 'Housekeeping',
    rx: /\b(housekeeping|clutter(?:ed)?|debris|scrap|obstruct(?:ed|ion)|blocked (?:exit|walkway))\b/i,
    noun: () => 'Poor housekeeping',
    consequence: 'Trips, blocked escape routes or fire load',
    action: 'Clear the area and keep walkways and exits unobstructed.',
  },
];

/** Engine energy (from the multilingual scorer) → hazard type, when no rule matched. */
const ENERGY_HAZARD: Record<string, string> = {
  Chemical: 'Chemical exposure',
  Pressure: 'Pressure release',
  Gravity: 'Fall from height',
  Electrical: 'Electrical',
  Mechanical: 'Caught in machinery',
  Thermal: 'Fire / explosion',
};

const LOCATION_RX =
  /\b(near|next to|beside|behind|inside|in front of|at|in|on|under|above|around|opposite)\s+(the\s+)?([A-Za-z0-9][A-Za-z0-9\-/ ]{1,40}?)(?=\s*[,.;!?]|\s+(?:and|where|while|with|but|because|when|so|people|workers?|someone|somebody|there|is|was|were|has|had)\b|\s*$)/gi;
const NOT_A_PLACE = /^(the )?(time|moment|morning|evening|night|day|shift|week|once|all|least|risk|place|work|progress|charge|order|use|case)\b/i;

/** The first "near the compressor"-style phrase, or null. Never guessed. */
export function extractLocation(text: string): string | null {
  for (const m of text.matchAll(LOCATION_RX)) {
    const phrase = `${m[2] ?? ''}${m[3]}`.trim();
    if (NOT_A_PLACE.test(phrase) || phrase.split(/\s+/).length > 6) continue;
    return cap(`${m[1].toLowerCase()} ${phrase}`);
  }
  return null;
}

function tierSeverity(a: Pick<Assessment, 'tier' | 'score'> | null): string {
  if (!a) return NOT_SPECIFIED;
  const label = a.tier === 1 ? 'High' : a.tier === 2 ? 'Medium' : 'Low';
  return `${label} — Tier ${a.tier}, SIF potential ${a.score}/100`;
}

function firstSentence(text: string, max = 280): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return NOT_SPECIFIED;
  const cut = clean.length > max ? `${clean.slice(0, max).replace(/\s+\S*$/, '')}…` : clean;
  return /[.!?…।]$/.test(cut) ? cap(cut) : `${cap(cut)}.`;
}

export interface StructureInput {
  text: string;
  source: ReportSource;
  assessment?: Pick<Assessment, 'tier' | 'score' | 'energy' | 'potentialOutcomes'> | null;
  capa?: CapaStep[] | null;
  installationName?: string | null;
  geo?: { lat: number; lng: number; accuracy?: number | null } | null;
  camera?: { label: string } | null;
  ppeMissing?: PpeType[] | null;
  /** A camera hazard (not PPE): the confirmed finding itself. */
  hazard?: { type: HazardType } | null;
}

/** Hazard class of each camera finding, matching the text rules above. */
const CAMERA_HAZARD: Record<HazardType, string> = {
  'restricted-zone': 'Unauthorised entry',
  'vehicle-proximity': 'Vehicle / mobile plant',
  'person-down': 'Slip / trip / fall',
  'blocked-zone': 'Housekeeping',
  'phone-use': 'Distraction',
  fire: 'Fire / explosion',
  smoke: 'Fire / explosion',
};

export function structureReport(input: StructureInput): StructuredIncident {
  const text = input.text ?? '';
  const a = input.assessment ?? null;

  let hazard: HazardRule | undefined;
  let match: RegExpMatchArray | null = null;
  for (const h of HAZARDS) {
    match = text.match(h.rx);
    if (match) {
      hazard = h;
      break;
    }
  }

  const phrase = extractLocation(text);
  const where: string[] = [];
  if (input.camera?.label) where.push(`Camera “${input.camera.label}”`);
  if (phrase) where.push(phrase);
  if (input.installationName) where.push(input.installationName);
  if (input.geo) {
    const acc = input.geo.accuracy ? ` (±${Math.round(input.geo.accuracy)} m)` : '';
    where.push(`GPS ${input.geo.lat.toFixed(5)}, ${input.geo.lng.toFixed(5)}${acc}`);
  }

  // Camera incidents: the violation itself is the fact; name it exactly.
  if (input.source === 'camera' && input.ppeMissing?.length) {
    const items = input.ppeMissing.map((t) => PPE_LABEL[t].toLowerCase()).join(' and ');
    return {
      title: cap(`missing ${items}${input.camera?.label ? ` — ${input.camera.label}` : ''}`),
      description: firstSentence(text, 400),
      hazardType: 'PPE non-compliance',
      location: where.length ? where.join(' · ') : NOT_SPECIFIED,
      severity: tierSeverity(a),
      potentialConsequence: HAZARDS[0].consequence,
      recommendedAction: HAZARDS[0].action,
      originalReport: text,
      source: 'camera',
      method: STRUCTURER_VERSION,
    };
  }

  // Camera hazards: name the confirmed finding exactly, too.
  if (input.source === 'camera' && input.hazard) {
    const rule = HAZARDS.find((h) => h.hazard === CAMERA_HAZARD[input.hazard!.type]);
    return {
      title: `${HAZARD_INFO[input.hazard.type].label}${input.camera?.label ? ` — ${input.camera.label}` : ''}`,
      description: firstSentence(text, 400),
      hazardType: CAMERA_HAZARD[input.hazard.type],
      location: where.length ? where.join(' · ') : NOT_SPECIFIED,
      severity: tierSeverity(a),
      potentialConsequence: rule?.consequence ?? NOT_SPECIFIED,
      recommendedAction: rule?.action ?? NOT_SPECIFIED,
      originalReport: text,
      source: 'camera',
      method: STRUCTURER_VERSION,
    };
  }

  const energyHazard = a?.energy?.[0]?.short ? ENERGY_HAZARD[a.energy[0].short] : undefined;
  const hazardType = hazard?.hazard ?? energyHazard ?? NOT_SPECIFIED;
  const noun = hazard && match ? hazard.noun(match) : null;
  const title = noun ? cap(`${noun}${phrase ? ` ${phrase.toLowerCase()}` : ''}`) : firstSentence(text, 70).replace(/\.$/, '');

  const outcomes = a?.potentialOutcomes?.length ? a.potentialOutcomes.join('; ') : null;
  const capaAction = a && a.tier <= 2 && input.capa?.[0]?.control ? input.capa[0].control : null;

  return {
    title,
    description: firstSentence(text),
    hazardType,
    location: where.length ? where.join(' · ') : NOT_SPECIFIED,
    severity: tierSeverity(a),
    potentialConsequence: hazard?.consequence ?? outcomes ?? NOT_SPECIFIED,
    recommendedAction: hazard?.action ?? capaAction ?? NOT_SPECIFIED,
    originalReport: text,
    source: input.source,
    method: STRUCTURER_VERSION,
  };
}
