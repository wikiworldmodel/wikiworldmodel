// A living scene: what it is made from, by the build and by the browser alike. A place at a moment, the land
// around it, and the taxa the records put there. Positions are metres on a local grid, as a city's are: x east
// and y north of the site's origin, which is where the place stood then, not where it is today. Which taxa, how
// big and when come from the records; where each animal and plant stands, how many, what it is doing and what
// colour it is come from the generator.
import type { ClimateClass, ClimateNode } from './climate.ts';
import type { Form } from './form.ts';
import type { FeatureTime } from './tileset.ts';

/** A taxon of the formation that is not drawn, and why not. */
export interface SceneOmission {
  id: string;
  label: string;
  why: string;
}

/** The land's cover, as the world's transitions give it at the slice. */
export interface SceneCover {
  plants: number;
  forests: number;
  grasses: number;
}

/** How a taxon in a scene rests on evidence. A site's own taxa come from its formation's rows. */
export type SceneTier = 'formation' | 'here' | 'region' | 'standin';

export interface LivingTaxon {
  /** a record's id, or the database's number as `txn:123` where no record adopts it */
  id: string;
  label: string;
  /** a key in the scene's forms; and whose form that is */
  form: string;
  form_from: string;
  form_label: string;
  /** whether the form is the taxon's own: if not, it is its nearest node's, and it says so */
  own: boolean;
  tier: SceneTier;
  /** to the nearest of its rows, in km */
  km?: number;
  /** how common it is in the list it comes from, 0–1 */
  weight: number;
  /** the rows of its stage, or its formation */
  rows: number;
  collections?: number;
  posture?: string;
  biped: boolean;
  /** how big it grew, in metres or kg: what the generator draws, within any range a claim gives */
  length?: number;
  hip?: number;
  height?: number;
  mass?: number;
  /** where its length or height comes from, if not its own measurement */
  size_from?: string;
  /** its length follows from a claimed mass */
  fromMass?: boolean;
  diet?: string;
  time: FeatureTime;
  variants?: Record<string, FeatureTime>;
}

/** The elevation field around a place, at the keyframe nearest its time: rows from the north, in metres above the coast. */
export interface ReliefPatch {
  lat0: number;
  lon0: number;
  step: number;
  nx: number;
  ny: number;
  z: number[];
}

/** Everything a scene is made from: nothing else about the world goes in, and the same spec makes the same bytes. */
export interface SceneSpec {
  format: 'lightworld-scene@2';
  site: {
    id: string;
    label: string;
    /** the record the scene belongs to, if it is a place with a record */
    place?: string;
    /** the local grid's origin: where the place stood at the slice, in the globe's coordinates at that time */
    origin: { lat: number; lon: number };
    /** where that is in the coordinates of the relief's keyframe, as the plate had carried it */
    relief_at?: { lat: number; lon: number };
    /** the times it is drawn for, and the moment it describes */
    span: [number, number];
    slice: number;
    /** what its stage is called */
    stage?: string;
  };
  relief: ReliefPatch;
  biome: { climate: ClimateClass; label: string; field: string; ageMa: number; cover: SceneCover; node: ClimateNode };
  taxa: LivingTaxon[];
  omitted: SceneOmission[];
  forms: Record<string, Form>;
  /** what the taxa rest on */
  fossils: { source: string; title: string; rows: number; collections: number; drawn: number };
  generator: { generator: string; version: number; seed: string; basis: 'procedural'; params: Record<string, unknown> };
}

/** A scene the build wrote, with what proves a browser made the same one. */
export interface SceneFileV2 {
  format: 'lightworld-scene-file@2';
  spec: SceneSpec;
  /** the hash of its ground, the cell it is arrived at and one mesh */
  sha256: string;
  focus: [number, number];
  to_river: [number, number];
  water_level: number;
}
