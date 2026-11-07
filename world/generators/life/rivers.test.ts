// A scene's rivers: bends of the shape and size the laws give, the same river however much of it a scene sees, the
// pattern its slope and flow call for, and oxbows off the channel.
import { describe, expect, it } from 'vitest';
import { braids, channel, drawRiver, fall, Guide, lengths, meanders, meet, sineCurve, type ChannelLaws, type RiverChoices, type RiverPath } from './rivers.ts';

// The values of field:earth/rivers and of gen:life/scene's `rivers`.
const LAWS: ChannelLaws = { width: [7.2, 0.5], depth: [0.27, 0.3], wavelength_widths: [7, 12], radius_widths: [2, 3], braided_cfs: [0.06, -0.44], sinuosity_least: 1.5, sinuosity_most: 2.2, deflection_most: 2.2 };
const C: RiverChoices = { step: [8, 4], detail: 3, steep: 0.02, floodplain: 6, wall: 1500, braid_bed: 4, older: 2, oxbow_share: 0.5, neck: 1.5, cutoff_swing: 0.93, vary: 0.25, skew: 0.12, smooth: 2000 };

const straight = (length: number) => new Guide([0, 0, length, 0]);
const distanceTo = (xy: Float64Array, x: number, y: number) => {
  let d = Infinity;
  for (let i = 0; i + 3 < xy.length; i += 2) {
    const ax = xy[i];
    const ay = xy[i + 1];
    const dx = xy[i + 2] - ax;
    const dy = xy[i + 3] - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    d = Math.min(d, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  return d;
};

describe("a scene's rivers", () => {
  it('winds by the sine-generated curve, as long as its sinuosity says', () => {
    for (const k of [1.3, 1.5, 2.0]) {
      const omega = LAWS.deflection_most * Math.sqrt((k - 1) / k);
      const curve = sineCurve(omega, 0);
      // Langbein & Leopold's ω = 2.2 √((k − 1)/k) gives about the sinuosity it is asked for.
      expect(1 / curve.down).toBeGreaterThan(k * 0.9);
      expect(1 / curve.down).toBeLessThan(k * 1.1);
    }
  });

  it('repeats its bends a wavelength apart, and is the same river however much of it is drawn', () => {
    const g = straight(40000);
    const omega = LAWS.deflection_most * Math.sqrt(0.5 / 1.5);
    const a = meanders(g, 12345, 0, 0, 30000, 1000, omega, C, 10);
    const b = meanders(g, 12345, 0, 10000, 40000, 1000, omega, C, 10);
    // Where both are drawn, they are the same line.
    for (let i = 0; i < b.length; i += 2) if (b[i] > 12000 && b[i] < 28000) expect(distanceTo(a, b[i], b[i + 1])).toBeLessThan(1);
    // As long as the path is over the valley, about its sinuosity.
    const at = lengths(a);
    expect(at[at.length - 1] / (a[a.length - 2] - a[0])).toBeGreaterThan(1.25);
    // Crossings of the valley's line: two to a wavelength.
    let crossings = 0;
    for (let i = 3; i < a.length; i += 2) if (Math.sign(a[i]) !== Math.sign(a[i - 2]) && a[i - 3] > 2000 && a[i - 3] < 28000) crossings++;
    expect(crossings / 26).toBeGreaterThan(1.6);
    expect(crossings / 26).toBeLessThan(2.4);
  });

  it('draws its channel by the laws, and braids, winds or runs straight as its slope and flow say', () => {
    expect(channel(300, LAWS).width).toBeCloseTo(7.2 * Math.sqrt(300), 6);
    expect(braids(1000, 0.002, LAWS)).toBe(true);
    expect(braids(1000, 0.0002, LAWS)).toBe(false);
    const course = { key: 'test#1', from: 'model' as const, xy: [-30000, 0, 0, 0, 30000, 0], s0: 0, q: [300, 300, 300] };
    const flat = drawRiver({ ...course, z: [30, 20, 10] }, LAWS, C, () => 0, 20000);
    expect(flat.path.pattern).toBe('meandering');
    expect(flat.path.half[0] * 2).toBeCloseTo(7.2 * Math.sqrt(300), 0);
    // Its water never rises downstream.
    for (let i = 1; i < flat.path.z.length; i++) expect(flat.path.z[i]).toBeLessThanOrEqual(flat.path.z[i - 1]);
    const steep = drawRiver({ ...course, z: [2400, 1200, 0] }, LAWS, C, () => 0, 20000);
    expect(steep.path.pattern).toBe('steep');
    const braided = drawRiver({ ...course, q: [3000, 3000, 3000], z: [100, 50, 0] }, LAWS, C, () => 0, 20000);
    expect(braided.path.pattern).toBe('braided');
  });

  it('lets its water fall gently downstream, never rising, where the ground under it steps', () => {
    const z = Float32Array.from([30, 30, 31, 30, 20, 20, 21, 20, 20, 10, 10, 10]);
    fall(z, 2);
    for (let i = 1; i < z.length; i++) expect(z[i]).toBeLessThanOrEqual(z[i - 1]);
    // No drop between neighbours is as sudden as the ground's ten metres.
    for (let i = 1; i < z.length; i++) expect(z[i - 1] - z[i]).toBeLessThan(5);
  });

  it('brings a river that runs into another to the other\'s water, and draws it only to the other\'s bank', () => {
    // A main river along y = 0, 400 m wide, its water at 10 m; a tributary from the north, its water at 14 m, ending on the main's line.
    const line = (pts: number[][]) => Float64Array.from(pts.flat());
    const main: RiverPath = { key: 'main', pattern: 'meandering', xy: line(Array.from({ length: 41 }, (_, i) => [i * 100 - 2000, 0])), z: new Float32Array(41).fill(10), half: new Float32Array(41).fill(200), depth: new Float32Array(41).fill(4), q: new Float32Array(41).fill(3000), plain: 3000 };
    const trib: RiverPath = { key: 'trib', pattern: 'meandering', xy: line(Array.from({ length: 41 }, (_, i) => [0, 4000 - i * 100])), z: new Float32Array(41).fill(14), half: new Float32Array(41).fill(30), depth: new Float32Array(41).fill(1), q: new Float32Array(41).fill(60), plain: 600 };
    meet([main, trib], 2000);
    expect(trib.z[40]).toBeCloseTo(10, 3);
    expect(trib.z[0]).toBeCloseTo(14, 3);
    for (let i = 1; i < 41; i++) expect(trib.z[i]).toBeLessThanOrEqual(trib.z[i - 1]);
    // Its last points, inside the main's channel, are not drawn.
    expect(trib.end).toBeLessThan(41);
    expect(trib.xy[(trib.end! - 1) * 2 + 1]).toBeGreaterThanOrEqual(200);
    expect(main.end).toBeUndefined();
  });

  it('leaves oxbows on the floodplain, off the channel', () => {
    const r = drawRiver({ key: 'test#2', from: 'model', xy: [-30000, 0, 0, 0, 30000, 0], s0: 0, q: [400, 400, 400], z: [12, 10, 8] }, LAWS, C, () => 0, 20000);
    expect(r.oxbows.length).toBeGreaterThan(0);
    const w = r.path.half[0] * 2;
    for (const o of r.oxbows) {
      expect(distanceTo(r.path.xy, o.xy[0], o.xy[1])).toBeLessThan(r.path.plain);
      // Its body is off the channel; its ends may lie against it, where the neck was cut.
      if (o.key.includes('#old')) {
        const at = lengths(o.xy);
        const end = at[at.length - 1];
        for (let i = 0; i < o.xy.length; i += 6) if (at[i / 2] > w * 2 && end - at[i / 2] > w * 2) expect(distanceTo(r.path.xy, o.xy[i], o.xy[i + 1])).toBeGreaterThan(w);
      }
    }
  });
});
