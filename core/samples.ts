// Uncertainty travels as samples (docs/STRUCTURE.md section 3.2). Every model consumes and produces it in one
// currency: member m of the world, drawn with the same m everywhere, so that member 7 of the climate goes with
// member 7 of the elevation. A member is a joint sample of the whole world, never a cross-product: two
// interacting fields of N members cost N runs, not N². Propagating uncertainty is running a model once per member.
//
// Most uncertainty is a parameter (a range, a mean and a spread): its samples are drawn from a seed when they are
// needed and stored nowhere. Only true ensembles, such as several runs of a model, keep their members. Member 0 is
// always the central value (the mean, the middle of a range, the median member), so whatever draws one member
// draws the best estimate. A single value whose uncertainty no one gave says so, rather than pretending it is zero.

/** How many members a model runs when nothing asks for more: enough to show a spread. */
export const MEMBERS = 16;

export type Uncertain =
  /** a value given with no uncertainty, by a source that says it is exact */
  | { kind: 'exact'; value: number }
  /** a single value whose uncertainty nobody gave */
  | { kind: 'unknown'; value: number }
  /** a mean and a standard deviation */
  | { kind: 'normal'; mean: number; sd: number }
  /** anywhere in a range, as a source that gives only its ends says */
  | { kind: 'range'; lo: number; hi: number }
  /** the members of an ensemble, such as several runs of a model; member m is the m-th, wrapping round */
  | { kind: 'members'; values: number[] }
  /** named alternatives, each its own picture: a member is one of them, the first being the default */
  | { kind: 'alternatives'; values: { id: string; value: number }[] };

/** A quantity's value as the world writes it (a number, { mean, sd } or { lo, hi }) as something to sample. */
export function uncertainOf(v: unknown): Uncertain {
  if (typeof v === 'number') return { kind: 'unknown', value: v };
  const q = v as { mean?: number; sd?: number; lo?: number; hi?: number } | null;
  if (q && typeof q.mean === 'number' && typeof q.sd === 'number') return { kind: 'normal', mean: q.mean, sd: q.sd };
  if (q && typeof q.lo === 'number' && typeof q.hi === 'number') return { kind: 'range', lo: Math.min(q.lo, q.hi), hi: Math.max(q.lo, q.hi) };
  throw new Error(`not a quantity to sample: ${JSON.stringify(v)}`);
}

/** The central value: what member 0 is. */
export function central(u: Uncertain): number {
  switch (u.kind) {
    case 'exact':
    case 'unknown':
      return u.value;
    case 'normal':
      return u.mean;
    case 'range':
      return (u.lo + u.hi) / 2;
    case 'members':
      return median(u.values);
    case 'alternatives':
      return u.values[0].value;
  }
}

/** FNV-1a of a seed and a member: the same number for the same pair on every machine. */
function hash(seed: string, member: number, salt: number): number {
  let h = 0x811c9dc5 ^ salt;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= member;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Member m of an uncertain value, seeded by what it is a value of (a claim's ref, a field's id and cell), so the
 * same value draws the same member everywhere. Member 0 is the central value.
 */
export function sample(u: Uncertain, seed: string, member: number): number {
  if (member === 0) return central(u);
  switch (u.kind) {
    case 'exact':
    case 'unknown':
      return u.value;
    case 'normal': {
      // Box and Muller's transform of two uniform draws.
      const a = Math.max(hash(seed, member, 1), 1e-12);
      const b = hash(seed, member, 2);
      return u.mean + u.sd * Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b);
    }
    case 'range':
      return u.lo + (u.hi - u.lo) * hash(seed, member, 1);
    case 'members':
      return u.values[member % u.values.length];
    case 'alternatives':
      return u.values[member % u.values.length].value;
  }
}

/** The first n members of a value. */
export function samples(u: Uncertain, seed: string, n = MEMBERS): number[] {
  return Array.from({ length: n }, (_, m) => sample(u, seed, m));
}

/** Run something once per member: how a model propagates the uncertainty of what it reads. */
export function perMember<T>(n: number, run: (member: number) => T): T[] {
  return Array.from({ length: n }, (_, m) => run(m));
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const i = s.length >> 1;
  return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
}

/** The value at a quantile of members, between the nearest two. */
function quantile(sorted: number[], q: number): number {
  const x = q * (sorted.length - 1);
  const i = Math.floor(x);
  return i + 1 < sorted.length ? sorted[i] + (sorted[i + 1] - sorted[i]) * (x - i) : sorted[i];
}

export interface Spread {
  /** member 0, the central value */
  central: number;
  median: number;
  /** the 5th and 95th percentiles of the members */
  lo: number;
  hi: number;
  sd: number;
  n: number;
}

/**
 * How spread a value's members are: what evidence mode draws beside the central value. The band is the 5th to
 * 95th percentile of the members, or for alternatives, each its own picture, the whole range between them.
 */
export function spread(members: number[], band: [number, number] = [0.05, 0.95]): Spread {
  const s = [...members].sort((a, b) => a - b);
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  const sd = Math.sqrt(s.reduce((a, b) => a + (b - mean) * (b - mean), 0) / s.length);
  return { central: members[0], median: median(s), lo: quantile(s, band[0]), hi: quantile(s, band[1]), sd, n: s.length };
}

/** The band of alternatives: from the lowest to the highest, as none is more likely than another. */
export const BETWEEN: [number, number] = [0, 1];

/** How a field carries its uncertainty, as its record says (its `spread`). */
export type FieldSpread = 'unknown' | 'band' | 'alternatives' | 'ensemble' | 'claims' | 'tiers';

/** What a click says of a field's uncertainty, by how the field carries it. */
export const SPREAD_TEXT: Record<FieldSpread, string> = {
  unknown: 'Its uncertainty is unknown: the source gives one value here and no spread around it, which does not mean it is exact.',
  band: 'It carries a band, a low and a high around each value, as its source gives them.',
  alternatives: 'It has alternative readings, each its own picture, which the alternatives switch between.',
  ensemble: 'It carries an ensemble of members, such as several runs of a model, whose spread is its uncertainty.',
  claims: 'Each value is a claim of the world, with the uncertainty that claim gives.',
  tiers: 'How sure each answer is goes in tiers: recorded here, inferred from the region, or a stand-in.',
};
