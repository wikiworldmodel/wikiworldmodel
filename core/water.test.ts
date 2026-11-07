// The monthly water balance (model:earth/water-balance): daylight from the latitude, Hamon's equation, and a year
// whose water adds up, wet where it rains and dry where it does not.
import { describe, expect, it } from 'vitest';
import { daylight, hamon, waterYear, type WaterParams } from './water.ts';

// The values of the model's record (world/models/earth/water-balance.yaml).
const W: WaterParams = { hamon: { a: 13.97, b: 4.95, c: 0.062 }, t_rain: 3.3, t_snow: -10, t_snow_high: -1, high_m: 1000, melt_max: 0.5, direct: 0.05, soil_mm: 150, rfactor: 0.5, obliquity_deg: 23.44, equinox_day: 80 };
const year = (t: number | number[], p: number | number[]) => [Array.isArray(t) ? t : Array(12).fill(t), Array.isArray(p) ? p : Array(12).fill(p)];

describe('the water balance', () => {
  it('gives twelve hours of daylight at the equator, long days and nights toward the poles, and the polar day and night', () => {
    for (const day of [15, 105, 196, 288]) expect(daylight(0, day, W)).toBeCloseTo(1, 6);
    expect(daylight(60, 172, W) * 12).toBeGreaterThan(18);
    expect(daylight(60, 172, W) * 12).toBeLessThan(19.2);
    expect(daylight(60, 355, W) * 12).toBeLessThan(6.2);
    expect(daylight(80, 172, W)).toBe(2);
    expect(daylight(80, 355, W)).toBe(0);
    expect(daylight(-60, 355, W)).toBeCloseTo(daylight(60, 172, W), 1);
  });

  it("follows Hamon's equation", () => {
    // 13.97 × 30 days × 1² × 4.95 × e⁰ / 100
    expect(hamon(0, 30, 1, W)).toBeCloseTo(20.745, 2);
    expect(hamon(25, 30, 1, W)).toBeGreaterThan(hamon(10, 30, 1, W));
  });

  it('adds up, once the soil has settled: what falls is what is taken up and what runs off', () => {
    for (const [t, p] of [year(25, 200), year(15, 60), [[-15, -12, -5, 2, 8, 14, 17, 15, 10, 3, -5, -12], Array(12).fill(40)]]) {
      const w = waterYear(t, p, 45, 200, W, 12);
      expect(Math.abs(w.precip - w.aet - w.runoff) / w.precip).toBeLessThan(0.02);
    }
  });

  it('runs a wet tropical year off in rivers, and a desert year hardly at all', () => {
    const wet = waterYear(...(year(26, 250) as [number[], number[]]), 0, 100, W);
    const desert = waterYear(...(year(28, 5) as [number[], number[]]), 23, 300, W);
    expect(wet.runoff / wet.precip).toBeGreaterThan(0.3);
    expect(desert.runoff / desert.precip).toBeLessThan(0.08);
    expect(desert.pet).toBeGreaterThan(desert.precip * 10);
  });

  it('holds what falls as snow while it is cold, and lets it go when it warms', () => {
    const frozen = waterYear(Array(12).fill(-30), Array(12).fill(30), 62, 300, W);
    expect(frozen.runoff).toBe(0);
    // Heavy snow all winter and no rain in the summer: what the soil cannot take of the melt runs off.
    const t = [-20, -18, -15, -12, 6, 12, 15, 13, 7, -12, -15, -18];
    const p = [120, 120, 120, 120, 0, 0, 0, 0, 0, 120, 120, 120];
    const thaw = waterYear(t, p, 62, 300, W);
    expect(thaw.runoff).toBeGreaterThan(0.2 * thaw.precip);
    // With a third of it, the summer's evaporation takes nearly all.
    const thin = waterYear(t, p.map((x) => x / 3), 62, 300, W);
    expect(thin.runoff).toBeLessThan(thaw.runoff / 5);
  });
});
