// How people lived, as data: the house a building tradition put up, the settlement those houses stood in, and the
// fields around it (docs/DWELLINGS.md). Like a taxon's body, a tradition's dwelling is a few named parameters, each a
// sourced claim; a tradition says only what differs from the broader one it is a member of, and inherits the rest;
// and where no tradition is written for a place and a time, the settlement generator's generic dwelling for the way of
// life and the climate stands in, and says so. Nothing here is a fact about any place: the facts are in the records.

/** A number, or a range of them as a source gives it. */
export type Span = number | { lo: number; hi: number };

/** The words each parameter may take, each with what it means. A claim that needs a new one adds it here, with its meaning. */
export const DWELLING_WORDS = {
  plan: {
    round: 'Circular in plan.',
    oval: 'Oval or elliptical in plan.',
    rectangular: 'Rectangular in plan, longer than wide.',
    square: 'About as wide as it is long.',
    apsidal: 'Rectangular with one or both ends rounded.',
    long: 'A longhouse: many times longer than it is wide, often for several households or for people and animals together.',
    courtyard: 'Rooms around an open court, which the house encloses.',
    'room-block': 'Many rooms joined wall to wall and often stacked, so that houses are cells of one block.',
  },
  walls: {
    mudbrick: 'Sun-dried mud bricks.',
    'fired-brick': 'Bricks fired in a kiln.',
    stone: 'Stone, dry or set in mortar or mud.',
    timber: 'Logs, planks or a timber frame filled with timber.',
    'wattle-and-daub': 'Woven branches plastered with mud or clay.',
    'pole-and-thatch': 'Poles with thatch or leaves tied to them, so that wall and roof are one.',
    reed: 'Bundled or woven reeds.',
    'rammed-earth': 'Earth rammed between boards.',
    cob: 'Solid earth built up by hand in courses, with no frame: cob, daga or puddled mud.',
    hide: 'Hides over a frame.',
    felt: 'Felt over a frame.',
    bark: 'Bark sheets over a frame.',
    sod: 'Cut turf or sod.',
    snow: 'Blocks of snow.',
    none: 'No walls: the roof comes down to the ground.',
  },
  roof: {
    flat: 'Flat.',
    gable: 'Two slopes meeting at a ridge.',
    hip: 'Sloping on all sides.',
    conical: 'A cone, over a round plan.',
    dome: 'A dome or a rounded vault of the whole house.',
    tent: 'A tent: a covering on poles.',
    vault: 'A barrel vault.',
  },
  roof_material: {
    earth: 'Earth or mud over beams and matting.',
    thatch: 'Thatch of straw, grass, reeds or leaves.',
    tile: 'Fired tiles.',
    timber: 'Planks or shingles.',
    bark: 'Bark sheets.',
    hide: 'Hides.',
    felt: 'Felt.',
    reed: 'Reed mats.',
    stone: 'Stone slabs or corbelled stone.',
    turf: 'Turf.',
    snow: 'Snow.',
  },
  floor: {
    ground: 'At the level of the ground.',
    sunken: 'Dug below the ground: a pit house.',
    raised: 'On a low earth or stone base.',
    platform: 'On a built platform, a metre or more high.',
    stilts: 'On posts, above the ground or water.',
  },
} as const;

export const SETTLEMENT_WORDS = {
  pattern: {
    nucleated: 'Houses clustered in a village, with fields around it.',
    dispersed: 'Houses or farmsteads standing apart, each among its own fields.',
    hamlet: 'A few houses together, the hamlets spread over the land.',
    compound: 'Houses of a household or a lineage inside one enclosure, the compounds spread or clustered.',
    linear: 'Houses in a row along a road, a river or a shore.',
    camp: 'Shelters of a mobile group, put up and left.',
    'room-block': 'One block of rooms holds the whole settlement, or most of it.',
    walled: 'A settlement inside a wall.',
  },
} as const;

export const FIELD_WORDS = {
  kind: {
    blocks: 'Rectangular fields, about as wide as long.',
    strips: 'Long narrow strips, ploughed in one direction.',
    irregular: 'Small fields of no regular shape.',
    terraces: 'Fields levelled into a slope, in steps.',
    paddies: 'Flooded fields within low banks, for rice.',
    basins: 'Fields watered from canals or a flood, in basins or plots along the channels.',
    raised: 'Raised beds or ridged fields in wet ground.',
    swidden: 'Plots cleared and burnt in woodland, cropped for a few years and left to grow back.',
    gardens: 'Gardens and orchards worked by hand around the houses.',
    none: 'No fields: the people of the tradition did not farm.',
  },
  bounds: {
    none: 'Open: nothing divides the fields.',
    banks: 'Earth banks or balks.',
    walls: 'Stone walls.',
    hedges: 'Hedges.',
    ditches: 'Ditches.',
    dikes: 'Dikes or levees, as around flooded fields.',
  },
} as const;

type Words<T extends Record<string, object>> = { [K in keyof T]?: keyof T[K] & string };

/** A dwelling as a claim states it: whichever parameters are known. Lengths in metres. */
export interface DwellingSpec extends Words<typeof DWELLING_WORDS> {
  /** across a round house, or the width and length of another */
  diameter?: Span;
  width?: Span;
  length?: Span;
  /** from the floor to the eaves, and to the top of the roof */
  wall_height?: Span;
  height?: Span;
  storeys?: Span;
  rooms?: Span;
  /** whether its rooms stand around an open court */
  court?: boolean;
}

/** How the houses stood together. */
export interface SettlementSpec extends Words<typeof SETTLEMENT_WORDS> {
  /** houses in one settlement */
  houses?: Span;
  /** metres from one house to the next */
  spacing?: Span;
  /** people in one house */
  household?: Span;
}

/** The fields around them. Plots in hectares. */
export interface FieldSpec extends Words<typeof FIELD_WORDS> {
  plot?: Span;
}

const DWELLING_NUMBERS = ['diameter', 'width', 'length', 'wall_height', 'height', 'storeys', 'rooms'] as const;
const SETTLEMENT_NUMBERS = ['houses', 'spacing', 'household'] as const;
const FIELD_NUMBERS = ['plot'] as const;

/** What is wrong with a span: a positive number, or { lo, hi } of them with lo ≤ hi. */
export function spanProblem(v: unknown): string | undefined {
  const pos = (x: unknown) => typeof x === 'number' && Number.isFinite(x) && x > 0;
  if (pos(v)) return undefined;
  const r = v as { lo?: unknown; hi?: unknown } | null;
  if (r && typeof r === 'object' && Object.keys(r).length === 2 && pos(r.lo) && pos(r.hi) && (r.lo as number) <= (r.hi as number)) return undefined;
  return 'a positive number, or { lo, hi } of them';
}

function problemsOf(v: unknown, what: string, words: Record<string, Record<string, string>>, numbers: readonly string[]): string[] {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return [`a ${what} is a mapping of its parameters`];
  const out: string[] = [];
  const entries = Object.entries(v as Record<string, unknown>);
  if (!entries.length) out.push(`a ${what} says something`);
  for (const [k, x] of entries) {
    if (k === 'court') {
      if (typeof x !== 'boolean') out.push('court is true or false');
      continue;
    }
    if (words[k]) {
      if (typeof x !== 'string' || !Object.hasOwn(words[k], x)) out.push(`${k} is one of ${Object.keys(words[k]).join(', ')}`);
      continue;
    }
    if (numbers.includes(k)) {
      const p = spanProblem(x);
      if (p) out.push(`${k} is ${p}`);
      continue;
    }
    out.push(`a ${what} has no "${k}": it may have ${[...Object.keys(words), ...numbers, ...(what === 'dwelling' ? ['court'] : [])].join(', ')}`);
  }
  return out;
}

export const dwellingProblems = (v: unknown) => problemsOf(v, 'dwelling', DWELLING_WORDS, DWELLING_NUMBERS);
export const settlementProblems = (v: unknown) => problemsOf(v, 'settlement form', SETTLEMENT_WORDS, SETTLEMENT_NUMBERS);
export const fieldProblems = (v: unknown) => problemsOf(v, 'field system', FIELD_WORDS, FIELD_NUMBERS);

/** Where each inherited parameter came from: the tradition whose claim gave it. */
export type From = Record<string, string>;

/** A tradition as the build compiles it: what it says, merged down from the traditions it is a member of. */
export interface Tradition {
  id: string;
  label: string;
  /** the tradition it is a member of, if any, and how many above it */
  parent?: string;
  depth: number;
  /** the regions of the dataset its extent names */
  regions: number[];
  /** when it holds, on the axis: [start, end]; an end it does not give is the present */
  span: [number, number];
  dwelling: DwellingSpec;
  settlement: SettlementSpec;
  fields: FieldSpec;
  /** which tradition gave each parameter: `dwelling.walls` → its id */
  from: From;
  /** whether it says anything of the dwelling itself, rather than inheriting it all */
  own: boolean;
}

/** A tradition's own claims, before inheritance. */
export interface TraditionInput {
  id: string;
  label: string;
  parent?: string;
  regions: number[];
  span: [number, number];
  dwelling?: DwellingSpec;
  settlement?: SettlementSpec;
  fields?: FieldSpec;
}

/**
 * Each tradition with what it inherits: a parameter it does not state is its nearest ancestor's that does. A
 * tradition with no regions of its own takes its parent's. A cycle, or a parent nobody wrote, ends the walk.
 */
export function compileTraditions(inputs: TraditionInput[]): Tradition[] {
  const byId = new Map(inputs.map((t) => [t.id, t]));
  const done = new Map<string, Tradition>();
  const visit = (t: TraditionInput, seen: Set<string>): Tradition => {
    const have = done.get(t.id);
    if (have) return have;
    const up = t.parent && byId.has(t.parent) && !seen.has(t.parent) ? visit(byId.get(t.parent)!, new Set([...seen, t.id])) : undefined;
    const from: From = { ...(up?.from ?? {}) };
    const merge = <T extends object>(mine: T | undefined, theirs: T | undefined, prefix: string): T => {
      const out = { ...(theirs ?? {}) } as Record<string, unknown>;
      for (const [k, v] of Object.entries(mine ?? {})) {
        out[k] = v;
        from[`${prefix}.${k}`] = t.id;
      }
      return out as T;
    };
    const out: Tradition = {
      id: t.id,
      label: t.label,
      ...(up ? { parent: up.id } : {}),
      depth: up ? up.depth + 1 : 0,
      regions: t.regions.length ? [...t.regions].sort((a, b) => a - b) : up?.regions ?? [],
      span: t.span,
      dwelling: merge(t.dwelling, up?.dwelling, 'dwelling'),
      settlement: merge(t.settlement, up?.settlement, 'settlement'),
      fields: merge(t.fields, up?.fields, 'fields'),
      from,
      own: !!t.dwelling && Object.keys(t.dwelling).length > 0,
    };
    done.set(t.id, out);
    return out;
  };
  return inputs.map((t) => visit(t, new Set())).sort((a, b) => (a.id < b.id ? -1 : 1));
}

/**
 * The tradition that holds at a region and a time: of those whose extent names the region and whose span holds the
 * time, the most particular, which is the deepest in the tree, then the one that names the fewest regions, then the
 * latest to start, then by id. Undefined where none does: the generator's generic dwelling stands in.
 */
export function traditionAt(list: Tradition[], region: number | undefined, t: number): Tradition | undefined {
  if (region === undefined) return undefined;
  let best: Tradition | undefined;
  for (const x of list) {
    if (t < x.span[0] || t > x.span[1] || !x.regions.includes(region)) continue;
    if (!x.own && !Object.keys(x.dwelling).length) continue;
    if (!best) {
      best = x;
      continue;
    }
    const better =
      x.depth !== best.depth ? x.depth > best.depth : x.regions.length !== best.regions.length ? x.regions.length < best.regions.length : x.span[0] !== best.span[0] ? x.span[0] > best.span[0] : x.id < best.id;
    if (better) best = x;
  }
  return best;
}

/** A span's middle, or the number itself. */
export const mid = (s: Span | undefined, or: number): number => (s === undefined ? or : typeof s === 'number' ? s : (s.lo + s.hi) / 2);

/** A value within a span by a number in [0, 1): evenly in proportion, as a range of sizes is mostly near its small end. */
export function within(s: Span | undefined, or: number, u: number): number {
  if (s === undefined) return or;
  if (typeof s === 'number') return s;
  return s.lo * Math.pow(s.hi / s.lo, u);
}

const spanText = (s: Span, unit = '') => (typeof s === 'number' ? `${s}${unit}` : `${s.lo}–${s.hi}${unit}`);

/** A dwelling, settlement form or field system in words, for a panel: its parameters as a source would say them. */
export function specText(v: DwellingSpec | SettlementSpec | FieldSpec): string {
  const parts: string[] = [];
  const r = v as Record<string, unknown>;
  const unit: Record<string, string> = { diameter: ' m across', width: ' m wide', length: ' m long', wall_height: ' m to the eaves', height: ' m high', storeys: ' storeys', rooms: ' rooms', houses: ' houses', spacing: ' m apart', household: ' people to a house', plot: ' ha a plot' };
  const word: Record<string, string> = { plan: 'plan', walls: 'walls of', roof: 'roof', roof_material: 'roofed with', floor: 'floor', pattern: '', kind: '', bounds: 'divided by' };
  for (const [k, x] of Object.entries(r)) {
    if (k === 'court') parts.push(x ? 'around a court' : 'without a court');
    else if (typeof x === 'string') parts.push(k === 'plan' || k === 'roof' || k === 'floor' ? `${x} ${word[k]}` : word[k] ? `${word[k]} ${x}` : x);
    else if (x !== undefined) parts.push(spanText(x as Span, unit[k] ?? ''));
  }
  return parts.join(', ');
}
