// A city as the build writes it and the viewer draws it: its site, its ground, and every
// structure with the footprint, height and form its records give. Positions are metres on a
// local grid: x east and y north of the site's origin, z above sea level.
import type { Basis, FeatureTime } from './tileset.ts';

/** What can be said of a building's architecture, and so what its form claim may hold. Unknown parts are the generator's guess. */
export const FORM_PARAMS = {
  temple: ['plan', 'order', 'front', 'side', 'column_height', 'podium_height', 'faces', 'roof', 'shaft'],
  tholos: ['order', 'columns', 'column_height', 'podium_height', 'roof', 'faces'],
  basilica: ['order', 'column_height', 'faces', 'roof', 'aisles', 'upper_order', 'storeys'],
  hall: ['faces', 'bays', 'roof'],
  court: ['order', 'column_height', 'faces', 'paving', 'gate', 'wall_height'],
  amphitheatre: ['tiers', 'bays', 'attic', 'arena_length', 'arena_width'],
  theatre: ['faces', 'tiers', 'bays', 'stage_height'],
  circus: ['faces', 'tiers', 'spina', 'open_end'],
  baths: ['faces', 'rotunda', 'hall_height', 'precinct'],
  rotunda: ['diameter', 'porch_front', 'order', 'column_height', 'roof', 'oculus', 'faces', 'drum_height'],
  mausoleum: ['drum_height', 'mound_height', 'tiers', 'statue', 'faces'],
  arch: ['bays', 'order', 'attic_height', 'quadriga', 'faces', 'width', 'depth'],
  column: ['statue', 'spiral', 'order', 'diameter', 'pedestal_height'],
  obelisk: ['base_width', 'pedestal_height'],
  pyramid: ['base_width'],
  statue: ['material', 'pedestal_height', 'equestrian'],
  fountain: ['diameter'],
  palace: ['storeys', 'court', 'faces'],
  market: ['levels', 'faces'],
  warehouse: ['levels', 'court'],
  barracks: ['wall_height', 'court'],
  wall: ['tower_spacing', 'tower_height', 'width'],
  gate: ['arches', 'towers', 'faces'],
  aqueduct: ['tiers', 'arches', 'width'],
  bridge: ['arches', 'width'],
  generic: ['storeys', 'roof', 'material', 'faces'],
} as const;

export type FormType = keyof typeof FORM_PARAMS;

/** A form as a claim states it: its type, and whichever parameters are known. */
export interface FormSpec {
  type: FormType;
  plan?: 'peripteral' | 'prostyle' | 'sine-postico' | 'pseudoperipteral' | 'dipteral' | 'in-antis';
  order?: 'tuscan' | 'doric' | 'ionic' | 'corinthian' | 'composite';
  upper_order?: 'tuscan' | 'doric' | 'ionic' | 'corinthian' | 'composite';
  /** columns across the front, and along a side counting the corners */
  front?: number;
  side?: number;
  columns?: number;
  column_height?: number;
  podium_height?: number;
  /** the bearing the building's front faces, in degrees clockwise from north */
  faces?: number;
  roof?: 'tile' | 'gilded' | 'bronze' | 'lead' | 'flat';
  shaft?: 'marble' | 'granite' | 'travertine' | 'stucco';
  aisles?: number;
  storeys?: number;
  bays?: number;
  tiers?: number;
  attic?: boolean;
  attic_height?: number;
  arena_length?: number;
  arena_width?: number;
  stage_height?: number;
  spina?: boolean;
  open_end?: boolean;
  rotunda?: boolean;
  hall_height?: number;
  precinct?: boolean;
  diameter?: number;
  porch_front?: number;
  oculus?: number;
  drum_height?: number;
  mound_height?: number;
  statue?: boolean;
  quadriga?: boolean;
  width?: number;
  depth?: number;
  spiral?: boolean;
  pedestal_height?: number;
  base_width?: number;
  material?: string;
  equestrian?: boolean;
  court?: boolean;
  levels?: number;
  wall_height?: number;
  paving?: string;
  gate?: boolean;
  tower_spacing?: number;
  tower_height?: number;
  arches?: number;
  towers?: number;
}

/** Why a form claim's value is not one, if it is not. */
export function formProblem(v: unknown): string | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'a form is a mapping with its type: { type: temple, … }';
  const { type, ...rest } = v as Record<string, unknown>;
  const known = FORM_PARAMS[type as FormType] as readonly string[] | undefined;
  if (!known) return `no form "${String(type)}": the forms are ${Object.keys(FORM_PARAMS).join(', ')}`;
  for (const k of Object.keys(rest)) if (!known.includes(k)) return `a ${String(type)} has no "${k}": it may have ${known.join(', ')}`;
  return undefined;
}

/** A nested grid of ground heights: `heights[j * nx + i]` in decimetres above sea level, row 0 at the south. */
export interface GroundLevel {
  /** the file, under the build */
  url: string;
  nx: number;
  ny: number;
  /** the grid's south-west corner, in local metres, and its spacing */
  x0: number;
  y0: number;
  cell: number;
}

export interface CityStructure {
  /** the entity's record */
  id: string;
  label: string;
  kind: string;
  form: FormSpec;
  /** outer rings and inner rings as flat [x, y, x, y, …], closed implicitly; empty for a point or a line */
  rings: number[][];
  holes?: number[][];
  /** lines, for roads, walls and aqueducts: flat [x, y, x, y, …] */
  lines?: number[][];
  /** the point it stands at */
  at: [number, number];
  /** the ground it stands on, in metres above sea level */
  base: number;
  /** its height above that, if a claim gives one */
  height?: number;
  time: FeatureTime;
  variants?: Record<string, FeatureTime>;
  basis: Basis;
  /** written by hand, with sources, rather than imported from the map */
  curated: boolean;
  /** how prominent its label is: 0 from afar, 1 over a district, 2 close by, 3 only up close */
  rank: number;
  /** what the map's tags say of its look: building:colour, roof:shape and so on */
  look?: Record<string, string>;
}

export interface CityFile {
  format: 'lightworld-city@1';
  site: {
    id: string;
    label: string;
    /** the local grid's origin, in present-day coordinates */
    origin: { lat: number; lon: number };
    /** the times its buildings are drawn for, and the slice its generated housing describes */
    span: [number, number];
    slice: number;
    water_level: number;
  };
  /** finest first; a place uses the finest level that covers it */
  ground: GroundLevel[];
  structures: CityStructure[];
  /** the river, as rings */
  water: number[][];
  islands: number[][];
  /** the generated housing's constraints and the hash of its plan */
  fabric: {
    generator: string;
    version: number;
    seed: string;
    basis: 'procedural';
    params: Record<string, unknown>;
    regions: { id: string; label: string; at: [number, number]; insulae?: number; domus?: number; source?: string }[];
    outputSha256: string;
  };
}

/** Local metres from latitude and longitude: an equirectangular grid, flat across a site. */
export const EARTH_RADIUS = 6371000;
const RAD = Math.PI / 180;

export function toLocal(origin: { lat: number; lon: number }, lat: number, lon: number): [number, number] {
  return [EARTH_RADIUS * Math.cos(origin.lat * RAD) * (lon - origin.lon) * RAD, EARTH_RADIUS * (lat - origin.lat) * RAD];
}

export function fromLocal(origin: { lat: number; lon: number }, x: number, y: number): [lat: number, lon: number] {
  return [origin.lat + y / EARTH_RADIUS / RAD, origin.lon + x / (EARTH_RADIUS * Math.cos(origin.lat * RAD)) / RAD];
}
