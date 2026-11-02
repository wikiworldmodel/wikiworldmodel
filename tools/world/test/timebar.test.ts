// The time control's scale: more room the nearer the present, smooth along the whole strip, with
// zooming and panning even along it, and a ruler that reads whatever scale it crosses.
import { describe, expect, it } from 'vitest';
import { fromMa, PRESENT_YEAR } from '../../../core/time.ts';
import { clampWindow, fitWindow, MIN_SPAN, panWindow, rulerTicks, tOf, xOf, zoomAround } from '../../../viewer/src/ui/timebar.ts';

const W = 1000;
const LIMITS: [number, number] = [fromMa(4907), PRESENT_YEAR + 8.1e9];

describe('time control', () => {
  it('maps times to the strip and back', () => {
    for (const win of [LIMITS, [fromMa(320), PRESENT_YEAR], [fromMa(70), fromMa(60)], [-800, 2000], [-45.5, -41.5]] as [number, number][]) {
      for (const f of [0, 0.1, 0.5, 0.9, 1]) {
        const t = tOf(f * W, win, W);
        expect(xOf(t, win, W)).toBeCloseTo(f * W, 6);
      }
      expect(xOf(win[0], win, W)).toBeCloseTo(0, 9);
      expect(xOf(win[1], win, W)).toBeCloseTo(W, 6);
    }
  });

  it('gives the recent past far more of the strip than the deep past', () => {
    const share = (a: number, b: number) => (xOf(b, LIMITS, W) - xOf(a, LIMITS, W)) / W;
    expect(share(-3000, PRESENT_YEAR)).toBeGreaterThan(0.3);
    expect(share(1, 1000)).toBeGreaterThan(0.07);
    expect(share(fromMa(66), fromMa(2.6))).toBeGreaterThan(0.1);
    expect(share(fromMa(4900), fromMa(541))).toBeGreaterThan(0.1);
    // The past takes most of it, and the future still has room.
    expect(xOf(PRESENT_YEAR, LIMITS, W) / W).toBeGreaterThan(0.8);
    expect(share(PRESENT_YEAR, PRESENT_YEAR + 5e9)).toBeGreaterThan(0.1);
  });

  it('has more pixels to the year, to within a few percent, all the way to the present, and no corners', () => {
    const density = (t: number) => {
      const d = Math.max(Math.abs(PRESENT_YEAR - t) * 1e-4, 1e-2);
      return (xOf(t + d, LIMITS, W) - xOf(t - d, LIMITS, W)) / (2 * d);
    };
    let last = 0;
    for (let v = Math.log(4.9e9); v > 0; v -= 0.02) {
      const here = density(PRESENT_YEAR - Math.exp(v));
      expect(here).toBeGreaterThan(last * 0.97);
      // Smooth: a step of 2% in age changes the scale by a little.
      if (last) expect(here / last).toBeLessThan(1.1);
      last = here;
    }
  });

  it('is close to linear across a window of history, and closer the narrower', () => {
    const skew = (win: [number, number]) => {
      const mid = (win[0] + win[1]) / 2;
      return Math.abs(xOf(mid, win, W) / W - 0.5);
    };
    expect(skew([-800, 1500])).toBeLessThan(0.2);
    expect(skew([1, 500])).toBeLessThan(0.1);
    expect(skew([-45.5, -41.5])).toBeLessThan(1e-3);
    expect(skew([fromMa(70), fromMa(60)])).toBeLessThan(0.02);
  });

  it('zooms about a point, keeping it where it was on the strip', () => {
    for (const tp of [fromMa(66), fromMa(2400), 120, 1900, PRESENT_YEAR + 1e9]) {
      const s = xOf(tp, LIMITS, W) / W;
      const win = zoomAround(LIMITS, tp, s, 4, LIMITS);
      expect(xOf(tp, win, W) / W).toBeCloseTo(s, 6);
      // Everything near it is magnified by the factor.
      const d = Math.max(Math.abs(PRESENT_YEAR - tp) * 1e-3, 0.5);
      const before = xOf(tp + d, LIMITS, W) - xOf(tp - d, LIMITS, W);
      expect((xOf(tp + d, win, W) - xOf(tp - d, win, W)) / before).toBeCloseTo(4, 2);
    }
  });

  it('reaches a few centuries in a few zooms, and stops at a few years', () => {
    let win = LIMITS;
    for (let i = 0; i < 6; i++) win = zoomAround(win, 120, xOf(120, win, W) / W, 2, LIMITS);
    expect(win[1] - win[0]).toBeLessThan(400);
    for (let i = 0; i < 12; i++) win = zoomAround(win, 120, xOf(120, win, W) / W, 2, LIMITS);
    expect(win[1] - win[0]).toBeCloseTo(MIN_SPAN, 6);
    expect(xOf(120, win, W)).toBeGreaterThanOrEqual(0);
    expect(zoomAround(win, 120, 0.5, 1e-9, LIMITS)).toEqual(LIMITS);
  });

  it('pans evenly along the scale, stays within its limits, and keeps a few years in view', () => {
    const win = zoomAround(LIMITS, fromMa(66), 0.5, 8, LIMITS);
    const moved = panWindow(win, -100, W, LIMITS);
    expect(xOf(tOf(100, win, W), moved, W)).toBeCloseTo(0, 6);
    const far = panWindow(win, -1e6, W, LIMITS);
    expect(far[1]).toBe(LIMITS[1]);
    expect(far[1] - far[0]).toBeLessThan(LIMITS[1] - LIMITS[0]);
    expect(panWindow(win, 1e6, W, LIMITS)[0]).toBe(LIMITS[0]);
    // A few years in Rome, dragged to the present, are still a few years.
    const narrow: [number, number] = [120, 124];
    const dragged = panWindow(narrow, -1e4, W, LIMITS);
    expect(dragged[1] - dragged[0]).toBeGreaterThanOrEqual(MIN_SPAN - 1e-6);
  });

  it('fits a stretch of time with a margin along the scale, and clamps it', () => {
    const [a, b] = fitWindow(fromMa(145), fromMa(66), LIMITS);
    expect(xOf(fromMa(145), [a, b], W)).toBeCloseTo((0.06 / 1.12) * W, 6);
    expect(xOf(fromMa(66), [a, b], W)).toBeCloseTo((1.06 / 1.12) * W, 6);
    expect(fitWindow(LIMITS[0], LIMITS[1], LIMITS)).toEqual(LIMITS);
    expect(clampWindow([LIMITS[0] - 1e9, fromMa(100)], LIMITS)[0]).toBe(LIMITS[0]);
  });

  describe('the ruler', () => {
    const ticks = (win: [number, number], width = 1280, gap = 72) => rulerTicks(win, (t) => xOf(t, win, width), (x) => tOf(x, win, width), gap);

    it('reads every scale across the whole range, evenly spaced', () => {
      const all = ticks(LIMITS);
      const labels = all.map((k) => k.label);
      expect(all.length).toBeGreaterThan(10);
      expect(labels.some((l) => / Ga$/.test(l))).toBe(true);
      expect(labels.some((l) => / Ma$/.test(l))).toBe(true);
      expect(labels.some((l) => / BCE$/.test(l))).toBe(true);
      expect(labels.some((l) => / CE$/.test(l))).toBe(true);
      expect(labels.some((l) => /^\+.* Gyr$/.test(l))).toBe(true);
      const xs = all.map((k) => xOf(k.t, LIMITS, 1280));
      expect(xs.every((v, i) => i === 0 || v - xs[i - 1] >= 72)).toBe(true);
      expect(Math.max(...xs.map((v, i) => (i === 0 ? 0 : v - xs[i - 1])))).toBeLessThan(250);
    });

    it('marks whole years and centuries of the calendar, BCE and CE counted apart', () => {
      expect(ticks([-800, 1500], 1280, 120).map((k) => k.label)).toContain('1 CE');
      expect(ticks([-500, -100], 1000, 100).map((k) => k.label).slice(0, 3)).toEqual(['500 BCE', '450 BCE', '400 BCE']);
      expect(ticks([-45.5, -41.5], 1000).map((k) => k.t)).toEqual([-45, -44, -43, -42]);
      expect(ticks([-45.5, -41.5], 1000).map((k) => k.label)).toEqual(['46 BCE', '45 BCE', '44 BCE', '43 BCE']);
    });

    it('is even across a narrow window of deep time', () => {
      expect(ticks([fromMa(70), fromMa(60)], 1000, 120).map((k) => k.label)).toEqual(['70 Ma', '68 Ma', '66 Ma', '64 Ma', '62 Ma', '60 Ma']);
      expect(ticks([fromMa(3000.000004), fromMa(3000)], 1000).map((k) => k.label)[0]).toMatch(/^3 Ga|^3\.0+\d* Ga$/);
    });
  });
});
