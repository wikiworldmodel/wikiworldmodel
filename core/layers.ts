// Things at places, drawn over the globe for the times they hold: today's borders and cities, and
// the hazards of the last few thousand years. They are rows of a dataset, not records, because there
// are thousands of them; each carries what the panel shows and the dataset that says so.
import type { SourceRecord } from './records.ts';

export interface PresentPlace {
  name: string;
  country: string;
  lon: number;
  lat: number;
  /** the population Natural Earth gives its city at its largest extent */
  pop: number;
  capital: boolean;
}

export interface PresentFile {
  format: 'lightworld-present@1';
  title: string;
  description?: string;
  /** when it starts to be drawn: the years it describes, as near as a single map can */
  since: number;
  until: number;
  source: string;
  sourceRecord?: SourceRecord;
  placesSource: string;
  placesSourceRecord?: SourceRecord;
  /** lines, flat [lon, lat, lon, lat, …], in hundredths of a degree */
  borders: number[][];
  /** the indices of the lines the map marks as disputed */
  disputed: number[];
  /** the largest first */
  places: PresentPlace[];
}

export const HAZARD_KINDS = ['eruption', 'earthquake', 'tsunami'] as const;
export type HazardKind = (typeof HAZARD_KINDS)[number];

export interface HazardRow {
  kind: HazardKind;
  /** on the world's axis: a year, with its month and day if the database gives them */
  t: number;
  /** when, as the database gives it */
  when: string;
  lat: number;
  lon: number;
  name: string;
  /** VEI of an eruption, magnitude of an earthquake, intensity of a tsunami; absent if it gives none */
  size?: number;
  /** deaths, where it gives a number */
  deaths?: number;
}

export interface HazardFile {
  format: 'lightworld-hazards@1';
  title: string;
  description?: string;
  source: string;
  sourceRecord?: SourceRecord;
  /** oldest first */
  rows: HazardRow[];
}

/** The rows within `halo` years of a time, oldest first. */
export function hazardsNear(file: HazardFile, t: number, halo: number): HazardRow[] {
  const rows = file.rows;
  let lo = 0;
  let hi = rows.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (rows[m].t < t - halo) lo = m + 1;
    else hi = m;
  }
  const out: HazardRow[] = [];
  for (let i = lo; i < rows.length && rows[i].t <= t + halo; i++) out.push(rows[i]);
  return out;
}

/** A row of a borders dataset: a polity as it is drawn for some years. */
export interface PolityRow {
  name: string;
  /** [from, to) on the world's axis */
  from: number;
  to: number;
  /** km², as the dataset gives it */
  area: number;
  /** where a label goes, [lon, lat] in degrees */
  at: [number, number];
  /** rings, outer and inner alike, each [lon0, lat0, lon1, lat1, …] in hundredths of a degree; filled even-odd */
  rings: number[][];
  wikipedia?: string;
}

export interface PolitiesFile {
  format: 'lightworld-polities@1';
  title: string;
  description?: string;
  source: string;
  sourceRecord?: import('./records.ts').SourceRecord;
  /** by when they start */
  rows: PolityRow[];
}

/** The rows that hold at a time. */
export const politiesAt = (file: PolitiesFile, t: number): PolityRow[] => file.rows.filter((r) => r.from <= t && t < r.to);

/** Is a point inside a row's rings, by the even-odd rule? Degrees. */
export function insideRow(r: PolityRow, lon: number, lat: number): boolean {
  const x = lon * 100;
  const y = lat * 100;
  let inside = false;
  for (const ring of r.rings) {
    for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
      const yi = ring[i + 1];
      const yj = ring[j + 1];
      if (yi > y !== yj > y && x < ((ring[j] - ring[i]) * (y - yi)) / (yj - yi) + ring[i]) inside = !inside;
    }
  }
  return inside;
}

/** A stretch of road or route, as a dataset draws it. */
export interface RouteRow {
  /** flat [lon, lat, lon, lat, …] in hundredths of a degree */
  line: number[];
  main: boolean;
  /** how sure the dataset is of where it ran */
  certainty: 'certain' | 'conjectured' | 'hypothetical';
  /** the years it is drawn for, on the world's axis */
  from: number;
  to: number;
}

export interface RoutesFile {
  format: 'lightworld-routes@1';
  title: string;
  description?: string;
  source: string;
  sourceRecord?: import('./records.ts').SourceRecord;
  routes: RouteRow[];
}

/** A language at the place a catalogue puts it today. */
export interface LanguageRow {
  name: string;
  /** the family it is classified in, or its own name if it stands alone */
  family: string;
  lat: number;
  lon: number;
  /** the catalogue's id for it */
  code: string;
}

export interface LanguagesFile {
  format: 'lightworld-languages@1';
  title: string;
  description?: string;
  source: string;
  sourceRecord?: import('./records.ts').SourceRecord;
  rows: LanguageRow[];
}

/**
 * People on a grid: how many in each cell, at each time step a reconstruction gives. It is drawn as a
 * picture of the surface, not as rows at places. The numbers are the file's typed arrays: a million of them.
 */
export interface PeopleHeader {
  format: 'lightworld-people@1';
  title: string;
  description?: string;
  source: string;
  sourceRecord?: SourceRecord;
  /** how wide a cell is, in degrees; column 0 starts at 180°W and row 0 at the north pole */
  res: number;
  /** the time steps, on the world's axis, oldest first */
  steps: number[];
  /** where the viewer's colours start and end, in people per km² of land: a choice of how to show it, not a fact */
  scale: { lo: number; hi: number };
  /** the range the authors give for their numbers, in percent either way: [time, percent], oldest first, straight between */
  range: [number, number][];
}

export interface PeopleFile extends PeopleHeader {
  /** the cells that ever hold anyone, by their place in the grid (row × columns + column), in order */
  cell: Uint32Array;
  /** each one's land, in km² */
  land: Uint32Array;
  /** how many people, a whole row of cells for each step */
  people: Uint32Array;
}

/** The two steps around a time, and how far it is from the first to the second; nothing outside them. */
export function stepsAround(steps: number[], t: number): { a: number; b: number; mix: number } | undefined {
  if (!steps.length || t < steps[0] || t > steps[steps.length - 1]) return undefined;
  let a = 0;
  let b = steps.length - 1;
  while (b - a > 1) {
    const m = (a + b) >> 1;
    if (steps[m] <= t) a = m;
    else b = m;
  }
  if (steps[a] === t) b = a;
  else if (steps[b] === t) a = b;
  return { a, b, mix: a === b ? 0 : (t - steps[a]) / (steps[b] - steps[a]) };
}

/** How many people each cell holds at a time, straight between steps; false, and nothing written, outside them. */
export function peopleAt(f: PeopleFile, t: number, out: Float64Array): boolean {
  const s = stepsAround(f.steps, t);
  if (!s) return false;
  const n = f.cell.length;
  const a = f.people.subarray(s.a * n, (s.a + 1) * n);
  const b = f.people.subarray(s.b * n, (s.b + 1) * n);
  for (let i = 0; i < n; i++) out[i] = a[i] + (b[i] - a[i]) * s.mix;
  return true;
}

/** The size of a grid of cells `res` degrees wide. */
export const gridSize = (res: number) => ({ nx: Math.round(360 / res), ny: Math.round(180 / res) });

/** Where a point falls in the grid: its row, its column, and which of the file's cells that is, or −1. */
export function cellAt(f: Pick<PeopleFile, 'res' | 'cell'>, lon: number, lat: number): { row: number; col: number; index: number } {
  const { nx, ny } = gridSize(f.res);
  const col = Math.max(0, Math.min(nx - 1, Math.floor((lon + 180) / f.res)));
  const row = Math.max(0, Math.min(ny - 1, Math.floor((90 - lat) / f.res)));
  const place = row * nx + col;
  let lo = 0;
  let hi = f.cell.length - 1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (f.cell[m] === place) return { row, col, index: m };
    if (f.cell[m] < place) lo = m + 1;
    else hi = m - 1;
  }
  return { row, col, index: -1 };
}

/** The range the authors give at a time: straight between the years they name, and held beyond them. */
export function rangeAt(points: [number, number][], t: number): number | undefined {
  if (!points.length) return undefined;
  if (t <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [t1, p1] = points[i];
    if (t <= t1) {
      const [t0, p0] = points[i - 1];
      return p0 + ((p1 - p0) * (t - t0)) / (t1 - t0);
    }
  }
  return points[points.length - 1][1];
}

/** Where a density falls on the viewer's scale, from 0 to 1, in its logarithm: nothing below the scale. */
export function levelOf(density: number, scale: PeopleHeader['scale']): number {
  if (!(density > scale.lo)) return 0;
  return Math.min(1, Math.log(density / scale.lo) / Math.log(scale.hi / scale.lo));
}
