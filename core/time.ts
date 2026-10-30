// The time axis: float64 decimal astronomical years (year 0 = 1 BCE, so 44 BCE is −43).
// Ages ("Ma", "ka") count back from 1950 CE, the "present" of the BP convention.
// Display units exist only at the edges: parsing record values and formatting labels.

export const PRESENT_YEAR = 1950;

export const fromMa = (ma: number): number => PRESENT_YEAR - ma * 1e6;
export const toMa = (year: number): number => (PRESENT_YEAR - year) / 1e6;
export const fromKa = (ka: number): number => PRESENT_YEAR - ka * 1e3;

/** A time value as stored in records, before normalization. */
export type TimeInput =
  | { ma: number | [number, number]; pm?: number; sigma?: number }
  | { ka: number | [number, number]; pm?: number; sigma?: number }
  | { year: number | [number, number]; pm?: number; sigma?: number }
  | { ce: number }
  | { bce: number };

/** A normalized time value, in astronomical years. `lo` is the older end. */
export type TimeValue =
  | { kind: 'instant'; t: number }
  | { kind: 'interval'; lo: number; hi: number }
  /**
   * A normal distribution. `pm` is the ± the source states and `sigma` its level (1 or 2σ)
   * if known; with the level unknown the ± is read as 1σ, the wider reading.
   */
  | { kind: 'normal'; mean: number; sd: number; pm: number; sigma?: number };

type Unit = 'ma' | 'ka' | 'year';

const UNIT_SCALE: Record<Unit, number> = { ma: 1e6, ka: 1e3, year: 1 };

function convert(unit: Unit, x: number): number {
  if (unit === 'ma') return fromMa(x);
  if (unit === 'ka') return fromKa(x);
  return x;
}

export function parseTime(input: TimeInput): TimeValue {
  if ('ce' in input) return { kind: 'instant', t: input.ce };
  if ('bce' in input) return { kind: 'instant', t: 1 - input.bce };
  const unit: Unit = 'ma' in input ? 'ma' : 'ka' in input ? 'ka' : 'year';
  const v = (input as Record<Unit, number | [number, number]>)[unit];
  if (Array.isArray(v)) {
    const a = convert(unit, v[0]);
    const b = convert(unit, v[1]);
    return { kind: 'interval', lo: Math.min(a, b), hi: Math.max(a, b) };
  }
  const t = convert(unit, v);
  if (input.pm === undefined) return { kind: 'instant', t };
  const pm = input.pm * UNIT_SCALE[unit];
  return { kind: 'normal', mean: t, sd: pm / (input.sigma ?? 1), pm, sigma: input.sigma };
}

/** Bounds used as hard constraints: an interval as given, a normal distribution at ±2σ (95%). */
export function bounds(v: TimeValue): [number, number] {
  if (v.kind === 'instant') return [v.t, v.t];
  if (v.kind === 'interval') return [v.lo, v.hi];
  return [v.mean - 2 * v.sd, v.mean + 2 * v.sd];
}

export function centre(v: TimeValue): number {
  if (v.kind === 'instant') return v.t;
  if (v.kind === 'interval') return (v.lo + v.hi) / 2;
  return v.mean;
}

function trimNumber(x: number, digits: number): string {
  return Number(x.toFixed(digits)).toString();
}

/**
 * A label for a point in time. `resolution` (years) chooses the precision; by default it
 * follows the magnitude of the age.
 */
export function formatTime(year: number, resolution?: number): string {
  const age = PRESENT_YEAR - year;
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

export function formatTimeValue(v: TimeValue): string {
  if (v.kind === 'instant') return formatTime(v.t);
  if (v.kind === 'interval') return `${formatTime(v.lo)} – ${formatTime(v.hi)}`;
  return `${formatTime(v.mean, v.sd)} ± ${formatDuration(v.pm)}${v.sigma ? ` (${v.sigma}σ)` : ''}`;
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
