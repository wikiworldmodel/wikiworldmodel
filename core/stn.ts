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

/**
 * Bellman–Ford from every node at once; returns a negative cycle if there is one. A cycle shows in the
 * predecessor graph long before the last round, so it is looked for every few rounds: most of the time of
 * checking a world goes on claims that contradict it, which would otherwise run all the n rounds.
 */
function findNegativeCycle(n: number, es: Edge[]): Edge[] | undefined {
  const dist = new Float64Array(n);
  const pred: Array<Edge | undefined> = new Array(n);
  for (let iter = 0; iter <= n; iter++) {
    let relaxing = false;
    for (const e of es) {
      if (dist[e.u] + e.w < dist[e.v] - EPS) {
        dist[e.v] = dist[e.u] + e.w;
        pred[e.v] = e;
        relaxing = true;
      }
    }
    if (!relaxing) return undefined;
    if (iter % 16 === 15) {
      const cycle = cycleIn(n, pred);
      if (cycle) return cycle;
    }
  }
  // Still relaxing after n+1 rounds, so the predecessor graph has a cycle: find it.
  const cycle = cycleIn(n, pred);
  if (cycle) return cycle;
  throw new Error('negative cycle detected but not found (inconsistent tolerance?)');
}

/** Shortest distances from `src`, with the constraints on each shortest path. */
function shortest(n: number, es: Edge[], src: number): { dist: Float64Array; pred: Array<Edge | undefined> } {
  const dist = new Float64Array(n).fill(Infinity);
  const pred: Array<Edge | undefined> = new Array(n);
  dist[src] = 0;
  for (let iter = 0; iter < n; iter++) {
    let changed = false;
    for (const e of es) {
      if (dist[e.u] !== Infinity && dist[e.u] + e.w < dist[e.v] - EPS) {
        dist[e.v] = dist[e.u] + e.w;
        pred[e.v] = e;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return { dist, pred };
}

/** The constraints along the shortest path from `from` to `to`, nearest to `from` first. */
function pathSources(pred: Array<Edge | undefined>, from: number, to: number): string[] {
  const out: string[] = [];
  let x = to;
  for (let guard = 0; x !== from && guard < pred.length; guard++) {
    const e = pred[x];
    if (!e) break;
    if (!out.includes(e.c.source)) out.unshift(e.c.source);
    x = e.u;
  }
  return out;
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
  const bounds: Bounds = new Map();
  for (let i = 1; i < n; i++) {
    bounds.set(names[i], {
      lo: -bwd.dist[i],
      hi: fwd.dist[i],
      loBy: pathSources(bwd.pred, 0, i),
      hiBy: pathSources(fwd.pred, 0, i),
    });
  }
  return { ok: true, bounds };
}
