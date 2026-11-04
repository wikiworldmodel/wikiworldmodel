// Turn the world's dated claims and relations into a simple temporal network, solve it, and
// derive every entity's and phase's interval from the evidence (section 5), for each
// scenario (core/scenario.ts): the default picture, plus alternatives and picked claims.
import { parseRef, splitRef } from '../../../core/refs.ts';
import { scenarioKey, type Scenario } from '../../../core/scenario.ts';
import { conflictIn, ORIGIN, solve, type Bounds, type Conflict, type Constraint, type Solution } from '../../../core/stn.ts';
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
  let all = allRelations.get(world);
  if (!all) {
    all = world.entities.flatMap((e) => e.relations).filter((r) => r.status !== 'deprecated' && r.rank !== 'deprecated');
    allRelations.set(world, all);
  }
  return all.filter((r) => !r.alt || alts.has(r.alt));
}

const allRelations = new WeakMap<World, Relation[]>();

/** Times already read: the network is made once for every competing claim, from the same few thousand values. */
const readStrings = new Map<string, TimeValue | undefined>();
const readObjects = new WeakMap<object, { v: TimeValue | undefined }>();

function timeOrUndefined(v: unknown): TimeValue | undefined {
  const read = () => {
    try {
      return parseTime(v as never);
    } catch {
      return undefined; // the validator reports it
    }
  };
  if (typeof v === 'string') {
    if (!readStrings.has(v)) readStrings.set(v, read());
    return readStrings.get(v);
  }
  if (typeof v !== 'object' || v === null) return read();
  let known = readObjects.get(v);
  if (!known) {
    known = { v: read() };
    readObjects.set(v, known);
  }
  return known.v;
}

/**
 * The network for a scenario. With `centres`, each dated claim is pinned to its central value
 * instead of its bounds: solving that gives best estimates for derived dates.
 */
export function buildNetwork(world: World, s: Scenario = {}, centres = false): { points: string[]; constraints: Constraint[] } {
  // A pick changes one group's claim, in a network otherwise its picture's: there are thousands of picks.
  if (s.picks?.length === 1) {
    const quick = pickedNetwork(world, s, centres);
    if (quick) return quick;
  }
  return wholeNetwork(world, s, centres);
}

const pictureNetworks = new WeakMap<World, Map<string, { points: string[]; constraints: Constraint[] }>>();

/** A picture's network, with one group's constraints changed for the claim picked; undefined if that cannot be done in place. */
function pickedNetwork(world: World, s: Scenario, centres: boolean): { points: string[]; constraints: Constraint[] } | undefined {
  const pick = s.picks![0];
  const { record, part } = splitRef(pick);
  const claim = world.entity.get(record)?.claims.find((c) => c.key === part);
  const g = claim && claimGroup(world, claim.subject, claim.prop);
  if (!claim || !g || !world.vocab.properties[g.prop]?.moment) return undefined;
  const picture: Scenario = s.alts?.length ? { alts: s.alts } : {};
  const before = chosen(g, picture);
  if (!before) return undefined;
  let known = pictureNetworks.get(world);
  if (!known) {
    known = new Map();
    pictureNetworks.set(world, known);
  }
  const key = `${scenarioKey(picture)}|${centres}`;
  let base = known.get(key);
  if (!base) {
    base = wholeNetwork(world, picture, centres);
    known.set(key, base);
  }
  const at = base.constraints.findIndex((c) => c.source === before.ref);
  if (at < 0) return undefined;
  // In place, so that the order of the constraints, on which ties in the solver turn, is the same as if made whole.
  const count = base.constraints.filter((c) => c.source === before.ref).length;
  const mine = claimConstraints(world, g.prop, claim, centres);
  return { points: base.points, constraints: [...base.constraints.slice(0, at), ...mine, ...base.constraints.slice(at + count)] };
}

/** What one dated claim says, as constraints. */
function claimConstraints(world: World, prop: string, c: Claim, centres: boolean): Constraint[] {
  const out: Constraint[] = [];
  const add = (x: Constraint) => out.push(x);
  if (!subjectExists(world, c.subject)) return out;
  const v = timeOrUndefined(c.value);
  if (!v) return out;
  const point = prop === 'end' ? pointOf(world, c.subject, 'end') : pointOf(world, c.subject, 'start');
  const source = c.ref;
  if (v.kind === 'ref') {
    if (!subjectExists(world, v.ref)) return out; // a wanted record: nothing to constrain by yet
    const [lo, hi] = v.lag;
    if (v.edge) {
      const tp = pointOf(world, v.ref, v.edge);
      if (prop === 'earlier_than') add({ source, from: point, to: tp, lo, hi: Infinity, note: 'earlier than' });
      else if (prop === 'later_than') add({ source, from: tp, to: point, lo, hi: Infinity, note: 'later than' });
      else add({ source, from: tp, to: point, lo, hi });
    } else if (prop === 'earlier_than') {
      add({ source, from: point, to: pointOf(world, v.ref, 'start'), lo: 0, hi: Infinity, note: 'earlier than' });
    } else if (prop === 'later_than') {
      add({ source, from: pointOf(world, v.ref, 'end'), to: point, lo: 0, hi: Infinity, note: 'later than' });
    } else {
      add({ source, from: pointOf(world, v.ref, 'start'), to: point, lo: 0, hi: Infinity, note: 'within' });
      add({ source, from: point, to: pointOf(world, v.ref, 'end'), lo: 0, hi: Infinity, note: 'within' });
    }
    return out;
  }
  if (v.kind === 'unknown') return out;
  const [lo, hi] = centres && prop !== 'earlier_than' && prop !== 'later_than' ? centre(v) : bounds(v);
  if (prop === 'earlier_than') add({ source, from: ORIGIN, to: point, lo: -Infinity, hi, note: 'earlier than' });
  else if (prop === 'later_than') add({ source, from: ORIGIN, to: point, lo, hi: Infinity, note: 'later than' });
  else if (Number.isFinite(lo) || Number.isFinite(hi)) add({ source, from: ORIGIN, to: point, lo, hi });
  return out;
}

function wholeNetwork(world: World, s: Scenario, centres: boolean): { points: string[]; constraints: Constraint[] } {
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
    if (c) constraints.push(...claimConstraints(world, g.prop, c, centres));
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

/** Whether a scenario holds, and if not why, without working out its dates. */
export function conflictInScenario(world: World, s: Scenario = {}, centres = false): Conflict | undefined {
  const { points, constraints } = buildNetwork(world, s, centres);
  return conflictIn(points, constraints);
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
 * Each picture, and each picture with one competing dated claim picked over the default.
 * Combinations of picks are not worked out. The first of a picture's is the picture itself.
 */
export function* scenariosOf(world: World, alternatives?: string[]): Generator<Scenario> {
  for (const p of pictures(world, alternatives)) {
    yield p;
    for (const g of claimGroups(world)) {
      if (!world.vocab.properties[g.prop]?.moment) continue;
      const avail = available(g, p);
      if (avail.length < 2) continue;
      const def = chosen(g, p);
      for (const c of avail) if (c !== def) yield { ...p, picks: [c.ref] };
    }
  }
}

type Bound = NonNullable<ReturnType<Bounds['get']>>;

/** Bounds kept as what differs from another solution's: reading one falls through to the other. */
class BoundsOver extends Map<string, Bound> {
  /** what it is kept over: its own entries are only what differs from this */
  readonly keptOver: Bounds;
  constructor(private base: Bounds) {
    super();
    this.keptOver = base;
  }
  override get(point: string): Bound | undefined {
    return super.get(point) ?? this.base.get(point);
  }
}

const sameBound = (a: Bound, b: Bound) => a.lo === b.lo && a.hi === b.hi && a.loBy.length === b.loBy.length && a.hiBy.length === b.hiBy.length && a.loBy.every((x, i) => x === b.loBy[i]) && a.hiBy.every((x, i) => x === b.hiBy[i]);

/** A solution with only what differs from a base kept: a pick moves a few dates, and there are thousands of picks. */
function overBase(sol: Solution, base: Bounds | undefined): Solution {
  if (!sol.ok || !base) return sol;
  const out = new BoundsOver(base);
  for (const [point, b] of sol.bounds) {
    const was = base.get(point);
    if (!was || !sameBound(b, was)) out.set(point, b);
  }
  return { ok: true, bounds: out };
}

/**
 * Solve each picture, and each picture with one competing dated claim picked over the default.
 * Each is kept only as it differs from its picture, and each picture as it differs from the default.
 */
export function solveVariants(world: World, alternatives?: string[]): Variant[] {
  const out: Variant[] = [];
  const boundsOf = (s: Solution) => (s.ok ? s.bounds : undefined);
  let rootSol: Bounds | undefined;
  let rootCentres: Bounds | undefined;
  let picture: Variant | undefined;
  for (const scenario of scenariosOf(world, alternatives)) {
    const isPicture = !scenario.picks?.length;
    const under = isPicture ? { sol: rootSol, centres: rootCentres } : { sol: boundsOf(picture!.solution), centres: boundsOf(picture!.centres) };
    const v: Variant = { key: scenarioKey(scenario), scenario, solution: overBase(solveScenario(world, scenario), under.sol), centres: overBase(solveScenario(world, scenario, true), under.centres) };
    out.push(v);
    if (isPicture) {
      picture = v;
      if (!rootSol) {
        rootSol = boundsOf(v.solution);
        rootCentres = boundsOf(v.centres);
      }
    }
  }
  return out;
}
