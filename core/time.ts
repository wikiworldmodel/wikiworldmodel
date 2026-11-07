// The time axis: float64 decimal astronomical years (year 0 = 1 BCE, so 44 BCE is −43).
// Ages (BP, ka, Ma, Ga) count back from 1950 CE, the "present" of the BP convention.
//
// Records may write each bound in whatever unit suits it (section 5 of WORLD-MODEL.md):
//   1990.61          a decimal astronomical year; a whole number means that whole year
//   80 CE, 44 BCE    calendar years (whole years)
//   15 March 44 BCE  a calendar date (that whole day), or a month: March 44 BCE
//   4550 BP          years before 1950
//   66.043 Ma        also ka, Ga
//   5 Gyr from now   also kyr and Myr; counted from the present of the axis (1950)
// A time value is a point, an interval {lo, hi} (lo is always the earlier time; either end
// may be left open), a normal distribution {mean, sd}, `unknown`, or a reference to another
// record's interval or one of its edges, {ref, edge, lag}. Durations (sd, lag) are a number
// of years or "<n> days|yr|kyr|Myr|Gyr".
//
// Dates are in the calendar then in use: the Julian before 15 October 1582, the Gregorian
// from then on (a date may name its calendar instead, "25 October 1917 CE Julian"). Earlier
// Julian dates are proleptic: the Roman calendar before 45 BCE ran out of step with the
// seasons, and a date written in it has to be converted before it goes here. A day's place in
// its year is its count of days into the year over the year's length, so whole years stay
// whole numbers; 1582, shortened by the reform, has 355 days.

export const PRESENT_YEAR = 1950;

export const fromMa = (ma: number): number => PRESENT_YEAR - ma * 1e6;
export const toMa = (year: number): number => (PRESENT_YEAR - year) / 1e6;
export const fromKa = (ka: number): number => PRESENT_YEAR - ka * 1e3;

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS = MONTH_NAMES;
/** Day number of 15 October 1582, the first day of the Gregorian calendar. */
const REFORM = 2299161;
/** The earliest year (astronomical) dates are read and written for: day numbers start in 4713 BCE. */
const FIRST_DATED_YEAR = -4712;

/** The day number (Julian Day Number) of a date; y is the astronomical year. */
function dayNumber(y: number, m: number, d: number, gregorian: boolean): number {
  const a = Math.floor((14 - m) / 12);
  const yy = y + 4800 - a;
  const mm = m + 12 * a - 3;
  const n = d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4);
  return gregorian ? n - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045 : n - 32083;
}

/** The date of a day number in one calendar (E. G. Richards' algorithm, for day numbers ≥ 0). */
function dateOf(j: number, gregorian: boolean): { y: number; m: number; d: number } {
  const f = gregorian ? j + 1401 + Math.floor((Math.floor((4 * j + 274277) / 146097) * 3) / 4) - 38 : j + 1401;
  const e = 4 * f + 3;
  const h = 5 * Math.floor((e % 1461) / 4) + 2;
  const m = ((Math.floor(h / 153) + 2) % 12) + 1;
  return { y: Math.floor(e / 1461) - 4716 + Math.floor((14 - m) / 12), m, d: Math.floor((h % 153) / 5) + 1 };
}

/** The first day of a year, in the calendar in use then. */
const yearStart = (y: number) => dayNumber(y, 1, 1, y > 1582);

/** A day number's place on the axis: its year, plus its days into the year over the year's length. */
function axisOf(j: number): number {
  const { y } = dateOf(j, j >= REFORM);
  const y0 = yearStart(y);
  return y + (j - y0) / (yearStart(y + 1) - y0);
}

/** The calendar date at a point on the axis, in the calendar then in use; none before 4713 BCE. */
export function dateAt(t: number): { year: number; month: number; day: number } | undefined {
  const y = Math.floor(t + 1e-9);
  if (!Number.isFinite(t) || y < FIRST_DATED_YEAR || y > 1e6) return undefined;
  const y0 = yearStart(y);
  const j = y0 + Math.floor(Math.max(0, t - y) * (yearStart(y + 1) - y0) + 1e-6);
  const { y: year, m, d } = dateOf(j, j >= REFORM);
  return { year, month: m, day: d };
}

const DATE = new RegExp(`^\\s*(?:(\\d{1,2})\\s+)?(${MONTHS.join('|')})\\s+(\\d+)\\s+(CE|BCE)(?:\\s+(Julian|Gregorian))?\\s*$`);

/** A calendar date, or a whole month: its start on the axis and the length of the day or month. */
function parseDate(input: string): { t: number; whole: number } | undefined {
  const m = DATE.exec(input);
  if (!m) return undefined;
  const month = MONTHS.indexOf(m[2]) + 1;
  const y = m[4] === 'BCE' ? 1 - Number(m[3]) : Number(m[3]);
  const day = m[1] === undefined ? 1 : Number(m[1]);
  if (y < FIRST_DATED_YEAR) throw new TimeError(`"${input}": dates are read from 4713 BCE on; write a year instead`);
  const gregorian = m[5] ? m[5] === 'Gregorian' : y > 1582 || (y === 1582 && (month > 10 || (month === 10 && day >= 15)));
  const j = dayNumber(y, month, day, gregorian);
  const back = dateOf(j, gregorian);
  if (back.y !== y || back.m !== month || back.d !== day) throw new TimeError(`"${input}" is not a date in the ${gregorian ? 'Gregorian' : 'Julian'} calendar`);
  const t = axisOf(j);
  if (m[1] !== undefined) return { t, whole: axisOf(j + 1) - t };
  const next = month === 12 ? dayNumber(y + 1, 1, 1, gregorian) : dayNumber(y, month + 1, 1, gregorian);
  return { t, whole: axisOf(next) - t };
}

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
const DURATION_UNITS: Record<string, number> = { day: 1 / 365.25, days: 1 / 365.25, yr: 1, kyr: 1e3, Myr: 1e6, Gyr: 1e9 };

/**
 * A point on the axis, and the length of the calendar unit it names, if it names one: a
 * whole year, month or day, which as a moment means that whole unit. Zero for an exact point.
 */
export function parsePoint(input: TimePointInput): { t: number; whole: number } {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new TimeError(`not a time: ${input}`);
    return { t: input, whole: Number.isInteger(input) ? 1 : 0 };
  }
  const date = parseDate(input);
  if (date) return date;
  const m = /^\s*(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s+(CE|BCE|BP|ka|Ma|Ga|kyr from now|Myr from now|Gyr from now)\s*$/.exec(input);
  if (!m) throw new TimeError(`not a time: "${input}" (write a year, a date such as 15 March 44 BCE, or a number with CE, BCE, BP, ka, Ma, Ga, or kyr/Myr/Gyr from now)`);
  const x = Number(m[1]);
  const unit = m[2];
  if (unit === 'CE') return { t: x, whole: Number.isInteger(x) ? 1 : 0 };
  if (unit === 'BCE') return { t: 1 - x, whole: Number.isInteger(x) ? 1 : 0 };
  if (unit in AGE_UNITS) return { t: PRESENT_YEAR - x * AGE_UNITS[unit], whole: 0 };
  return { t: PRESENT_YEAR + x * FUTURE_UNITS[unit.split(' ')[0]], whole: 0 };
}

export function parseDuration(input: DurationInput): number {
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input < 0) throw new TimeError(`not a duration: ${input}`);
    return input;
  }
  const m = /^\s*(\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s+(days?|yr|kyr|Myr|Gyr)\s*$/.exec(input);
  if (!m) throw new TimeError(`not a duration: "${input}" (write years, or a number with days, yr, kyr, Myr or Gyr)`);
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
    return p.whole ? { kind: 'interval', lo: p.t, hi: p.t + p.whole } : { kind: 'instant', t: p.t };
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
    // "1990 to 2000" includes the whole of 2000, and "to 15 March" the whole of that day.
    hi: hiP ? hiP.t + hiP.whole : Infinity,
  };
  if (lo === 'unknown') v.loUnknown = true;
  if (hi === 'unknown') v.hiUnknown = true;
  if (v.lo > v.hi) throw new TimeError(`lo is later than hi (${lo} after ${hi}); lo is always the earlier time`);
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
  // A finer resolution than a year shows the month, or the day.
  const unit = resolution === undefined || resolution >= 60 / 365 ? 'year' : resolution >= 3 / 365 ? 'month' : 'day';
  return formatDate(year, unit);
}

/** The calendar year, month or day that contains a point on the axis. */
export function formatDate(t: number, unit: 'year' | 'month' | 'day'): string {
  const date = unit === 'year' ? undefined : dateAt(t);
  const y = date?.year ?? Math.floor(t + 1e-9);
  const era = y <= 0 ? `${1 - y} BCE` : `${y} CE`;
  if (!date) return era;
  return unit === 'month' ? `${MONTHS[date.month - 1]} ${era}` : `${date.day} ${MONTHS[date.month - 1]} ${era}`;
}

/** The calendar unit a point starts, if it starts one: a year, else a month, else a day. */
function unitStarted(t: number): 'year' | 'month' | 'day' | undefined {
  if (Math.abs(t - Math.round(t)) < 1e-9) return 'year';
  const y = Math.floor(t);
  if (y < FIRST_DATED_YEAR || y > 1e6) return undefined;
  const k = (t - y) * (yearStart(y + 1) - yearStart(y));
  if (Math.abs(k - Math.round(k)) > 1e-6) return undefined;
  return dateAt(t)?.day === 1 ? 'month' : 'day';
}

/**
 * An interval of whole calendar units, as text: "80 CE", "March 44 BCE", "15 March 44 BCE", or
 * a range of them. Undefined if its ends are not calendar units.
 */
function formatWhole(lo: number, hi: number): string | undefined {
  const order = ['year', 'month', 'day'];
  const a = unitStarted(lo);
  const b = unitStarted(hi);
  if (!a || !b) return undefined;
  const unit = order[Math.max(order.indexOf(a), order.indexOf(b))] as 'year' | 'month' | 'day';
  // The end is exclusive: the unit before it is the last one in the interval.
  const first = formatDate(lo, unit);
  const last = formatDate(hi - 1e-7, unit);
  return first === last ? first : `${first} – ${last}`;
}

/** A label for a duration in years, e.g. "40 days", "22 kyr" or "1.3 Myr". */
export function formatDuration(years: number): string {
  const a = Math.abs(years);
  if (a >= 1e6) return `${trimNumber(a / 1e6, a >= 1e7 ? 0 : 1)} Myr`;
  if (a >= 1e3) return `${trimNumber(a / 1e3, a >= 1e4 ? 0 : 1)} kyr`;
  if (a < 1) return `${Math.round(a * 365.25)} days`;
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
  if (historical(v.lo) && historical(v.hi) && !v.loUnknown && !v.hiUnknown) {
    const whole = formatWhole(v.lo, v.hi);
    if (whole) return whole;
  }
  // An end that is exclusive (the start of the unit after) is shown as the unit before it.
  const end = (y: number) => {
    const unit = historical(y) ? unitStarted(y) : undefined;
    return unit ? formatDate(y - 1e-7, unit) : at(y);
  };
  const lo = v.loUnknown ? 'unknown' : Number.isFinite(v.lo) ? at(v.lo) : null;
  const hi = v.hiUnknown ? 'unknown' : Number.isFinite(v.hi) ? end(v.hi) : null;
  if (lo && hi) return `${lo} – ${hi}`;
  if (hi) return `no later than ${hi}`;
  return `no earlier than ${lo}`;
}

/** Whether a time is close enough to the present for the calendar: within 10 kyr of 1950. */
export const historical = (year: number): boolean => Math.abs(PRESENT_YEAR - year) < 1e4;

/** A time as the URL carries it: within 10 kyr of the present, so that a day can be told apart. */
export function quantizeTime(year: number): number {
  return historical(year) ? Math.round(year * 1000) / 1000 : Math.round(year);
}

/**
 * Canonical URL form: a decimal astronomical year to a thousandth (about nine hours) within
 * 10 kyr of the present, e.g. "-43.796"; further away, the age in Ma with whole years as the
 * finest step, e.g. "66.043Ma".
 */
export function timeToParam(year: number): string {
  const y = quantizeTime(year);
  return historical(y) ? String(y) : `${(PRESENT_YEAR - y) / 1e6}Ma`;
}

export function timeFromParam(s: string): number | undefined {
  const m = /^(-?\d+(?:\.\d+)?)(Ma|ka|BCE|CE)?$/.exec(s.trim());
  if (!m) return undefined;
  const x = Number(m[1]);
  if (m[2] === 'Ma') return Math.round(fromMa(x));
  if (m[2] === 'ka') return Math.round(fromKa(x));
  if (m[2] === 'BCE') return 1 - x;
  return x;
}
