// Plate rotation models: parse GPlates/PLATES4 .rot files, bake them to quaternion
// keyframes, and evaluate total rotations with the same semantics as GPlates.
//
// A .rot line is `moving age lat lon angle fixed ! comment`: the finite rotation that
// takes the moving plate from its present-day position to its position at `age` Ma,
// relative to the fixed plate. Consecutive lines of one moving plate that share a fixed
// plate form a sequence; a change of fixed plate is a crossover. The total rotation of a
// plate relative to the anchor is R(anchor→fixed) · R(fixed→moving), interpolated by slerp
// between the bracketing lines of the sequence that contains the requested age.

import { IDENTITY, fromPole, mul, slerp, type Quat } from './quat.ts';

export interface RotLine {
  moving: number;
  age: number;
  lat: number;
  lon: number;
  angle: number;
  fixed: number;
  comment: string;
}

/** One sequence: a run of keyframes for a moving plate relative to a single fixed plate. */
export interface BakedSequence {
  moving: number;
  fixed: number;
  ages: number[];
  q: Quat[];
}

export interface BakedRotationModel {
  format: 'lightworld-rotations@1';
  anchor: number;
  /** all sequences in rotation-file order (the order decides crossovers, see RotationModel) */
  sequences: BakedSequence[];
  /** short plate labels parsed from rotation-file comments, e.g. 201 → "SAM" */
  labels: Record<string, string>;
}

/** Plate id 999 marks comment lines in PLATES4 rotation files. */
const COMMENT_PLATE = 999;

export function parseRot(text: string): RotLine[] {
  const out: RotLine[] = [];
  const lines = text.split(/\r?\n/);
  for (let n = 0; n < lines.length; n++) {
    const raw = lines[n];
    if (!raw.trim()) continue;
    const bang = raw.indexOf('!');
    const data = bang >= 0 ? raw.slice(0, bang) : raw;
    const comment = bang >= 0 ? raw.slice(bang + 1).trim() : '';
    const f = data.trim().split(/\s+/);
    if (f.length < 6) throw new Error(`rotation file line ${n + 1}: expected 6 fields, got ${f.length}`);
    const nums = f.slice(0, 6).map(Number);
    if (nums.some((x) => !Number.isFinite(x))) throw new Error(`rotation file line ${n + 1}: non-numeric field`);
    const [moving, age, lat, lon, angle, fixed] = nums;
    if (moving === COMMENT_PLATE) continue;
    out.push({ moving, age, lat, lon, angle, fixed, comment });
  }
  return out;
}

/** Abbreviation like "SAM" from a comment like "SAM-AFR South America-Africa". */
function labelFromComment(comment: string): string | undefined {
  const m = /^!?\s*([A-Z]{2,5})(?:[-\s]|$)/.exec(comment);
  return m ? m[1] : undefined;
}

export function bakeRotationModel(lines: RotLine[], anchor = 0): BakedRotationModel {
  const sequences: BakedSequence[] = [];
  const labels: Record<string, string> = {};
  let current: BakedSequence | undefined;
  for (const l of lines) {
    const continues =
      current &&
      current.moving === l.moving &&
      current.fixed === l.fixed &&
      l.age >= current.ages[current.ages.length - 1];
    if (!continues) {
      current = { moving: l.moving, fixed: l.fixed, ages: [], q: [] };
      sequences.push(current);
    }
    current!.ages.push(l.age);
    current!.q.push(fromPole(l.lat, l.lon, l.angle));
  }
  // Prefer the label on a plate's present-day line, else its first labelled line.
  for (const present of [true, false]) {
    for (const l of lines) {
      const key = String(l.moving);
      if (key in labels || (present && l.age !== 0)) continue;
      const label = labelFromComment(l.comment);
      if (label) labels[key] = label;
    }
  }
  if (sequences.some((s) => s.moving === anchor)) {
    throw new Error(`anchor plate ${anchor} is a moving plate in this model; only a root anchor is supported`);
  }
  return { format: 'lightworld-rotations@1', anchor, sequences, labels };
}

/** Interpolate a sequence at an age inside its [first, last] keyframe range. */
function interpolate(s: BakedSequence, age: number): Quat {
  const n = s.ages.length;
  if (n === 1) return s.q[0];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (s.ages[mid] <= age) lo = mid;
    else hi = mid;
  }
  const a0 = s.ages[lo];
  const a1 = s.ages[hi];
  if (age === a0) return s.q[lo];
  if (age === a1) return s.q[hi];
  return slerp(s.q[lo], s.q[hi], (age - a0) / (a1 - a0));
}

/**
 * Total rotations (anchor → plate) at one age, built the way GPlates builds its
 * reconstruction tree: depth-first from the anchor, visiting each fixed plate's sequences in
 * reverse file order, and keeping the first path that reaches each moving plate. Away from
 * crossovers there is only one path; at a crossover age this order decides which of the two
 * sequences is used. A plate that is not reached gets the identity, as in GPlates.
 */
export class RotationModel {
  readonly baked: BakedRotationModel;
  private outgoing = new Map<number, BakedSequence[]>();
  private treeAge = Number.NaN;
  private tree = new Map<number, Quat>();

  constructor(baked: BakedRotationModel) {
    this.baked = baked;
    for (const s of baked.sequences) {
      const list = this.outgoing.get(s.fixed) ?? [];
      list.unshift(s);
      this.outgoing.set(s.fixed, list);
    }
  }

  plateIds(): number[] {
    return [...new Set(this.baked.sequences.map((s) => s.moving))].sort((a, b) => a - b);
  }

  label(plate: number): string | undefined {
    return this.baked.labels[String(plate)];
  }

  /** Total rotation of `plate` at `ageMa` (millions of years before present). */
  total(plate: number, ageMa: number): Quat {
    if (ageMa !== this.treeAge) this.build(ageMa);
    return this.tree.get(plate) ?? IDENTITY;
  }

  /** Does the model say where `plate` was at `ageMa`? Where it doesn't, `total` is the identity. */
  reaches(plate: number, ageMa: number): boolean {
    if (ageMa !== this.treeAge) this.build(ageMa);
    return plate === this.baked.anchor || this.tree.has(plate);
  }

  private build(age: number): void {
    const tree = new Map<number, Quat>();
    const anchor = this.baked.anchor;
    const stack: Array<{ plate: number; q: Quat; i: number }> = [{ plate: anchor, q: IDENTITY, i: 0 }];
    while (stack.length) {
      const top = stack[stack.length - 1];
      const out = this.outgoing.get(top.plate) ?? [];
      if (top.i >= out.length) {
        stack.pop();
        continue;
      }
      const s = out[top.i++];
      const n = s.ages.length;
      if (age < s.ages[0] || age > s.ages[n - 1]) continue;
      if (s.moving === anchor || tree.has(s.moving)) continue;
      const q = top.plate === anchor ? interpolate(s, age) : mul(top.q, interpolate(s, age));
      tree.set(s.moving, q);
      stack.push({ plate: s.moving, q, i: 0 });
    }
    this.tree = tree;
    this.treeAge = age;
  }
}
