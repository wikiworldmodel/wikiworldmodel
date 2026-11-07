// A living scene: what it is made from, by the build and by the browser alike. A place at a moment, the land
// around it, and the taxa the records put there. Positions are metres on a local grid, as a city's are: x east
// and y north of the site's origin, which is where the place stood then, not where it is today. Which taxa, how
// big and when come from the records; where each animal and plant stands, how many, what it is doing and what
// colour it is come from the generator.
import type { ClimateClass, ClimateNode, ClimateRule } from './climate.ts';
import type { Months } from './months.ts';
import type { WaterParams } from './water.ts';
import type { Fingerprint } from './fingerprint.ts';
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

/** A river as a scene's spec gives it: its course in local metres, upstream first (world/generators/life/rivers.ts draws it). */
export interface SceneRiver {
  /** what names it: its set and reach, or its dataset's row; what is invented of it is keyed by this */
  key: string;
  from: 'observed' | 'model';
  /** flat [x, y, …], upstream first */
  xy: number[];
  /** the distance along it to its first point from where its reach begins, m */
  s0: number;
  /** its mean flow at each point, m³/s; or its measured width at each point, m */
  q?: number[];
  width?: number[];
  /** the height of its water at each point, m above the coast, where the world gives it */
  z?: number[];
}

/** The laws a channel is drawn by: the rivers field's parameters (field:earth/rivers). */
export interface ChannelLaws {
  width: [number, number];
  depth: [number, number];
  wavelength_widths: [number, number];
  radius_widths: [number, number];
  braided_cfs: [number, number];
  sinuosity_least: number;
  sinuosity_most: number;
  deflection_most: number;
}

/** The water the world gives a place: its rivers, the laws their channels are drawn by, and what they rest on. */
export interface SceneWater {
  rivers: SceneRiver[];
  laws: ChannelLaws;
  /** evidence where a dataset measured a river here, model where only the drainage routes one */
  tier: 'evidence' | 'model';
  /** the fields its rivers come from */
  from: string[];
}

/**
 * The climate a scene stands in, at its own heights (field:earth/climate-at-height): the months of the node it stands
 * on, of the finest climate that covers its time, the height they stand for, and what brings them to any other height
 * and month.
 */
export interface SceneClimate {
  /** the climate field read, and its keyframe */
  field: string;
  ageMa: number;
  /** the node's twelve months, January first: °C and mm */
  months: Months;
  /** the height those months stand for, m above the coast the scene's relief is measured from, and that coast above the sea */
  height: number;
  coast: number;
  /** how fast the air cools upward, °C a kilometre */
  lapse: number;
  /** the thresholds that class the climate at a height */
  rule: ClimateRule;
  /** the water balance's rules, by which snow falls, lies and melts */
  water: WaterParams;
  /** the month drawn, 1–12, and the latitude of the node then, which sets its daylight */
  month: number;
  lat: number;
}

/** Everything a scene is made from: nothing else about the world goes in, and the same spec makes the same scene. */
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
  /** where the world says the rivers run; without it a scene invents its river */
  water?: SceneWater;
  biome: { climate: ClimateClass; label: string; field: string; ageMa: number; cover: SceneCover; node: ClimateNode };
  /** the climate at its heights and in its month; without it, the one class of the biome holds everywhere */
  climate?: SceneClimate;
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
  /** the fingerprint of its ground, the cell it is arrived at and one mesh */
  print: Fingerprint;
  focus: [number, number];
  to_river: [number, number];
  water_level: number;
}
