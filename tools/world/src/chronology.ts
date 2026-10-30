// Turn the world's dated claims and temporal relations into a simple temporal network,
// solve it, and derive every entity's and phase's interval from the evidence.
import { ORIGIN, solve, type Constraint, type Solution } from '../../../core/stn.ts';
import { bounds, centre, parseTime, type TimeInput } from '../../../core/time.ts';
import type { Claim, Entity, World } from './world.ts';

const TIME_PROPS = new Set(['date', 'start', 'end', 'date_before', 'date_after']);

export interface Subject {
  /** entity id, or entity#phase */
  ref: string;
  entity: Entity;
  phase?: string;
  start: string;
  end: string;
}

/** A group of competing claims: same subject and property. */
export interface ClaimGroup {
  key: string;
  subject: string;
  prop: string;
  claims: { id: string; claim: Claim }[];
  preferred?: string;
}

export interface Scenario {
  /** group key → chosen claim id, overriding the preferred claim */
  choose?: Record<string, string>;
}

export function durationYears(d: Record<string, number> | undefined, fallback: number): number {
  if (!d) return fallback;
  if ('myr' in d) return d.myr * 1e6;
  if ('kyr' in d) return d.kyr * 1e3;
  return d.yr;
}

export function subjects(world: World): Map<string, Subject> {
  const out = new Map<string, Subject>();
  for (const { data: e } of world.entities) {
    const kind = world.vocab.kinds[e.kind];
    const instant = kind?.temporal === 'instant';
    out.set(e.id, {
      ref: e.id,
      entity: e,
      start: instant ? `${e.id}@date` : `${e.id}@start`,
      end: instant ? `${e.id}@date` : `${e.id}@end`,
    });
    for (const p of Object.keys(e.phases ?? {})) {
      const ref = `${e.id}#${p}`;
      out.set(ref, { ref, entity: e, phase: p, start: `${ref}@start`, end: `${ref}@end` });
    }
  }
  return out;
}

export function claimGroups(world: World): ClaimGroup[] {
  const groups = new Map<string, ClaimGroup>();
  for (const { data: e } of world.entities) {
    for (const [id, claim] of Object.entries(e.claims)) {
      if (claim.status === 'deprecated') continue;
      const subject = claim.phase ? `${e.id}#${claim.phase}` : e.id;
      const key = `${subject}|${claim.prop}`;
      const g = groups.get(key) ?? { key, subject, prop: claim.prop, claims: [] };
      g.claims.push({ id, claim });
      if (claim.rank === 'preferred') g.preferred = g.preferred === undefined ? id : g.preferred;
      groups.set(key, g);
    }
  }
  return [...groups.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
}

/** The claim a scenario uses for a group: the override, else the preferred, else the only one. */
export function chosen(g: ClaimGroup, scenario: Scenario = {}): string | undefined {
  const o = scenario.choose?.[g.key];
  if (o) return o;
  if (g.preferred) return g.preferred;
  return g.claims.length === 1 ? g.claims[0].id : undefined;
}

/**
 * The network for a scenario. With `centres`, each dated claim is pinned to its central value
 * instead of its bounds: solving that gives best estimates for derived dates.
 */
export function buildNetwork(world: World, scenario: Scenario = {}, centres = false): { points: string[]; constraints: Constraint[] } {
  const subs = subjects(world);
  const points = new Set<string>();
  const constraints: Constraint[] = [];
  for (const s of subs.values()) {
    points.add(s.start);
    points.add(s.end);
    const src = `${s.entity.id}:structure`;
    if (s.start !== s.end) constraints.push({ source: src, from: s.start, to: s.end, lo: 0, hi: Infinity, note: 'starts before it ends' });
    if (s.phase) {
      const parent = subs.get(s.entity.id)!;
      constraints.push({ source: src, from: parent.start, to: s.start, lo: 0, hi: Infinity, note: `phase ${s.phase} starts within the entity` });
      constraints.push({ source: src, from: s.end, to: parent.end, lo: 0, hi: Infinity, note: `phase ${s.phase} ends within the entity` });
    }
  }
  for (const g of claimGroups(world)) {
    if (!TIME_PROPS.has(g.prop)) continue;
    const id = chosen(g, scenario);
    if (!id) continue;
    const claim = g.claims.find((c) => c.id === id)!.claim;
    const s = subs.get(g.subject);
    if (!s) continue;
    const value = parseTime(claim.value as TimeInput);
    const [lo, hi] = centres && (g.prop === 'date' || g.prop === 'start' || g.prop === 'end') ? [centre(value), centre(value)] : bounds(value);
    const point = g.prop === 'end' ? s.end : s.start;
    const source = `${s.entity.id}:claims.${id}`;
    if (g.prop === 'date_before') constraints.push({ source, from: ORIGIN, to: point, lo: -Infinity, hi, note: 'no later than' });
    else if (g.prop === 'date_after') constraints.push({ source, from: ORIGIN, to: point, lo, hi: Infinity, note: 'no earlier than' });
    else constraints.push({ source, from: ORIGIN, to: point, lo, hi });
  }
  for (const { data: e } of world.entities) {
    for (const [rid, r] of Object.entries(e.relations ?? {})) {
      const self = subs.get(r.phase ? `${e.id}#${r.phase}` : e.id);
      const other = subs.get(r.of);
      if (!self || !other) continue;
      const source = `${e.id}:relations.${rid}`;
      const lagLo = durationYears(r.lag?.min, 0);
      const lagHi = durationYears(r.lag?.max, Infinity);
      switch (r.type) {
        case 'before':
          constraints.push({ source, from: self.end, to: other.start, lo: lagLo, hi: lagHi });
          break;
        case 'after':
          constraints.push({ source, from: other.end, to: self.start, lo: lagLo, hi: lagHi });
          break;
        case 'during':
          constraints.push({ source, from: other.start, to: self.start, lo: 0, hi: Infinity });
          constraints.push({ source, from: self.end, to: other.end, lo: 0, hi: Infinity });
          break;
        case 'overlaps':
          constraints.push({ source, from: self.start, to: other.end, lo: 0, hi: Infinity });
          constraints.push({ source, from: other.start, to: self.end, lo: 0, hi: Infinity });
          break;
        case 'caused-by':
          constraints.push({ source, from: other.start, to: self.start, lo: lagLo, hi: lagHi });
          break;
        default:
          break; // spatial and lineage relations carry no time constraint
      }
    }
  }
  return { points: [...points], constraints };
}

export function solveWorld(world: World, scenario: Scenario = {}, centres = false): Solution {
  const { points, constraints } = buildNetwork(world, scenario, centres);
  return solve(points, constraints);
}

export interface Alternative {
  group: string;
  claim: string;
  solution: Solution;
  /** the same scenario with dated claims pinned to their centres (for best estimates) */
  centres: Solution;
}

/** Solve once per alternative claim (each non-preferred claim swapped in on its own). */
export function solveAlternatives(world: World): Alternative[] {
  const out: Alternative[] = [];
  for (const g of claimGroups(world)) {
    if (!TIME_PROPS.has(g.prop) || g.claims.length < 2) continue;
    for (const { id } of g.claims) {
      if (id === chosen(g)) continue;
      const scenario = { choose: { [g.key]: id } };
      out.push({ group: g.key, claim: id, solution: solveWorld(world, scenario), centres: solveWorld(world, scenario, true) });
    }
  }
  return out;
}
