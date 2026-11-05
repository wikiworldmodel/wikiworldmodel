// A sheet of a form: the body from the side, the front and above, in its poses and at each detail, with a
// scale in metres. It is how whoever writes a form checks what they wrote, by looking at it. Nothing here
// runs in a browser, or needs a GPU: a small software rasterizer and a PNG writer.
import { deflateSync } from 'node:zlib';
import type { Form } from '../../../core/form.ts';
import { Mesh, STRIDE } from '../../../world/generators/city/kit.ts';
import { drawAnimal, drawPlant, POSE, type Detail, type Stance } from '../../../world/generators/life/forms.ts';

type Rgb = [number, number, number];

/** A colour for each material: enough to tell the parts apart. */
const TONE: Record<number, Rgb> = {
  10: [24, 22, 20],
  31: [132, 118, 88],
  32: [214, 200, 160],
  33: [110, 104, 62],
  34: [150, 116, 76],
  35: [58, 96, 52],
  36: [86, 134, 58],
  37: [104, 78, 58],
  38: [64, 110, 50],
  39: [110, 130, 150],
  40: [176, 136, 92],
  41: [70, 54, 44],
};

class Canvas {
  readonly rgb: Uint8Array;
  readonly z: Float32Array;
  constructor(readonly w: number, readonly h: number) {
    this.rgb = new Uint8Array(w * h * 3).fill(238);
    this.z = new Float32Array(w * h).fill(Infinity);
  }
  set(x: number, y: number, c: Rgb): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 3;
    this.rgb[i] = c[0];
    this.rgb[i + 1] = c[1];
    this.rgb[i + 2] = c[2];
  }
  rect(x0: number, y0: number, x1: number, y1: number, c: Rgb): void {
    for (let y = Math.floor(y0); y <= y1; y++) for (let x = Math.floor(x0); x <= x1; x++) this.set(x, y, c);
  }
}

/** A view: which way each of the mesh's axes goes on the page. */
interface View {
  title: string;
  /** a vertex's page coordinates and its depth, before scaling */
  project: (x: number, y: number, z: number) => [number, number, number];
  /** the direction of the light, in the mesh's frame */
  light: [number, number, number];
}

const SIDE: View = { title: 'SIDE', project: (x, y, z) => [y, z, x], light: [-0.55, 0.45, 0.7] };
const FRONT: View = { title: 'FRONT', project: (x, y, z) => [x, z, -y], light: [0.4, 0.55, 0.73] };
const TOP: View = { title: 'TOP', project: (x, y, z) => [y, x, -z], light: [0.3, 0.3, 0.9] };

function drawMesh(cv: Canvas, m: Mesh, view: View, ox: number, oy: number, scale: number): void {
  const { vertices, indices } = m.arrays();
  const f = new Float32Array(vertices);
  const b = new Uint8Array(vertices);
  const sx: number[] = [];
  const sy: number[] = [];
  const sd: number[] = [];
  for (let i = 0; i < m.verts; i++) {
    const [u, v, d] = view.project(f[i * 7], f[i * 7 + 1], f[i * 7 + 2]);
    sx.push(ox + u * scale);
    sy.push(oy - v * scale);
    sd.push(d);
  }
  const [lx, ly, lz] = view.light;
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t];
    const c = indices[t + 1];
    const e = indices[t + 2];
    const area = (sx[c] - sx[a]) * (sy[e] - sy[a]) - (sx[e] - sx[a]) * (sy[c] - sy[a]);
    if (area === 0) continue;
    const n = a * STRIDE + 12;
    const nx = (b[n] - 128) / 127;
    const ny = (b[n + 1] - 128) / 127;
    const nz = (b[n + 2] - 128) / 127;
    const lit = 0.42 + 0.58 * Math.abs(nx * lx + ny * ly + nz * lz);
    const tone = TONE[b[a * STRIDE + 24]] ?? [128, 128, 128];
    const colour: Rgb = [tone[0] * lit, tone[1] * lit, tone[2] * lit];
    const x0 = Math.max(0, Math.floor(Math.min(sx[a], sx[c], sx[e])));
    const x1 = Math.min(cv.w - 1, Math.ceil(Math.max(sx[a], sx[c], sx[e])));
    const y0 = Math.max(0, Math.floor(Math.min(sy[a], sy[c], sy[e])));
    const y1 = Math.min(cv.h - 1, Math.ceil(Math.max(sy[a], sy[c], sy[e])));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const w0 = ((sx[c] - x) * (sy[e] - y) - (sx[e] - x) * (sy[c] - y)) / area;
        const w1 = ((sx[e] - x) * (sy[a] - y) - (sx[a] - x) * (sy[e] - y)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const depth = w0 * sd[a] + w1 * sd[c] + w2 * sd[e];
        const at = y * cv.w + x;
        if (depth < cv.z[at]) {
          cv.z[at] = depth;
          cv.set(x, y, colour);
        }
      }
    }
  }
}

// A 5×7 font, as much of one as a sheet says.
const GLYPHS: Record<string, string> = {
  A: '01110100011000111111100011000110001', B: '11110100011000111110100011000111110', C: '01111100001000010000100001000001111', D: '11110100011000110001100011000111110', E: '11111100001000011110100001000011111', F: '11111100001000011110100001000010000', G: '01111100001000010111100011000101111', H: '10001100011000111111100011000110001', I: '11111001000010000100001000010011111', J: '00111000100001000010000101001001100', K: '10001100101010011000101001001010001', L: '10000100001000010000100001000011111', M: '10001110111010110001100011000110001', N: '10001110011010110011100011000110001', O: '01110100011000110001100011000101110', P: '11110100011000111110100001000010000', Q: '01110100011000110001101011001001101', R: '11110100011000111110101001001010001', S: '01111100001000001110000010000111110', T: '11111001000010000100001000010000100', U: '10001100011000110001100011000101110', V: '10001100011000110001100010101000100', W: '10001100011000110101101011101110001', X: '10001100010101000100010101000110001', Y: '10001100010101000100001000010000100', Z: '11111000010001000100010001000011111',
  '0': '01110100011001110101110011000101110', '1': '00100011000010000100001000010001110', '2': '01110100010000100010001000100011111', '3': '11110000010000101110000010000111110', '4': '00010001100101010010111110001000010', '5': '11111100001111000001000011000101110', '6': '00110010001000011110100011000101110', '7': '11111000010001000100010000100001000', '8': '01110100011000101110100011000101110', '9': '01110100011000101111000010001001100',
  '.': '00000000000000000000000000110001100', '-': '00000000000000011111000000000000000', ':': '00000011000110000000011000110000000', '/': '00001000010001000100010001000010000', '(': '00010001000100001000010000010000010', ')': '01000001000001000010000100010001000', ',': '00000000000000000000001100010001000', ' ': '00000000000000000000000000000000000',
};

function text(cv: Canvas, s: string, x: number, y: number, scale = 2, c: Rgb = [40, 40, 44]): void {
  let px = x;
  for (const ch of s.toUpperCase()) {
    const g = GLYPHS[ch] ?? GLYPHS[' '];
    for (let j = 0; j < 7; j++) for (let i = 0; i < 5; i++) if (g[j * 5 + i] === '1') cv.rect(px + i * scale, y + j * scale, px + i * scale + scale - 1, y + j * scale + scale - 1, c);
    px += 6 * scale;
  }
}

/** The PNG file of an RGB image. */
export function png(rgb: Uint8Array, w: number, h: number): Buffer {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  const crc = (buf: Buffer) => {
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 255] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc(body));
    return Buffer.concat([head, body, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

export interface SheetSize {
  /** an animal's length and hip height, or a plant's height, in metres */
  length?: number;
  hip?: number;
  height?: number;
  /** what the sheet is headed with */
  label: string;
  biped?: boolean;
}

const niceStep = (span: number) => {
  for (const s of [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100]) if (span / s <= 10) return s;
  return 200;
};

/** Draw one mesh in a panel of the sheet, scaled to fit, with its ground line and scale. */
function panel(cv: Canvas, m: Mesh, view: View, x: number, y: number, w: number, h: number, title: string, fit: number): void {
  cv.rect(x, y, x + w - 2, y + h - 2, [248, 248, 246]);
  text(cv, title, x + 6, y + 6, 1);
  const { vertices } = m.arrays();
  const f = new Float32Array(vertices);
  let u0 = Infinity;
  let u1 = -Infinity;
  let v0 = Infinity;
  let v1 = -Infinity;
  for (let i = 0; i < m.verts; i++) {
    const [u, v] = view.project(f[i * 7], f[i * 7 + 1], f[i * 7 + 2]);
    u0 = Math.min(u0, u);
    u1 = Math.max(u1, u);
    v0 = Math.min(v0, v);
    v1 = Math.max(v1, v);
  }
  if (!m.verts) {
    text(cv, 'NOT DRAWN AT THIS DETAIL', x + 10, y + h / 2, 1);
    return;
  }
  // The ground is always in the picture, so that a body's height can be read.
  if (view !== TOP) {
    v0 = Math.min(v0, 0);
    v1 = Math.max(v1, 0);
  }
  const scale = Math.min((w - 30) / Math.max(fit, u1 - u0), (h - 46) / Math.max(fit * 0.5, v1 - v0));
  const ox = x + w / 2 - ((u0 + u1) / 2) * scale;
  const oy = y + 24 + (h - 46) / 2 + ((v0 + v1) / 2) * scale;
  const groundY = view === TOP ? oy : oy;
  if (view !== TOP) cv.rect(x + 4, groundY, x + w - 6, groundY, [150, 150, 150]);
  cv.z.fill(Infinity);
  drawMesh(cv, m, view, ox, oy, scale);
  // The scale, along the bottom.
  const step = niceStep((w - 30) / scale);
  const by = y + h - 10;
  const bx = x + 12;
  cv.rect(bx, by, bx + step * scale, by + 1, [30, 30, 30]);
  cv.rect(bx, by - 3, bx, by + 1, [30, 30, 30]);
  cv.rect(bx + step * scale, by - 3, bx + step * scale, by + 1, [30, 30, 30]);
  text(cv, `${step} M`, bx + step * scale + 6, by - 5, 1);
}

/** The sheet of a form, as a PNG. */
export function formSheet(form: Form, size: SheetSize): Buffer {
  const W = 1320;
  const H = 880;
  const cv = new Canvas(W, H);
  const animal = form.kind === 'animal';
  const L = size.length ?? 1;
  const hip = size.hip ?? L * (form.hip ?? 0.3);
  const height = size.height ?? 10;
  const head = animal ? `${size.label}: ${L.toFixed(2)} M LONG, HIPS ${hip.toFixed(2)} M` : `${size.label}: ${height.toFixed(1)} M TALL`;
  text(cv, head, 16, 12, 2);
  const stance = (pose: number, detail: Detail): Stance => ({ L, H: hip, pose, phase: 0.25, sway: 0, detail, tint: 128, biped: !!size.biped });
  const mesh = (pose: number, detail: Detail, seed = 7): Mesh => {
    const m = new Mesh(4096);
    if (animal) drawAnimal(m, form, stance(pose, detail));
    else drawPlant(m, form, height, seed, detail, 128);
    return m;
  };
  const fit = animal ? L : height;
  const pw = 330;
  const ph = 280;
  const panels: { m: Mesh; v: View; t: string }[] = animal
    ? [
        { m: mesh(POSE.stand, 2), v: SIDE, t: 'SIDE, STANDING, FINE' },
        { m: mesh(POSE.walk, 2), v: SIDE, t: 'SIDE, WALKING' },
        { m: mesh(POSE.graze, 2), v: SIDE, t: 'SIDE, HEAD DOWN' },
        { m: mesh(POSE.alert, 2), v: SIDE, t: 'SIDE, ALERT' },
        { m: mesh(POSE.stand, 2), v: FRONT, t: 'FRONT' },
        { m: mesh(POSE.stand, 2), v: TOP, t: 'ABOVE' },
        ...(Object.values(form.parts).some((p) => p?.type === 'wing')
          ? [
              { m: mesh(POSE.fly, 2), v: SIDE, t: 'SIDE, IN THE AIR' },
              { m: mesh(POSE.fly, 2), v: FRONT, t: 'FRONT, IN THE AIR' },
            ]
          : []),
        { m: mesh(POSE.stand, 1), v: SIDE, t: 'COARSE' },
        { m: mesh(POSE.stand, 0), v: SIDE, t: 'TINY' },
      ]
    : [
        { m: mesh(0, 2, 7), v: SIDE, t: 'SIDE, FINE' },
        { m: mesh(0, 2, 19), v: SIDE, t: 'ANOTHER' },
        { m: mesh(0, 2, 7), v: FRONT, t: 'FRONT' },
        { m: mesh(0, 2, 7), v: TOP, t: 'ABOVE' },
        { m: mesh(0, 1), v: SIDE, t: 'COARSE' },
        { m: mesh(0, 0), v: SIDE, t: 'TINY' },
      ];
  panels.forEach((p, i) => panel(cv, p.m, p.v, 8 + (i % 4) * pw, 44 + Math.floor(i / 4) * ph, pw - 4, ph - 4, `${p.t}, ${p.m.verts} VERTS`, fit));
  return png(cv.rgb, W, H);
}
