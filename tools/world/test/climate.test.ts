// The climate the globe reads: twelve months reduced to four numbers, and the Köppen–Geiger classes
// those four numbers give, after Peel et al. (2007), Table 1.
import { describe, expect, it } from 'vitest';
import { aridThreshold, climateClass, decodeNode, encodeNode, reduceMonths, type ClimateRule } from '../../../core/climate.ts';

const RULE: ClimateRule = { polar: 10, frost: 0, tropical: 18, cold: 0, arid: 1, desert: 0.5 };
const months = (a: number[]) => a;

describe('the climate of a place', () => {
  it('is its warmest and coldest month, and how dry and how wet it is', () => {
    const t = months([-4, -2, 3, 9, 15, 20, 23, 22, 17, 10, 4, -2]);
    const p = months([50, 45, 55, 60, 70, 80, 75, 70, 60, 55, 50, 50]);
    const c = reduceMonths(t, p);
    expect(c.hot).toBe(23);
    expect(c.cold).toBe(-4);
    const rain = p.reduce((a, b) => a + b, 0);
    const mean = t.reduce((a, b) => a + b, 0) / 12;
    // Summer is April to September here, which takes 395 of 720 mm: neither threshold's special case.
    expect(c.aridity).toBeCloseTo(rain / (10 * aridThreshold(mean, 395 / 720)), 10);
    expect(c.margin).toBeCloseTo(Math.max(45 - 60, 45 - (100 - rain / 25)), 10);
  });

  it('takes summer to be the warmer half of the year, south of the equator too', () => {
    const north = reduceMonths(months([0, 0, 0, 20, 20, 20, 20, 20, 20, 0, 0, 0]), months([0, 0, 0, 100, 100, 100, 100, 100, 100, 0, 0, 0]));
    const south = reduceMonths(months([20, 20, 20, 0, 0, 0, 0, 0, 0, 20, 20, 20]), months([100, 100, 100, 0, 0, 0, 0, 0, 0, 100, 100, 100]));
    expect(north.aridity).toBeCloseTo(south.aridity, 10);
  });

  it('follows Peel et al. for the threshold of dryness', () => {
    expect(aridThreshold(20, 0.8)).toBe(68); // 70% of the rain in summer: 2 × MAT + 28
    expect(aridThreshold(20, 0.2)).toBe(40); // 70% in winter: 2 × MAT
    expect(aridThreshold(20, 0.5)).toBe(54); // otherwise: 2 × MAT + 14
  });

  it('names the classes as the table does', () => {
    const wet = { aridity: 3, margin: 10 };
    expect(climateClass({ hot: 30, cold: 25, ...wet }, RULE)).toBe('rainforest');
    expect(climateClass({ hot: 30, cold: 25, aridity: 3, margin: -10 }, RULE)).toBe('savanna');
    expect(climateClass({ hot: 30, cold: 12, ...wet }, RULE)).toBe('temperate');
    expect(climateClass({ hot: 24, cold: -8, ...wet }, RULE)).toBe('cold');
    expect(climateClass({ hot: 6, cold: -30, ...wet }, RULE)).toBe('tundra');
    expect(climateClass({ hot: -2, cold: -40, ...wet }, RULE)).toBe('ice');
    // Dry comes before everything but the polar classes, as in the table.
    expect(climateClass({ hot: 35, cold: 15, aridity: 0.3, margin: -50 }, RULE)).toBe('desert');
    expect(climateClass({ hot: 35, cold: 15, aridity: 0.7, margin: -50 }, RULE)).toBe('steppe');
    expect(climateClass({ hot: 6, cold: -30, aridity: 0.1, margin: -50 }, RULE)).toBe('tundra');
  });

  it('survives its four bytes closely enough to keep its class', () => {
    const c = { hot: 27.3, cold: 3.1, aridity: 1.8, margin: -35 };
    const b = encodeNode(c);
    for (const x of b) expect(Number.isInteger(x) && x >= 0 && x <= 255).toBe(true);
    const back = decodeNode(b.map((x) => x / 255));
    expect(Math.abs(back.hot - c.hot)).toBeLessThan(0.3);
    expect(Math.abs(back.cold - c.cold)).toBeLessThan(0.3);
    expect(Math.abs(back.aridity - c.aridity)).toBeLessThan(0.02);
    expect(Math.abs(back.margin - c.margin)).toBeLessThan(1);
    expect(climateClass(back, RULE)).toBe(climateClass(c, RULE));
  });
});
