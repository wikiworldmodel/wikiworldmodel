// Entity records for the inspect panel, features for tiles, periods, and the search index.
import type { CitationRecord, ClaimRecord, EntityRecord, InverseRecord, PeriodRecord, RelationRecord, SearchFile, SourceRecord, VariantRecord } from '../../../../core/records.ts';
import { conj, rotate, toLatLon, unitVector } from '../../../../core/quat.ts';
import { parseRef, splitRef } from '../../../../core/refs.ts';
import type { RotationModel } from '../../../../core/rotation-model.ts';
import type { Bounds, Solution } from '../../../../core/stn.ts';
import { centre, formatDuration, formatTimeValue, parseLag, parseTime, PRESENT_YEAR, type TimeValue } from '../../../../core/time.ts';
import type { Basis, Estimate, Feature, FeatureBasis, FeatureName, FeatureTime } from '../../../../core/tileset.ts';
import { chosen, pointOf, scenarioKey, subjectExists, type ClaimGroup, type Variant } from '../chronology.ts';
import { BASES, isMoment, type Claim, type Entity, type Source, type World } from '../world.ts';

const mid = (lo: number, hi: number) => (Number.isFinite(lo) && Number.isFinite(hi) ? (lo + hi) / 2 : Number.isFinite(lo) ? lo : Number.isFinite(hi) ? hi : null);

/** The weakest basis: evidence, then reconstruction, projection and procedural. */
export function weakest(bases: Basis[]): Basis {
  return bases.reduce<Basis>((w, b) => (BASES.indexOf(b) > BASES.indexOf(w) ? b : w), 'evidence');
}

/** What the build knows about the world once its chronology is solved. */
export interface Solved {
  world: World;
  /** the default picture */
  sol: Solution & { ok: true };
  centres: Solution;
  /** every other scenario solved */
  variants: Variant[];
  groups: ClaimGroup[];
  model: RotationModel;
}

const boundsOf = (s: Solution) => (s.ok ? s.bounds : undefined);

/**
 * Bounds come from the network with every claim at its full range; the best estimate from
 * the same network with each claim pinned to its centre, so a date derived from "after X"
 * starts at X's central value rather than at the edge of X's uncertainty.
 */
function estimate(b: Bounds, centres: Bounds | undefined, point: string, direct: boolean): Estimate {
  const v = b.get(point)!;
  const c = centres?.get(point);
  return { best: c ? mid(c.lo, c.hi) : mid(v.lo, v.hi), lo: v.lo, hi: v.hi, derived: !direct };
}

/** Does a claimed time bound only one side, such as "younger than 3.4 Ga"? */
function oneSided(c: Claim): boolean {
  const v = parseTime(c.value as never);
  return v.kind === 'interval' && (!Number.isFinite(v.lo) || !Number.isFinite(v.hi));
}

/** The chosen claim of a subject's property in the default picture. */
export function claimOf(s: Solved, subject: string, prop: string): Claim | undefined {
  const g = s.groups.find((x) => x.subject === subject && x.prop === prop);
  return g ? chosen(g) : undefined;
}

function directTime(s: Solved, subject: string, prop: string): Claim | undefined {
  const c = claimOf(s, subject, prop);
  if (!c) return undefined;
  try {
    return parseTime(c.value as never).kind === 'ref' ? undefined : c;
  } catch {
    return undefined;
  }
}

function timeOf(s: Solved, subject: string, b: Bounds, centres?: Bounds): FeatureTime {
  const w = s.world;
  if (isMoment(w, subject)) {
    const e = estimate(b, centres, pointOf(w, subject, 'start'), !!directTime(s, subject, 'date'));
    const bounded = boundedBest(s, subject, b);
    if (bounded !== null) e.best = Math.min(Math.max(bounded, e.lo), e.hi);
    return { start: e, end: e, instant: true };
  }
  const endClaim = claimOf(s, subject, 'end');
  const end = estimate(b, centres, pointOf(w, subject, 'end'), !!directTime(s, subject, 'end'));
  const unknown = endClaim?.value === 'unknown';
  // Something with no stated or derivable end still holds.
  if ((!endClaim || unknown) && end.hi === Infinity) end.best = null;
  const { record, phase } = splitRef(subject);
  const latest = !phase && w.vocab.kinds[w.entity.get(record)?.kind ?? '']?.start === 'latest';
  const claimed = directTime(s, subject, 'start');
  const start = estimate(b, centres, pointOf(w, subject, 'start'), !!claimed);
  // A start the kind shows at the latest time the evidence allows, where no claim pins it:
  // at the best date of the member or subgroup that limits it, else at that limit; unknown
  // if nothing limits it, rather than at a bound or midway between bounds.
  if (latest && (!claimed || oneSided(claimed))) {
    const x = latestBest(s, subject, b, centres);
    const hi = (centres ?? b).get(pointOf(w, subject, 'start'))!.hi;
    start.best = x !== null ? Math.min(Math.max(x, start.lo), start.hi) : Number.isFinite(hi) ? hi : null;
  }
  const t: FeatureTime = { start, end, instant: false };
  if (unknown) t.endUnknown = true;
  return t;
}

/**
 * A moment whose date is bounded by one-sided evidence tighter than the rest ("before an ash
 * bed dated 555.3 Ma", within a 96 Myr period) is shown at that evidence, not midway through
 * the period: the solver says which claims set each bound.
 */
function boundedBest(s: Solved, subject: string, b: Bounds): number | null {
  const v = b.get(pointOf(s.world, subject, 'start'));
  if (!v) return null;
  const at = (refs: string[], prop: 'earlier_than' | 'later_than') => {
    for (const ref of refs) {
      const { record, part } = splitRef(ref);
      const c = record === subject ? s.world.entity.get(record)?.claims.find((x) => x.key === part && x.prop === prop) : undefined;
      const t = c ? parseTime(c.value as never) : undefined;
      if (t && t.kind !== 'ref' && Number.isFinite(centre(t)[0])) return centre(t)[0];
    }
    return null;
  };
  const before = Number.isFinite(v.hi) ? at(v.hiBy, 'earlier_than') : null;
  const after = Number.isFinite(v.lo) ? at(v.loBy, 'later_than') : null;
  return before !== null && after !== null ? (before + after) / 2 : (before ?? after);
}

/**
 * A start shown at the latest time the evidence allows is limited by a member (a fossil) or a
 * subgroup: show it at that record's best date, not at the edge of its uncertainty.
 */
function latestBest(s: Solved, subject: string, b: Bounds, centres: Bounds | undefined, depth = 0): number | null {
  const v = (centres ?? b).get(pointOf(s.world, subject, 'start'));
  if (!v || !Number.isFinite(v.hi) || depth > 50) return null;
  for (const src of v.hiBy) {
    const { record, part } = splitRef(src);
    const r = part ? s.world.entity.get(record)?.relations.find((x) => x.key === part) : undefined;
    if (!r || splitRef(r.to).record !== subject) continue;
    if (r.rel === 'member-of') return timeOf(s, r.subject, b, centres).start.best;
    if (r.rel === 'descends-from') return latestBest(s, r.subject, b, centres, depth + 1) ?? timeOf(s, r.subject, b, centres).start.best;
  }
  return null;
}

function sameTime(a: FeatureTime, b: FeatureTime): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Names in the default picture, and the one in use today. */
function namesOf(s: Solved, e: Entity): { label: string; names: FeatureName[] } {
  const text = (v: unknown) => {
    const m = v as Record<string, string>;
    return m.en ?? Object.values(m)[0];
  };
  const names: FeatureName[] = [];
  for (const c of e.claims) {
    if (c.prop !== 'name' || c.subject !== e.id || c.alt || c.status === 'deprecated' || c.rank === 'deprecated') continue;
    const n: FeatureName = { text: text(c.value) };
    if (c.valid !== undefined) {
      const v = parseTime(c.valid as never);
      if (v.kind === 'interval') n.valid = [v.lo, v.hi];
      else if (v.kind === 'instant') n.valid = [v.t, v.t];
    }
    names.push(n);
  }
  const chosenName = claimOf(s, e.id, 'name');
  const today = names.filter((n) => !n.valid || (n.valid[0] <= PRESENT_YEAR && PRESENT_YEAR <= n.valid[1]));
  const label = chosenName && (!chosenName.valid || today.some((n) => n.text === text(chosenName.value))) ? text(chosenName.value) : (today[0]?.text ?? names.at(-1)?.text ?? e.id);
  return { label, names };
}

/** Where a located entity is in its own frame, and on which plate. */
export interface Placement {
  frame: string;
  plate?: number;
  location: { lat: number; lon: number };
  basis: FeatureBasis;
}

/**
 * Carry a location from the frame it was measured in into the entity's frame (section 4.6):
 * present-day coordinates go into a plate frame by undoing that plate's rotation at the
 * present (the identity, for PALEOMAP).
 */
export function placement(s: Solved, e: Entity): Placement | undefined {
  const loc = claimOf(s, e.id, 'location');
  const fr = claimOf(s, e.id, 'frame');
  if (!loc || !fr) return undefined;
  const p = loc.value as { lat: number; lon: number; frame: string };
  const frame = s.world.frame.get(fr.value as string);
  if (!frame) return undefined;
  const plate = frame.kind === 'plate' ? frame.transform?.plate : undefined;
  let location = { lat: p.lat, lon: p.lon };
  if (plate !== undefined && p.frame === 'frame:earth/present-day') {
    const [lat, lon] = toLatLon(rotate(conj(s.model.total(plate, 0)), unitVector(p.lat, p.lon)));
    location = { lat, lon };
  }
  const frameBasis: Basis = plate !== undefined ? 'reconstruction' : 'evidence';
  return {
    frame: frame.id,
    plate,
    location,
    basis: { time: 'evidence', place: weakest([loc.basis, fr.basis, frameBasis]), placeNow: loc.basis },
  };
}

/** The basis of a derived interval: the weakest of the claims and relations it rests on. */
function timeBasis(s: Solved, refs: string[]): Basis {
  const bases: Basis[] = [];
  for (const r of refs) {
    const { record, part: key } = splitRef(r);
    if (!key) continue;
    const e = s.world.entity.get(record);
    const x = e?.claims.find((c) => c.key === key) ?? e?.relations.find((y) => y.key === key);
    if (x) bases.push(x.basis);
  }
  return weakest(bases);
}

function derivedBy(b: Bounds, w: World, subject: string): { start: string[]; end: string[] } {
  const by = (p: string) => [...new Set([...b.get(p)!.loBy, ...b.get(p)!.hiBy])];
  return { start: by(pointOf(w, subject, 'start')), end: by(pointOf(w, subject, 'end')) };
}

function statusOf(e: Entity): Feature['status'] {
  const statuses = e.claims.map((c) => c.status);
  return statuses.includes('disputed') ? 'disputed' : statuses.every((x) => x === 'accepted') ? 'accepted' : 'proposed';
}

/**
 * Times under other scenarios, where they differ from what the viewer would otherwise use:
 * a picture's time where it differs from the default, a pick's where it differs from its
 * picture's.
 */
function variantTimes(s: Solved, subject: string, base: FeatureTime): Record<string, FeatureTime> {
  const out: Record<string, FeatureTime> = {};
  const pictureTime = new Map<string, FeatureTime>();
  for (const v of s.variants) {
    if (v.scenario.picks?.length || !v.solution.ok) continue;
    pictureTime.set(v.key, timeOf(s, subject, v.solution.bounds, boundsOf(v.centres)));
  }
  for (const v of s.variants) {
    if (!v.key || !v.solution.ok) continue;
    const t = timeOf(s, subject, v.solution.bounds, boundsOf(v.centres));
    const fallback = v.scenario.picks?.length ? (pictureTime.get(scenarioKey({ alts: v.scenario.alts })) ?? base) : base;
    if (!sameTime(t, fallback)) out[v.key] = t;
  }
  return out;
}

export function features(s: Solved): Feature[] {
  const out: Feature[] = [];
  for (const e of s.world.entities) {
    const pl = placement(s, e);
    if (!pl) continue;
    const time = timeOf(s, e.id, s.sol.bounds, boundsOf(s.centres));
    const by = derivedBy(s.sol.bounds, s.world, e.id);
    const variants = variantTimes(s, e.id, time);
    const { label, names } = namesOf(s, e);
    out.push({
      id: e.id,
      label,
      names: names.length > 1 || names.some((n) => n.valid) ? names : undefined,
      kind: e.kind,
      basis: { ...pl.basis, time: timeBasis(s, [...by.start, ...by.end]) },
      frame: pl.frame,
      plate: pl.plate,
      location: pl.location,
      time,
      variants: Object.keys(variants).length ? variants : undefined,
      status: statusOf(e),
    });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : 1));
}

function valueText(s: Solved, c: Claim, labelOf: (ref: string) => string): string {
  const prop = s.world.vocab.properties[c.prop];
  const v = c.value;
  switch (prop?.type) {
    case 'time':
      return formatTimeValue(parseTime(v as never), labelOf);
    case 'point': {
      const p = v as { lat: number; lon: number; frame: string };
      const f = s.world.frame.get(p.frame);
      return `${Math.abs(p.lat).toFixed(3)}°${p.lat >= 0 ? 'N' : 'S'}, ${Math.abs(p.lon).toFixed(3)}°${p.lon >= 0 ? 'E' : 'W'}${f ? ` (${f.title.toLowerCase()})` : ''}`;
    }
    case 'ref':
      return labelOf(String(v));
    case 'text':
      return Object.entries(v as Record<string, string>).map(([lang, t]) => (lang === 'en' ? t : `${t} (${lang})`)).join(' · ');
    case 'quantity':
      return `${(v as number).toLocaleString('en-US')} ${prop.unit}`;
    default:
      return String(v);
  }
}

function validText(v: unknown): string | undefined {
  if (v === undefined) return undefined;
  const t: TimeValue = parseTime(v as never);
  return formatTimeValue(t);
}

function lagText(lag: unknown): string | undefined {
  if (lag === undefined) return undefined;
  const [lo, hi] = parseLag(lag as never);
  if (lo === hi) return lo === 0 ? 'with no lag' : `after ${formatDuration(lo)}`;
  return hi === Infinity ? `at least ${formatDuration(lo)} after` : `${formatDuration(lo)} to ${formatDuration(hi)} after`;
}

/** A source as the viewer shows it: the record, without how the build fetches it. */
export function sourceRecord(src: Source): SourceRecord {
  const { id, type, kind, citation, authors, published, snapshot, title, container, doi, url, license, via, reliability, verified, note } = src;
  return { id, type, kind, citation, authors, published, snapshot, title, container, doi, url, license, via, reliability, verified, note };
}

/** A label for any reference: an entity's or phase's name, a record's title, or the reference itself. */
export function labeller(s: Solved): (ref: string) => string {
  const cache = new Map<string, string>();
  for (const e of s.world.entities) cache.set(e.id, namesOf(s, e).label);
  return (ref: string) => {
    try {
      const r = parseRef(ref);
      if (r.type === 'entity') {
        const base = cache.get(r.id);
        if (!base) return ref;
        if (r.phase) return `${base}: ${s.world.entity.get(r.id)!.phases.find((p) => p.id === r.phase)?.label ?? r.phase}`;
        return base;
      }
      if (r.type === 'frame') return s.world.frame.get(r.id)?.title ?? ref;
      if (r.type === 'alt') return s.world.alternative.get(r.id)?.title ?? ref;
      return ref;
    } catch {
      return ref;
    }
  };
}

export function records(s: Solved): EntityRecord[] {
  const w = s.world;
  const labelOf = labeller(s);
  const exists = (ref: string) => {
    try {
      const r = parseRef(ref);
      return r.type === 'external' || (r.type === 'entity' ? w.entity.has(r.id) : w.source.has(r.id) || w.frame.has(r.id) || w.alternative.has(r.id) || w.fields.some((f) => f.id === r.id) || w.generators.some((g) => g.id === r.id));
    } catch {
      return false;
    }
  };
  // Inverses: every relation, and every claim whose value is a record, seen from its target.
  const inverse = new Map<string, InverseRecord[]>();
  const addInverse = (target: string, x: InverseRecord) => {
    const id = splitRef(target).record;
    inverse.set(id, [...(inverse.get(id) ?? []), x]);
  };
  for (const e of w.entities) {
    for (const r of e.relations) {
      const type = w.vocab.relations[r.rel];
      if (type && subjectExists(w, r.to)) addInverse(r.to, { rel: type.inverse, via: r.ref, from: r.subject, fromLabel: labelOf(r.subject), status: r.status });
    }
    for (const c of e.claims) {
      const prop = w.vocab.properties[c.prop];
      if (prop?.type !== 'ref' || !prop.inverse) continue;
      const frame = w.frame.get(String(c.value));
      if (frame?.entity && w.entity.has(frame.entity)) addInverse(frame.entity, { rel: prop.inverse, via: c.ref, from: c.subject, fromLabel: labelOf(c.subject), status: c.status });
    }
  }
  const out: EntityRecord[] = [];
  for (const e of w.entities) {
    const used = new Set<string>();
    const wanted = new Set<string>();
    const cites = (cs: { ref: string; loc?: string; quote?: string }[]): CitationRecord[] =>
      cs.map((c) => {
        used.add(c.ref);
        return { ref: c.ref, loc: c.loc, quote: c.quote };
      });
    const common = (c: Claim | (typeof e.relations)[number]) => ({
      ref: c.ref,
      key: c.key,
      subject: c.subject,
      valid: c.valid,
      validText: validText(c.valid),
      sources: cites(c.sources),
      unsourced: c.unsourced,
      confidence: c.confidence,
      confidenceRange: typeof c.confidence === 'string' ? w.vocab.confidence[c.confidence] : undefined,
      basis: c.basis,
      alt: c.alt,
      author: c.author,
      status: c.status,
      rank: c.rank,
      note: c.note,
    });
    const claims: ClaimRecord[] = e.claims.map((c) => {
      const g = s.groups.find((x) => x.key === `${c.subject}|${c.prop}`);
      for (const ref of claimRefs(w, c)) if (!exists(ref)) wanted.add(splitRef(ref).record);
      return {
        ...common(c),
        prop: c.prop,
        value: c.value,
        valueText: valueText(s, c, labelOf),
        method: c.method,
        methodLabel: c.method ? w.vocab.methods[c.method]?.label : undefined,
        group: `${c.subject}|${c.prop}`,
        competing: !!g && g.claims.length > 1,
        chosen: !!g && chosen(g) === c,
      };
    });
    const relations: RelationRecord[] = e.relations.map((r) => {
      const ok = exists(r.to);
      if (!ok) wanted.add(splitRef(r.to).record);
      return { ...common(r), rel: r.rel, family: w.vocab.relations[r.rel]?.family ?? 'other', to: r.to, toLabel: labelOf(r.to), wanted: !ok, lagText: lagText(r.lag) };
    });
    const time = timeOf(s, e.id, s.sol.bounds, boundsOf(s.centres));
    const variants: VariantRecord[] = [];
    const mine = new Set([...e.claims, ...e.relations].map((x) => x.ref));
    const differs = variantTimes(s, e.id, time);
    for (const v of s.variants) {
      if (!v.key) continue;
      const picked = v.scenario.picks?.some((p) => mine.has(p));
      if (!v.solution.ok) {
        if (picked) variants.push({ key: v.key, consistent: false, conflict: v.solution.conflict.constraints.map((c) => c.source) });
        continue;
      }
      if (picked || differs[v.key]) variants.push({ key: v.key, consistent: true, time: timeOf(s, e.id, v.solution.bounds, boundsOf(v.centres)) });
    }
    const pl = placement(s, e);
    const by = derivedBy(s.sol.bounds, w, e.id);
    const frame = pl ? w.frame.get(pl.frame) : undefined;
    const { label, names } = namesOf(s, e);
    out.push({
      id: e.id,
      kind: e.kind,
      kindLabel: w.vocab.kinds[e.kind]?.label ?? e.kind,
      label,
      names,
      summary: e.summary,
      basis: pl ? { ...pl.basis, time: timeBasis(s, [...by.start, ...by.end]) } : { time: timeBasis(s, [...by.start, ...by.end]), place: 'evidence', placeNow: 'evidence' },
      frame: frame ? { id: frame.id, title: frame.title, plate: pl!.plate, entity: frame.entity, entityLabel: frame.entity ? labelOf(frame.entity) : undefined } : undefined,
      same_as: e.same_as,
      phases: e.phases.map((p) => ({ id: p.id, label: p.label ?? p.id, gap: p.gap, time: timeOf(s, `${e.id}@${p.id}`, s.sol.bounds, boundsOf(s.centres)) })),
      time,
      claims,
      relations,
      inverse: (inverse.get(e.id) ?? []).sort((a, b) => (a.via < b.via ? -1 : 1)),
      variants,
      derivedBy: by,
      sources: Object.fromEntries([...used].sort().filter((id) => w.source.has(id)).map((id) => [id, sourceRecord(w.source.get(id)!)])),
      wanted: [...wanted].sort(),
    });
  }
  return out;
}

/** The records a claim refers to, besides its sources. */
function claimRefs(w: World, c: Claim): string[] {
  const prop = w.vocab.properties[c.prop];
  const out = c.sources.map((x) => x.ref);
  if (c.alt) out.push(c.alt);
  if (prop?.type === 'ref') out.push(String(c.value));
  if (prop?.type === 'point') out.push((c.value as { frame: string }).frame);
  if (prop?.type === 'time') {
    try {
      const t = parseTime(c.value as never);
      if (t.kind === 'ref') out.push(t.ref);
    } catch {
      // the validator reports it
    }
  }
  return out;
}

export function periods(s: Solved): PeriodRecord[] {
  const w = s.world;
  const out: PeriodRecord[] = [];
  const edge = (b: Bounds, centres: Bounds | undefined, id: string, which: 'start' | 'end') => {
    const t = timeOf(s, id, b, centres);
    const x = which === 'start' ? t.start.best : t.end.best;
    return x === null ? Infinity : x;
  };
  for (const e of w.entities) {
    if (!e.kind.startsWith('period/')) continue;
    const color = claimOf(s, e.id, 'color')?.value as string | undefined;
    const parent = e.relations.find((r) => r.rel === 'part-of')?.to;
    const start = edge(s.sol.bounds, boundsOf(s.centres), e.id, 'start');
    const end = edge(s.sol.bounds, boundsOf(s.centres), e.id, 'end');
    const variants: Record<string, { start: number; end: number }> = {};
    for (const v of s.variants) {
      if (!v.key || !v.solution.ok || v.scenario.picks?.length) continue;
      const vs = edge(v.solution.bounds, boundsOf(v.centres), e.id, 'start');
      const ve = edge(v.solution.bounds, boundsOf(v.centres), e.id, 'end');
      if (vs !== start || ve !== end) variants[v.key] = { start: vs, end: ve };
    }
    out.push({
      id: e.id,
      name: namesOf(s, e).label,
      rank: (w.vocab.kinds[e.kind]?.label ?? e.kind).toLowerCase(),
      start,
      end,
      color,
      parent,
      variants: Object.keys(variants).length ? variants : undefined,
    });
  }
  return out.sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : 1));
}

export function search(s: Solved, feats: Feature[]): SearchFile {
  const located = new Set(feats.map((f) => f.id));
  return {
    entities: s.world.entities
      .filter((e) => !e.kind.startsWith('period/'))
      .map((e) => ({ id: e.id, label: namesOf(s, e).label, kind: e.kind, summary: e.summary, time: timeOf(s, e.id, s.sol.bounds, boundsOf(s.centres)), located: located.has(e.id) })),
  };
}

