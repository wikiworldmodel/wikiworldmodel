// Feature tiles: where the build puts each record's marker, and how the viewer finds it again.
//
// A feature is stored once, by three things:
// - time: in the smallest span of a tree over the time axis that holds the whole of its life. The
//   tree's leaves double in length going away from the present, so a moment of the last few years
//   and one of the Hadean each find a leaf of their own scale.
// - place: in a cell of a quadtree over its position on its own plate, not over the map of any one
//   time. The cell's cap moves rigidly with the plate, so the viewer can rotate it to the time shown.
// - prominence: a cell keeps what is most prominent, up to a budget; the rest go to its children.
// So what is far off and minor needs no download until the camera comes near.
import { rotate, unitVector, type Quat } from './quat.ts';
import { PRESENT_YEAR } from './time.ts';
import type { Feature } from './tileset.ts';

/** How many leaves lie on each side of the present: a leaf's far end is 2^(k+1) years from it. */
export const BINS_EACH_WAY = 34;
const LAST_BIN = BINS_EACH_WAY * 2 - 1;

/** The leaf of the time tree that holds a time: 0 is the oldest, and the future starts at BINS_EACH_WAY. */
export function binOf(t: number): number {
  const from = t - PRESENT_YEAR;
  const away = Math.abs(from);
  let k = 0;
  // Doubling, not a logarithm, so that the build and every browser agree.
  for (let edge = 2; k < BINS_EACH_WAY - 1 && away >= edge; edge *= 2) k++;
  return from < 0 ? BINS_EACH_WAY - 1 - k : BINS_EACH_WAY + k;
}

/** A node of the time tree: its number (children of n are 2n and 2n+1), and the leaves it covers. */
export interface TimeNode {
  node: number;
  bins: [number, number];
}

/** The smallest node of the time tree that holds the leaves from `a` to `b`. */
export function timeNodeOf(a: number, b: number): TimeNode {
  let node = 1;
  let lo = 0;
  let hi = LAST_BIN;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (b <= mid) {
      node *= 2;
      hi = mid;
    } else if (a > mid) {
      node = node * 2 + 1;
      lo = mid + 1;
    } else break;
  }
  return { node, bins: [lo, hi] };
}

/** The leaves a node of the time tree covers. */
export function binsOfNode(node: number): [number, number] {
  let depth = 0;
  while (node >> (depth + 1)) depth++;
  let lo = 0;
  let hi = LAST_BIN;
  for (let d = depth - 1; d >= 0; d--) {
    const mid = (lo + hi) >> 1;
    if ((node >> d) & 1) lo = mid + 1;
    else hi = mid;
  }
  return [lo, hi];
}

/** The earliest and latest a feature can show under any scenario, its bounds included. */
export function lifeOf(f: Pick<Feature, 'time' | 'variants'>): [number, number] {
  let a = Infinity;
  let b = -Infinity;
  for (const x of [f.time, ...Object.values(f.variants ?? {})]) {
    const start = x.start.best ?? -Infinity;
    const end = x.end.best === null ? Infinity : x.end.best;
    a = Math.min(a, start, Number.isFinite(x.start.lo) ? x.start.lo : start);
    b = Math.max(b, end, Number.isFinite(x.end.hi) ? x.end.hi : end);
    // A moment shows across the bounds of its start.
    if (x.instant && Number.isFinite(x.start.hi)) b = Math.max(b, x.start.hi);
  }
  return [a, b];
}

export type Cell = [west: number, south: number, east: number, north: number];

/** A cell of the quadtree, from its key: one digit per level, bit 0 for east and bit 1 for north. */
export function cellOf(q: string): Cell {
  let [w, s, e, n]: Cell = [-180, -90, 180, 90];
  for (const c of q) {
    const d = Number(c);
    const lon = (w + e) / 2;
    const lat = (s + n) / 2;
    if (d & 1) w = lon;
    else e = lon;
    if (d & 2) s = lat;
    else n = lat;
  }
  return [w, s, e, n];
}

/** The digit of the child of a cell that holds a place. */
export function childOf(cell: Cell, lat: number, lon: number): number {
  return (lon >= (cell[0] + cell[2]) / 2 ? 1 : 0) + (lat >= (cell[1] + cell[3]) / 2 ? 2 : 0);
}

/** A circle on the sphere around a cell: its centre, and its radius in degrees. */
export function capOf(q: string): { centre: number[]; radius: number } {
  const [w, s, e, n] = cellOf(q);
  const centre = unitVector((s + n) / 2, (w + e) / 2);
  if (!q) return { centre, radius: 180 };
  let least = 1;
  for (const lat of [s, (s + n) / 2, n]) {
    for (const lon of [w, (w + e) / 2, e]) {
      const p = unitVector(lat, lon);
      least = Math.min(least, p[0] * centre[0] + p[1] * centre[1] + p[2] * centre[2]);
    }
  }
  return { centre, radius: (Math.acos(Math.min(1, least)) * 180) / Math.PI };
}

/** One tile: its node in time, its cell, how many it holds, and the plates in it and below it. */
export interface FeatureTileRef {
  t: number;
  q: string;
  n: number;
  plates: number[];
}

export interface FeatureIndex {
  format: 'lightworld-features@1';
  tiles: FeatureTileRef[];
  /** the tile each feature is in, by its place in `tiles` */
  where: Record<string, number>;
}

/** A feature's dates under other pictures, kept apart from its row: its own, and each of its moves'. */
export interface FeatureVariants {
  time?: Feature['variants'];
  moves?: (Feature['variants'] | null)[];
}

/** Puts a feature's dates under other pictures back on its row. */
export function withVariants(f: Feature, v: FeatureVariants): void {
  f.variants = v.time;
  v.moves?.forEach((m, i) => {
    if (m && f.moves?.[i]) f.moves[i].variants = m;
  });
}

export const featureTileUrl = (r: Pick<FeatureTileRef, 't' | 'q'>) => `features/t${r.t}/${r.q || 'root'}.json`;
export const FEATURE_INDEX = 'features/index.json';
export const FEATURE_VARIANTS = 'features/variants.json';

/** What the camera can see: the point under it, how far it can see from there, and how much the screen spans, in degrees. */
export interface FeatureView {
  t: number;
  /** how long, in years, a moment stays visible either side of its time */
  halo: number;
  dir: number[];
  sees: number;
  footprint: number;
  rotation: (plate: number) => Quat;
  placed: (plate: number) => boolean;
}

/** A cell splits into its children when it is this much bigger than what the screen spans. */
const REFINE = 1.5;

/**
 * The tiles a view needs: of every node of the time tree that touches its time, the root cell, and
 * those of its descendants that are in view and small enough to be worth drawing from here.
 */
export function tilesFor(index: FeatureIndex, view: FeatureView): FeatureTileRef[] {
  const by = keyed(index);
  const out: FeatureTileRef[] = [];
  const a = binOf(view.t - view.halo);
  const b = binOf(view.t + view.halo);
  const visit = (r: FeatureTileRef) => {
    out.push(r);
    const cap = capOf(r.q);
    if (cap.radius <= REFINE * view.footprint) return;
    for (const d of '0123') {
      const child = by.tiles.get(`${r.t}/${r.q}${d}`);
      if (child && inView(child, view)) visit(child);
    }
  };
  for (const t of by.nodes) {
    const [lo, hi] = binsOfNode(t);
    if (lo > b || hi < a) continue;
    const root = by.tiles.get(`${t}/`);
    if (root) visit(root);
  }
  return out;
}

function inView(r: FeatureTileRef, view: FeatureView): boolean {
  const cap = capOf(r.q);
  const reach = Math.cos((Math.min(180, cap.radius + view.sees) * Math.PI) / 180);
  for (const plate of r.plates) {
    if (plate && !view.placed(plate)) continue;
    const c = plate ? rotate(view.rotation(plate), cap.centre as [number, number, number]) : cap.centre;
    if (c[0] * view.dir[0] + c[1] * view.dir[1] + c[2] * view.dir[2] >= reach) return true;
  }
  return false;
}

const cache = new WeakMap<FeatureIndex, { tiles: Map<string, FeatureTileRef>; nodes: number[] }>();
function keyed(index: FeatureIndex): { tiles: Map<string, FeatureTileRef>; nodes: number[] } {
  let k = cache.get(index);
  if (!k) {
    k = { tiles: new Map(index.tiles.map((r) => [`${r.t}/${r.q}`, r])), nodes: [...new Set(index.tiles.map((r) => r.t))] };
    cache.set(index, k);
  }
  return k;
}
