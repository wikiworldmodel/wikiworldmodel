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
}

export interface Feature {
  id: string;
  label: string;
  kind: string;
  basis: 'evidence' | 'reconstruction' | 'procedural';
  /** frame the location is given in; for earth/plates, `plate` is the plate it rides */
  frame: string;
  plate?: number;
  location: { lat: number; lon: number };
  time: FeatureTime;
  /** interval under each alternative claim: "subject|prop=claimId" → time */
  alternatives?: Record<string, FeatureTime>;
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
  id: string;
  generator: string;
  version: number;
  seed: string;
  basis: 'procedural';
  params: Record<string, unknown>;
  /** sha256 of the generator's output for these constraints, as computed by the build */
  outputSha256: string;
}

export interface TileHeader {
  format: 'lightworld-tile@1';
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

export interface Tileset {
  format: 'lightworld-tileset@1';
  build: string;
  field: {
    id: string;
    title: string;
    units: string;
    datum: string;
    basis: string;
    interpolation: string;
    source: string;
    sourceRecord?: import('./records.ts').SourceRecord;
    coastlineM: number;
  };
  keyframesMa: number[];
  timeRange: [number, number];
  lods: LodInfo[];
  tiles: TileRef[];
  files: { frames: string; periods: string; search: string; records: string };
  /** attribution the viewer must show for the data it displays */
  credits: { label: string; license: string }[];
}

/** The plate index maps the plate ids used in field tiles to dense indices for the GPU. */
export interface FramesFile {
  rotations: import('./rotation-model.ts').BakedRotationModel;
  plateIndex: number[];
}
