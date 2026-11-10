// Pass criteria of the ninth slice that a build can answer for itself (docs/slices/NINTH-SLICE.md): the energy-balance
// model's thresholds through time, and the model against the evidence it does not read, as coverage.json reports it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CoverageFile, SeriesFile } from '../../../core/records.ts';
import { fromMa } from '../../../core/time.ts';
import { latestBuild } from './helpers.ts';

const json = <T>(name: string): T => JSON.parse(readFileSync(join(latestBuild(), name), 'utf8')) as T;
const series = (id: string) => {
  const s = json<SeriesFile>('series.json').series.find((x) => x.id === id);
  if (!s) throw new Error(`the build has no series ${id}`);
  return s;
};

describe('the energy-balance model', () => {
  it('computes the CO₂ below which the Earth freezes over from the Sun of each time, less as the Sun brightens', () => {
    const freeze = series('field:earth/snowball-co2');
    const thaw = series('field:earth/thaw-co2');
    expect(freeze.points[0][0]).toBeLessThanOrEqual(fromMa(4300));
    expect(freeze.points.at(-1)![0]).toBe(fromMa(0));
    for (let i = 1; i < freeze.points.length; i++) expect(freeze.points[i][1]).toBeLessThanOrEqual(freeze.points[i - 1][1]);
    for (let i = 1; i < thaw.points.length; i++) expect(thaw.points[i][1]).toBeLessThanOrEqual(thaw.points[i - 1][1]);
    // A thaw always asks more than staying unfrozen, and the thaw's series stops where it would ask more than the model's limit.
    for (const [t, v] of thaw.points) expect(v).toBeGreaterThan(freeze.points.find((p) => p[0] === t)![1]);
    expect(thaw.points[0][0]).toBeGreaterThan(freeze.points[0][0]);
  });

  it("gives today's climate within the band the temperature series gives for the present", () => {
    const { present } = json<CoverageFile>('coverage.json').energyBalance!;
    expect(present.against).toBe('field:earth/surface-temperature');
    expect(present.mean).toBeGreaterThanOrEqual(present.lo!);
    expect(present.mean).toBeLessThanOrEqual(present.hi!);
    expect(present.iceEdge).toBeGreaterThan(60);
  });

  it('keeps the Earth unfrozen at the CO₂ of the Mt. Roe, Bird and Pronto paleosols, which weathered under rain', () => {
    const { evidence } = json<CoverageFile>('coverage.json').energyBalance!;
    for (const id of ['earth/samples/mt-roe-paleosol', 'earth/samples/bird-paleosol', 'earth/samples/pronto-paleosol']) {
      const e = evidence.find((x) => x.id === id);
      expect(e, id).toBeDefined();
      expect(e!.verdict, id).toBe('unfrozen');
      expect(e!.co2[0], id).toBeGreaterThan(e!.freezeBelow);
    }
  });

  it("finds what the model's record says it disagrees with", () => {
    const report = json<CoverageFile>('coverage.json').energyBalance!;
    // The Alpine Lake soil: most runs on its range of CO₂ are frozen.
    const alpine = report.evidence.find((x) => x.id === 'earth/samples/alpine-lake-paleosol')!;
    expect(alpine.frozen).toBeGreaterThan(alpine.members / 2);
    // The Marinoan's end: the model needs more CO₂ to thaw than the rocks record.
    const marinoan = report.glaciations.find((g) => g.id === 'earth/events/marinoan-glaciation')!;
    expect(marinoan.co2AtEnd?.claim).toBe('earth/events/marinoan-glaciation#co2-end-hoffman-2017');
    expect(marinoan.thawsAtEnd).toBe(false);
    // The Phanerozoic: colder than the rocks on average.
    expect(report.phanerozoic!.against).toBe('field:earth/surface-temperature');
    expect(report.phanerozoic!.meanDifference).toBeLessThan(0);
  });

  it('asks each Snowball glaciation for CO₂ below what the Sun of its start allows, more of the older ones', () => {
    const { glaciations } = json<CoverageFile>('coverage.json').energyBalance!;
    const ids = glaciations.map((g) => g.id);
    expect(ids).toEqual(['earth/events/makganyene-glaciation', 'earth/events/sturtian-glaciation', 'earth/events/marinoan-glaciation']);
    const freeze = series('field:earth/snowball-co2');
    for (const g of glaciations) {
      const near = freeze.points.reduce((b, p) => (Math.abs(p[0] - fromMa(g.startMa)) < Math.abs(b[0] - fromMa(g.startMa)) ? p : b));
      // The report's threshold at the start, and the series' at the nearest step, agree within the step's change.
      expect(g.freezeBelowAtStart / near[1]).toBeGreaterThan(0.8);
      expect(g.freezeBelowAtStart / near[1]).toBeLessThan(1.25);
    }
    expect(glaciations[0].freezeBelowAtStart).toBeGreaterThan(glaciations[1].freezeBelowAtStart * 10);
  });

  it('answers the climate before the Cambrian as a model, where it once was a stand-in', () => {
    const tiers = json<CoverageFile>('coverage.json').tiers!;
    const deep = tiers.find((t) => t.span === '4600–1000 Ma')!.layers.climate;
    expect(deep.model).toBeGreaterThan(deep.generic);
    const matrix = json<CoverageFile>('coverage.json').matrix!;
    expect(JSON.stringify(matrix)).toContain('field:earth/snowball-co2');
  });
});
