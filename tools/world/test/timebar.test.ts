// The time control's warp: logarithmic in distance from the present on both sides of it, and
// the same as before for windows in the past no wider than 400 Myr.
import { describe, expect, it } from 'vitest';
import { fromMa, PRESENT_YEAR } from '../../../core/time.ts';
import { tOf, xOf, zoomAround } from '../../../viewer/src/ui/timebar.ts';

const W = 1000;

describe('time control', () => {
  it('maps times to the strip and back', () => {
    for (const win of [[fromMa(4900), PRESENT_YEAR + 5.3e9], [fromMa(320), PRESENT_YEAR], [fromMa(70), fromMa(60)]] as [number, number][]) {
      for (const f of [0, 0.1, 0.5, 0.9, 1]) {
        const t = tOf(f * W, win, W);
        expect(xOf(t, win, W)).toBeCloseTo(f * W, 6);
      }
      expect(xOf(win[0], win, W)).toBeCloseTo(0, 9);
      expect(xOf(win[1], win, W)).toBeCloseTo(W, 6);
    }
  });

  it('keeps the warp it had for windows in the past', () => {
    const win: [number, number] = [fromMa(320), PRESENT_YEAR];
    const c = 320e6 / 8;
    const old = (t: number) => (W * (Math.log(320e6 + c) - Math.log(PRESENT_YEAR - t + c))) / (Math.log(320e6 + c) - Math.log(c));
    for (const ma of [300, 280, 66, 10, 0.5]) expect(xOf(fromMa(ma), win, W)).toBeCloseTo(old(fromMa(ma)), 6);
  });

  it('gives the past and the future room on either side of the present', () => {
    const win: [number, number] = [fromMa(4600), PRESENT_YEAR + 4.6e9];
    expect(xOf(PRESENT_YEAR, win, W)).toBeCloseTo(W / 2, 6);
    // Logarithmic: the last 300 Myr take far more of the strip than a linear scale's 3%.
    expect(xOf(PRESENT_YEAR, win, W) - xOf(fromMa(300), win, W)).toBeGreaterThan(0.15 * W);
  });

  it('zooms about a point, keeping it where it was on the strip', () => {
    const limits: [number, number] = [fromMa(4900), PRESENT_YEAR + 5.3e9];
    for (const tp of [fromMa(66), fromMa(2400), PRESENT_YEAR + 1e9]) {
      const s = xOf(tp, limits, W) / W;
      const win = zoomAround(limits, tp, s, 4, limits);
      expect(xOf(tp, win, W) / W).toBeCloseTo(s, 4);
      expect(win[1] - win[0]).toBeCloseTo((limits[1] - limits[0]) / 4, -3);
    }
  });
});
