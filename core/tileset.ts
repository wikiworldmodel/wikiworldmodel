// The 4D tile set: what the build writes and the viewer streams.
//
// A tile covers a cell on the sphere (a lon/lat box) and a span of time, at one level of
// detail. It carries every keyframe of every field that is needed to interpolate inside its
// span, every feature whose interval overlaps it, and the constraints for client-side
// generators. Coarse levels cover the whole globe with long time spans; finer levels cover
// smaller cells with shorter spans, so the amount of data per tile stays bounded.

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
  /** when the name was in use; absent: always */
  valid?: [number, number];
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
  time: FeatureTime;
  /** interval under other scenarios (keyed by scenario key), where it differs */
  variants?: Record<string, FeatureTime>;
  status: 'proposed' | 'accepted' | 'disputed' | 'deprecated';
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
  /** sha256 of the generator's output for these constraints, as computed by the build */
  outputSha256: string;
}

export interface TileHeader {
  format: 'lightworld-tile@2';
  id: string;
  lod: number;
  bbox: [number, number, number, number];
  time: [number, number];
  field: FieldContent;
  features: Feature[];
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

export interface Tileset {
  format: 'lightworld-tileset@2';
  build: string;
  field: {
    id: string;
    title: string;
    units: string;
    datum: string;
    basis: Basis;
    interpolation: string;
    source: string;
    sourceRecord?: import('./records.ts').SourceRecord;
    /** the derived coastline field */
    coastline: { id: string; title: string; isolineM: number };
  };
  keyframesMa: number[];
  timeRange: [number, number];
  lods: LodInfo[];
  tiles: TileRef[];
  files: { frames: string; periods: string; search: string; records: string; coverage: string };
  /** attribution the viewer must show for the data it displays */
  credits: { label: string; license: string }[];
  /** the alternatives this build shows, by group */
  alternatives: AlternativeGroupInfo[];
  /** kind labels, for display */
  kinds: Record<string, string>;
}

/** The plate index maps the plate ids used in field tiles to dense indices for the GPU. */
export interface FramesFile {
  rotations: import('./rotation-model.ts').BakedRotationModel;
  plateIndex: number[];
  /** the frames records use: plate frames name their plate and the entity that defines them */
  frames: { id: string; title: string; kind: string; plate?: number; entity?: string }[];
}
