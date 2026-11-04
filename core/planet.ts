// The planet's states (planet.json): the phases of the planet's record, such as a magma
// ocean or oceans of water, and the episodes that change its look while they last, such as
// the ice of a Snowball Earth. Each comes with its interval in every scenario that moves it
// and the claims that decide how it looks. The viewer reads them at the time shown; how a
// state is drawn is the surface generator's and the renderer's business, not a fact.
import { lookup, type Scenario } from './scenario.ts';
import type { Basis, FeatureTime } from './tileset.ts';

/** A claim that decides how a state looks. */
export interface StateClaim {
  /** entity#key */
  claim: string;
  value: string | number;
  rank: string;
  /** the alternative it belongs to; absent: the default picture */
  alt?: string;
  basis: Basis;
}

export interface PlanetState {
  /** the entity, or entity@phase */
  subject: string;
  label: string;
  time: FeatureTime;
  /** its interval under other scenarios (keyed by scenario key), where it differs */
  variants?: Record<string, FeatureTime>;
  /** by property, the claims that decide its look; several for one property compete */
  values: Record<string, StateClaim[]>;
}

export interface PlanetFile {
  /** the planet's record and its phases, in order; null if the world has none */
  planet: { id: string; label: string; time: FeatureTime; variants?: Record<string, FeatureTime>; phases: PlanetState[] } | null;
  /** events that change the planet's look while they last, such as glaciations */
  episodes: PlanetState[];
  /** transitions that brought a new cover to the land or the shallow seas */
  covers?: PlanetState[];
  /** how long, in years, a cover takes to spread where its transition gives no end */
  coverSpread?: number;
}

/** How far each cover has spread at a time, 0–1: none before its transition starts. */
export interface Cover {
  crust: number;
  plants: number;
  forests: number;
  grasses: number;
  reefs: number;
}

const COVER_KEYS: Record<string, keyof Cover> = { 'microbial-crust': 'crust', 'land-plants': 'plants', forests: 'forests', grasslands: 'grasses', reefs: 'reefs' };

/** What the land and the shallow seas can be covered with at a time, in a scenario. */
export function coverAt(file: PlanetFile, t: number, s: Scenario): Cover {
  const out: Cover = { crust: 0, plants: 0, forests: 0, grasses: 0, reefs: 0 };
  const spread = file.coverSpread ?? 3e7;
  for (const st of file.covers ?? []) {
    const key = COVER_KEYS[String(valueOf(st, 'cover', s))];
    if (!key) continue;
    const [a, b] = spanOf(st, s);
    if (t < a) continue;
    // A reef-building episode holds from its start to its end. Any other cover stays once it has
    // come, and its end is when it had spread.
    if (key === 'reefs') {
      if (t <= b) out.reefs = 1;
      continue;
    }
    const span = Number.isFinite(b) && b > a ? b - a : spread;
    const x = Math.min(1, (t - a) / span);
    out[key] = Math.max(out[key], x * x * (3 - 2 * x));
  }
  // Grasses, trees and low plants are all plants: where a later cover has come the earlier has too.
  out.plants = Math.max(out.plants, out.forests, out.grasses);
  return out;
}

/** The planet at a time, in a scenario: what the renderer and the panels need. */
export interface Look {
  /** the planet exists: false before its record starts, or after it ends */
  formed: boolean;
  /** the phase that holds, if any */
  phase: PlanetState | null;
  surface: string | null;
  atmosphere: string | null;
  /** how far through its phase the time is: 0 at its start, 1 at its end */
  progress: number;
  /** the lowest latitude that ice reaches, in degrees; 90 is no ice */
  iceReach: number;
  /** the episode the ice belongs to */
  ice: PlanetState | null;
}

/**
 * The claim a scenario uses among competing ones, as the chronology chooses: the scenario's
 * alternative's own claims if it has any, else the default picture's; among those a pick,
 * else the one preferred, else the only one not deprecated.
 */
export function chosenClaim(cs: StateClaim[], s: Scenario): StateClaim | undefined {
  const alts = new Set(s.alts ?? []);
  const own = cs.filter((c) => c.alt && alts.has(c.alt));
  const avail = own.length ? own : cs.filter((c) => !c.alt);
  const pick = avail.find((c) => s.picks?.includes(c.claim));
  if (pick) return pick;
  const preferred = avail.filter((c) => c.rank === 'preferred');
  if (preferred.length) return preferred.length === 1 ? preferred[0] : undefined;
  const usable = avail.filter((c) => c.rank !== 'deprecated');
  return usable.length === 1 ? usable[0] : undefined;
}

/** A state's interval in a scenario, as [start, end) at its best estimates; open ends are infinite. */
export function spanOf(st: { time: FeatureTime; variants?: Record<string, FeatureTime> }, s: Scenario): [number, number] {
  const time = lookup(st.variants, s, st.time);
  return [time.start.best ?? -Infinity, time.end.best ?? Infinity];
}

export function valueOf(st: PlanetState, prop: string, s: Scenario): string | number | null {
  return chosenClaim(st.values[prop] ?? [], s)?.value ?? null;
}

export function lookAt(file: PlanetFile, t: number, s: Scenario): Look {
  const look: Look = { formed: true, phase: null, surface: null, atmosphere: null, progress: 0, iceReach: 90, ice: null };
  const p = file.planet;
  if (!p) return look;
  const [born, gone] = spanOf(p, s);
  if (t < born || t > gone) return { ...look, formed: false };
  for (const ph of p.phases) {
    const [a, b] = spanOf(ph, s);
    // A phase holds from its start until the next begins; the last also at the very end.
    if (t >= a && (t < b || (t === b && ph === p.phases.at(-1)))) {
      look.phase = ph;
      look.progress = Number.isFinite(a) && Number.isFinite(b) && b > a ? (t - a) / (b - a) : 0;
      break;
    }
  }
  if (look.phase) {
    const surface = valueOf(look.phase, 'surface', s);
    const atmosphere = valueOf(look.phase, 'atmosphere', s);
    look.surface = typeof surface === 'string' ? surface : null;
    look.atmosphere = typeof atmosphere === 'string' ? atmosphere : null;
  }
  for (const ep of file.episodes) {
    const [a, b] = spanOf(ep, s);
    if (t < a || t > b) continue;
    const reach = valueOf(ep, 'ice_reach', s);
    if (typeof reach === 'number' && reach < look.iceReach) {
      look.iceReach = reach;
      look.ice = ep;
    }
  }
  return look;
}
