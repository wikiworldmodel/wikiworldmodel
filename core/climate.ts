// The climate of the land as the globe reads it (climate.lwt): at each keyframe, four numbers per
// node of a grid, from which the Köppen–Geiger classes follow, so that a border between climates
// can fall between nodes and move smoothly with the plates and through time. The same rule is
// written here for the build's checks and the panels, and in the globe's shader for the picture.
import type { FieldGrid } from './tileset.ts';

/** The rule's thresholds (world/fields/earth/biome.yaml), after Peel et al. (2007), Table 1. */
export interface ClimateRule {
  /** the warmest month, in °C: below `polar` it is polar, and at or below `frost` under ice */
  polar: number;
  frost: number;
  /** the coldest month, in °C: from `tropical` it is tropical, and at or below `cold` it is cold */
  tropical: number;
  cold: number;
  /** yearly rain over ten times the threshold: below `arid` it is arid, and below `desert` a desert */
  arid: number;
  desert: number;
}

export interface ClimateNode {
  /** the warmest and coldest month, °C */
  hot: number;
  cold: number;
  /** yearly rain over ten times the Köppen threshold: under 1 is arid */
  aridity: number;
  /** how far the driest month is over what a rain forest or monsoon forest needs, mm */
  margin: number;
}

export type ClimateClass = 'rainforest' | 'savanna' | 'desert' | 'steppe' | 'temperate' | 'cold' | 'tundra' | 'ice';

export const CLIMATE_LABEL: Record<ClimateClass, string> = {
  rainforest: 'tropical, wet all or most of the year (Af, Am)',
  savanna: 'tropical, with a long dry season (Aw)',
  desert: 'desert (BW)',
  steppe: 'steppe (BS)',
  temperate: 'temperate (C)',
  cold: 'cold (D)',
  tundra: 'tundra (ET)',
  ice: 'frozen all year (EF)',
};

/** The class of a climate, in the order Köppen and Peel take them: polar first, then arid, then by temperature. */
export function climateClass(c: ClimateNode, r: ClimateRule): ClimateClass {
  if (c.hot < r.polar) return c.hot <= r.frost ? 'ice' : 'tundra';
  if (c.aridity < r.arid) return c.aridity < r.desert ? 'desert' : 'steppe';
  if (c.cold >= r.tropical) return c.margin >= 0 ? 'rainforest' : 'savanna';
  return c.cold > r.cold ? 'temperate' : 'cold';
}

/** Köppen's aridity threshold, in mm of rain a year, as Peel et al. give it. */
export function aridThreshold(meanT: number, summerShare: number): number {
  return 2 * meanT + (summerShare >= 0.7 ? 28 : summerShare <= 0.3 ? 0 : 14);
}

/** A month's climate as twelve temperatures (°C) and rains (mm), reduced to what the classes need. */
export function reduceMonths(t: ArrayLike<number>, p: ArrayLike<number>): ClimateNode {
  let hot = -Infinity;
  let cold = Infinity;
  let mean = 0;
  let rain = 0;
  let driest = Infinity;
  for (let m = 0; m < 12; m++) {
    hot = Math.max(hot, t[m]);
    cold = Math.min(cold, t[m]);
    mean += t[m] / 12;
    rain += p[m];
    driest = Math.min(driest, p[m]);
  }
  // Summer is the warmer of the half-years October to March and April to September.
  let tApr = 0;
  let pApr = 0;
  for (let m = 3; m < 9; m++) {
    tApr += t[m];
    pApr += p[m];
  }
  const northern = tApr / 6 >= (mean * 12 - tApr) / 6;
  const summerRain = northern ? pApr : rain - pApr;
  const threshold = aridThreshold(mean, rain > 0 ? summerRain / rain : 0.5);
  const aridity = threshold <= 0 ? 4 : Math.min(4, rain / (10 * threshold));
  // Rain forest if its driest month has 60 mm, monsoon forest if it has 100 − rain/25 mm.
  const margin = Math.max(driest - 60, driest - (100 - rain / 25));
  return { hot, cold, aridity, margin };
}

/** How the four numbers go into a node's four bytes. Kept to the ranges that matter to the classes. */
const HOT_LO = -60;
const HOT_SPAN = 110;
const ARID_MAX = 4;
const MARGIN_SPAN = 300;

const byte = (x: number) => Math.max(0, Math.min(255, Math.round(x * 255)));

export function encodeNode(c: ClimateNode): [number, number, number, number] {
  return [byte((c.hot - HOT_LO) / HOT_SPAN), byte((c.cold - HOT_LO) / HOT_SPAN), byte(Math.sqrt(Math.max(0, c.aridity) / ARID_MAX)), byte((c.margin + MARGIN_SPAN / 2) / MARGIN_SPAN)];
}

/** Four values in 0–1 (a texel, or bytes over 255) back to a climate. */
export function decodeNode(v: ArrayLike<number>): ClimateNode {
  return { hot: v[0] * HOT_SPAN + HOT_LO, cold: v[1] * HOT_SPAN + HOT_LO, aridity: v[2] * v[2] * ARID_MAX, margin: v[3] * MARGIN_SPAN - MARGIN_SPAN / 2 };
}

/** The top bit of a node's plate says the model has land there; the others are the plate's index. */
export const LAND_BIT = 0x8000;

export interface ClimateHeader {
  format: 'lightworld-climate@1';
  grid: FieldGrid;
  /** youngest first; `values` and `plate` are buffer indices; `frameMa` the age whose coordinates the nodes are on, if not their own */
  keyframes: { ageMa: number; values: number; plate: number; frameMa?: number }[];
  rule: ClimateRule;
}
