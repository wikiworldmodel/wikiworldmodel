// A scene's rivers, from the courses the world gives (docs/slices/EIGHTH-SLICE.md): a measured centreline, or a reach of the
// drainage model, drawn with the channel the laws of rivers give it, and with the detail finer than its course is known
// to: the bends of a meandering river (Langbein & Leopold's sine-generated curve, a wavelength of 7 to 12 widths), the
// loops of its older courses left as oxbow lakes, the threads of a braided one. Every invented thing is keyed by the
// reach and the distance along it, never by the scene, so two scenes that see the same reach draw the same river.
import type { ChannelLaws, SceneRiver } from '../../../core/scene.ts';
import { hash2, hashString } from '../city/math.ts';

export type { ChannelLaws, SceneRiver };

/** The generator's own choices of how a river is drawn (gen:life/scene's `rivers`). */
export interface RiverChoices {
  /** how finely a course is followed: points this far apart, m, at least, and in widths */
  step: [number, number];
  /** bends are added where a wavelength is shorter than this many times the spacing of the course's points */
  detail: number;
  /** a river steeper than this is a mountain stream: barely winding, with no floodplain */
  steep: number;
  /** how far a floodplain reaches beyond the bends, in widths; and how wide valley walls are, m */
  floodplain: number;
  wall: number;
  /** a braided river's bed, in widths of its flow: wide and shallow */
  braid_bed: number;
  /** how many older courses leave oxbows, and the share of their loops that do */
  older: number;
  oxbow_share: number;
  /** a loop is cut off where its neck narrows to this many widths; an older course swings this share of the most a bend can */
  neck: number;
  cutoff_swing: number;
  /** how much the size of each bend varies, as a share, and the third harmonic that squares off its apex */
  vary: number;
  skew: number;
  /** how far along a river its water's height is smoothed, m */
  smooth: number;
}

export type Pattern = 'meandering' | 'braided' | 'steep';

/** A river as drawn: its path, finely, and its channel at each point. */
export interface RiverPath {
  key: string;
  pattern: Pattern;
  /** flat [x, y, …], upstream first, about `step` apart */
  xy: Float64Array;
  /** the water's height at each point, m above the coast */
  z: Float32Array;
  /** the channel's half width and depth, m, and the flow, m³/s */
  half: Float32Array;
  depth: Float32Array;
  q: Float32Array;
  /** how far the floodplain reaches either side of the course it follows, m */
  plain: number;
  /** where its water is drawn to: short of its last point where it runs into another river's channel */
  end?: number;
}

/**
 * Where a river runs into another, its water comes to the other's height at the meeting, over the last stretch of
 * `blend` metres, and it is not drawn inside the other's channel. In place.
 */
export function meet(paths: RiverPath[], blend: number): void {
  for (const a of paths) {
    const n = a.xy.length / 2;
    if (n < 2) continue;
    const ex = a.xy[n * 2 - 2];
    const ey = a.xy[n * 2 - 1];
    let into: RiverPath | undefined;
    let j = 0;
    let best = Infinity;
    for (const b of paths) {
      if (b === a) continue;
      for (let k = 0; k < b.xy.length; k += 2) {
        const d = Math.hypot(b.xy[k] - ex, b.xy[k + 1] - ey);
        if (d < best) {
          best = d;
          into = b;
          j = k / 2;
        }
      }
    }
    if (!into || best > into.half[j] + a.half[n - 1] + 60) continue;
    // Its water down (or up) to the other's at the meeting, over the last stretch.
    const at = lengths(a.xy);
    const shift = into.z[j] - a.z[n - 1];
    for (let i = 0; i < n; i++) {
      const t = 1 - (at[n - 1] - at[i]) / blend;
      if (t > 0) a.z[i] += shift * t * t * (3 - 2 * t);
    }
    for (let i = 1; i < n; i++) if (a.z[i] > a.z[i - 1]) a.z[i] = a.z[i - 1];
    // Drawn only to the other's bank.
    let end = n;
    while (end > 1) {
      const x = a.xy[end * 2 - 2];
      const y = a.xy[end * 2 - 1];
      let inside = false;
      for (let k = Math.max(0, j - 200); k < Math.min(into.xy.length / 2, j + 200); k++) {
        if (Math.hypot(into.xy[k * 2] - x, into.xy[k * 2 + 1] - y) < into.half[k]) {
          inside = true;
          break;
        }
      }
      if (!inside) break;
      end--;
    }
    a.end = end;
  }
}

export interface Oxbow {
  key: string;
  xy: Float64Array;
  half: number;
  z: number;
}

const CFS = 35.3147;
const TAU = Math.PI * 2;

/** The width and depth of a channel for a flow, m. */
export function channel(q: number, laws: ChannelLaws): { width: number; depth: number } {
  const f = Math.max(q, 0.01);
  return { width: laws.width[0] * Math.pow(f, laws.width[1]), depth: laws.depth[0] * Math.pow(f, laws.depth[1]) };
}

/** The flow a measured width implies, by the width law turned round. */
export const flowOfWidth = (w: number, laws: ChannelLaws) => Math.pow(w / laws.width[0], 1 / laws.width[1]);

/** Whether a channel of a flow at a slope braids (Leopold & Wolman's line, which reads its flow in cubic feet a second). */
export const braids = (q: number, slope: number, laws: ChannelLaws) => slope > laws.braided_cfs[0] * Math.pow(Math.max(q, 0.01) * CFS, laws.braided_cfs[1]);

/** A line smoothed by corner cutting, its ends kept. */
export function chaikin(xy: ArrayLike<number>, rounds: number): number[] {
  let p = Array.from(xy);
  for (let r = 0; r < rounds && p.length >= 6; r++) {
    const out = [p[0], p[1]];
    for (let i = 0; i + 3 < p.length; i += 2) {
      out.push(0.75 * p[i] + 0.25 * p[i + 2], 0.75 * p[i + 1] + 0.25 * p[i + 3], 0.25 * p[i] + 0.75 * p[i + 2], 0.25 * p[i + 1] + 0.75 * p[i + 3]);
    }
    out.push(p[p.length - 2], p[p.length - 1]);
    p = out;
  }
  return p;
}

/** A line's length at each of its points. */
export function lengths(xy: ArrayLike<number>): Float64Array {
  const n = xy.length / 2;
  const out = new Float64Array(n);
  for (let i = 1; i < n; i++) out[i] = out[i - 1] + Math.hypot(xy[i * 2] - xy[i * 2 - 2], xy[i * 2 + 1] - xy[i * 2 - 1]);
  return out;
}

/** A line read at a distance along it: its point and its unit direction there. */
export class Guide {
  readonly at: Float64Array;
  readonly length: number;
  constructor(readonly xy: ArrayLike<number>) {
    this.at = lengths(xy);
    this.length = this.at[this.at.length - 1];
  }
  /** the segment a distance falls in, and how far along it */
  private find(s: number): [number, number] {
    const a = this.at;
    let lo = 0;
    let hi = a.length - 1;
    if (s <= 0) return [0, 0];
    if (s >= a[hi]) return [Math.max(0, hi - 1), 1];
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (a[m] <= s) lo = m;
      else hi = m;
    }
    const d = a[hi] - a[lo];
    return [lo, d > 0 ? (s - a[lo]) / d : 0];
  }
  /** the point at a distance along the line, and its direction there; past either end the line goes on straight */
  point(s: number): [number, number, number, number] {
    const [i, t] = this.find(Math.max(0, Math.min(this.length, s)));
    const p = this.xy;
    const dx = p[i * 2 + 2] - p[i * 2];
    const dy = p[i * 2 + 3] - p[i * 2 + 1];
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const over = s < 0 ? s : s > this.length ? s - this.length : 0;
    return [p[i * 2] + dx * t + ux * over, p[i * 2 + 1] + dy * t + uy * over, ux, uy];
  }
  /** a value given at each point of the line, read straight between them */
  value(v: ArrayLike<number>, s: number): number {
    const [i, t] = this.find(s);
    return v[i] + (v[Math.min(v.length - 1, i + 1)] - v[i]) * t;
  }
}

/**
 * One period of a sine-generated curve (Langbein & Leopold 1966): its heading swings as ω sin(2πs/M), here with a
 * little of the third harmonic. Tabulated as the distance down the valley and across it at each step along the path,
 * for a path of unit length per period; the valley length one period covers is `down`.
 */
export function sineCurve(omega: number, skew: number, n = 256): { x: Float64Array; y: Float64Array; down: number } {
  const x = new Float64Array(n + 1);
  const y = new Float64Array(n + 1);
  const ds = 1 / n;
  let px = 0;
  let py = 0;
  for (let i = 1; i <= n; i++) {
    const psi = (TAU * (i - 0.5)) / n;
    const h = omega * (Math.sin(psi) + skew * Math.sin(3 * psi));
    px += Math.cos(h) * ds;
    py += Math.sin(h) * ds;
    x[i] = px;
    y[i] = py;
  }
  // Centre it across the valley: a full period comes back to where it began.
  let mean = 0;
  for (let i = 0; i <= n; i++) mean += y[i];
  mean /= n + 1;
  for (let i = 0; i <= n; i++) y[i] -= mean;
  return { x, y, down: x[n] };
}

/** A fraction from a key and numbers: 0–1, the same everywhere. */
const unit = (key: number, a: number, b: number) => hash2(a, b, key);

/**
 * The bends of a meandering river along a guide, from distance `from` to `to` along it: points `step` apart along the
 * path. Each period of the curve has its own size and swing, varied about the river's, keyed by the reach and the
 * period's number, so any stretch of it is the same however it is reached. `phase` shifts it: an older course.
 */
export function meanders(g: Guide, keyOf: number, s0: number, from: number, to: number, wavelength: number, omega: number, c: RiverChoices, step: number, phase = 0): Float64Array {
  const out: number[] = [];
  const curve = sineCurve(omega, c.skew);
  const sinuosity = 1 / curve.down;
  const n = curve.x.length - 1;
  // The valley length of each period, and its path length: k times as long.
  const first = Math.floor((s0 + from) / wavelength + phase) - 1;
  const last = Math.ceil((s0 + to) / wavelength + phase) + 1;
  for (let p = first; p <= last; p++) {
    // Each bend a little bigger or smaller than the river's, across the valley.
    const size = 1 + c.vary * (unit(keyOf, p, 17) - 0.5) * 2;
    const start = (p - phase) * wavelength - s0;
    const across = (wavelength / curve.down) * size;
    const along = wavelength / curve.down;
    const count = Math.max(2, Math.round((wavelength * sinuosity * size) / step));
    for (let i = 0; i < count; i++) {
      const f = (i / count) * n;
      const j = Math.floor(f);
      const t = f - j;
      const x = curve.x[j] + (curve.x[Math.min(n, j + 1)] - curve.x[j]) * t;
      const y = curve.y[j] + (curve.y[Math.min(n, j + 1)] - curve.y[j]) * t;
      const s = start + x * along;
      if (s < from - wavelength || s > to + wavelength) continue;
      const [gx, gy, dx, dy] = g.point(s);
      out.push(gx - dy * y * across, gy + dx * y * across);
    }
  }
  return Float64Array.from(out);
}

/**
 * A profile made to fall: the nearest that never rises (pool-adjacent-violators), then a running mean over `window`
 * points either side, which keeps it falling and spreads a sudden step over the window. In place.
 */
export function fall(z: Float32Array, window: number): void {
  const mean: number[] = [];
  const size: number[] = [];
  for (const v of z) {
    mean.push(v);
    size.push(1);
    while (mean.length > 1 && mean[mean.length - 1] > mean[mean.length - 2]) {
      const m = mean.pop()!;
      const k = size.pop()!;
      const j = mean.length - 1;
      mean[j] = (mean[j] * size[j] + m * k) / (size[j] + k);
      size[j] += k;
    }
  }
  let at = 0;
  mean.forEach((m, b) => {
    for (let k = 0; k < size[b]; k++) z[at++] = m;
  });
  if (window < 1 || z.length < 3) return;
  const sum = new Float64Array(z.length + 1);
  for (let i = 0; i < z.length; i++) sum[i + 1] = sum[i] + z[i];
  const out = new Float32Array(z.length);
  for (let i = 0; i < z.length; i++) {
    const a = Math.max(0, i - window);
    const b = Math.min(z.length - 1, i + window);
    out[i] = (sum[b + 1] - sum[a]) / (b - a + 1);
  }
  for (let i = 1; i < out.length; i++) if (out[i] > out[i - 1]) out[i] = out[i - 1];
  z.set(out);
}

/** A path with loops whose necks narrow below `neck` cut off at them: the path that is left, and the loops. */
export function cutOff(xy: Float64Array, neck: number, least: number): { path: Float64Array; loops: Float64Array[] } {
  const n = xy.length / 2;
  const at = lengths(xy);
  const keep: number[] = [];
  const loops: Float64Array[] = [];
  let i = 0;
  while (i < n) {
    keep.push(i);
    let cut = -1;
    // The farthest point within reach of this one along the path, beyond the shortest loop, that comes back near it.
    for (let j = i + 2; j < n && at[j] - at[i] < least * 6; j++) {
      if (at[j] - at[i] < least) continue;
      if (Math.hypot(xy[j * 2] - xy[i * 2], xy[j * 2 + 1] - xy[i * 2 + 1]) < neck) cut = j;
    }
    if (cut > 0) {
      loops.push(xy.slice(i * 2, cut * 2 + 2));
      i = cut;
    } else i++;
  }
  const path = new Float64Array(keep.length * 2);
  keep.forEach((k, m) => {
    path[m * 2] = xy[k * 2];
    path[m * 2 + 1] = xy[k * 2 + 1];
  });
  return { path, loops };
}

/** The nearest point of a path to a point, by brute force over a stride: its index. */
function nearestIndex(xy: Float64Array, x: number, y: number): number {
  let best = 0;
  let d = Infinity;
  for (let i = 0; i < xy.length; i += 2) {
    const e = (xy[i] - x) ** 2 + (xy[i + 1] - y) ** 2;
    if (e < d) {
      d = e;
      best = i / 2;
    }
  }
  return best;
}

/**
 * A river drawn: its course followed or, where its bends are finer than its points, wound into them; its channel from
 * its flow; its water's height falling downstream; and the loops of its older courses, as oxbows.
 */
export function drawRiver(river: SceneRiver, laws: ChannelLaws, c: RiverChoices, heightAt: (x: number, y: number) => number, reach: number): { path: RiverPath; oxbows: Oxbow[] } {
  let r = river;
  const keyOf = hashString(r.key);
  // A course with no heights of its own (a measured one, whose direction its dataset does not give) runs downhill on
  // the ground under it.
  if (!r.z && r.xy.length >= 4) {
    const n = r.xy.length;
    if (heightAt(r.xy[0], r.xy[1]) < heightAt(r.xy[n - 2], r.xy[n - 1])) {
      const xy: number[] = [];
      for (let i = n - 2; i >= 0; i -= 2) xy.push(r.xy[i], r.xy[i + 1]);
      r = { ...r, xy, ...(r.width ? { width: [...r.width].reverse() } : {}), ...(r.q ? { q: [...r.q].reverse() } : {}) };
    }
  }
  const coarse = r.xy;
  const pts = coarse.length / 2;
  const spacing = pts > 1 ? lengths(coarse)[pts - 1] / (pts - 1) : 1;
  // The guide: the course smoothed, more where it is coarse.
  const guide = new Guide(chaikin(coarse, r.from === 'model' ? 4 : 2));
  const raw = new Guide(coarse);
  // Its flow and width, at the middle of what the scene sees.
  const widthAt = (s: number) => (r.width ? raw.value(r.width, Math.min(raw.length, s)) : undefined);
  const qAt = (s: number) => (r.q ? raw.value(r.q, Math.min(raw.length, s)) : flowOfWidth(widthAt(s) ?? 30, laws));
  const mid = guide.length / 2;
  const q = qAt(mid);
  const w = widthAt(mid) ?? channel(q, laws).width;
  // The water's height: given, or the ground's under the course; then never rising downstream.
  const zAt = (s: number) => (r.z ? raw.value(r.z, Math.min(raw.length, s)) : (() => {
    const [x, y] = guide.point(s);
    return heightAt(x, y);
  })());
  const step = Math.max(c.step[0], w / c.step[1]);
  const slope = (zAt(0) - zAt(guide.length)) / Math.max(1, guide.length);
  const pattern: Pattern = slope > c.steep ? 'steep' : braids(q, Math.max(0, slope), laws) ? 'braided' : 'meandering';
  const range = (a: number, b: number) => Math.round((a + (b - a) * unit(keyOf, 1, 3)) * 1000) / 1000;
  const wavelength = w * range(laws.wavelength_widths[0], laws.wavelength_widths[1]);
  const sinuosity = pattern === 'meandering' ? range(laws.sinuosity_least, laws.sinuosity_most) : 1.06;
  // Only what the course is too coarse to show is wound in.
  const wind = pattern !== 'steep' && wavelength < c.detail * spacing;
  // What the scene sees of it, and a wavelength either side.
  let from = 0;
  let to = guide.length;
  for (let s = 0; s <= guide.length; s += step * 4) {
    const [x, y] = guide.point(s);
    if (Math.hypot(x, y) < reach) {
      from = Math.max(0, s - reach * 0.1);
      break;
    }
  }
  for (let s = guide.length; s >= 0; s -= step * 4) {
    const [x, y] = guide.point(s);
    if (Math.hypot(x, y) < reach) {
      to = Math.min(guide.length, s + reach * 0.1);
      break;
    }
  }
  let xy: Float64Array;
  const oxbows: Oxbow[] = [];
  const guidePoints = Float64Array.from(guide.xy as ArrayLike<number>);
  // How far its oxbows reach from the course it follows: the floodplain takes them in.
  let widest = 0;
  if (wind) {
    const omega = laws.deflection_most * Math.sqrt((sinuosity - 1) / sinuosity);
    const wound = meanders(guide, keyOf, r.s0, from, to, wavelength, omega, c, step);
    const cut = cutOff(wound, c.neck * w, wavelength * 1.2);
    xy = cut.path;
    for (const loop of cut.loops) oxbows.push({ key: `${r.key}#cut`, xy: loop, half: w * 0.4, z: 0 });
    // The older courses: the same river's bends, shifted, of which a share of the loops are left as oxbows.
    if (pattern === 'meandering') {
      const belt = (wavelength * sinuosity) / 4;
      for (let o = 1; o <= c.older; o++) {
        // Bends that had swung to the point of cutting off, near the most a bend can before its limbs meet, of a river
        // that wound a little tighter then; each loop left on the side it bulged to, beyond the belt the river winds in now.
        const older = meanders(guide, keyOf + o * 7919, r.s0, from, to, wavelength * 0.7, laws.deflection_most * c.cutoff_swing, { ...c, vary: c.vary * 1.4 }, step, unit(keyOf, o, 41));
        const cutOld = cutOff(older, c.neck * w * 2, wavelength * 0.7 * 1.1);
        cutOld.loops.forEach((raw, m) => {
          if (unit(keyOf + o, m, 53) > c.oxbow_share) return;
          let cx = 0;
          let cy = 0;
          for (let i = 0; i < raw.length; i += 2) {
            cx += raw[i];
            cy += raw[i + 1];
          }
          cx /= raw.length / 2;
          cy /= raw.length / 2;
          const gi = nearestIndex(guidePoints, cx, cy);
          const [gx, gy, dx, dy] = guide.point(guide.at[gi]);
          const side = Math.sign((cx - gx) * -dy + (cy - gy) * dx) || 1;
          const shift = side * (belt + w);
          const loop = raw.map((v, i) => v + (i % 2 ? dx : -dy) * shift);
          const at = lengths(loop);
          const end = at[at.length - 1];
          for (let i = 0; i < loop.length; i += 4) {
            const [px, py] = [loop[i], loop[i + 1]];
            const gk = nearestIndex(guidePoints, px, py);
            widest = Math.max(widest, Math.hypot(guide.xy[gk * 2] - px, guide.xy[gk * 2 + 1] - py));
            if (at[i / 2] < w * 2 || end - at[i / 2] < w * 2) continue;
            const k = nearestIndex(xy, px, py);
            if (Math.hypot(xy[k * 2] - px, xy[k * 2 + 1] - py) < w * 1.2) return;
          }
          oxbows.push({ key: `${r.key}#old${o}.${m}`, xy: loop, half: w * 0.4, z: 0 });
        });
      }
    }
  } else {
    // Followed as it is, finely.
    const pts2: number[] = [];
    for (let s = from; s <= to; s += step) {
      const [x, y] = guide.point(s);
      pts2.push(x, y);
    }
    xy = Float64Array.from(pts2);
  }
  // Each point's place along the guide, to read the flow and the water's height there.
  const n = xy.length / 2;
  const sOf = new Float64Array(n);
  {
    let j = 0;
    const at = guide.at;
    for (let i = 0; i < n; i++) {
      // The guide's points are many more than a bend: search forward from the last match.
      let best = j;
      let d = Infinity;
      // The first point is looked for along the whole guide; each after it near where the last was found.
      for (let k = i ? Math.max(0, j - 40) : 0; k < (i ? Math.min(at.length, j + 400) : at.length); k++) {
        const e = (guide.xy[k * 2] - xy[i * 2]) ** 2 + (guide.xy[k * 2 + 1] - xy[i * 2 + 1]) ** 2;
        if (e < d) {
          d = e;
          best = k;
        }
      }
      j = best;
      sOf[i] = at[best];
    }
  }
  const z = new Float32Array(n);
  const half = new Float32Array(n);
  const depth = new Float32Array(n);
  const qs = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const qi = qAt(sOf[i]);
    const wi = widthAt(sOf[i]);
    const ch = wi ? { width: wi, depth: channel(flowOfWidth(wi, laws), laws).depth } : channel(qi, laws);
    z[i] = zAt(sOf[i]);
    half[i] = (ch.width * (pattern === 'braided' ? c.braid_bed : 1)) / 2;
    depth[i] = pattern === 'braided' ? ch.depth * 0.5 : ch.depth;
    qs[i] = qi;
  }
  // The water's height: the profile nearest the ground's that never rises downstream, smoothed over a couple of km, so
  // that a low cell of the coarse ground does not drop the river all at once.
  fall(z, Math.max(1, Math.round(c.smooth / step)));
  for (const o of oxbows) {
    const k = nearestIndex(xy, o.xy[0], o.xy[1]);
    o.z = z[k] - 0.4;
  }
  const amplitude = wind ? (wavelength * sinuosity) / 4 : 0;
  const plain = pattern === 'steep' ? w : Math.max(amplitude + c.floodplain * w, oxbows.length ? widest + 2 * w : 0);
  return { path: { key: r.key, pattern, xy, z, half, depth, q: qs, plain }, oxbows };
}
