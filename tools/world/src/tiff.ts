// Just enough of GeoTIFF to read elevation grids: classic TIFF, little-endian, one band of
// 16-bit integers or 32-bit floats, in strips or tiles, raw or deflated, with the horizontal
// and floating-point predictors.
import { readFile } from 'node:fs/promises';
import { unzlibSync } from 'fflate';

export interface Raster {
  width: number;
  height: number;
  data: Float32Array;
  /** map coordinates of the outer corner of pixel (0, 0), and the size of a pixel */
  x0: number;
  y0: number;
  dx: number;
  dy: number;
  nodata?: number;
}

const SIZES: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 11: 4, 12: 8 };

/** A raster's layout, and a way to decode it a row of a block at a time. */
interface Decoder {
  width: number;
  height: number;
  /** map coordinates of the outer corner of pixel (0, 0), and the size of a pixel */
  x0: number;
  y0: number;
  dx: number;
  dy: number;
  nodata?: number;
  /** each row of each block, in order: the row's index in the raster, its first column, and its values */
  rows(each: (y: number, x: number, values: Float32Array) => void): void;
}

function decoder(buf: Buffer, path: string): Decoder {
  if (buf.toString('latin1', 0, 2) !== 'II' || buf.readUInt16LE(2) !== 42) throw new Error(`${path}: only little-endian classic TIFF is read`);
  const offset = buf.readUInt32LE(4);
  const count = buf.readUInt16LE(offset);
  const tags = new Map<number, number[]>();
  const text = new Map<number, string>();
  for (let i = 0; i < count; i++) {
    const e = offset + 2 + i * 12;
    const tag = buf.readUInt16LE(e);
    const type = buf.readUInt16LE(e + 2);
    const n = buf.readUInt32LE(e + 4);
    const size = SIZES[type] ?? 1;
    const at = size * n <= 4 ? e + 8 : buf.readUInt32LE(e + 8);
    if (type === 2) {
      text.set(tag, buf.toString('latin1', at, at + n).replace(/\0.*$/, ''));
      continue;
    }
    const values: number[] = [];
    for (let k = 0; k < n; k++) {
      const p = at + k * size;
      values.push(type === 3 ? buf.readUInt16LE(p) : type === 4 ? buf.readUInt32LE(p) : type === 11 ? buf.readFloatLE(p) : type === 12 ? buf.readDoubleLE(p) : type === 1 ? buf[p] : 0);
    }
    tags.set(tag, values);
  }
  const one = (t: number, d?: number) => {
    const v = tags.get(t)?.[0] ?? d;
    if (v === undefined) throw new Error(`${path}: no tag ${t}`);
    return v;
  };
  const width = one(256);
  const height = one(257);
  const bits = one(258);
  const compression = one(259, 1);
  const predictor = one(317, 1);
  const format = one(339, 1);
  if (one(277, 1) !== 1) throw new Error(`${path}: one band only`);
  if (compression !== 1 && compression !== 8 && compression !== 32946) throw new Error(`${path}: compression ${compression} is not read`);
  const tiled = tags.has(322);
  const blockW = tiled ? one(322) : width;
  const blockH = tiled ? one(323) : one(278, height);
  const offsets = tags.get(tiled ? 324 : 273)!;
  const counts = tags.get(tiled ? 325 : 279)!;
  const bytes = bits / 8;
  const across = Math.ceil(width / blockW);
  const scale = tags.get(33550)!;
  const tie = tags.get(33922)!;
  const nodata = text.get(42113);
  const rows = (each: (y: number, x: number, values: Float32Array) => void) => {
    offsets.forEach((off, b) => {
      const raw = buf.subarray(off, off + counts[b]);
      const block = compression === 1 ? new Uint8Array(raw) : unzlibSync(new Uint8Array(raw));
      const bx = tiled ? (b % across) * blockW : 0;
      const by = tiled ? Math.floor(b / across) * blockH : b * blockH;
      const nrows = tiled ? blockH : Math.min(blockH, height - by);
      const rowBytes = blockW * bytes;
      const cols = Math.min(blockW, width - bx);
      const out = new Float32Array(cols);
      for (let r = 0; r < nrows; r++) {
        const row = block.subarray(r * rowBytes, (r + 1) * rowBytes);
        if (predictor === 2 && bytes === 2) {
          for (let i = 2; i < row.length; i += 2) {
            const v = (row[i] | (row[i + 1] << 8)) + (row[i - 2] | (row[i - 1] << 8));
            row[i] = v & 255;
            row[i + 1] = (v >> 8) & 255;
          }
        }
        if (by + r >= height) break;
        if (predictor === 3) {
          // Bytes differenced along the row, then split into planes, most significant first.
          for (let i = 1; i < row.length; i++) row[i] = (row[i] + row[i - 1]) & 255;
          const v = new DataView(new ArrayBuffer(4));
          for (let i = 0; i < cols; i++) {
            v.setUint8(0, row[i]);
            v.setUint8(1, row[i + blockW]);
            v.setUint8(2, row[i + 2 * blockW]);
            v.setUint8(3, row[i + 3 * blockW]);
            out[i] = v.getFloat32(0, false);
          }
        } else if (bytes === 4 && format === 3) {
          const v = new DataView(row.buffer, row.byteOffset, row.byteLength);
          for (let i = 0; i < cols; i++) out[i] = v.getFloat32(i * 4, true);
        } else if (bytes === 2) {
          const v = new DataView(row.buffer, row.byteOffset, row.byteLength);
          for (let i = 0; i < cols; i++) out[i] = format === 2 ? v.getInt16(i * 2, true) : v.getUint16(i * 2, true);
        } else throw new Error(`${path}: ${bits}-bit samples of format ${format} are not read`);
        each(by + r, bx, out);
      }
    });
  };
  return { width, height, x0: tie[3] - tie[0] * scale[0], y0: tie[4] + tie[1] * scale[1], dx: scale[0], dy: scale[1], nodata: nodata === undefined ? undefined : Number(nodata), rows };
}

export async function readTiff(path: string): Promise<Raster> {
  const d = decoder(await readFile(path), path);
  const data = new Float32Array(d.width * d.height);
  d.rows((y, x, values) => data.set(values, y * d.width + x));
  return { width: d.width, height: d.height, data, x0: d.x0, y0: d.y0, dx: d.dx, dy: d.dy, nodata: d.nodata };
}

/**
 * A global raster averaged onto a grid of nodes `step` degrees apart, from 90°N and 180°W, wrapping east: each node the
 * mean of the pixels whose centres are nearer to it than to any other node, and their lowest. Read a block at a time, so
 * a raster too large to hold decoded is never held whole. Pixels of no data are left out, and a node with none is NaN.
 */
export async function meanGrid(path: string, step: number): Promise<{ nx: number; ny: number; step: number; data: Float32Array; low: Float32Array }> {
  const d = decoder(await readFile(path), path);
  const nx = Math.round(360 / step);
  const ny = Math.round(180 / step) + 1;
  if (Math.abs(d.x0 + 180) > d.dx / 2 || Math.abs(d.y0 - 90) > d.dy / 2 || Math.abs(d.width * d.dx - 360) > d.dx || Math.abs(d.height * d.dy - 180) > d.dy) throw new Error(`${path}: not a global grid from 90°N and 180°W`);
  const sum = new Float64Array(nx * ny);
  const count = new Uint32Array(nx * ny);
  const low = new Float32Array(nx * ny).fill(Infinity);
  const col = Int32Array.from({ length: d.width }, (_, x) => ((Math.round((x + 0.5) * d.dx / step) % nx) + nx) % nx);
  d.rows((y, x0, values) => {
    const row = Math.min(ny - 1, Math.round(((y + 0.5) * d.dy) / step)) * nx;
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (Number.isNaN(v) || v === d.nodata) continue;
      const k = row + col[x0 + i];
      sum[k] += v;
      count[k]++;
      if (v < low[k]) low[k] = v;
    }
  });
  const data = new Float32Array(nx * ny);
  for (let k = 0; k < data.length; k++) {
    data[k] = count[k] ? sum[k] / count[k] : NaN;
    if (!count[k]) low[k] = NaN;
  }
  return { nx, ny, step, data, low };
}

/** A raster's value at map coordinates, bilinear; undefined outside it or on missing data. */
export function sampleRaster(r: Raster, x: number, y: number): number | undefined {
  const fx = (x - r.x0) / r.dx - 0.5;
  const fy = (r.y0 - y) / r.dy - 0.5;
  const i = Math.floor(fx);
  const j = Math.floor(fy);
  if (i < 0 || j < 0 || i >= r.width - 1 || j >= r.height - 1) return undefined;
  const u = fx - i;
  const v = fy - j;
  const at = j * r.width + i;
  const a = r.data[at];
  const b = r.data[at + 1];
  const c = r.data[at + r.width];
  const d = r.data[at + r.width + 1];
  if (r.nodata !== undefined && (a === r.nodata || b === r.nodata || c === r.nodata || d === r.nodata)) return undefined;
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}

/** UTM easting and northing on WGS84 (Krüger's series, three terms: well under a metre here). */
export function utm(lat: number, lon: number, zone: number): [number, number] {
  const a = 6378137;
  const f = 1 / 298.257223563;
  const k0 = 0.9996;
  const n = f / (2 - f);
  const big = (a / (1 + n)) * (1 + (n * n) / 4 + n ** 4 / 64);
  const al = [n / 2 - (2 * n * n) / 3 + (5 * n ** 3) / 16, (13 * n * n) / 48 - (3 * n ** 3) / 5, (61 * n ** 3) / 240];
  const ph = (lat * Math.PI) / 180;
  const lm = ((lon - (zone * 6 - 183)) * Math.PI) / 180;
  const e = (2 * Math.sqrt(n)) / (1 + n);
  const t = Math.sinh(Math.atanh(Math.sin(ph)) - e * Math.atanh(e * Math.sin(ph)));
  const xi = Math.atan2(t, Math.cos(lm));
  const eta = Math.atanh(Math.sin(lm) / Math.sqrt(1 + t * t));
  let x = eta;
  let y = xi;
  al.forEach((c, i) => {
    const j = 2 * (i + 1);
    x += c * Math.cos(j * xi) * Math.sinh(j * eta);
    y += c * Math.sin(j * xi) * Math.cosh(j * eta);
  });
  return [500000 + k0 * big * x, k0 * big * y];
}
