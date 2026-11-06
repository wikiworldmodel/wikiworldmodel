// How much of the world each layer knows, and how (docs/STRUCTURE.md section 3.3): every layer asked across the
// globe and the whole span of time, in columns that follow the time control's own scale, so an era takes the room
// on the coverage chart that it takes on the strip. The build counts it; the coverage page draws it.
import { lookAt } from './planet.ts';
import { LAYERS, resolve, TIERS, type LayerId, type ResolveWorld, type Tier } from './resolve.ts';
import type { Scenario } from './scenario.ts';
import { positionOf, timeAt } from './timescale.ts';

/** A stretch of time, [older, younger] on the axis. */
export type Span = [number, number];

/** What answers a layer somewhere in time: a field, a dataset, a generator or the records of the planet. */
export interface CoverageSource {
  layer: LayerId;
  /** the record it is: a field, a source, a generator or an entity */
  id: string;
  title: string;
  /** the tier it answers in */
  tier: Tier;
  /** when it answers, [older, younger] */
  span: Span;
  /** the spacing of its grid, in degrees, if it has one */
  res_deg?: number;
  /** the time between its keyframes, in years, if it has them */
  step_yr?: number;
  /** sources in the same lane are drawn on one line, one after another */
  lane?: string;
}

export interface CoverageMatrix {
  format: 'lightworld-coverage@1';
  /** the chart's columns, oldest first, each [older, younger]: equal steps along the time control's scale */
  columns: Span[];
  /** places are the centres of a grid this many degrees across, in rows from the north and west to east within a row */
  step: number;
  /** times asked within each column, evenly along it; a column's map is drawn at its middle one */
  samples: number;
  /** why each answer was given, as resolve says it; cells name them by their place in this list */
  whys: string[];
  layers: {
    layer: LayerId;
    cells: {
      /** the share of the globe's area each tier answers over the column's times, in the order of TIERS; they sum to 1 */
      share: number[];
      /** which whys were given, with the share of the area each was given for */
      why: [number, number][];
      /** the tier at each place at the column's middle time, as runs: a letter of TIER_CODE and a count, "g2400u192" */
      map: string;
    }[];
  }[];
  sources: CoverageSource[];
}

/** A letter for each tier, in a cell's map. */
export const TIER_CODE: Record<Tier, string> = { evidence: 'e', model: 'm', generic: 'g', unknown: 'u' };
const CODE_TIER = Object.fromEntries(Object.entries(TIER_CODE).map(([k, v]) => [v, k])) as Record<string, Tier>;

/** n columns, each an equal step along the time control's scale, from the oldest time to the youngest. */
export function coverageColumns(range: Span, n: number): Span[] {
  const a = positionOf(range[0]);
  const b = positionOf(range[1]);
  const at = (i: number) => (i === 0 ? range[0] : i === n ? range[1] : timeAt(a + ((b - a) * i) / n));
  return Array.from({ length: n }, (_, i) => [at(i), at(i + 1)] as Span);
}

/** The times asked within a column: evenly along the scale, never at its edges. */
export function columnTimes(col: Span, samples: number): number[] {
  const a = positionOf(col[0]);
  const b = positionOf(col[1]);
  return Array.from({ length: samples }, (_, j) => timeAt(a + ((b - a) * (j + 0.5)) / samples));
}

/** The places of a grid, from the north, west to east, with the share of the globe's area each stands for. */
export function coveragePlaces(step: number): { lat: number; lon: number; area: number }[] {
  const rows = Math.round(180 / step);
  const cols = Math.round(360 / step);
  const out: { lat: number; lon: number; area: number }[] = [];
  let total = 0;
  for (let r = 0; r < rows; r++) {
    const lat = 90 - (r + 0.5) * step;
    const top = ((90 - r * step) * Math.PI) / 180;
    const bottom = ((90 - (r + 1) * step) * Math.PI) / 180;
    const area = Math.sin(top) - Math.sin(bottom);
    for (let c = 0; c < cols; c++) {
      out.push({ lat, lon: -180 + (c + 0.5) * step, area });
      total += area;
    }
  }
  for (const p of out) p.area /= total;
  return out;
}

/** Runs of letters, as a cell's map is written. */
export function encodeRuns(codes: string[]): string {
  let out = '';
  for (let i = 0; i < codes.length; ) {
    let j = i;
    while (j < codes.length && codes[j] === codes[i]) j++;
    out += codes[i] + (j - i);
    i = j;
  }
  return out;
}

/** The tier at each place of a cell's map. */
export function decodeRuns(map: string): Tier[] {
  const out: Tier[] = [];
  for (const [, code, count] of map.matchAll(/([a-z])(\d+)/g)) for (let k = 0; k < Number(count); k++) out.push(CODE_TIER[code]);
  return out;
}

const round = (x: number) => Math.round(x * 1e4) / 1e4;

/** Asks every layer at every place of the grid, at `samples` times in each column, and counts what answers. */
export function coverageMatrix(w: ResolveWorld, range: Span, n: number, step: number, samples: number, sources: CoverageSource[], s: Scenario = {}): CoverageMatrix {
  const columns = coverageColumns(range, n);
  const places = coveragePlaces(step);
  const whys: string[] = [];
  const whyIndex = new Map<string, number>();
  const middle = Math.floor(samples / 2);
  const layers = LAYERS.map((layer) => ({
    layer,
    cells: columns.map((col) => {
      const share = new Map<Tier, number>(TIERS.map((t) => [t, 0]));
      const why = new Map<number, number>();
      const codes: string[] = [];
      columnTimes(col, samples).forEach((t, j) => {
        const look = lookAt(w.planet, t, s);
        for (const p of places) {
          const a = resolve(w, layer, p.lat, p.lon, t, s, look);
          const weight = p.area / samples;
          share.set(a.tier, share.get(a.tier)! + weight);
          let k = whyIndex.get(a.why);
          if (k === undefined) {
            k = whys.push(a.why) - 1;
            whyIndex.set(a.why, k);
          }
          why.set(k, (why.get(k) ?? 0) + weight);
          if (j === middle) codes.push(TIER_CODE[a.tier]);
        }
      });
      return {
        share: TIERS.map((t) => round(share.get(t)!)),
        why: [...why.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([k, v]) => [k, round(v)] as [number, number]),
        map: encodeRuns(codes),
      };
    }),
  }));
  return { format: 'lightworld-coverage@1', columns, step, samples, whys, layers, sources };
}
