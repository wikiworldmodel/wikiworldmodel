// The time axis: float64 decimal astronomical years (year 0 = 1 BCE, so 44 BCE is −43).
// Ages (BP, ka, Ma, Ga) count back from 1950 CE, the "present" of the BP convention.
//
// Records may write each bound in whatever unit suits it (section 5 of WORLD-MODEL.md):
//   1990.61        a decimal astronomical year; a whole number means that whole year
//   80 CE, 44 BCE  calendar years (whole years)
//   4550 BP        years before 1950
//   66.043 Ma      also ka, Ga
//   5 Gyr from now also kyr and Myr; counted from the present of the axis (1950)
// A time value is a point, an interval {lo, hi} (lo is always the earlier time; either end
// may be left open), a normal distribution {mean, sd}, `unknown`, or a reference to another
// record's interval or one of its edges, {ref, edge, lag}. Durations (sd, lag) are a number
// of years or "<n> yr|kyr|Myr|Gyr".

export const PRESENT_YEAR = 1950;

export const fromMa = (ma: number): number => PRESENT_YEAR - ma * 1e6;
export const toMa = (year: number): number => (PRESENT_YEAR - year) / 1e6;
export const fromKa = (ka: number): number => PRESENT_YEAR - ka * 1e3;

/** One bound or moment as written in a record. */
export type TimePointInput = number | string;
export type DurationInput = number | string;
export type LagInput = DurationInput | { lo?: DurationInput; hi?: DurationInput };

/** A time value as written in a record, before normalization. */
export type TimeInput =
  | TimePointInput
  | 'unknown'
  | { lo?: TimePointInput | 'unknown'; hi?: TimePointInput | 'unknown' }
  | { mean: TimePointInput; sd: DurationInput }
  | { ref: string; edge?: 'start' | 'end'; lag?: LagInput };

/** A normalized time value, in astronomical years. `lo` is the earlier end. */
export type TimeValue =
  | { kind: 'instant'; t: number }
  /** an interval; an open end is ±Infinity, an end stated as unknown is flagged */
  | { kind: 'interval'; lo: number; hi: number; loUnknown?: boolean; hiUnknown?: boolean }
  | { kind: 'normal'; mean: number; sd: number }
  | { kind: 'ref'; ref: string; edge?: 'start' | 'end'; lag: [number, number] }
  | { kind: 'unknown' };

export class TimeError extends Error {}

const AGE_UNITS: Record<string, number> = { BP: 1, ka: 1e3, Ma: 1e6, Ga: 1e9 };
const FUTURE_UNITS: Record<string, number> = { kyr: 1e3, Myr: 1e6, Gyr: 1e9 };
const DURATION_UNITS: Record<string, number> = { yr: 1, kyr: 1e3, Myr: 1e6, Gyr: 1e9 };

/**
 * A point on the axis, and whether it was written as a whole calendar year (which, as a
 * moment, means that whole year).
 */
export function parsePoint(input: TimePointInput): { t: number; wholeYear: boolean } {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new TimeError(`not a time: ${input}`);
    return { t: input, wholeYear: Number.isInteger(input) };
  }
  const m = /^\s*(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s+(CE|BCE|BP|ka|Ma|Ga|kyr from now|Myr from now|Gyr from now)\s*$/.exec(input);
  if (!m) throw new TimeError(`not a time: "${input}" (write a year, or a number with CE, BCE, BP, ka, Ma, Ga, or kyr/Myr/Gyr from now)`);
  const x = Number(m[1]);
  const unit = m[2];
  if (unit === 'CE') return { t: x, wholeYear: Number.isInteger(x) };
  if (unit === 'BCE') return { t: 1 - x, wholeYear: Number.isInteger(x) };
  if (unit in AGE_UNITS) return { t: PRESENT_YEAR - x * AGE_UNITS[unit], wholeYear: false };
  return { t: PRESENT_YEAR + x * FUTURE_UNITS[unit.split(' ')[0]], wholeYear: false };
}

export function parseDuration(input: DurationInput): number {
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input < 0) throw new TimeError(`not a duration: ${input}`);
    return input;
  }
  const m = /^\s*(\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s+(yr|kyr|Myr|Gyr)\s*$/.exec(input);
  if (!m) throw new TimeError(`not a duration: "${input}" (write years, or a number with yr, kyr, Myr or Gyr)`);
  return Number(m[1]) * DURATION_UNITS[m[2]];
}

/** A lag as [lo, hi] in years; a single duration is exact, a missing end is open. */
export function parseLag(input: LagInput | undefined): [number, number] {
  if (input === undefined) return [0, Infinity];
  if (typeof input === 'object') {
    const lo = input.lo === undefined ? 0 : parseDuration(input.lo);
    const hi = input.hi === undefined ? Infinity : parseDuration(input.hi);
    if (lo > hi) throw new TimeError(`lag lo is greater than hi`);
    return [lo, hi];
  }
  const d = parseDuration(input);
  return [d, d];
}

export function parseTime(input: TimeInput): TimeValue {
  if (input === 'unknown') return { kind: 'unknown' };
  if (typeof input === 'number' || typeof input === 'string') {
    const p = parsePoint(input);
    return p.wholeYear ? { kind: 'interval', lo: p.t, hi: p.t + 1 } : { kind: 'instant', t: p.t };
  }
  const keys = input && typeof input === 'object' ? Object.keys(input).sort().join(',') : '';
  const forms = ['hi', 'lo', 'hi,lo', 'mean,sd', 'ref', 'edge,ref', 'lag,ref', 'edge,lag,ref'];
  if (!forms.includes(keys)) throw new TimeError(`not a time value: ${JSON.stringify(input)} (write a point, {lo, hi}, {mean, sd}, {ref, edge, lag} or unknown)`);
  if ('ref' in input) {
    if (input.edge !== undefined && input.edge !== 'start' && input.edge !== 'end') throw new TimeError(`edge must be start or end`);
    return { kind: 'ref', ref: input.ref, edge: input.edge, lag: input.lag === undefined ? [0, 0] : parseLag(input.lag) };
  }
  if ('mean' in input) {
    const sd = parseDuration(input.sd);
    return { kind: 'normal', mean: parsePoint(input.mean).t, sd };
  }
  const { lo, hi } = input as { lo?: TimePointInput | 'unknown'; hi?: TimePointInput | 'unknown' };
  const loP = lo === undefined || lo === 'unknown' ? undefined : parsePoint(lo);
  const hiP = hi === undefined || hi === 'unknown' ? undefined : parsePoint(hi);
  const v: TimeValue = {
    kind: 'interval',
    lo: loP ? loP.t : -Infinity,
    // "1990 to 2000" includes the whole of 2000.
    hi: hiP ? (hiP.wholeYear ? hiP.t + 1 : hiP.t) : Infinity,
  };
  if (lo === 'unknown') v.loUnknown = true;
  if (hi === 'unknown') v.hiUnknown = true;
  if (v.lo > v.hi) throw new TimeError(`lo is later than hi (${formatTime(v.lo)} after ${formatTime(v.hi)}); lo is always the earlier time`);
  return v;
}

/** Bounds used as hard constraints: an interval as given, a normal distribution at ±2σ (95%). */
export function bounds(v: TimeValue): [number, number] {
  if (v.kind === 'instant') return [v.t, v.t];
  if (v.kind === 'interval') return [v.lo, v.hi];
  if (v.kind === 'normal') return [v.mean - 2 * v.sd, v.mean + 2 * v.sd];
  return [-Infinity, Infinity];
}

export function centre(v: TimeValue): [number, number] {
  if (v.kind === 'instant') return [v.t, v.t];
  if (v.kind === 'normal') return [v.mean, v.mean];
  if (v.kind === 'interval' && Number.isFinite(v.lo) && Number.isFinite(v.hi)) {
    const c = (v.lo + v.hi) / 2;
    return [c, c];
  }
  return bounds(v);
}

function trimNumber(x: number, digits: number): string {
  return Number(x.toFixed(digits)).toString();
}

/**
 * A label for a point in time. `resolution` (years) chooses the precision; by default it
 * follows the magnitude of the age.
 */
export function formatTime(year: number, resolution?: number): string {
  if (year === -Infinity) return 'open';
  if (year === Infinity) return 'open';
  const age = PRESENT_YEAR - year;
  // The future, beyond the span where a calendar year reads naturally.
  if (age <= -1e4) {
    const ahead = -age;
    const [div, unit] = ahead >= 1e9 ? [1e9, 'Gyr'] : ahead >= 1e6 ? [1e6, 'Myr'] : [1e3, 'kyr'];
    const digits = resolution ? Math.max(0, Math.min(6, Math.ceil(-Math.log10(resolution / div)))) : 2;
    return `${trimNumber(ahead / div, digits)} ${unit} from now`;
  }
  if (age >= 1e6) {
    const digits = resolution ? Math.max(0, Math.min(6, Math.ceil(-Math.log10(resolution / 1e6)))) : age >= 1e8 ? 1 : 2;
    return `${trimNumber(age / 1e6, digits)} Ma`;
  }
  if (age >= 1e4) {
    const digits = resolution ? Math.max(0, Math.min(3, Math.ceil(-Math.log10(resolution / 1e3)))) : 1;
    return `${trimNumber(age / 1e3, digits)} ka`;
  }
  const y = Math.round(year);
  return y <= 0 ? `${1 - y} BCE` : `${y} CE`;
}

/** A label for a duration in years, e.g. "22 kyr" or "1.3 Myr". */
export function formatDuration(years: number): string {
  const a = Math.abs(years);
  if (a >= 1e6) return `${trimNumber(a / 1e6, a >= 1e7 ? 0 : 1)} Myr`;
  if (a >= 1e3) return `${trimNumber(a / 1e3, a >= 1e4 ? 0 : 1)} kyr`;
  return `${Math.round(a)} yr`;
}

/** A time value as text, in Ma with up to four decimals in deep time. */
export function formatTimeValue(v: TimeValue, refLabel: (ref: string) => string = (r) => r): string {
  const deep = (y: number) => PRESENT_YEAR - y >= 1e4;
  const ma = (y: number) => `${+((PRESENT_YEAR - y) / 1e6).toFixed(4)} Ma`;
  const at = (y: number) => (deep(y) ? ma(y) : formatTime(y));
  if (v.kind === 'instant') return at(v.t);
  if (v.kind === 'unknown') return 'unknown';
  if (v.kind === 'normal') {
    if (!deep(v.mean)) return `${formatTime(v.mean)} ± ${formatDuration(v.sd)} (1σ)`;
    return `${+((PRESENT_YEAR - v.mean) / 1e6).toFixed(4)} ± ${+(v.sd / 1e6).toFixed(4)} Ma (1σ)`;
  }
  if (v.kind === 'ref') {
    const what = v.edge ? `the ${v.edge} of ${refLabel(v.ref)}` : `during ${refLabel(v.ref)}`;
    const [lo, hi] = v.lag;
    if (lo === 0 && hi === 0) return what;
    return `${what}, ${hi === Infinity ? `at least ${formatDuration(lo)}` : lo === hi ? formatDuration(lo) : `${formatDuration(lo)} to ${formatDuration(hi)}`} after`;
  }
  const lo = v.loUnknown ? 'unknown' : Number.isFinite(v.lo) ? at(v.lo) : null;
  const hi = v.hiUnknown ? 'unknown' : Number.isFinite(v.hi) ? at(v.hi) : null;
  if (lo && hi) return `${lo} – ${hi}`;
  if (hi) return `no later than ${hi}`;
  return `no earlier than ${lo}`;
}

/** Canonical URL form: the age in Ma, with whole years as the finest step, e.g. "66.043Ma". */
export function timeToParam(year: number): string {
  const y = Math.round(year);
  return `${(PRESENT_YEAR - y) / 1e6}Ma`;
}

export function timeFromParam(s: string): number | undefined {
  const m = /^(-?\d+(?:\.\d+)?)(Ma|ka)?$/.exec(s.trim());
  if (!m) return undefined;
  const x = Number(m[1]);
  if (m[2] === 'Ma') return Math.round(fromMa(x));
  if (m[2] === 'ka') return Math.round(fromKa(x));
  return x;
}
