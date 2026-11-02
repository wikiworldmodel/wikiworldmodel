// Polities' territory (territory.json): for each record with a territory claim, the rows of a
// borders dataset that the claim names, each a set of polygons holding for the years it gives.
// Competing claims are chosen as the chronology chooses (chosenClaim), and a row shows only
// while its polity exists, in the scenario shown. Which rows make one polity is the claim's
// business; the dataset's own names are kept, so the viewer can say which row it draws.
import { chosenClaim, spanOf, type StateClaim } from './planet.ts';
import type { Scenario } from './scenario.ts';
import type { FeatureTime } from './tileset.ts';

/** Coordinates are stored in hundredths of a degree. */
export const TERRITORY_SCALE = 100;

export interface TerritoryRow {
  /** the dataset's name for the row */
  name: string;
  /** [from, to) in astronomical years */
  from: number;
  to: number;
  /** km², as the dataset gives it */
  area: number;
  /** where a label goes, [lon, lat] in degrees */
  at: [number, number];
  /** rings, outer and inner alike, each [lon0, lat0, lon1, lat1, …]; filled even-odd */
  rings: number[][];
}

export interface TerritoryClaim extends StateClaim {
  /** the dataset the rows come from */
  source: string;
  rows: TerritoryRow[];
}

export interface Territory {
  /** the entity, or entity@phase */
  subject: string;
  label: string;
  time: FeatureTime;
  /** its interval under other scenarios (keyed by scenario key), where it differs */
  variants?: Record<string, FeatureTime>;
  /** several compete */
  claims: TerritoryClaim[];
  /** the subject's phases, for naming it at a time: "Rome · Republic" */
  phases?: { label: string; time: FeatureTime; variants?: Record<string, FeatureTime> }[];
}

export interface TerritoryFile {
  territories: Territory[];
}

export interface TerritoryAt {
  territory: Territory;
  claim: TerritoryClaim;
  /** the rows that hold: usually one, two where the dataset's polities overlap in time */
  rows: TerritoryRow[];
}

/** What each polity held at time t, in a scenario: the rows of its chosen claim that hold then. */
export function territoriesAt(file: TerritoryFile, t: number, s: Scenario): TerritoryAt[] {
  const out: TerritoryAt[] = [];
  for (const territory of file.territories) {
    const [a, b] = spanOf(territory, s);
    if (t < a || t >= b) continue;
    const claim = chosenClaim(territory.claims, s) as TerritoryClaim | undefined;
    const rows = claim?.rows.filter((r) => r.from <= t && t < r.to) ?? [];
    if (claim && rows.length) out.push({ territory, claim, rows });
  }
  return out;
}

/** Whether a point lies inside a row's polygons (even-odd, as they are filled). */
export function contains(row: TerritoryRow, lon: number, lat: number): boolean {
  const x = lon * TERRITORY_SCALE;
  const y = lat * TERRITORY_SCALE;
  let inside = false;
  for (const r of row.rings) {
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const yi = r[i + 1];
      const yj = r[j + 1];
      if (yi > y !== yj > y && x < ((r[j] - r[i]) * (y - yi)) / (yj - yi) + r[i]) inside = !inside;
    }
  }
  return inside;
}
