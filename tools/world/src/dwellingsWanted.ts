// What most wants a building tradition (docs/DWELLINGS.md): each ArchaeoGLOBE region at each of a run of times, with how
// many people HYDE puts there, and whether any tradition the world records draws its houses. The top of the list is where
// most houses are drawn as generic.
import { claimGroups, solveScenario } from './chronology.ts';
import { buildLandscape } from './build/landscape.ts';
import { peopleLayer } from './build/layers.ts';
import { traditionAt, type Tradition } from '../../../core/dwelling.ts';
import { gridSize, peopleAt, type PeopleFile } from '../../../core/layers.ts';
import { formatTime } from '../../../core/time.ts';
import { loadWorld } from './world.ts';

export interface Wanted {
  region: number;
  label: string;
  t: number;
  people: number;
  /** the tradition that draws its houses then, if any */
  tradition?: string;
}

/** Every region at every time, with its people and its tradition. */
export async function dwellingsWanted(times: number[]): Promise<{ rows: Wanted[]; traditions: Tradition[] }> {
  const world = await loadWorld();
  const sol = solveScenario(world);
  if (!sol.ok) throw new Error('the world has no solution: run `npm run validate`');
  const solved = { world, sol, centres: solveScenario(world, {}, true), variants: [], groups: claimGroups(world), model: undefined as never };
  const b = await buildLandscape(solved as never, () => {});
  if (!b) throw new Error('the world has no anthromes field');
  const pl = await peopleLayer(world);
  if (!pl) throw new Error('the world has no grid of people');
  const pf = { ...pl.header, cell: pl.arrays[0], land: pl.arrays[1], people: pl.arrays[2] } as unknown as PeopleFile;
  const { nx } = gridSize(pf.res);
  // The region each 1° cell's middle falls in.
  const regionOf = new Int16Array(pf.cell.length);
  pf.cell.forEach((place, i) => {
    const lat = 90 - (Math.floor(place / nx) + 0.5) * pf.res;
    const lon = -180 + ((place % nx) + 0.5) * pf.res;
    regionOf[i] = b.at(lat, lon, 2000)?.region ?? 0;
  });
  const labels = new Map(b.assessments.regions.map((r) => [r.id, r.label]));
  const rows: Wanted[] = [];
  const now = new Float64Array(pf.cell.length);
  for (const t of times) {
    if (!peopleAt(pf, t, now)) continue;
    const sum = new Map<number, number>();
    for (let i = 0; i < now.length; i++) if (regionOf[i]) sum.set(regionOf[i], (sum.get(regionOf[i]) ?? 0) + now[i]);
    for (const [region, people] of sum) rows.push({ region, label: labels.get(region) ?? String(region), t, people: Math.round(people), ...(traditionAt(b.traditions, region, t) ? { tradition: traditionAt(b.traditions, region, t)!.id } : {}) });
  }
  return { rows, traditions: b.traditions };
}

/** The list as printed: the most people drawn with generic houses first, or one region's times. */
export function wantedText(rows: Wanted[], n: number, region?: number): string {
  const fmt = (x: number) => (x >= 1e6 ? `${(x / 1e6).toFixed(1)} million` : x.toLocaleString('en-US'));
  if (region !== undefined) {
    const mine = rows.filter((r) => r.region === region).sort((a, b) => a.t - b.t);
    if (!mine.length) return `No region ${region}.`;
    return [`${mine[0].label} (region ${region}):`, ...mine.map((r) => `  ${formatTime(r.t).padEnd(12)} ${fmt(r.people).padStart(14)} people  ${r.tradition ?? '— generic houses'}`)].join('\n');
  }
  const open = rows.filter((r) => !r.tradition && r.people > 0).sort((a, b) => b.people - a.people).slice(0, n);
  return [`The regions and times with the most people drawn with generic houses (ArchaeoGLOBE region, time, HYDE's people):`, ...open.map((r) => `  ${String(r.region).padStart(3)} ${r.label.padEnd(44)} ${formatTime(r.t).padEnd(12)} ${fmt(r.people).padStart(14)}`)].join('\n');
}
