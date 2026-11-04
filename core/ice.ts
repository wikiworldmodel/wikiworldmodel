// The ice sheets as the globe reads them (ice.lwt). At each keyframe, for each scenario, two bytes per
// node of a grid: how far the node is from the sheet's margin, and how thick the ice is there. The
// grid's margin moves smoothly between keyframes because it is the distance that is interpolated, as
// the thickness alone would make the ice jump to the union of the two.
import type { FieldGrid } from './tileset.ts';

/** How far a node's byte can say it is from the margin: 127.5 steps either way, about 1000 km. */
export const MARGIN_KM_PER_STEP = 8;
/** Nothing in the field is as thick as this, in metres. The bytes hold its square root, so that thin ice has the finer steps. */
export const THICKNESS_TOP = 5000;

const clampByte = (x: number) => Math.max(0, Math.min(255, Math.round(x)));

/** Inside the ice is above the middle of the byte, outside below it, and no node is exactly on the margin. */
export const encodeMargin = (km: number): number => clampByte(127.5 + km / MARGIN_KM_PER_STEP);
export const decodeMargin = (v: number): number => (v - 127.5) * MARGIN_KM_PER_STEP;
export const encodeThickness = (m: number): number => clampByte(Math.sqrt(Math.max(0, m) / THICKNESS_TOP) * 255);
export const decodeThickness = (v: number): number => (v / 255) ** 2 * THICKNESS_TOP;

export interface IceKeyframe {
  ageMa: number;
  /** buffer indices of a byte per node */
  margin: number;
  thickness: number;
}

export interface IceScenario {
  id: string;
  title: string;
  /** the alternative that draws it; absent: the default picture */
  alt?: string;
  /** youngest first; where it has none for an age, the default picture's is drawn */
  keyframes: IceKeyframe[];
}

export interface IceHeader {
  format: 'lightworld-ice@1';
  grid: FieldGrid;
  /** buffer index of each node's plate; every keyframe is on today's coordinates, so one will do */
  plate: number;
  /** the thickness whose contour the margin is, in metres */
  marginM: number;
  /** the first is the default picture's */
  scenarios: IceScenario[];
}

/** The scenario a picture draws: the one its alternatives name, else the default picture's. */
export function iceScenario(h: Pick<IceHeader, 'scenarios'>, alts: readonly string[]): IceScenario {
  return h.scenarios.find((s) => s.alt && alts.includes(s.alt)) ?? h.scenarios[0];
}

/** The keyframe of a scenario at an age, or the default picture's where it has none there. */
export function iceFrame(h: Pick<IceHeader, 'scenarios'>, s: IceScenario, ageMa: number): IceKeyframe {
  return s.keyframes.find((k) => k.ageMa === ageMa) ?? h.scenarios[0].keyframes.find((k) => k.ageMa === ageMa)!;
}

/**
 * The keyframes around an age and how far between them it is, 0 at the younger and 1 at the older; a
 * time after the youngest holds it. Null for a time older than the oldest: the field has nothing then.
 */
export function iceKeysAt(ages: readonly number[], ageMa: number): { younger: number; older: number; mix: number } | null {
  const a = Math.max(ageMa, ages[0]);
  if (a > ages[ages.length - 1]) return null;
  const older = ages.find((k) => k >= a)!;
  const younger = [...ages].reverse().find((k) => k <= a)!;
  return { younger, older, mix: older === younger ? 0 : (a - younger) / (older - younger) };
}

/** A value of the grid at a place: bilinear between the four nodes around it. Rows run from `lat0` southwards. */
export function sampleGrid(grid: FieldGrid, values: ArrayLike<number>, lat: number, lon: number): number {
  const y = Math.max(0, Math.min(grid.ny - 1, (grid.lat0 - lat) / grid.step));
  const x = (((lon - grid.lon0) / grid.step) % grid.nx + grid.nx) % grid.nx;
  const j0 = Math.min(grid.ny - 2, Math.floor(y));
  const i0 = Math.floor(x);
  const i1 = (i0 + 1) % grid.nx;
  const fy = y - j0;
  const fx = x - i0;
  const at = (j: number, i: number) => values[j * grid.nx + i];
  return (at(j0, i0) * (1 - fx) + at(j0, i1) * fx) * (1 - fy) + (at(j0 + 1, i0) * (1 - fx) + at(j0 + 1, i1) * fx) * fy;
}
