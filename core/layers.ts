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
