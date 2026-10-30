// Entity records for the inspect panel, features for tiles, and the search index.
import type { Bounds, Solution } from '../../../../core/stn.ts';
import { parseTime, type TimeInput } from '../../../../core/time.ts';
import type { EntityRecord } from '../../../../core/records.ts';
import type { Estimate, Feature, FeatureTime } from '../../../../core/tileset.ts';
import { claimGroups, chosen, subjects, type Alternative, type Subject } from '../chronology.ts';
import type { PointResult } from '../importer.ts';
import type { Entity, World } from '../world.ts';

const mid = (lo: number, hi: number) => (Number.isFinite(lo) && Number.isFinite(hi) ? (lo + hi) / 2 : Number.isFinite(lo) ? lo : Number.isFinite(hi) ? hi : null);

/**
 * Bounds come from the network with every claim at its full range; the best estimate from
 * the same network with each claim pinned to its centre, so a date derived from "after X"
 * starts at X's central value rather than at the edge of X's uncertainty.
 */
export function estimate(b: Bounds, centres: Bounds | undefined, point: string, direct: boolean): Estimate {
  const v = b.get(point)!;
  const c = centres?.get(point);
  return { best: c ? mid(c.lo, c.hi) : mid(v.lo, v.hi), lo: v.lo, hi: v.hi, derived: !direct };
}

function timeOf(world: World, s: Subject, b: Bounds, centres?: Bounds): FeatureTime {
  const instant = world.vocab.kinds[s.entity.kind]?.temporal === 'instant';
  const has = (prop: string) => Object.values(s.entity.claims).some((c) => c.prop === prop && (c.phase ?? undefined) === s.phase && c.status !== 'deprecated');
  if (instant) {
    const e = estimate(b, centres, s.start, has('date'));
    return { start: e, end: e, instant: true };
  }
  const end = estimate(b, centres, s.end, has('end'));
  // Something with no stated or derivable end still exists.
  if (!has('end') && end.hi === Infinity) end.best = null;
  return { start: estimate(b, centres, s.start, has('start')), end, instant: false };
}

const boundsOf = (s: Solution) => (s.ok ? s.bounds : undefined);

function basisOf(e: Entity): Feature['basis'] {
  return e.basis ?? 'evidence';
}

export function features(world: World, sol: Solution & { ok: true }, centres: Solution, alternatives: Alternative[], plates: Map<string, PointResult>): Feature[] {
  const subs = subjects(world);
  const out: Feature[] = [];
  for (const { data: e } of world.entities) {
    const loc = Object.values(e.claims).find((c) => c.prop === 'location' && c.rank === 'preferred');
    if (!loc) continue;
    const s = subs.get(e.id)!;
    // Only the alternatives that change this feature's dates, so that the viewer can pick
    // the one that applies when several claims are switched.
    const alts: Record<string, FeatureTime> = {};
    for (const a of alternatives) {
      if (!a.solution.ok || !affects(s, sol.bounds, a.solution.bounds, boundsOf(centres), boundsOf(a.centres))) continue;
      alts[`${a.group}=${a.claim}`] = timeOf(world, s, a.solution.bounds, boundsOf(a.centres));
    }
    const statuses = Object.values(e.claims).map((c) => c.status);
    out.push({
      id: e.id,
      label: e.label,
      kind: e.kind,
      basis: basisOf(e),
      frame: e.frame,
      plate: e.frame === 'earth/plates' ? (plates.get(e.id)?.plate ?? undefined) : undefined,
      location: loc.value as { lat: number; lon: number },
      time: timeOf(world, s, sol.bounds, boundsOf(centres)),
      alternatives: Object.keys(alts).length ? alts : undefined,
      status: statuses.includes('disputed') ? 'disputed' : statuses.every((x) => x === 'accepted') ? 'accepted' : 'proposed',
    });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : 1));
}

function valueText(world: World, prop: string, value: unknown): string | undefined {
  const t = world.vocab.props[prop]?.type;
  if (t !== 'time') return undefined;
  const v = parseTime(value as TimeInput);
  const ma = (y: number) => `${+((1950 - y) / 1e6).toFixed(4)} Ma`;
  if (v.kind === 'instant') return ma(v.t);
  if (v.kind === 'interval') return `${ma(v.lo)} – ${ma(v.hi)}`;
  return `${ma(v.mean)} ± ${+(v.pm / 1e6).toFixed(4)} Myr${v.sigma ? ` (${v.sigma}σ)` : ''}`;
}

export function records(
  world: World,
  sol: Solution & { ok: true },
  centres: Solution,
  alternatives: Alternative[],
  plates: Map<string, PointResult>,
  plateLabel: (p: number) => string | undefined,
): EntityRecord[] {
  const subs = subjects(world);
  const sourceById = new Map(world.sources.map((s) => [s.data.id, s.data]));
  const entityById = new Map(world.entities.map((e) => [e.data.id, e.data]));
  const groups = claimGroups(world);
  const out: EntityRecord[] = [];
  for (const { data: e } of world.entities) {
    const s = subs.get(e.id)!;
    const used = new Set<string>();
    const claims = Object.entries(e.claims).map(([id, c]) => {
      used.add(c.source);
      const subject = c.phase ? `${e.id}#${c.phase}` : e.id;
      const g = groups.find((x) => x.key === `${subject}|${c.prop}`);
      return {
        ...c,
        id,
        valueText: valueText(world, c.prop, c.value),
        group: `${subject}|${c.prop}`,
        chosen: !!g && chosen(g) === id,
        competing: !!g && g.claims.length > 1,
      };
    });
    const relations = Object.entries(e.relations ?? {}).map(([id, r]) => {
      used.add(r.source);
      const [oid, ophase] = r.of.split('#');
      const other = entityById.get(oid);
      const ofLabel = other ? (ophase ? `${other.label}: ${other.phases?.[ophase]?.label ?? ophase}` : other.label) : r.of;
      return { ...r, id, ofLabel, typeFamily: world.vocab.relations[r.type]?.family ?? 'other' };
    });
    const alts = alternatives
      .filter((a) => groupEntity(a.group) === e.id || (a.solution.ok && affects(s, sol.bounds, a.solution.bounds, boundsOf(centres), boundsOf(a.centres))))
      .map((a) => ({
        group: a.group,
        claim: a.claim,
        consistent: a.solution.ok,
        conflict: a.solution.ok ? undefined : a.solution.conflict.constraints.map((c) => c.source),
        time: a.solution.ok ? timeOf(world, s, a.solution.bounds, boundsOf(a.centres)) : undefined,
      }));
    const pr = plates.get(e.id);
    const bounds = sol.bounds;
    out.push({
      id: e.id,
      kind: e.kind,
      kindLabel: world.vocab.kinds[e.kind]?.label ?? e.kind,
      label: e.label,
      summary: e.summary,
      basis: basisOf(e),
      frame: {
        id: e.frame,
        title: world.frames[e.frame]?.title ?? e.frame,
        plate: pr?.plate ?? undefined,
        plateLabel: pr?.plate ? plateLabel(pr.plate) : undefined,
      },
      same_as: e.same_as,
      phases: Object.entries(e.phases ?? {}).map(([id, p]) => ({ id, label: p.label, summary: p.summary, time: timeOf(world, subs.get(`${e.id}#${id}`)!, bounds, boundsOf(centres)) })),
      time: timeOf(world, s, bounds, boundsOf(centres)),
      claims,
      relations,
      alternatives: alts,
      derivedBy: { start: bounds.get(s.start)!.loBy.concat(bounds.get(s.start)!.hiBy).filter(uniq), end: bounds.get(s.end)!.loBy.concat(bounds.get(s.end)!.hiBy).filter(uniq) },
      sources: Object.fromEntries([...used].sort().map((id) => [id, sourceById.get(id)!])),
    });
  }
  return out;
}

function uniq<T>(x: T, i: number, a: T[]): boolean {
  return a.indexOf(x) === i;
}

export function groupEntity(group: string): string {
  return group.split('|')[0].split('#')[0];
}

/** Whether an alternative scenario changes this subject's bounds or best estimates. */
function affects(s: Subject, a: Bounds, b: Bounds, ca?: Bounds, cb?: Bounds): boolean {
  const differ = (x?: Bounds, y?: Bounds) =>
    [s.start, s.end].some((p) => x?.get(p)?.lo !== y?.get(p)?.lo || x?.get(p)?.hi !== y?.get(p)?.hi);
  return differ(a, b) || differ(ca, cb);
}
