// The 4D tile set: what the build writes and the viewer streams.
//
// A tile covers a cell on the sphere (a lon/lat box) and a span of time, at one level of
// detail. It carries every keyframe of every field that is needed to interpolate inside its
// span, every feature whose interval overlaps it, and the constraints for client-side
// generators. Coarse levels cover the whole globe with long time spans; finer levels cover
// smaller cells with shorter spans, so the amount of data per tile stays bounded.

import type { Fingerprint } from './fingerprint.ts';

/** Interval of a feature, in astronomical years. `null` end = still exists. */
export interface Estimate {
  /** best estimate used for display */
  best: number | null;
  /** 95% (or hard) bounds from the chronology solver; ±Infinity when unconstrained */
  lo: number;
  hi: number;
  /** whether the estimate comes from a direct claim or only from relations */
  derived: boolean;
}

export interface FeatureTime {
  start: Estimate;
  /** for instants, end === start */
  end: Estimate;
  instant: boolean;
  /** it ended, at a time no claim gives (rather than still holding) */
  endUnknown?: boolean;
}

export type Basis = 'evidence' | 'reconstruction' | 'projection' | 'procedural';

/**
 * How directly a feature rests on evidence: derived content takes the weakest basis among
 * its inputs (section 7). Its place at the present is its measured location; at other
 * times the location is also moved by its frame.
 */
export interface FeatureBasis {
  time: Basis;
  place: Basis;
  placeNow: Basis;
}

export interface FeatureName {
  text: string;
  /**
   * when the name was in use, [from, to); absent: always. null is an open end (JSON has no
   * infinity). A name whose use ended at an unknown time is given up to the present, where
   * today's name takes over.
   */
  valid?: [number | null, number | null];
}

export interface Feature {
  id: string;
  /** today's name */
  label: string;
  /** names in use at other times, if any */
  names?: FeatureName[];
  kind: string;
  basis: FeatureBasis;
  /** the frame the feature moves with; for a plate frame, `plate` is the plate it rides */
  frame: string;
  plate?: number;
  /** in the feature's own frame (plate-local), carried there from where it was measured */
  location: { lat: number; lon: number };
  /** a thing that moved: where it was in each of its phases, oldest first */
  moves?: FeatureMove[];
  time: FeatureTime;
  /** interval under other scenarios (keyed by scenario key), where it differs */
  variants?: Record<string, FeatureTime>;
  status: 'proposed' | 'accepted' | 'disputed' | 'deprecated';
  /** from how far away it shows by itself: derived by the build, and no claim about the world */
  prominence?: number;
}

/** Kinds a site draws, in its own streets, and the globe does not. */
export const cityKind = (k: string) => /^(building|monument|works|open)(\/|$)/.test(k);

/** Where a thing was for one phase of its life. */
export interface FeatureMove {
  label: string;
  plate?: number;
  location: { lat: number; lon: number };
  time: FeatureTime;
  variants?: Record<string, FeatureTime>;
}

export interface FieldKeyframe {
  /** astronomical year */
  t: number;
  ageMa: number;
  /** buffer indices: int16 metres, uint16 plate index (into frames.json plateIndex) */
  elev: number;
  plate: number;
}

export interface FieldGrid {
  /** longitude/latitude of node (0, 0), the north-west corner */
  lon0: number;
  lat0: number;
  /** node spacing in degrees */
  step: number;
  nx: number;
  ny: number;
  /** true if the last column connects back to the first (a global grid) */
  wrap: boolean;
}

export interface FieldContent {
  id: string;
  grid: FieldGrid;
  keyframes: FieldKeyframe[];
}

export interface GeneratorConstraint {
  /** the generator record */
  generator: string;
  version: number;
  /** the stable slot id of what it makes here, and the seed that slot declares */
  slot: string;
  seed: string;
  basis: 'procedural';
  params: Record<string, unknown>;
  /** what the generator made here, as the build made it: a browser's must agree within the tolerance (core/fingerprint.ts) */
  output: Fingerprint;
}

export interface TileHeader {
  format: 'lightworld-tile@4';
  id: string;
  lod: number;
  bbox: [number, number, number, number];
  time: [number, number];
  /** the gridded field that covers the tile's span, if any does */
  field: FieldContent | null;
  generators: GeneratorConstraint[];
}

export interface TileRef {
  id: string;
  lod: number;
  /** west, south, east, north in degrees (paleo-coordinates of the planet frame) */
  bbox: [number, number, number, number];
  /** [older, younger] in astronomical years */
  time: [number, number];
  url: string;
  bytes: number;
  sha256: string;
  parent: string | null;
}

export interface LodInfo {
  lod: number;
  step: number;
  /** cell size in degrees */
  cell: [number, number];
  /** time bins as [olderMa, youngerMa] */
  binsMa: [number, number][];
}

export interface AlternativeGroupInfo {
  id: string;
  title: string;
  description?: string;
  /** the member shown by default; null: the default picture */
  default: string | null;
  members: { id: string; title: string; description?: string; kind?: string }[];
}

/**
 * A gridded field the tiles carry, and the span it covers. Its int16 values are metres of
 * elevation, or for `blocks` a mask: positive inside a continental block of the plate model.
 */
export interface FieldInfo {
  id: string;
  title: string;
  mode: 'elevation' | 'blocks';
  description?: string;
  units?: string;
  datum?: string;
  basis: Basis;
  interpolation: string;
  /** the dataset it comes from */
  source: string;
  sourceRecord?: import('./records.ts').SourceRecord;
  /** [older, younger] astronomical years, its projection included */
  coverage: [number, number];
  keyframesMa: number[];
  /** after its youngest keyframe, the field holds that keyframe as a projection until `until` */
  projection?: { method: 'hold'; until: number; note?: string };
  /** the coastline derived from it, for an elevation field */
  coastline?: { id: string; title: string; isolineM: number };
}

export interface Tileset {
  format: 'lightworld-tileset@4';
  build: string;
  /** gridded fields, in order of preference where two cover the same time */
  fields: FieldInfo[];
  /** the span of the world: its oldest record to its furthest projection */
  timeRange: [number, number];
  lods: LodInfo[];
  tiles: TileRef[];
  files: { frames: string; periods: string; search: string; records: string; coverage: string; series: string; planet: string; territory: string; city?: string; climate?: string; ice?: string; tree?: string; present?: string; hazards?: string; polities?: string; routes?: string; languages?: string; overlays?: string; people?: string; atlas?: string; features: string };
  /** the climate field the land is painted from, and the derived field that paints it */
  climate?: { field: string; title: string; description?: string; biomeTitle: string; biomeDescription?: string; source: string; sourceRecord?: import('./records.ts').SourceRecord; params: Record<string, unknown> };
  /** the ice sheets drawn over the land, where a field has them, instead of a claimed latitude */
  ice?: IceInfo;
  /** attribution the viewer must show for the data it displays */
  credits: { label: string; license: string }[];
  /** the alternatives this build shows, by group */
  alternatives: AlternativeGroupInfo[];
  /** kind labels, for display */
  kinds: Record<string, string>;
  /** the places the viewer can fly down into */
  sites?: SiteInfo[];
}

/** What the viewer needs to know of the ice-sheet field: what it is, when it covers, and how far to trust it. */
export interface IceInfo {
  field: string;
  title: string;
  description?: string;
  uncertainty?: string;
  basis: Basis;
  source: string;
  sourceRecord?: import('./records.ts').SourceRecord;
  /** [older, younger] astronomical years, its projection included */
  coverage: [number, number];
  keyframesMa: number[];
  /** after its youngest keyframe, the field holds it as a projection until `until` */
  projection?: { method: 'hold'; until: number; note?: string };
  /** the thickness whose contour its margin is, in metres */
  marginM: number;
  scenarios: { id: string; title: string; alt?: string }[];
}

/** A place the viewer can fly down into: a city's streets, or a living scene. */
export interface SiteInfo {
  kind: 'city' | 'life';
  id: string;
  label: string;
  /** the file that describes it, under the build */
  file: string;
  /** the record that opening flies down into it */
  place?: string;
  /** its local grid's origin, in the globe's coordinates at the time it is drawn for */
  origin: { lat: number; lon: number };
  /** the times it is drawn for, and the moment it is written for */
  span: [number, number];
  slice: number;
  /** a visit during these years keeps the time shown; otherwise it moves to the slice, and the window to this */
  near: [number, number];
  window: [number, number];
  /** where a visitor arrives */
  view: { x: number; y: number; range: number; heading: number; tilt: number };
}

/** The plate index maps the plate ids used in field tiles to dense indices for the GPU. */
export interface FramesFile {
  rotations: import('./rotation-model.ts').BakedRotationModel;
  plateIndex: number[];
  /** the frames records use: plate frames name their plate and the entity that defines them */
  frames: { id: string; title: string; kind: string; plate?: number; entity?: string }[];
}

/**
 * Where a feature is at a time: for a thing that moved, the phase that holds, or else the last one
 * begun (or, before any began, the first); for anything else, where it always is.
 */
export function placeAt(f: Feature, t: number, pick: (m: FeatureMove) => FeatureTime = (m) => m.time): { location: { lat: number; lon: number }; plate?: number } {
  if (!f.moves?.length) return f;
  let at = f.moves[0];
  for (const m of f.moves) if ((pick(m).start.best ?? -Infinity) <= t) at = m;
  return at;
}
