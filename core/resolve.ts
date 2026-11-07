// One contract for every layer (docs/STRUCTURE.md section 3.3): asked at any place and any time, a layer says what
// it has there and which tier answered.
//
//   evidence  records or rows put it here, then
//   model     a field or a model covers this place and time
//   generic   nothing does, so a generic prior is drawn in its place, and says so
//   unknown   nothing is known, and nothing stands in for it
//
// A layer never answers nothing: a fall-through is a bug, and the build's tests ask every layer across the whole span
// of the world. Unknown is a fine answer; looking broken is not, so the viewer draws each tier as designed, and the
// generic prior plainly.
import { atlasKey, atlasList, seaList, TIER, type AtlasBin, type AtlasGrid, type SeaBin } from './atlas.ts';
import { lookAt, type Look, type PlanetFile } from './planet.ts';
import type { Scenario } from './scenario.ts';

export type Tier = 'evidence' | 'model' | 'generic' | 'unknown';
export const TIERS: readonly Tier[] = ['evidence', 'model', 'generic', 'unknown'];

export const LAYERS = ['planet', 'geography', 'climate', 'ice', 'life', 'people', 'polity'] as const;
export type LayerId = (typeof LAYERS)[number];

export interface Answer {
  layer: LayerId;
  tier: Tier;
  /** what the layer has here, in a word or a number; null where it has nothing */
  value: string | number | null;
  /** why this tier, in a sentence a panel can show */
  why: string;
}

/**
 * Who lived at a place and time, as the atlases have it: its tier on the land's list, or on the sea's (`sea-…`); `sea`
 * where the land's atlas has no land there and the sea's no list; null where neither reaches the time.
 */
export type LifeTier = 'here' | 'region' | 'standin' | 'nothing' | 'sea' | 'sea-here' | 'sea-region' | 'sea-standin' | 'sea-nothing';

/** What resolve reads: the build and the viewer each give it what they have loaded. */
export interface ResolveWorld {
  planet: PlanetFile;
  /** the gridded geography, by field, with the span each covers [older, younger] on the axis */
  geography: { title: string; mode: 'elevation' | 'blocks'; coverage: [number, number] }[];
  climate?: [number, number];
  ice?: [number, number];
  people?: [number, number];
  polities?: [number, number];
  life?: (lat: number, lon: number, t: number) => LifeTier | null;
  polity?: (lat: number, lon: number, t: number) => string | undefined;
  /** where the generic prior puts land */
  genericLand?: (lat: number, lon: number) => boolean;
}

const within = (span: [number, number] | undefined, t: number) => !!span && t >= span[0] && t <= span[1];

/** `look` is the planet at t under s, for a caller that asks many places at one time. */
export function resolve(w: ResolveWorld, layer: LayerId, lat: number, lon: number, t: number, s: Scenario = {}, look: Look = lookAt(w.planet, t, s)): Answer {
  const a = (tier: Tier, value: Answer['value'], why: string): Answer => ({ layer, tier, value, why });
  if (!look.formed) return a('unknown', null, 'The Earth had not formed, or is gone.');
  switch (layer) {
    case 'planet':
      return look.phase ? a('evidence', look.phase.label, 'The planet\'s state at this time, from its records.') : a('unknown', null, 'No state of the planet is recorded for this time.');
    case 'geography': {
      if (look.surface === 'magma' || look.surface === 'crust-and-magma') return a('evidence', look.surface, 'The planet\'s state covers everything: there is no land and sea to map.');
      const f = w.geography.find((g) => within(g.coverage, t));
      if (f) return a('model', f.mode, `${f.title} covers this time.`);
      if (look.surface === 'bare-rock') return a('generic', 'rock', 'Nothing records the ground of this time: bare rock is drawn, as the planet\'s state says there were no oceans.');
      const land = w.genericLand?.(lat, lon);
      return a('generic', land ? 'land' : 'sea', 'Nothing records where the land was at this time: generic land is drawn, its places invented and its amount a placeholder.');
    }
    case 'climate':
      if (within(w.climate, t)) return a('model', 'climate field', 'A climate model\'s run covers this time.');
      return a('generic', look.surface ?? 'plain', 'No climate field covers this time: the planet\'s state stands in for it.');
    case 'ice':
      if (within(w.ice, t)) return a('model', 'ice-sheet field', 'A reconstruction of the ice sheets covers this time.');
      if (look.ice) return a('evidence', look.iceReach, 'A glaciation\'s records say how far its ice reached.');
      return a('generic', 'none', 'No ice is drawn: nothing records ice here then, which does not mean there was none.');
    case 'life': {
      const tier = w.life?.(lat, lon, t) ?? null;
      if (tier === null) return a('unknown', null, 'The atlases of who lived where reach only the Phanerozoic.');
      if (tier === 'here') return a('evidence', tier, 'Fossils put its taxa near here, then.');
      if (tier === 'region') return a('model', tier, 'Fossils of the region, reachable overland in a like climate, are inferred to have lived here.');
      if (tier === 'standin') return a('generic', tier, 'Nothing of a kind is known near: the nearest clade that has it stands in.');
      if (tier === 'sea-here') return a('evidence', tier, 'Fossils of the sea put its genera near here, then.');
      if (tier === 'sea-region') return a('model', tier, 'Fossils of the sea of the region, reachable by sea in a like belt of latitude, are inferred to have lived here.');
      if (tier === 'sea-standin') return a('generic', tier, 'Nothing is recorded in the sea near here: the commonest genera of the stage in a like belt of latitude stand in.');
      return a('unknown', tier, tier === 'sea' ? 'Neither atlas has a list for this sea then.' : 'No record of life here then.');
    }
    case 'people':
      if (within(w.people, t)) return a('model', 'population grid', 'A reconstruction of where people lived covers this time.');
      return a('unknown', null, 'No grid of where people lived covers this time.');
    case 'polity': {
      if (!within(w.polities, t)) return a('unknown', null, 'No dataset of states covers this time.');
      const name = w.polity?.(lat, lon, t);
      return name ? a('evidence', name, 'A row of a dataset of states, or a record, draws one here.') : a('unknown', null, 'No state is drawn here: the dataset has none, which does not mean there was none.');
    }
  }
}

/** How many answers of each tier a set of places and times gets, for each layer: how much of the world each tier holds. */
export function tierCounts(w: ResolveWorld, places: [number, number][], times: number[], s: Scenario = {}): Record<LayerId, Record<Tier, number>> {
  const out = Object.fromEntries(LAYERS.map((l) => [l, Object.fromEntries(TIERS.map((t) => [t, 0]))])) as Record<LayerId, Record<Tier, number>>;
  for (const layer of LAYERS) for (const t of times) for (const [lat, lon] of places) out[layer][resolve(w, layer, lat, lon, t, s).tier]++;
  return out;
}

/** The atlas's tier at a place and time, from its stages: the best tier on the place's list. */
export function lifeTierOf(bins: { from: number; to: number }[], grid: AtlasGrid, bin: (i: number) => AtlasBin | undefined, lat: number, lon: number, t: number): LifeTier | null {
  const i = bins.findIndex((b) => b.from <= t && t < b.to);
  if (i < 0) return null;
  const b = bin(i);
  if (!b) return null;
  const list = atlasList(b, grid, lat, lon);
  if (!list.length) return b.nodes[String(atlasKey(grid, lat, lon))] ? 'nothing' : 'sea';
  const best = Math.min(...list.map((e) => e.tier));
  return best === TIER.here ? 'here' : best === TIER.region ? 'region' : 'standin';
}

/** The sea's atlas's tier at a place and time, from its stages: the best tier on the place's list, or null where it has none. */
export function seaTierOf(bins: { from: number; to: number }[], grid: AtlasGrid, bin: (i: number) => SeaBin | undefined, lat: number, lon: number, t: number): LifeTier | null {
  const i = bins.findIndex((b) => b.from <= t && t < b.to);
  if (i < 0) return null;
  const b = bin(i);
  if (!b) return null;
  const list = seaList(b, grid, lat, lon);
  if (!list) return null;
  if (!list.length) return 'sea-nothing';
  const best = Math.min(...list.map((e) => e.tier));
  return best === TIER.here ? 'sea-here' : best === TIER.region ? 'sea-region' : 'sea-standin';
}

/** Places to ask at: the centre of every cell of a grid this many degrees across. */
export function gridPlaces(step: number): [number, number][] {
  const out: [number, number][] = [];
  for (let lat = -90 + step / 2; lat < 90; lat += step) for (let lon = -180 + step / 2; lon < 180; lon += step) out.push([lat, lon]);
  return out;
}

/** Spans of time to summarise by, as ages in Ma from the oldest: each a tenth of the one before, then the future. */
export const TIER_SPANS: { label: string; olderMa: number; youngerMa: number }[] = [
  { label: '4600–1000 Ma', olderMa: 4600, youngerMa: 1000 },
  { label: '1000–100 Ma', olderMa: 1000, youngerMa: 100 },
  { label: '100–10 Ma', olderMa: 100, youngerMa: 10 },
  { label: '10–1 Ma', olderMa: 10, youngerMa: 1 },
  { label: '1 Ma–100 ka', olderMa: 1, youngerMa: 0.1 },
  { label: '100–10 ka', olderMa: 0.1, youngerMa: 0.01 },
  { label: 'the last 10 kyr', olderMa: 0.01, youngerMa: 0 },
  { label: 'the next 10 Gyr', olderMa: 0, youngerMa: -10000 },
];
