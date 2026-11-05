// A simple temporal network: time points linked by constraints `to − from ∈ [lo, hi]`.
// It is consistent iff its distance graph has no negative cycle. A simple negative cycle is
// a minimal set of conflicting constraints: drop any one of them and that cycle is gone.
// Absolute dates are constraints against ORIGIN, the point fixed at year 0.

export const ORIGIN = '$origin';

export interface Constraint {
  /** provenance: the claim or relation this constraint comes from */
  source: string;
  from: string;
  to: string;
  /** to − from ≥ lo (may be −Infinity) */
  lo: number;
  /** to − from ≤ hi (may be +Infinity) */
  hi: number;
  note?: string;
}

export interface Conflict {
  /** the constraints on one simple negative cycle, in cycle order */
  constraints: Constraint[];
  /** the cycle's total weight: how far, in years, the constraints overshoot each other (< 0) */
  slack: number;
}

export type Bounds = Map<string, { lo: number; hi: number; loBy: string[]; hiBy: string[] }>;

export type Solution = { ok: true; bounds: Bounds } | { ok: false; conflict: Conflict };

interface Edge {
  u: number;
  v: number;
  w: number;
  c: Constraint;
}

const EPS = 1e-3; // years

function edges(index: Map<string, number>, constraints: Constraint[]): Edge[] {
  const out: Edge[] = [];
  for (const c of constraints) {
    const u = index.get(c.from);
    const v = index.get(c.to);
    if (u === undefined || v === undefined) throw new Error(`constraint ${c.source} refers to an unknown point`);
    if (c.hi !== Infinity) out.push({ u, v, w: c.hi, c }); // x_v − x_u ≤ hi
    if (c.lo !== -Infinity) out.push({ u: v, v: u, w: -c.lo, c }); // x_u − x_v ≤ −lo
  }
  return out;
}

/** A cycle in the predecessor graph, if there is one: it can only be a negative cycle. */
function cycleIn(n: number, pred: Array<Edge | undefined>): Edge[] | undefined {
  const state = new Uint8Array(n); // 0 = unseen, 1 = on the current walk, 2 = done
  for (let start = 0; start < n; start++) {
    const walk: number[] = [];
    let x: number | undefined = start;
    while (x !== undefined && state[x] === 0) {
      state[x] = 1;
      walk.push(x);
      x = pred[x]?.u;
    }
    if (x !== undefined && state[x] === 1) {
      const cycle: Edge[] = [];
      let y = x;
      do {
        const e: Edge = pred[y]!;
        cycle.push(e);
        y = e.u;
      } while (y !== x);
      return cycle.reverse();
    }
    for (const w of walk) state[w] = 2;
  }
  return undefined;
}

/** The edges leaving each point, in the order given. */
function adjacency(n: number, es: Edge[]): Edge[][] {
  const out: Edge[][] = Array.from({ length: n }, () => []);
  for (const e of es) out[e.u].push(e);
  return out;
}

/**
 * Shortest distances by a queue (SPFA): a point is looked at again only when its distance falls, so
 * a network settles in a few passes over its edges, where Bellman–Ford makes one pass per point.
 * The queue is first in, first out, so the result is the same on every run. A cycle shows in the
 * predecessor graph, where it can only be a negative one: it is looked for whenever a path grows
 * past the number of points, and every n relaxations besides, since a cycle can turn many times
 * before any path grows that long.
 */
function settle(n: number, out: Edge[][], dist: Float64Array, start: number[]): { pred: Array<Edge | undefined>; cycle?: Edge[] } {
  const pred: Array<Edge | undefined> = new Array(n);
  const len = new Int32Array(n);
  const queued = new Uint8Array(n);
  const ring = new Int32Array(n + 1);
  let head = 0;
  let tail = 0;
  const push = (v: number) => {
    queued[v] = 1;
    ring[tail] = v;
    tail = tail === n ? 0 : tail + 1;
  };
  for (const v of start) push(v);
  let relaxed = 0;
  while (head !== tail) {
    const u = ring[head];
    head = head === n ? 0 : head + 1;
    queued[u] = 0;
    const du = dist[u];
    if (du === Infinity) continue;
    for (const e of out[u]) {
      if (du + e.w < dist[e.v] - EPS) {
        dist[e.v] = du + e.w;
        pred[e.v] = e;
        len[e.v] = len[u] + 1;
        if (len[e.v] >= n || ++relaxed % n === 0) {
          const cycle = cycleIn(n, pred);
          if (cycle) return { pred, cycle };
          if (len[e.v] >= n) throw new Error('negative cycle detected but not found (inconsistent tolerance?)');
        }
        if (!queued[e.v]) push(e.v);
      }
    }
  }
  return { pred };
}

/** A negative cycle anywhere in the network, if there is one: every point starts at distance 0. */
function findNegativeCycle(n: number, es: Edge[]): Edge[] | undefined {
  return settle(n, adjacency(n, es), new Float64Array(n), Array.from({ length: n }, (_, i) => i)).cycle;
}

/** Shortest distances from `src`, with the constraints on each shortest path. */
function shortest(n: number, es: Edge[], src: number): { dist: Float64Array; pred: Array<Edge | undefined> } {
  const dist = new Float64Array(n).fill(Infinity);
  dist[src] = 0;
  const { pred } = settle(n, adjacency(n, es), dist, [src]);
  return { dist, pred };
}

/**
 * For every point, the constraints along its shortest path from `from`, nearest to `from` first,
 * each once, where it last appears. Each point's list is its predecessor's with one more, so they
 * are worked out together.
 */
function pathSources(pred: Array<Edge | undefined>, from: number): string[][] {
  const n = pred.length;
  const paths: Array<string[] | undefined> = new Array(n);
  paths[from] = [];
  for (let i = 0; i < n; i++) {
    const chain: number[] = [];
    let x = i;
    while (paths[x] === undefined) {
      const e = pred[x];
      if (!e || chain.length > n) {
        paths[x] = [];
        break;
      }
      chain.push(x);
      x = e.u;
    }
    for (let k = chain.length - 1; k >= 0; k--) {
      const y = chain[k];
      if (paths[y] !== undefined) continue;
      const e = pred[y]!;
      const before = paths[e.u]!;
      const src = e.c.source;
      paths[y] = before.includes(src) ? [...before.filter((s) => s !== src), src] : [...before, src];
    }
  }
  return paths as string[][];
}

function conflictOf(cycle: Edge[]): Conflict {
  const seen = new Set<Constraint>();
  const cs: Constraint[] = [];
  for (const e of cycle) {
    if (!seen.has(e.c)) {
      seen.add(e.c);
      cs.push(e.c);
    }
  }
  return { constraints: cs, slack: cycle.reduce((s, e) => s + e.w, 0) };
}

/** Whether a network holds, without working out its bounds: the conflict, if it does not. */
export function conflictIn(points: string[], constraints: Constraint[]): Conflict | undefined {
  const names = [ORIGIN, ...new Set(points)];
  const index = new Map(names.map((p, i) => [p, i]));
  const cycle = findNegativeCycle(names.length, edges(index, constraints));
  return cycle && conflictOf(cycle);
}

export function solve(points: string[], constraints: Constraint[]): Solution {
  const names = [ORIGIN, ...[...new Set(points)].filter((p) => p !== ORIGIN).sort()];
  const index = new Map(names.map((p, i) => [p, i]));
  const es = edges(index, constraints);
  const n = names.length;
  const cycle = findNegativeCycle(n, es);
  if (cycle) return { ok: false, conflict: conflictOf(cycle) };
  // Upper bounds: shortest paths from ORIGIN. Lower bounds: shortest paths to ORIGIN,
  // i.e. from ORIGIN in the reversed graph.
  const fwd = shortest(n, es, 0);
  const rev = es.map((e) => ({ u: e.v, v: e.u, w: e.w, c: e.c }));
  const bwd = shortest(n, rev, 0);
  const loBy = pathSources(bwd.pred, 0);
  const hiBy = pathSources(fwd.pred, 0);
  const bounds: Bounds = new Map();
  for (let i = 1; i < n; i++) bounds.set(names[i], { lo: -bwd.dist[i], hi: fwd.dist[i], loBy: loBy[i], hiBy: hiBy[i] });
  return { ok: true, bounds };
}

type Bound = { lo: number; hi: number; loBy: string[]; hiBy: string[] };

const sameConstraint = (a: Constraint, b: Constraint) => a === b || (a.source === b.source && a.from === b.from && a.to === b.to && a.lo === b.lo && a.hi === b.hi && a.note === b.note);

/**
 * The part of a network that can differ from a base network's solution, where the two differ in a
 * few constraints. A network falls into pieces that meet only at ORIGIN, the fixed point: a
 * shortest path never passes through ORIGIN twice, so a piece's bounds, and whether it holds,
 * depend on nothing outside it, and solving a piece alone gives what solving the whole gives,
 * tie for tie. So only the pieces holding a changed constraint need solving again.
 *
 * Undefined if the networks do not share their points: then solve the whole.
 */
function changedPart(base: { points: string[]; constraints: Constraint[] }, points: string[], constraints: Constraint[]): { points: string[]; constraints: Constraint[] } | undefined {
  if (points !== base.points && (points.length !== base.points.length || points.some((p, i) => p !== base.points[i]))) return undefined;
  // The changed stretch: what lies between the longest common start and the longest common end.
  const a = base.constraints;
  const b = constraints;
  let head = 0;
  while (head < a.length && head < b.length && sameConstraint(a[head], b[head])) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && sameConstraint(a[a.length - 1 - tail], b[b.length - 1 - tail])) tail++;
  const aEnd = a.length - tail;
  const bEnd = b.length - tail;
  const shift = b.length - a.length;
  // The new network's constraints at each point: the base's outside the stretch, and the new stretch.
  const baseAt = constraintsAt(a);
  const newAt = new Map<string, number[]>();
  for (let j = head; j < bEnd; j++) for (const p of [b[j].from, b[j].to]) if (p !== ORIGIN) newAt.set(p, [...(newAt.get(p) ?? []), j]);
  const at = (p: string): number[] => {
    const out: number[] = [];
    for (const i of baseAt.get(p) ?? []) if (i < head) out.push(i);
    out.push(...(newAt.get(p) ?? []));
    for (const i of baseAt.get(p) ?? []) if (i >= aEnd) out.push(i + shift);
    return out;
  };
  // Walk out from every point the stretch touches, over constraints that do not run through ORIGIN.
  const seen = new Set<string>();
  const todo: string[] = [];
  const visit = (p: string) => {
    if (p === ORIGIN || seen.has(p)) return;
    seen.add(p);
    todo.push(p);
  };
  for (let i = head; i < aEnd; i++) [a[i].from, a[i].to].forEach(visit);
  for (let j = head; j < bEnd; j++) [b[j].from, b[j].to].forEach(visit);
  const held = new Set<number>();
  while (todo.length) {
    const p = todo.pop()!;
    for (const j of at(p)) {
      held.add(j);
      visit(b[j].from);
      visit(b[j].to);
    }
  }
  return { points: [...seen], constraints: [...held].sort((x, y) => x - y).map((j) => b[j]) };
}

/** The constraints at each point other than ORIGIN, by index, worked out once per network. */
const constraintIndex = new WeakMap<Constraint[], Map<string, number[]>>();
function constraintsAt(cs: Constraint[]): Map<string, number[]> {
  let m = constraintIndex.get(cs);
  if (!m) {
    m = new Map();
    cs.forEach((c, i) => {
      for (const p of [c.from, c.to]) {
        if (p === ORIGIN) continue;
        const list = m!.get(p);
        if (!list) m!.set(p, [i]);
        else if (list[list.length - 1] !== i) list.push(i);
      }
    });
    constraintIndex.set(cs, m);
  }
  return m;
}

/**
 * A network that differs from a solved one in a few constraints, solved again only where it can
 * differ (see changedPart). Returns the bounds that differ from the base's, or the conflict;
 * undefined if the networks do not share their points, when the caller should solve the whole.
 */
export function solveChanged(base: { points: string[]; constraints: Constraint[]; bounds: Pick<Bounds, 'get'> }, points: string[], constraints: Constraint[]): { ok: true; changed: Array<[string, Bound]> } | { ok: false; conflict: Conflict } | undefined {
  const part = changedPart(base, points, constraints);
  if (!part) return undefined;
  const sol = solve(part.points, part.constraints);
  if (!sol.ok) return sol;
  const changed: Array<[string, Bound]> = [];
  for (const [p, now] of sol.bounds) {
    const was = base.bounds.get(p);
    if (!was || !sameBound(now, was)) changed.push([p, now]);
  }
  return { ok: true, changed };
}

/**
 * Whether a network that differs from a consistent one in a few constraints holds, looking only
 * where it can differ (see changedPart): the conflict if it does not. Undefined for "holds"; the
 * string "whole" if the networks do not share their points, when the caller should check the whole.
 */
export function conflictChanged(base: { points: string[]; constraints: Constraint[] }, points: string[], constraints: Constraint[]): Conflict | undefined | 'whole' {
  const part = changedPart(base, points, constraints);
  if (!part) return 'whole';
  return part.points.length ? conflictIn(part.points, part.constraints) : undefined;
}

function sameBound(a: Bound, b: Bound): boolean {
  return a.lo === b.lo && a.hi === b.hi && a.loBy.length === b.loBy.length && a.hiBy.length === b.hiBy.length && a.loBy.every((x, i) => x === b.loBy[i]) && a.hiBy.every((x, i) => x === b.hiBy[i]);
}
