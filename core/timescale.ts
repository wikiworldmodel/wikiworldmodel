// The time control's scale: one fixed map from time to a position along the strip, as a map
// projection is for the globe. Each era below is given the share of the whole strip it is
// worth looking at, and a smooth curve runs through them, so the scale has no corners where
// eras meet. To change how much room an era gets, change its stop. The coverage chart is drawn
// on the same scale, so an era takes the same room there.
import { fromMa, PRESENT_YEAR } from './time.ts';

/** Where each era starts along the whole strip, in hundredths of it. */
const STOPS: [year: number, position: number][] = [
  [fromMa(4900), 0],
  [fromMa(2500), 5], // the Hadean and the Archean
  [fromMa(541), 13], // the Proterozoic
  [fromMa(252), 20], // the Paleozoic
  [fromMa(66), 30], // the Mesozoic
  [fromMa(2.6), 42], // the Cenozoic
  [-10000, 48], // the Pleistocene and early people
  [-3000, 52], // the first farmers
  [1, 60], // the first writing, to Rome
  [1000, 68],
  [1500, 73],
  [1800, 78],
  [PRESENT_YEAR, 85],
  [2100, 89],
  [PRESENT_YEAR + 1e6, 91],
  [PRESENT_YEAR + 1e9, 95],
  [PRESENT_YEAR + 8.1e9, 100],
];

/** Below this distance from the present, in years, the underlying scale is linear; above it, logarithmic. */
const SOFT = 50;
const toLog = (t: number) => Math.asinh((t - PRESENT_YEAR) / SOFT);
const fromLog = (v: number) => PRESENT_YEAR + SOFT * Math.sinh(v);

const vs = STOPS.map(([t]) => toLog(t));
const ps = STOPS.map(([, p]) => p);
const hs = vs.slice(1).map((v, i) => v - vs[i]);
const ds = hs.map((h, i) => (ps[i + 1] - ps[i]) / h);

/** Slopes at the stops that keep the curve rising between them (Fritsch and Butland's). */
const ms = vs.map((_, i) => {
  if (i === 0) return ds[0];
  if (i === vs.length - 1) return ds[i - 1];
  const a = 2 * hs[i] + hs[i - 1];
  const b = hs[i] + 2 * hs[i - 1];
  return (a + b) / (a / ds[i - 1] + b / ds[i]);
});

/** The curve within the i-th era, at a fraction f of its way along. */
function within(i: number, f: number): number {
  const g = 1 - f;
  return g * g * (1 + 2 * f) * ps[i] + f * g * g * hs[i] * ms[i] + f * f * (3 - 2 * f) * ps[i + 1] - f * f * g * hs[i] * ms[i + 1];
}

/** The last index of a rising list whose value is at or below x, within the eras. */
function eraOf(list: number[], x: number): number {
  let lo = 0;
  let hi = list.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (list[mid] <= x) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** A time's position along the whole strip. Beyond the first and last stops the scale runs on straight. */
export function positionOf(t: number): number {
  const v = toLog(t);
  const last = vs.length - 1;
  if (v <= vs[0]) return ps[0] + (v - vs[0]) * ms[0];
  if (v >= vs[last]) return ps[last] + (v - vs[last]) * ms[last];
  const i = eraOf(vs, v);
  return within(i, (v - vs[i]) / hs[i]);
}

/** The time at a position along the whole strip. */
export function timeAt(p: number): number {
  const last = ps.length - 1;
  if (p <= ps[0]) return fromLog(vs[0] + (p - ps[0]) / ms[0]);
  if (p >= ps[last]) return fromLog(vs[last] + (p - ps[last]) / ms[last]);
  const i = eraOf(ps, p);
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 52; k++) {
    const mid = (lo + hi) / 2;
    if (within(i, mid) < p) lo = mid;
    else hi = mid;
  }
  return fromLog(vs[i] + ((lo + hi) / 2) * hs[i]);
}
