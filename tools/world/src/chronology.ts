// Turn the world's dated claims and relations into a simple temporal network, solve it, and
// derive every entity's and phase's interval from the evidence (section 5), for each
// scenario (core/scenario.ts): the default picture, plus alternatives and picked claims.
import { parseRef } from '../../../core/refs.ts';
import { scenarioKey, type Scenario } from '../../../core/scenario.ts';
import { ORIGIN, solve, type Constraint, type Solution } from '../../../core/stn.ts';
import { bounds, centre, parseLag, parseTime, type TimeValue } from '../../../core/time.ts';
import { isMoment, type Claim, type Relation, type World } from './world.ts';

export { scenarioKey, type Scenario } from '../../../core/scenario.ts';

/** The STN point of a subject's start or end; a moment has one point, its date. */
export function pointOf(world: World, subject: string, edge: 'start' | 'end'): string {
  return isMoment(world, subject) ? `${subject}|date` : `${subject}|${edge}`;
}

/** Does a reference name a subject (an entity or one of its phases) that exists? */
export function subjectExists(world: World, ref: string): boolean {
  try {
    const r = parseRef(ref);
    if (r.type !== 'entity' || r.part) return false;
    const e = world.entity.get(r.id);
    return !!e && (!r.phase || e.phases.some((p) => p.id === r.phase));
  } catch {
    return false;
  }
}

/** Competing claims: same subject and property. */
export interface ClaimGroup {
  key: string;
  subject: string;
  prop: string;
  claims: Claim[];
}

const groupsOf = new WeakMap<World, { list: ClaimGroup[]; byKey: Map<string, ClaimGroup> }>();

/**
 * The world's claims grouped by subject and property, in key order. A loaded world does not
 * change, so this is worked out once per world: callers ask for it per entity, and redoing it
 * each time made validation quadratic in the size of the world.
 */
export function claimGroups(world: World): ClaimGroup[] {
  return indexGroups(world).list;
}

/** The group of one subject's property, if it has claims. */
export function claimGroup(world: World, subject: string, prop: string): ClaimGroup | undefined {
  return indexGroups(world).byKey.get(`${subject}|${prop}`);
}

function indexGroups(world: World): { list: ClaimGroup[]; byKey: Map<string, ClaimGroup> } {
  const known = groupsOf.get(world);
  if (known) return known;
  const groups = new Map<string, ClaimGroup>();
  for (const e of world.entities) {
    for (const c of e.claims) {
      if (c.status === 'deprecated') continue;
      const key = `${c.subject}|${c.prop}`;
      const g = groups.get(key) ?? { key, subject: c.subject, prop: c.prop, claims: [] };
      g.claims.push(c);
      groups.set(key, g);
    }
  }
  const index = { list: [...groups.values()].sort((a, b) => (a.key < b.key ? -1 : 1)), byKey: groups };
  groupsOf.set(world, index);
  return index;
}

/**
 * The claims of a group a scenario chooses among: its alternatives' own claims if they have
 * any for this group (each alternative ranks its own claims), else the default picture's.
 */
export function available(g: ClaimGroup, s: Scenario): Claim[] {
  const alts = new Set(s.alts ?? []);
  const own = g.claims.filter((c) => c.alt && alts.has(c.alt));
  return own.length ? own : g.claims.filter((c) => !c.alt);
}

/**
 * The claim a scenario uses for a group: a pick, else the preferred one among those
 * available, else the only one that is not deprecated. Undefined if that is ambiguous.
 */
export function chosen(g: ClaimGroup, s: Scenario = {}): Claim | undefined {
  const avail = available(g, s);
  const pick = avail.find((c) => s.picks?.includes(c.ref));
  if (pick) return pick;
  const preferred = avail.filter((c) => c.rank === 'preferred');
  if (preferred.length === 1) return preferred[0];
  if (preferred.length > 1) return undefined;
  const usable = avail.filter((c) => c.rank !== 'deprecated');
  return usable.length === 1 ? usable[0] : undefined;
}

/** Relations that hold in a scenario's picture. */
export function relationsIn(world: World, s: Scenario): Relation[] {
  const alts = new Set(s.alts ?? []);
  return world.entities.flatMap((e) => e.relations).filter((r) => r.status !== 'deprecated' && r.rank !== 'deprecated' && (!r.alt || alts.has(r.alt)));
}

function timeOrUndefined(v: unknown): TimeValue | undefined {
  try {
    return parseTime(v as never);
  } catch {
    return undefined; // the validator reports it
  }
}

/**
 * The network for a scenario. With `centres`, each dated claim is pinned to its central value
 * instead of its bounds: solving that gives best estimates for derived dates.
 */
export function buildNetwork(world: World, s: Scenario = {}, centres = false): { points: string[]; constraints: Constraint[] } {
  const points = new Set<string>();
  const constraints: Constraint[] = [];
  const add = (c: Constraint) => constraints.push(c);
  for (const e of world.entities) {
    const start = pointOf(world, e.id, 'start');
    const end = pointOf(world, e.id, 'end');
    points.add(start).add(end);
    if (start !== end) add({ source: e.id, from: start, to: end, lo: 0, hi: Infinity, note: 'starts before it ends' });
    // Phases tile the lifetime: the first starts with the entity, each ends as the next
    // starts, and the last ends with the entity.
    let prev = start;
    for (const p of e.phases) {
      const ps = `${e.id}@${p.id}|start`;
      const pe = `${e.id}@${p.id}|end`;
      points.add(ps).add(pe);
      add({ source: e.id, from: prev, to: ps, lo: 0, hi: 0, note: prev === start ? `phase ${p.id} starts with the entity` : `phase ${p.id} starts as the one before it ends` });
      add({ source: e.id, from: ps, to: pe, lo: 0, hi: Infinity, note: `phase ${p.id} starts before it ends` });
      prev = pe;
    }
    if (e.phases.length) add({ source: e.id, from: prev, to: end, lo: 0, hi: 0, note: 'the last phase ends with the entity' });
  }
  for (const g of claimGroups(world)) {
    const prop = world.vocab.properties[g.prop];
    if (!prop?.moment) continue;
    const c = chosen(g, s);
    if (!c || !subjectExists(world, c.subject)) continue;
    const v = timeOrUndefined(c.value);
    if (!v) continue;
    const point = g.prop === 'end' ? pointOf(world, c.subject, 'end') : pointOf(world, c.subject, 'start');
    const source = c.ref;
    if (v.kind === 'ref') {
      if (!subjectExists(world, v.ref)) continue; // a wanted record: nothing to constrain by yet
      const [lo, hi] = v.lag;
      if (v.edge) {
        const tp = pointOf(world, v.ref, v.edge);
        if (g.prop === 'earlier_than') add({ source, from: point, to: tp, lo, hi: Infinity, note: 'earlier than' });
        else if (g.prop === 'later_than') add({ source, from: tp, to: point, lo, hi: Infinity, note: 'later than' });
        else add({ source, from: tp, to: point, lo, hi });
      } else if (g.prop === 'earlier_than') {
        add({ source, from: point, to: pointOf(world, v.ref, 'start'), lo: 0, hi: Infinity, note: 'earlier than' });
      } else if (g.prop === 'later_than') {
        add({ source, from: pointOf(world, v.ref, 'end'), to: point, lo: 0, hi: Infinity, note: 'later than' });
      } else {
        add({ source, from: pointOf(world, v.ref, 'start'), to: point, lo: 0, hi: Infinity, note: 'within' });
        add({ source, from: point, to: pointOf(world, v.ref, 'end'), lo: 0, hi: Infinity, note: 'within' });
      }
      continue;
    }
    if (v.kind === 'unknown') continue;
    const [lo, hi] = centres && g.prop !== 'earlier_than' && g.prop !== 'later_than' ? centre(v) : bounds(v);
    if (g.prop === 'earlier_than') add({ source, from: ORIGIN, to: point, lo: -Infinity, hi, note: 'earlier than' });
    else if (g.prop === 'later_than') add({ source, from: ORIGIN, to: point, lo, hi: Infinity, note: 'later than' });
    else if (Number.isFinite(lo) || Number.isFinite(hi)) add({ source, from: ORIGIN, to: point, lo, hi });
  }
  for (const r of relationsIn(world, s)) {
    const type = world.vocab.relations[r.rel];
    if (!type?.time || !subjectExists(world, r.subject) || !subjectExists(world, r.to)) continue;
    let lag: [number, number] = [0, Infinity];
    try {
      lag = parseLag(r.lag);
    } catch {
      continue; // the validator reports it
    }
    const at = (x: string) => {
      const [who, edge] = x.split('.') as ['self' | 'other', 'start' | 'end'];
      return pointOf(world, who === 'self' ? r.subject : r.to, edge);
    };
    for (const t of type.time) {
      const [lo, hi] = t.lag ? lag : [0, Infinity];
      add({ source: r.ref, from: at(t.from), to: at(t.to), lo, hi });
    }
  }
  return { points: [...points], constraints };
}

export function solveScenario(world: World, s: Scenario = {}, centres = false): Solution {
  const { points, constraints } = buildNetwork(world, s, centres);
  return solve(points, constraints);
}

export interface Variant {
  key: string;
  scenario: Scenario;
  solution: Solution;
  /** the same scenario with dated claims pinned to their centres (for best estimates) */
  centres: Solution;
}

/** The pictures to check or show: the default, and each given alternative on top of it. */
export function pictures(world: World, alternatives: string[] = world.alternatives.filter((a) => a.type === 'alternative').map((a) => a.id)): Scenario[] {
  return [{}, ...alternatives.map((a) => ({ alts: [a] }))];
}

/**
 * Solve each picture, and each picture with one competing dated claim picked over the
 * default. Combinations of picks are not precomputed.
 */
export function solveVariants(world: World, alternatives?: string[]): Variant[] {
  const out: Variant[] = [];
  const run = (scenario: Scenario) => out.push({ key: scenarioKey(scenario), scenario, solution: solveScenario(world, scenario), centres: solveScenario(world, scenario, true) });
  for (const p of pictures(world, alternatives)) {
    run(p);
    for (const g of claimGroups(world)) {
      if (!world.vocab.properties[g.prop]?.moment) continue;
      const avail = available(g, p);
      if (avail.length < 2) continue;
      const def = chosen(g, p);
      for (const c of avail) if (c !== def) run({ ...p, picks: [c.ref] });
    }
  }
  return out;
}
