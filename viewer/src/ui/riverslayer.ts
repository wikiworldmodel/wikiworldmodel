// The rivers and lakes of the time shown, over the globe (field:earth/rivers, field:earth/lakes; core/rivers.ts): the
// network of the set whose span holds the time, at its keyframe nearest the time. Each reach is a line through its
// nodes, broken where the sea or a lake of the keyframe covers one and where the far side hides one; each lake is its
// cells, filled. From far off only the great rivers are drawn, and more as the camera comes down, each as wide as the
// log of its flow says, the greatest of the time widest. A set on today's ground is carried to the time shown with its
// plates, as the land under it is. Close by, the rivers Landsat saw are drawn over the model's, each at its own width:
// evidence at the present, and before it held back on today's ground, as a model, where the sea and the lakes of the
// time leave today's land.
import { EARTH_RADIUS } from '../../../core/city.ts';
import { conj, IDENTITY, mul, rotate, toLatLon, unitVector, type Quat } from '../../../core/quat.ts';
import type { RiverKey, RiverNet, RiverWidths } from '../../../core/rivers.ts';
import type { RotationModel } from '../../../core/rotation-model.ts';
import { toMa } from '../../../core/time.ts';
import { MIN_DIST, type Camera } from '../camera.ts';
import type { Rivers } from '../rivers.ts';

const RAD = Math.PI / 180;

/** The toggle the layer waits for, as a field's does: its key is kept in the link's `ly=`. */
export const RIVERS_TOGGLE = { key: 'rv', label: 'Rivers' };

/** The model's reaches are drawn in so many widths, each one stroke, from the thinnest to the widest, in pixels. */
const CLASSES = 8;
const THINNEST = 0.6;
const WIDEST = 3.5;
/** A lake's cells are filled in strips of at most this many along a row, so that a strip's edges keep to the globe. */
const STRIP = 8;
/** The blue of the model's water, and of the rivers Landsat saw while they are evidence (--evidence, viewer/src/tokens.css). */
const WATER = '62, 150, 235';
const SEEN = '127, 209, 255';
/** The rivers Landsat saw come in from so many metres a pixel, and are wholly there at half of it. */
const SEEN_FROM = 2000;
/** A node of today's ground this near a segment Landsat saw is under it: its sea and its lakes are the segment's. */
const OWN = Math.cos(0.2 * RAD);

/**
 * The least flow a reach is drawn with, m³/s, for a camera `dist` radii from the centre: a hundred at the closest the
 * globe comes, and as its height to the power 1.5 above that, so about 3,000 at the first view and 15,000 from furthest
 * out. From far off only the great rivers are seen.
 */
export const minFlow = (dist: number): number => 100 * (Math.max(0, dist - 1) / (MIN_DIST - 1)) ** 1.5;

/** What the layer drew in the last frame. */
export interface RiversDrawn {
  /** the network of the set drawn, and the age of its keyframe */
  set?: string;
  ageMa?: number;
  /** how many reaches, lakes and segments Landsat saw were drawn */
  drawn: number;
  lakes: number;
  observed: number;
  /** how long the layer took over the frame, ms */
  ms: number;
}

/** A reach drawn near a place: its flow where it ends, m³/s, its order, and its nodes there, where they are drawn, with their height in the grid's metres. */
export interface RiverNear {
  q: number;
  order: number;
  nodes: { lat: number; lon: number; z: number }[];
}

/** A network, ready to draw. */
interface NetDraw {
  net: RiverNet;
  /** each node as a unit vector, on the coordinates of the network's own age */
  xyz: Float32Array;
  /** each reach's cap: the unit vector at its middle, and the angle from it to its furthest node */
  cap: Float32Array;
  /** the plates its reaches ride, once each */
  plates: number[];
  /** the age its nodes are carried to; a count that moves on with it; each plate's rotation there; whether any moved */
  age: number;
  gen: number;
  turns: Map<number, Quat>;
  moved: boolean;
  /** the greatest angle any plate turned, radians: no place moved further, so a cap of its own coordinates widened by it holds the carried */
  pad: number;
  /** its nodes carried, a reach's when it is drawn, each reach stamped with the count it was carried at */
  now: Float32Array;
  stamp: Int32Array;
  /** for the node nearest a place: the nodes in each cell of a degree, and each node's reach */
  cells?: { first: Uint32Array; list: Uint32Array; reachOf: Uint32Array };
}

/** A lake of a keyframe, ready to draw. */
interface LakeDraw {
  /** its strips of cells, four corners each (north-west, north-east, south-east, south-west), as unit vectors on the network's coordinates */
  quads: Float32Array;
  /** its strips carried, and the count they were carried at */
  now: Float32Array;
  gen: number;
  cap: Float32Array;
  cells: number;
  /** the plate it rides, that of the network's node nearest it: −1 until it is wanted, 0 for none */
  plate: number;
}

/** A keyframe, ready to draw: the reaches with water, the greatest flow first, the greatest flow, and the lakes. */
interface KeyDraw {
  byFlow: Uint32Array;
  top: number;
  lakes: LakeDraw[];
}

/** The rivers Landsat saw, ready to draw. */
interface SeenDraw {
  w: RiverWidths;
  /** each point as a unit vector, and each segment's cap */
  xyz: Float32Array;
  cap: Float32Array;
  /** the network of today's ground the nearest nodes are of; each segment's nearest node (−2 until asked, −1 for none), and whether it is under the segment */
  of?: NetDraw;
  near: Int32Array;
  own: Uint8Array;
  /** its points carried, each segment stamped with the count it was carried at */
  now: Float32Array;
  stamp: Int32Array;
}

function fit(c: HTMLCanvasElement, width: number, height: number): CanvasRenderingContext2D {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (c.width !== Math.round(width * dpr) || c.height !== Math.round(height * dpr)) {
    c.width = Math.round(width * dpr);
    c.height = Math.round(height * dpr);
  }
  const g = c.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, width, height);
  return g;
}

/** The cap around unit vectors `from` to `to`: their mean, made a unit vector, and the angle from it to the furthest. */
function capOf(xyz: Float32Array, from: number, to: number, out: Float32Array, at: number): void {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let j = from; j < to; j++) {
    x += xyz[j * 3];
    y += xyz[j * 3 + 1];
    z += xyz[j * 3 + 2];
  }
  const l = Math.hypot(x, y, z) || 1;
  x /= l;
  y /= l;
  z /= l;
  let least = 1;
  for (let j = from; j < to; j++) least = Math.min(least, x * xyz[j * 3] + y * xyz[j * 3 + 1] + z * xyz[j * 3 + 2]);
  out[at] = x;
  out[at + 1] = y;
  out[at + 2] = z;
  out[at + 3] = Math.acos(Math.max(-1, Math.min(1, least)));
}

/** Unit vectors `from` to `to` of `src` turned by `q` into the same places of `dst`: core/quat.ts's rotate, unrolled. */
function rotateRun(q: Quat, src: Float32Array, dst: Float32Array, from: number, to: number): void {
  const [w, x, y, z] = q;
  for (let j = from; j < to; j++) {
    const vx = src[j * 3];
    const vy = src[j * 3 + 1];
    const vz = src[j * 3 + 2];
    const cx = y * vz - z * vy;
    const cy = z * vx - x * vz;
    const cz = x * vy - y * vx;
    dst[j * 3] = vx + 2 * (w * cx + y * cz - z * cy);
    dst[j * 3 + 1] = vy + 2 * (w * cy + z * cx - x * cz);
    dst[j * 3 + 2] = vz + 2 * (w * cz + x * cy - y * cx);
  }
}

function netDraw(net: RiverNet): NetDraw {
  const { nx, step } = net.grid;
  const n = net.nodes.length;
  const xyz = new Float32Array(n * 3);
  for (let j = 0; j < n; j++) {
    const k = net.nodes[j];
    const lat = (90 - Math.floor(k / nx) * step) * RAD;
    const lon = (-180 + (k % nx) * step) * RAD;
    xyz[j * 3] = Math.cos(lat) * Math.cos(lon);
    xyz[j * 3 + 1] = Math.cos(lat) * Math.sin(lon);
    xyz[j * 3 + 2] = Math.sin(lat);
  }
  const cap = new Float32Array(net.count * 4);
  for (let i = 0; i < net.count; i++) capOf(xyz, net.start[i], net.start[i + 1], cap, i * 4);
  return { net, xyz, cap, plates: net.plate ? [...new Set(net.plate)] : [], age: NaN, gen: 0, turns: new Map(), moved: false, pad: 0, now: new Float32Array(n * 3), stamp: new Int32Array(net.count).fill(-1) };
}

/** The nodes of a network in each cell of a degree, by its own coordinates, and the reach each node is of. */
function cellsOf(d: NetDraw): NonNullable<NetDraw['cells']> {
  const { net } = d;
  const { nx, step } = net.grid;
  const n = net.nodes.length;
  const cellOf = new Uint32Array(n);
  const first = new Uint32Array(360 * 180 + 1);
  for (let j = 0; j < n; j++) {
    const k = net.nodes[j];
    const c = Math.min(179, Math.floor(Math.floor(k / nx) * step)) * 360 + (Math.floor((k % nx) * step) % 360);
    cellOf[j] = c;
    first[c + 1]++;
  }
  for (let c = 0; c < 360 * 180; c++) first[c + 1] += first[c];
  const next = first.slice(0, -1);
  const list = new Uint32Array(n);
  for (let j = 0; j < n; j++) list[next[cellOf[j]]++] = j;
  const reachOf = new Uint32Array(n);
  for (let i = 0; i < net.count; i++) reachOf.fill(i, net.start[i], net.start[i + 1]);
  return { first, list, reachOf };
}

function keyDraw(net: RiverNet, key: RiverKey): KeyDraw {
  const wet: number[] = [];
  let top = 0;
  for (let i = 0; i < net.count; i++) {
    if (!(key.q[i] > 0)) continue;
    wet.push(i);
    top = Math.max(top, key.q[i]);
  }
  const byFlow = Uint32Array.from(wet.sort((a, b) => key.q[b] - key.q[a]));
  // A lake's cells, a strip along each row while they touch: a node is the middle of its cell.
  const { nx, step } = net.grid;
  const h = step / 2;
  const lakes: LakeDraw[] = [];
  for (let l = 0; l + 1 < key.lakeStart.length; l++) {
    const cells = Int32Array.from(key.lakeNodes.subarray(key.lakeStart[l], key.lakeStart[l + 1])).sort();
    const corners: number[] = [];
    for (let a = 0; a < cells.length; ) {
      const row = Math.floor(cells[a] / nx);
      let b = a + 1;
      while (b < cells.length && b - a < STRIP && cells[b] === cells[b - 1] + 1 && Math.floor(cells[b] / nx) === row) b++;
      const lat = 90 - row * step;
      const north = Math.min(90, lat + h);
      const south = Math.max(-90, lat - h);
      const west = -180 + (cells[a] % nx) * step - h;
      const east = -180 + (cells[b - 1] % nx) * step + h;
      corners.push(...unitVector(north, west), ...unitVector(north, east), ...unitVector(south, east), ...unitVector(south, west));
      a = b;
    }
    const quads = Float32Array.from(corners);
    const cap = new Float32Array(4);
    capOf(quads, 0, quads.length / 3, cap, 0);
    lakes.push({ quads, now: new Float32Array(quads.length), gen: -1, cap, cells: cells.length, plate: -1 });
  }
  return { byFlow, top, lakes };
}

function seenDraw(w: RiverWidths): SeenDraw {
  const points = w.xy.length / 2;
  const xyz = new Float32Array(points * 3);
  for (let p = 0; p < points; p++) {
    const lat = w.xy[p * 2 + 1] * RAD;
    const lon = w.xy[p * 2] * RAD;
    xyz[p * 3] = Math.cos(lat) * Math.cos(lon);
    xyz[p * 3 + 1] = Math.cos(lat) * Math.sin(lon);
    xyz[p * 3 + 2] = Math.sin(lat);
  }
  const segments = w.start.length - 1;
  const cap = new Float32Array(segments * 4);
  for (let i = 0; i < segments; i++) capOf(xyz, w.start[i], w.start[i + 1], cap, i * 4);
  return { w, xyz, cap, near: new Int32Array(segments).fill(-2), own: new Uint8Array(segments), now: new Float32Array(points * 3), stamp: new Int32Array(segments).fill(-1) };
}

export class RiversLayer {
  readonly el: HTMLCanvasElement;
  /** what the last frame drew */
  last: RiversDrawn = { drawn: 0, lakes: 0, observed: 0, ms: 0 };
  private nets = new WeakMap<RiverNet, NetDraw>();
  private keys = new WeakMap<RiverKey, KeyDraw>();
  private seen = new WeakMap<RiverWidths, SeenDraw>();
  /** the last frame's network and keyframe, and the reaches and lakes of them it drew, for tests */
  private shown: { d: NetDraw; key: RiverKey; k: KeyDraw; reaches: number[]; lakes: number[] } | null = null;

  constructor(
    private rivers: Rivers,
    private model: RotationModel,
  ) {
    this.el = document.createElement('canvas');
    this.el.className = 'row-layer rivers';
    this.el.hidden = true;
  }

  /** What its toggle says it draws, from the fields' titles. */
  get title(): string {
    const info = this.rivers.info;
    if (!info) return RIVERS_TOGGLE.label;
    const seen = info.observed ? `; close by, ${info.observed.title.charAt(0).toLowerCase()}${info.observed.title.slice(1)}` : '';
    return `${info.title} and ${info.lakes.title.toLowerCase()}: where the drainage model has water run and stand at the time shown, only the great rivers from far off and more as you come down${seen}`;
  }

  /**
   * Carry a network to an age, to the nearest thousand years, in which the plates move some tens of metres: each
   * plate's rotation from the age its nodes are on, and a new count, so that each reach is carried again when drawn.
   */
  private carry(d: NetDraw, ageMa: number): void {
    const age = Math.round(ageMa * 1e3) / 1e3;
    if (age === d.age) return;
    d.age = age;
    d.gen++;
    d.turns.clear();
    d.pad = 0;
    const from = d.net.frameMa;
    d.moved = !!d.net.plate && age !== from;
    if (!d.moved) return;
    // The plate model keeps one age's tree at a time: every plate at the network's own age, then every plate at this.
    const was = d.plates.map((p) => (this.model.reaches(p, from) ? this.model.total(p, from) : null));
    const is = d.plates.map((p) => (this.model.reaches(p, age) ? this.model.total(p, age) : null));
    d.plates.forEach((p, n) => {
      const q = was[n] && is[n] ? mul(is[n]!, conj(was[n]!)) : IDENTITY;
      d.turns.set(p, q);
      d.pad = Math.max(d.pad, 2 * Math.acos(Math.min(1, Math.abs(q[0]))));
    });
  }

  /** A reach's nodes where they are at the age carried to. */
  private nodesOf(d: NetDraw, i: number): Float32Array {
    if (!d.moved) return d.xyz;
    if (d.stamp[i] !== d.gen) {
      rotateRun(d.turns.get(d.net.plate![i]) ?? IDENTITY, d.xyz, d.now, d.net.start[i], d.net.start[i + 1]);
      d.stamp[i] = d.gen;
    }
    return d.now;
  }

  /** The node of a network nearest a place on its own coordinates, among the cells of a degree around it, and the cosine of the angle to it: −1 for none. */
  private nearest(d: NetDraw, x: number, y: number, z: number): [number, number] {
    const c = (d.cells ??= cellsOf(d));
    const [lat, lon] = toLatLon([x, y, z]);
    const row = Math.min(179, Math.max(0, Math.floor(90 - lat)));
    const col = Math.floor(lon + 180);
    let best = -1;
    let most = -2;
    for (let r = Math.max(0, row - 1); r <= Math.min(179, row + 1); r++) {
      for (let k = col - 1; k <= col + 1; k++) {
        const cell = r * 360 + (((k % 360) + 360) % 360);
        for (let n = c.first[cell]; n < c.first[cell + 1]; n++) {
          const j = c.list[n];
          const dot = x * d.xyz[j * 3] + y * d.xyz[j * 3 + 1] + z * d.xyz[j * 3 + 2];
          if (dot > most) {
            most = dot;
            best = j;
          }
        }
      }
    }
    return [best, most];
  }

  /** The rotation of the plate of a network's node, to the age carried to. */
  private turnOfNode(d: NetDraw, j: number): Quat {
    return j >= 0 ? (d.turns.get(d.net.plate![d.cells!.reachOf[j]]) ?? IDENTITY) : IDENTITY;
  }

  /** A lake's strips where they are at the age carried to: on the plate of the network's node nearest it. */
  private lakeNow(d: NetDraw, lake: LakeDraw): Float32Array {
    if (!d.moved) return lake.quads;
    if (lake.gen !== d.gen) {
      if (lake.plate < 0) {
        let [j] = this.nearest(d, lake.cap[0], lake.cap[1], lake.cap[2]);
        if (j < 0) [j] = this.nearest(d, lake.quads[0], lake.quads[1], lake.quads[2]);
        lake.plate = j >= 0 ? d.net.plate![d.cells!.reachOf[j]] : 0;
      }
      rotateRun(d.turns.get(lake.plate) ?? IDENTITY, lake.quads, lake.now, 0, lake.quads.length / 3);
      lake.gen = d.gen;
    }
    return lake.now;
  }

  /** A segment Landsat saw, its node of today's ground found once: the plate that carries it, and the sea and lakes over it. */
  private resolve(s: SeenDraw, d: NetDraw, i: number): void {
    if (s.of !== d) {
      s.of = d;
      s.near.fill(-2);
      s.stamp.fill(-1);
    }
    if (s.near[i] !== -2) return;
    const p = (s.w.start[i] + s.w.start[i + 1]) >> 1;
    const [j, cos] = this.nearest(d, s.xyz[p * 3], s.xyz[p * 3 + 1], s.xyz[p * 3 + 2]);
    s.near[i] = j;
    s.own[i] = cos >= OWN ? 1 : 0;
  }

  /** A segment's points where they are at the age carried to. */
  private seenNow(s: SeenDraw, d: NetDraw, i: number): Float32Array {
    if (!d.moved) return s.xyz;
    if (s.stamp[i] !== d.gen) {
      rotateRun(this.turnOfNode(d, s.near[i]), s.xyz, s.now, s.w.start[i], s.w.start[i + 1]);
      s.stamp[i] = d.gen;
    }
    return s.now;
  }

  /** Draw the rivers and lakes of a time, carried to `ageMa`, the age the globe's land is at. */
  update(camera: Camera, on: boolean, t: number, ageMa: number, dist: number, width: number, height: number): void {
    const started = performance.now();
    this.shown = null;
    this.last = { drawn: 0, lakes: 0, observed: 0, ms: 0 };
    const info = on ? this.rivers.info : undefined;
    const set = info && this.rivers.setAt(t);
    const net = set && this.rivers.net(set);
    const key = set && this.rivers.key(set, toMa(t));
    if (!info || !set || !net || !key) {
      this.el.hidden = true;
      return;
    }
    const d = this.nets.get(net) ?? netDraw(net);
    this.nets.set(net, d);
    const k = this.keys.get(key) ?? keyDraw(net, key);
    this.keys.set(key, k);
    this.carry(d, ageMa);
    const g = fit(this.el, width, height);
    this.el.hidden = false;
    // The view: the point under the camera, how far from it the screen reaches, and the metres a pixel spans at its middle.
    const e = camera.eye;
    const m = camera.viewProj;
    const r = Math.hypot(e[0], e[1], e[2]);
    const ux = e[0] / r;
    const uy = e[1] / r;
    const uz = e[2] / r;
    const sees = camera.reach().sees * RAD;
    const mpp = (Math.max(0, dist - 1) * EARTH_RADIUS * 2) / (height * camera.proj[5]);
    // A cap is of the network's own coordinates: carried, it is wider by as far as any plate took it.
    const inView = (cap: Float32Array, at: number) => ux * cap[at] + uy * cap[at + 1] + uz * cap[at + 2] >= Math.cos(Math.min(Math.PI, sees + cap[at + 3] + d.pad));
    let sx = 0;
    let sy = 0;
    /** Whether the point last projected is on the screen, not only facing it: what is counted as drawn. */
    const onScreen = () => sx >= 0 && sy >= 0 && sx <= width && sy <= height;
    /** Where a point of the globe is on the screen, into sx and sy: false where the far side hides it, or it is behind the camera. */
    const project = (x: number, y: number, z: number): boolean => {
      if (e[0] * x + e[1] * y + e[2] * z <= 1) return false;
      const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
      if (cw <= 0) return false;
      sx = (((m[0] * x + m[4] * y + m[8] * z + m[12]) / cw) * 0.5 + 0.5) * width;
      sy = (0.5 - ((m[1] * x + m[5] * y + m[9] * z + m[13]) / cw) * 0.5) * height;
      return true;
    };

    // The lakes, once a cell is a pixel across.
    const lakes: number[] = [];
    if ((net.grid.step * RAD * EARTH_RADIUS) / mpp >= 1) {
      const path = new Path2D();
      const corner = new Float64Array(8);
      k.lakes.forEach((lake, l) => {
        if (!inView(lake.cap, 0)) return;
        const q = this.lakeNow(d, lake);
        let any = false;
        strips: for (let n = 0; n < q.length; n += 12) {
          let on = false;
          for (let c = 0; c < 4; c++) {
            if (!project(q[n + c * 3], q[n + c * 3 + 1], q[n + c * 3 + 2])) continue strips;
            corner[c * 2] = sx;
            corner[c * 2 + 1] = sy;
            on ||= onScreen();
          }
          // Left open: the fill closes each strip, and a browser may measure the whole path to close one.
          path.moveTo(corner[0], corner[1]);
          path.lineTo(corner[2], corner[3]);
          path.lineTo(corner[4], corner[5]);
          path.lineTo(corner[6], corner[7]);
          any ||= on;
        }
        if (any) lakes.push(l);
      });
      g.fillStyle = `rgba(${WATER}, 0.85)`;
      g.fill(path);
    }

    // The reaches that carry enough, the greatest first: each one stroke of its width's, broken where it is not drawn.
    const least = Math.max(1e-3, minFlow(dist));
    const span = Math.log(Math.max(k.top, least * 1.001) / least);
    const paths = Array.from({ length: CLASSES }, () => new Path2D());
    const reaches: number[] = [];
    for (let n = 0; n < k.byFlow.length; n++) {
      const i = k.byFlow[n];
      const q = key.q[i];
      if (q < least) break;
      if (!inView(d.cap, i * 4)) continue;
      const xyz = this.nodesOf(d, i);
      const path = paths[Math.min(CLASSES - 1, Math.floor((CLASSES * Math.log(q / least)) / span))];
      let open = false;
      let was = false;
      let any = false;
      for (let j = net.start[i]; j < net.start[i + 1]; j++) {
        if (!net.wet(j, key) || !project(xyz[j * 3], xyz[j * 3 + 1], xyz[j * 3 + 2])) {
          open = false;
          continue;
        }
        const on = onScreen();
        if (open) {
          path.lineTo(sx, sy);
          any ||= on || was;
        } else path.moveTo(sx, sy);
        open = true;
        was = on;
      }
      if (any) reaches.push(i);
    }
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (let c = 0; c < CLASSES; c++) {
      g.lineWidth = THINNEST + ((WIDEST - THINNEST) * (c + 0.5)) / CLASSES;
      g.strokeStyle = `rgba(${WATER}, ${(0.6 + (0.25 * c) / (CLASSES - 1)).toFixed(3)})`;
      g.stroke(paths[c]);
    }

    // Close by, the rivers Landsat saw, over the model's, on today's ground: not its lakes, nor a segment with no width.
    let observed = 0;
    const o = info.observed;
    const fade = Math.min(1, Math.max(0, (SEEN_FROM - mpp) / (SEEN_FROM / 2)));
    const widths = o && fade > 0 && set === this.rivers.setAt(o.span[0]) ? this.rivers.observedGlobe() : undefined;
    if (o && widths) {
      const s = this.seen.get(widths) ?? seenDraw(widths);
      this.seen.set(widths, s);
      // Evidence at the present; before it, held back as a model, carried with the plate of its node of today's ground,
      // and not drawn where the sea or a lake of the time covers that node's land.
      const evidence = t >= o.span[0] && t <= o.span[1];
      const strokes = new Map<number, Path2D>();
      for (let i = 0; i + 1 < widths.start.length; i++) {
        if (widths.flag[i] === 1 || !(widths.width[i] > 0) || !inView(s.cap, i * 4)) continue;
        if (!evidence || d.moved) this.resolve(s, d, i);
        const j = s.near[i];
        if (!evidence && j >= 0 && s.own[i] && net.z[j] > 0 && !net.wet(j, key)) continue;
        const xyz = this.seenNow(s, d, i);
        // Its width in pixels, to the nearest half power of two.
        const c = Math.round(2 * Math.log2(Math.max(1, widths.width[i] / mpp)));
        let path = strokes.get(c);
        if (!path) strokes.set(c, (path = new Path2D()));
        let open = false;
        let was = false;
        let any = false;
        for (let p = widths.start[i]; p < widths.start[i + 1]; p++) {
          if (!project(xyz[p * 3], xyz[p * 3 + 1], xyz[p * 3 + 2])) {
            open = false;
            continue;
          }
          const on = onScreen();
          if (open) {
            path.lineTo(sx, sy);
            any ||= on || was;
          } else path.moveTo(sx, sy);
          open = true;
          was = on;
        }
        if (any) observed++;
      }
      g.strokeStyle = `rgba(${evidence ? SEEN : WATER}, ${(0.9 * fade).toFixed(3)})`;
      for (const [c, path] of [...strokes].sort((a, b) => a[0] - b[0])) {
        g.lineWidth = 2 ** (c / 2);
        g.stroke(path);
      }
    }
    this.shown = { d, key, k, reaches, lakes };
    this.last = { set: set.network, ageMa: key.ageMa, drawn: reaches.length, lakes: lakes.length, observed, ms: performance.now() - started };
  }

  /** The reaches the last frame drew that pass within `deg` degrees of a place, as they were drawn. */
  near(lat: number, lon: number, deg: number): RiverNear[] {
    const f = this.shown;
    if (!f) return [];
    const { net } = f.d;
    const [px, py, pz] = unitVector(lat, lon);
    const within = Math.cos(deg * RAD);
    const out: RiverNear[] = [];
    for (const i of f.reaches) {
      const xyz = this.nodesOf(f.d, i);
      const nodes: RiverNear['nodes'] = [];
      for (let j = net.start[i]; j < net.start[i + 1]; j++) {
        const x = xyz[j * 3];
        const y = xyz[j * 3 + 1];
        const z = xyz[j * 3 + 2];
        if (!net.wet(j, f.key) || x * px + y * py + z * pz < within) continue;
        const [la, lo] = toLatLon([x, y, z]);
        nodes.push({ lat: la, lon: lo, z: net.z[j] });
      }
      if (nodes.length) out.push({ q: f.key.q[i], order: net.order[i], nodes });
    }
    return out;
  }

  /** The lake the last frame drew over a place, if any: its level in the grid's metres, whether it spills, and how many cells it covers. */
  lakeAt(lat: number, lon: number): { level: number; spills: boolean; cells: number } | null {
    const f = this.shown;
    if (!f) return null;
    const { net } = f.d;
    const { nx, step } = net.grid;
    const lakeOf = net.lakes(f.key);
    for (const l of f.lakes) {
      const lake = f.k.lakes[l];
      // Back to the network's coordinates, on the lake's plate.
      const turn = f.d.moved ? (f.d.turns.get(lake.plate) ?? IDENTITY) : IDENTITY;
      const [la, lo] = toLatLon(rotate(conj(turn), unitVector(lat, lon)));
      const cell = Math.round((90 - la) / step) * nx + ((Math.round((lo + 180) / step) % nx) + nx) % nx;
      if (lakeOf.get(cell) === l) return { level: f.key.lakeLevel[l], spills: f.key.lakeSpills[l] === 1, cells: lake.cells };
    }
    return null;
  }
}
