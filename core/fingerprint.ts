// What a generator made, in numbers two machines can agree on without making the same bytes
// (docs/STRUCTURE.md section 3.5). A generator may use any arithmetic, so the build and a browser
// may differ in the last bits of a float. They must still agree on what was made: how many of each
// thing and which ones, exactly, and where and how big, within a tolerance.
//
// A fingerprint has a part for each array of the output. An identity part (which taxon, which kind
// of building, the indices of a mesh) is hashed and must match exactly. A measured part (positions,
// heights, colours) keeps its count, mean, spread, extremes and a coarse histogram, which must agree
// within the tolerance.

export interface PartPrint {
  /** how many values */
  n: number;
  /** an identity part: FNV-1a of its values, which must match exactly */
  hash?: string;
  /** a measured part: what must agree within the tolerance */
  mean?: number;
  sd?: number;
  min?: number;
  max?: number;
  /** how many values fall in each eighth of [min, max] */
  hist?: number[];
}

/** One part per array of the output, by name. */
export type Fingerprint = Record<string, PartPrint>;

export interface Part {
  name: string;
  values: ArrayLike<number>;
  /** which ones, not how much: matched exactly */
  identity?: boolean;
}

export interface Tolerance {
  /** relative to the larger of the two values, or to the part's range when that is larger */
  rel: number;
  /** absolute, for values near zero */
  abs: number;
  /** the share of a part's values that may move from one eighth of its range to the next */
  hist: number;
}

/** Loose enough for floats that differ in their last bits, tight enough that any change a person could see fails. */
export const TOLERANCE: Tolerance = { rel: 1e-4, abs: 1e-6, hist: 0.005 };

const BINS = 8;

/** FNV-1a over the values, each taken as a 32-bit integer: exact on every engine. */
function hashValues(values: ArrayLike<number>): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < values.length; i++) {
    let v = values[i] | 0;
    for (let b = 0; b < 4; b++) {
      h ^= v & 0xff;
      h = Math.imul(h, 0x01000193);
      v >>>= 8;
    }
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function measure(values: ArrayLike<number>): PartPrint {
  const n = values.length;
  if (!n) return { n };
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = values[i];
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const mean = sum / n;
  let sq = 0;
  for (let i = 0; i < n; i++) sq += (values[i] - mean) * (values[i] - mean);
  const hist = new Array<number>(BINS).fill(0);
  const span = max - min;
  for (let i = 0; i < n; i++) hist[span > 0 ? Math.min(BINS - 1, Math.floor(((values[i] - min) / span) * BINS)) : 0]++;
  return { n, mean, sd: Math.sqrt(sq / n), min, max, hist };
}

export function fingerprint(parts: Part[]): Fingerprint {
  const out: Fingerprint = {};
  for (const p of parts) out[p.name] = p.identity ? { n: p.values.length, hash: hashValues(p.values) } : measure(p.values);
  return out;
}

/** What differs between two fingerprints beyond the tolerance, in words; empty when they agree. */
export function fingerprintProblems(expected: Fingerprint, actual: Fingerprint, tol: Tolerance = TOLERANCE): string[] {
  const out: string[] = [];
  const names = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
  for (const name of names) {
    const a = expected[name];
    const b = actual[name];
    if (!a || !b) {
      out.push(`${name}: ${a ? 'missing' : 'not expected'}`);
      continue;
    }
    if (a.n !== b.n) {
      out.push(`${name}: ${b.n} values, not ${a.n}`);
      continue;
    }
    if (a.hash !== undefined || b.hash !== undefined) {
      if (a.hash !== b.hash) out.push(`${name}: different values (${b.hash} for ${a.hash})`);
      continue;
    }
    if (!a.n) continue;
    const range = Math.max(Math.abs(a.max! - a.min!), Math.abs(b.max! - b.min!));
    for (const k of ['mean', 'sd', 'min', 'max'] as const) {
      const x = a[k]!;
      const y = b[k]!;
      if (Math.abs(x - y) > tol.abs + tol.rel * Math.max(Math.abs(x), Math.abs(y), range)) out.push(`${name}: ${k} ${y} for ${x}`);
    }
    const moved = (a.hist ?? []).reduce((s, c, i) => s + Math.abs(c - (b.hist?.[i] ?? 0)), 0) / 2;
    if (moved > Math.max(1, tol.hist * a.n)) out.push(`${name}: ${moved} of ${a.n} values in other eighths of the range`);
  }
  return out;
}

/** Bytes as one measured part: for a picture, whose pixels are its values. */
export function bytesPrint(name: string, bytes: Uint8Array | Uint8ClampedArray): Fingerprint {
  return fingerprint([{ name, values: bytes }]);
}

/** A generator's output as the build recorded it and as this machine made it, and how they differ. */
export interface PrintCheck {
  expected: Fingerprint | null;
  actual: Fingerprint | null;
  problems: string[];
}

export function printCheck(expected: Fingerprint | null = null): PrintCheck {
  return { expected, actual: null, problems: [] };
}

/** Record what this machine made, and what differs from the build's beyond the tolerance. */
export function settlePrint(check: PrintCheck, actual: Fingerprint): string[] {
  check.actual = actual;
  check.problems = check.expected ? fingerprintProblems(check.expected, actual) : [];
  return check.problems;
}
