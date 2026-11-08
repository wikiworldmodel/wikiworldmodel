// The energy-balance model run over the world (model:earth/energy-balance, core/ebm.ts): the CO₂ at which the Earth of
// each time freezes over and thaws under the Sun of that time, the climate it settles into on the CO₂ the world's
// evidence gives, and how that stands against the evidence it does not read: the glaciations that reached the equator,
// the soils that weathered under rain, the temperature the rocks give. Nothing here is stored in git; the build makes it.
import type { PlanetFile } from '../../../../core/planet.ts';
import { spanOf, valueOf } from '../../../../core/planet.ts';
import { EnergyBalance, type EnergyBalanceParams } from '../../../../core/ebm.ts';
import type { EnergyBalanceReport, SeriesRecord } from '../../../../core/records.ts';
import { sample, spread, type Uncertain } from '../../../../core/samples.ts';
import { centre, parseDuration, parsePoint, parseTime, toMa, type TimePointInput } from '../../../../core/time.ts';
import { chosen, claimGroup } from '../chronology.ts';
import type { Field, World } from '../world.ts';

export const RULES = { freeze: 'energy-balance-freeze', thaw: 'energy-balance-thaw', temperature: 'energy-balance-temperature' } as const;
const SUN = 'field:sun/luminosity';
const CO2 = 'field:earth/co2';
/** The pressures the thresholds are sought between, bar: from far below any the evidence gives to the model's limit. */
const range = (p: EnergyBalanceParams): [number, number] => [1e-8, p.co2_max];

const sig = (x: number) => Number(x.toPrecision(4));

/** The model's parameters: the field of its freezing threshold holds them for every output of the model. */
export function energyBalanceParams(world: World): EnergyBalanceParams | undefined {
  return world.fields.find((f) => f.rule === RULES.freeze)?.params as unknown as EnergyBalanceParams | undefined;
}

/** A series' value at time t, linear between its points; null outside them. */
export function seriesAt(points: SeriesRecord['points'], t: number): number | null {
  if (!points.length || t < points[0][0] || t > points.at(-1)![0]) return null;
  let i = 0;
  while (i < points.length - 2 && points[i + 1][0] < t) i++;
  const [a, b] = [points[i], points[i + 1] ?? points[i]];
  return b[0] === a[0] ? a[1] : a[1] + ((b[1] - a[1]) * (t - a[0])) / (b[0] - a[0]);
}

/** Years from `lo` to `hi` every `step`, with `hi` itself last. */
function steps(lo: number, hi: number, step: number): number[] {
  const out: number[] = [];
  for (let i = 0; lo + i * step < hi; i++) out.push(lo + i * step);
  out.push(hi);
  return out;
}

/**
 * A series of the model, from the series it reads that are already made: the Sun's brightness, and the CO₂ for the
 * temperature. A threshold has one value per time; the temperature has its members' 5th and 95th percentiles around
 * the run on the CO₂ series' own value.
 */
export function energyBalanceSeries(world: World, f: Field, made: SeriesRecord[]): SeriesRecord['points'] {
  const params = energyBalanceParams(world);
  if (!params) throw new Error(`${f.id}: no field holds the energy-balance model's parameters (rule ${RULES.freeze})`);
  const sun = made.find((s) => s.id === SUN);
  if (!sun) throw new Error(`${f.id}: the energy-balance model needs ${SUN}`);
  const model = new EnergyBalance(params);
  if (f.rule === RULES.freeze || f.rule === RULES.thaw) {
    const lo = parsePoint(f.time!.lo as TimePointInput).t;
    const hi = parsePoint(f.time!.hi as TimePointInput).t;
    const out: SeriesRecord['points'] = [];
    for (const t of steps(lo, hi, parseDuration(f.time!.step!))) {
      const l = seriesAt(sun.points, t);
      if (l === null) continue;
      const v = f.rule === RULES.freeze ? model.freezeBelow(l, range(params)) : model.thawAbove(l, range(params));
      if (Number.isFinite(v) && v > 0) out.push([Math.round(t), sig(v), null, null]);
    }
    return out;
  }
  if (f.rule === RULES.temperature) {
    const co2 = made.find((s) => s.id === CO2);
    if (!co2) throw new Error(`${f.id}: the energy-balance model needs ${CO2}`);
    const members = Number(f.params?.members ?? 16);
    const atmosphere = Number(f.params?.atmosphere_bar ?? 1);
    const lo = parsePoint(f.time!.lo as TimePointInput).t;
    const hi = parsePoint(f.time!.hi as TimePointInput).t;
    const out: SeriesRecord['points'] = [];
    for (const [t, v, below, above] of co2.points) {
      if (t < lo || t > hi) continue;
      const l = seriesAt(sun.points, t);
      if (l === null) continue;
      // Member 0 is the series' own value; the others are drawn from its band, the same member at every time.
      const band: Uncertain | null = below !== null && above !== null ? { kind: 'range', lo: below, hi: above } : null;
      const temps = Array.from({ length: band ? members : 1 }, (_, m) => {
        const ppm = m === 0 || !band ? v : sample(band, CO2, m);
        return model.balance(l, model.forcing(ppm * 1e-6 * atmosphere), 'warm').mean;
      });
      const s = spread(temps);
      out.push([Math.round(t), sig(temps[0]), band ? sig(s.lo) : null, band ? sig(s.hi) : null]);
    }
    return out;
  }
  throw new Error(`${f.id}: no energy-balance rule "${f.rule}"`);
}

/** A record's claim of a property, as the chronology chooses among competing ones. */
function claimOf(world: World, subject: string, prop: string) {
  const g = claimGroup(world, subject, prop);
  return g && chosen(g);
}

/** A quantity's value as a range: a number is its own range, { lo, hi } and { mean, sd } their band. */
function rangeOf(v: unknown): [number, number] | null {
  if (typeof v === 'number') return [v, v];
  const q = v as { lo?: number; hi?: number; mean?: number; sd?: number } | null;
  if (typeof q?.lo === 'number' && typeof q?.hi === 'number') return [Math.min(q.lo, q.hi), Math.max(q.lo, q.hi)];
  if (typeof q?.mean === 'number' && typeof q?.sd === 'number') return [q.mean - q.sd, q.mean + q.sd];
  return null;
}

/**
 * The model against the evidence it does not read (coverage.json's `energyBalance`): each sample's CO₂, run as
 * members across its range; each glaciation that reached the equator, with the CO₂ it needed to start and to end, and
 * the CO₂ the rocks give at its end where a claim does; today's climate against the temperature series' present; and
 * the Phanerozoic run against the temperature the rocks give.
 */
export function energyBalanceReport(world: World, planet: PlanetFile, series: SeriesRecord[], model = 'model:earth/energy-balance'): EnergyBalanceReport | undefined {
  const params = energyBalanceParams(world);
  const sun = series.find((s) => s.id === SUN);
  if (!params || !sun) return undefined;
  const ebm = new EnergyBalance(params);
  const members = Number(world.fields.find((f) => f.rule === RULES.temperature)?.params?.members ?? 16);
  const at = (t: number) => seriesAt(sun.points, t);

  const evidence: EnergyBalanceReport['evidence'] = [];
  for (const e of world.entities) {
    if (e.kind !== 'sample') continue;
    const c = claimOf(world, e.id, 'co2_pressure');
    const d = claimOf(world, e.id, 'date');
    const bounds = c && rangeOf(c.value);
    if (!c || !d || !bounds) continue;
    const [t] = centre(parseTime(d.value as never));
    const l = at(t);
    if (l === null) continue;
    const band: Uncertain = bounds[0] === bounds[1] ? { kind: 'unknown', value: bounds[0] } : { kind: 'range', lo: bounds[0], hi: bounds[1] };
    const runs = Array.from({ length: members }, (_, m) => ebm.balance(l, ebm.forcing(sample(band, c.ref, m)), 'warm'));
    const frozen = runs.filter((r) => r.iceEdge === 0).length;
    const means = spread(runs.map((r) => r.mean));
    evidence.push({
      id: e.id,
      claim: c.ref,
      ageMa: sig(toMa(t)),
      luminosity: sig(l),
      co2: bounds.map(sig) as [number, number],
      freezeBelow: sig(ebm.freezeBelow(l, range(params))),
      frozen,
      members,
      mean: [sig(means.lo), sig(means.median), sig(means.hi)],
      verdict: frozen === 0 ? 'unfrozen' : frozen === members ? 'frozen' : 'partly-frozen',
    });
  }

  const glaciations: EnergyBalanceReport['glaciations'] = [];
  for (const ep of planet.episodes) {
    const reach = valueOf(ep, 'ice_reach', {});
    if (reach !== 0) continue;
    const [start, end] = spanOf(ep, {});
    const lStart = at(start);
    const lEnd = at(end);
    if (lStart === null || lEnd === null) continue;
    const subject = ep.subject.split('@')[0];
    const c = claimOf(world, subject, 'co2_pressure');
    const atEnd = c ? rangeOf(c.value) : null;
    const thaw = ebm.thawAbove(lEnd, range(params));
    glaciations.push({
      id: subject,
      startMa: sig(toMa(start)),
      endMa: sig(toMa(end)),
      freezeBelowAtStart: sig(ebm.freezeBelow(lStart, range(params))),
      // More than the model's limit: null, as JSON has no infinity.
      thawAboveAtEnd: Number.isFinite(thaw) ? sig(thaw) : null,
      ...(atEnd && c ? { co2AtEnd: { claim: c.ref, value: atEnd.map(sig) as [number, number] }, thawsAtEnd: atEnd[1] >= thaw } : {}),
    });
  }

  // Today: the Sun of the present, CO₂ at the model's reference, against the temperature the rocks give for today.
  const present = ebm.balance(at(Math.min(sun.points.at(-1)![0], 1950)) ?? 1, 0, 'warm');
  const rocks = series.find((s) => s.id === 'field:earth/surface-temperature');
  const now = rocks?.points.at(-1);

  // The Phanerozoic: the model's temperature against the rocks', where both have a value.
  const mine = series.find((s) => s.id === world.fields.find((f) => f.rule === RULES.temperature)?.id);
  let phanerozoic: EnergyBalanceReport['phanerozoic'];
  if (mine && rocks) {
    const pairs = mine.points.flatMap(([t, v]) => {
      const r = seriesAt(rocks.points, t);
      return r === null ? [] : [[v, r] as [number, number]];
    });
    if (pairs.length > 2) {
      const n = pairs.length;
      const mx = pairs.reduce((s, p) => s + p[0], 0) / n;
      const my = pairs.reduce((s, p) => s + p[1], 0) / n;
      const cov = pairs.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0);
      const vx = pairs.reduce((s, p) => s + (p[0] - mx) ** 2, 0);
      const vy = pairs.reduce((s, p) => s + (p[1] - my) ** 2, 0);
      phanerozoic = {
        against: rocks.id,
        points: n,
        meanDifference: sig(mx - my),
        rms: sig(Math.sqrt(pairs.reduce((s, p) => s + (p[0] - p[1]) ** 2, 0) / n)),
        correlation: sig(cov / Math.sqrt(vx * vy)),
      };
    }
  }
  return {
    model,
    present: { mean: sig(present.mean), iceEdge: present.iceEdge, ...(now && rocks ? { against: rocks.id, value: now[1], lo: now[2], hi: now[3] } : {}) },
    evidence: evidence.sort((a, b) => b.ageMa - a.ageMa),
    glaciations: glaciations.sort((a, b) => b.startMa - a.startMa),
    ...(phanerozoic ? { phanerozoic } : {}),
  };
}
