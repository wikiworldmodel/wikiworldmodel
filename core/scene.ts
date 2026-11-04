// A living scene as the build writes it and the viewer draws it: a place at a moment, the ground
// under it, and the taxa the records put there. Positions are metres on a local grid, as a city's
// are: x east and y north of the site's origin, which is where the place stood then, not where it
// is today. Which taxa, how big and when come from the records; where each animal and plant stands,
// how many, what it is doing and what colour it is come from the generator.
import type { GroundLevel } from './city.ts';
import type { ClimateClass } from './climate.ts';
import type { FeatureTime } from './tileset.ts';

/** How a taxon is drawn, as its `body_plan` claim says. */
export type BodyPlan =
  | 'ceratopsian'
  | 'tyrannosaur'
  | 'hadrosaur'
  | 'ankylosaur'
  | 'pachycephalosaur'
  | 'ornithopod'
  | 'small-theropod'
  | 'crocodilian'
  | 'turtle'
  | 'small-mammal'
  | 'conifer'
  | 'palm'
  | 'broadleaf'
  | 'fern';

const PLANT_PLANS: ReadonlySet<string> = new Set(['conifer', 'palm', 'broadleaf', 'fern']);
export const isPlant = (plan: string) => PLANT_PLANS.has(plan);

export interface SceneTaxon {
  /** its record */
  id: string;
  label: string;
  plan: BodyPlan;
  posture?: string;
  /** the grown animal's length and the height of its hips, in metres, as its claims give them */
  length?: number;
  hip?: number;
  /** its length is not claimed: the kit's shape gives it, from the mass that is */
  fromMass?: boolean;
  /** the grown plant's height, in metres, as its claim gives it */
  height?: number;
  mass?: number;
  /** the snapshot's rows that put it in this formation at this moment, and the collections they are in */
  rows: number;
  collections: number;
  time: FeatureTime;
  variants?: Record<string, FeatureTime>;
}

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

export interface SceneFile {
  format: 'lightworld-scene@1';
  site: {
    id: string;
    label: string;
    /** the record the scene belongs to */
    place: string;
    /** the local grid's origin: where the place stood at the slice, in the globe's coordinates at that time */
    origin: { lat: number; lon: number };
    /** the place's own coordinates today */
    today: { lat: number; lon: number };
    /** the times it is drawn for, and the moment it describes */
    span: [number, number];
    slice: number;
    water_level: number;
    /** where a visitor arrives, in local metres, and the direction from there to the river */
    focus: [number, number];
    to_river: [number, number];
  };
  /** finest first, as a city's: a place uses the finest level that covers it */
  ground: GroundLevel[];
  taxa: SceneTaxon[];
  omitted: SceneOmission[];
  /** the climate field's reading of the place, and the cover the transitions allow */
  biome: { climate: ClimateClass; label: string; field: string; ageMa: number; cover: SceneCover };
  /** the rows the scene rests on */
  fossils: {
    source: string;
    title: string;
    rows: number;
    collections: number;
    /** how many of those rows belong to a taxon that is drawn */
    drawn: number;
  };
  generator: {
    generator: string;
    version: number;
    seed: string;
    basis: 'procedural';
    params: Record<string, unknown>;
    /** the hash of the plan, and of one cell's mesh, which the browser must match to the byte */
    outputSha256: string;
    cell: { key: number; detail: number; sha256: string };
  };
}
