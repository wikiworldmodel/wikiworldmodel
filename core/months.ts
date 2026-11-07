// The months of a climate at a place and a height (model:earth/lapse-rate). Each climate field's keyframes keep, at
// every node where the model has land, its twelve months of temperature and rain, and the height those months stand
// for: the model's own ground under the node. The build writes them in tiles of a few degrees (months/…), and a scene
// reads the node it stands on, of the finest climate that covers its time. Brought to any other height by the air's
// lapse rate, the months say what the climate is there: its class, so where the trees stop and the ice begins, and in
// any month how much snow lies, by the water balance's own rules (core/water.ts).
import { climateClass, reduceMonths, type ClimateClass, type ClimateNode, type ClimateRule } from './climate.ts';
import { waterYear, type WaterParams } from './water.ts';

/** Twelve months, January first: mean temperature, °C, and precipitation, mm. */
export interface Months {
  t: number[];
  p: number[];
}

/** One tile's nodes: the box they are on, and each keyframe's land nodes in it, as indices into the arrays after it. */
export interface MonthsTileHeader {
  format: 'lightworld-months@1';
  field: string;
  /** the box: its first node's latitude and longitude, the grid's step, and how many nodes across and down; its rains as `encodeRain` keeps them */
  grid: { lat0: number; lon0: number; step: number; nx: number; ny: number };
  /** each keyframe: its age, the age whose coordinates its nodes are on, and the arrays of its land nodes */
  keyframes: { ageMa: number; frameMa: number; node: number; t: number; p: number; z: number }[];
}

/** A climate field's months, as the tileset lists them. */
export interface MonthsSet {
  field: string;
  title: string;
  /** every keyframe's age, Ma, youngest first */
  keyframesMa: number[];
  /** the age whose coordinates every keyframe's nodes are on, where they share one (0 for today's); each its own if not */
  frameMa?: number;
  /** the grid's step and the tiles' size, degrees, and each tile's file by its key (`tileKey`) */
  step: number;
  tile_deg: number;
  tiles: Record<string, string>;
}

/** What a scene reads of the climate at a height (field:earth/climate-at-height): the sets, finest in time first. */
export interface MonthsInfo {
  field: string;
  title: string;
  model?: string;
  /** how fast the air cools upward, °C a kilometre */
  lapse: number;
  /** the water balance's rules (field:earth/runoff), by which snow falls, lies and melts */
  water: WaterParams;
  sets: MonthsSet[];
}

/**
 * Temperatures are kept in half degrees above -64 °C; rains by their square root, in quarters, which keeps a dry month
 * to a fraction of a millimetre and a monsoon's to a few per cent, up to 4 m a month; heights in metres.
 */
export const T_SCALE = 2;
export const T_OFFSET = 128;
export const P_ROOT = 4;
export const encodeRain = (mm: number) => Math.max(0, Math.min(255, Math.round(Math.sqrt(Math.max(0, mm)) * P_ROOT)));
export const decodeRain = (code: number) => (code / P_ROOT) ** 2;

/** The tile a node is in, by its own latitude and longitude. */
export function tileKey(lon: number, lat: number, deg: number): string {
  const i = Math.floor((((lon + 180) % 360) + 360) % 360 / deg);
  const j = Math.max(0, Math.min(Math.floor((90 - lat) / deg), Math.ceil(180 / deg) - 1));
  return `${i}_${j}`;
}

/** How far from a place its node is looked for, in steps of the grid. */
export const NEAR_STEPS = 1.5;

/** Every tile a node within `NEAR_STEPS` of a place could be in. */
export function tilesNear(lat: number, lon: number, set: Pick<MonthsSet, 'step' | 'tile_deg'>): string[] {
  const r = set.step * NEAR_STEPS;
  const rl = Math.min(180, r / Math.max(0.05, Math.cos((Math.min(89, Math.abs(lat)) * Math.PI) / 180)));
  const out = new Set<string>();
  for (const la of [lat - r, lat, lat + r]) for (const lo of [lon - rl, lon, lon + rl]) out.add(tileKey(lo, Math.max(-90, Math.min(90, la)), set.tile_deg));
  return [...out].sort();
}

/** The nearest land node to a place among some tiles, at a keyframe. */
export function nearestNode(tiles: MonthsTile[], ageMa: number, lat: number, lon: number): ReturnType<MonthsTile['at']> {
  let best: ReturnType<MonthsTile['at']>;
  let bestD = Infinity;
  for (const t of tiles) {
    const a = t.at(ageMa, lat, lon);
    if (a && a.d < bestD) {
      bestD = a.d;
      best = a;
    }
  }
  return best;
}

/** The set of the finest climate that covers an age, and its keyframe nearest it. */
export function monthsKeyframe(info: MonthsInfo, ageMa: number): { set: MonthsSet; ageMa: number } | undefined {
  for (const set of info.sets) {
    const ks = set.keyframesMa;
    if (!ks.length) continue;
    const young = Math.min(...ks);
    const old = Math.max(...ks);
    if (ageMa > old + 1e-9 && set !== info.sets[info.sets.length - 1]) continue;
    const a = Math.max(young, Math.min(old, ageMa));
    return { set, ageMa: ks.reduce((x, y) => (Math.abs(y - a) < Math.abs(x - a) ? y : x)) };
  }
  return undefined;
}

/** The node of a place, from a decoded tile: the months there, and the height above the sea they stand for. */
export class MonthsTile {
  constructor(
    readonly header: MonthsTileHeader,
    private arrays: ArrayLike<number>[],
  ) {}

  /** The nearest land node of the tile within `NEAR_STEPS` of a place, at a keyframe, and how far (in degrees, squared); undefined if there is none. */
  at(ageMa: number, lat: number, lon: number): { months: Months; height: number; lat: number; lon: number; d: number } | undefined {
    const k = this.header.keyframes.find((x) => Math.abs(x.ageMa - ageMa) < 1e-9);
    if (!k) return undefined;
    const g = this.header.grid;
    const node = this.arrays[k.node];
    let best = -1;
    let bestD = (g.step * NEAR_STEPS) ** 2;
    for (let q = 0; q < node.length; q++) {
      const la = g.lat0 - Math.floor(node[q] / g.nx) * g.step;
      let dl = (g.lon0 + (node[q] % g.nx) * g.step - lon) % 360;
      if (dl > 180) dl -= 360;
      if (dl < -180) dl += 360;
      const d = (la - lat) ** 2 + (dl * Math.cos((lat * Math.PI) / 180)) ** 2;
      if (d < bestD) {
        bestD = d;
        best = q;
      }
    }
    if (best < 0) return undefined;
    const t = this.arrays[k.t];
    const p = this.arrays[k.p];
    const months: Months = { t: [], p: [] };
    for (let m = 0; m < 12; m++) {
      months.t.push((t[best * 12 + m] - T_OFFSET) / T_SCALE);
      months.p.push(decodeRain(p[best * 12 + m]));
    }
    return { months, height: this.arrays[k.z][best], lat: g.lat0 - Math.floor(node[best] / g.nx) * g.step, lon: g.lon0 + (node[best] % g.nx) * g.step, d: bestD };
  }
}

/** The months `dz` metres above the height they stand for: the same rain, the air colder by the lapse rate. */
export function atHeight(m: Months, dz: number, lapse: number): Months {
  const d = (lapse * dz) / 1000;
  return { t: m.t.map((x) => x - d), p: m.p };
}

/** The climate's numbers at a height, as the Köppen–Geiger classes read them. */
export function nodeAtHeight(m: Months, dz: number, lapse: number): ClimateNode {
  const h = atHeight(m, dz, lapse);
  return reduceMonths(h.t, h.p);
}

/** The class at a height. */
export function classAtHeight(m: Months, dz: number, lapse: number, rule: ClimateRule): ClimateClass {
  return climateClass(nodeAtHeight(m, dz, lapse), rule);
}

/** The warmest month, 1–12. */
export function warmestMonth(m: Months): number {
  let best = 0;
  for (let i = 1; i < 12; i++) if (m.t[i] > m.t[best]) best = i;
  return best + 1;
}

/**
 * The snow lying in the middle of a month, mm of water: the mean of what lay at the end of the month before and at its
 * own end, in a year the water balance has run until it comes round. `elevation` is the height above the sea, which
 * sets the snow's threshold.
 */
export function snowInMonth(m: Months, month: number, lat: number, elevation: number, w: WaterParams): number {
  const end: number[] = new Array(12).fill(0);
  waterYear(m.t, m.p, lat, elevation, w, 5, end);
  const i = month - 1;
  return (end[(i + 11) % 12] + end[i]) / 2;
}

/**
 * Whether snow covers the ground at a height in a month: at least `mm` of it lies, and the month is colder than the
 * water balance's threshold for rain alone. The model melts at most a share of the snow in a month, so a trace of the
 * winter's lasts into a summer far too warm to hold it; a month that warm is drawn bare.
 */
export function snowCovers(m: Months, month: number, lat: number, elevation: number, w: WaterParams, mm: number): boolean {
  return m.t[month - 1] < w.t_rain && snowInMonth(m, month, lat, elevation, w) >= mm;
}

/**
 * The lowest height, in `step`s from `lo` to `hi` above the height the months stand for, at which snow covers the ground
 * in a month (`snowCovers`): Infinity if it does nowhere in that range. The elevation above the sea of a height is `sea`
 * more.
 */
export function snowLine(m: Months, month: number, lat: number, sea: number, w: WaterParams, lapse: number, mm: number, lo: number, hi: number, step: number): number {
  let prev = -Infinity;
  for (let dz = lo; dz <= hi + 1e-9; dz += step) {
    if (snowCovers(atHeight(m, dz, lapse), month, lat, dz + sea, w, mm)) {
      if (prev === -Infinity) return dz;
      // Between the last height without and the first with, to a metre.
      let a = prev;
      let b = dz;
      while (b - a > 1) {
        const c = (a + b) / 2;
        if (snowCovers(atHeight(m, c, lapse), month, lat, c + sea, w, mm)) b = c;
        else a = c;
      }
      return b;
    }
    prev = dz;
  }
  return Infinity;
}
