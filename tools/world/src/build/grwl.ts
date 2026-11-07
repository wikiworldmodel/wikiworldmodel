// Rivers wider than 30 m, as Landsat saw them (field:earth/river-widths): GRWL's segments, read from its shapefile,
// cut into tiles of 10° that a scene fetches for the place it is of, and thinned into one file the globe draws from.
// Each segment keeps the median of its widths and its flag (river, lake, tidal river or canal), as the dataset gives
// them; one with no width keeps none.
import { encodeTile } from '../../../../core/container.ts';
import { tileKey, type RiverWidthsHeader } from '../../../../core/rivers.ts';
import { stableStringify } from '../util.ts';

/** A shapefile's polylines: each record's parts, as flat [lon, lat, …]. */
export function readPolylines(buf: Uint8Array): Float64Array[][] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const out: Float64Array[][] = [];
  for (let o = 100; o + 8 <= buf.length; ) {
    const length = dv.getInt32(o + 4, false) * 2;
    const c = o + 8;
    const type = dv.getInt32(c, true);
    const parts: Float64Array[] = [];
    // A polyline, with or without heights and measures: they begin alike.
    if (type === 3 || type === 13 || type === 23) {
      const nParts = dv.getInt32(c + 36, true);
      const nPoints = dv.getInt32(c + 40, true);
      const first = Array.from({ length: nParts }, (_, i) => dv.getInt32(c + 44 + 4 * i, true));
      const at = c + 44 + 4 * nParts;
      first.forEach((from, p) => {
        const to = p + 1 < nParts ? first[p + 1] : nPoints;
        const xy = new Float64Array((to - from) * 2);
        for (let i = from; i < to; i++) {
          xy[(i - from) * 2] = dv.getFloat64(at + 16 * i, true);
          xy[(i - from) * 2 + 1] = dv.getFloat64(at + 16 * i + 8, true);
        }
        parts.push(xy);
      });
    }
    out.push(parts);
    o = c + length;
  }
  return out;
}

/** A dBase file's records, each a field's text by its name. */
export function readDbf(buf: Uint8Array): Record<string, string>[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const count = dv.getUint32(4, true);
  const headerLength = dv.getUint16(8, true);
  const recordLength = dv.getUint16(10, true);
  const text = new TextDecoder('latin1');
  const fields: { name: string; length: number }[] = [];
  for (let o = 32; buf[o] !== 0x0d; o += 32) fields.push({ name: text.decode(buf.subarray(o, o + 11)).replace(/\0.*$/s, ''), length: buf[o + 16] });
  const out: Record<string, string>[] = [];
  for (let r = 0; r < count; r++) {
    let at = headerLength + r * recordLength + 1;
    const rec: Record<string, string> = {};
    for (const f of fields) {
      rec[f.name] = text.decode(buf.subarray(at, at + f.length)).trim();
      at += f.length;
    }
    out.push(rec);
  }
  return out;
}

export interface Segment {
  /** flat [lon, lat, …] */
  xy: Float64Array;
  /** the median width, m; NaN where the dataset has none */
  width: number;
  /** 0 river, 1 lake or reservoir, 2 tidal river, 3 canal; anything else as the dataset has it */
  flag: number;
}

/** GRWL's segments: each part of each record, with its record's median width and flag. */
export function grwlSegments(shp: Uint8Array, dbf: Uint8Array): Segment[] {
  const lines = readPolylines(shp);
  const rows = readDbf(dbf);
  if (lines.length !== rows.length) throw new Error(`GRWL: ${lines.length} shapes but ${rows.length} records`);
  const out: Segment[] = [];
  lines.forEach((parts, i) => {
    const r = rows[i];
    // A segment with no data has a least width of 1 and a greatest of -1.
    const none = Number(r.width_min_) === 1 && Number(r.width_max_) === -1;
    const width = none ? NaN : Number(r.width_med_);
    const flag = Number(r.lakeFlag);
    for (const xy of parts) if (xy.length >= 4) out.push({ xy, width, flag });
  });
  return out;
}

/** A line thinned so that no point left out is further than `tolerance` degrees from it (Douglas–Peucker). */
export function thin(xy: Float64Array, tolerance: number): Float64Array {
  const n = xy.length / 2;
  if (n <= 2) return xy;
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const ax = xy[a * 2];
    const ay = xy[a * 2 + 1];
    const dx = xy[b * 2] - ax;
    const dy = xy[b * 2 + 1] - ay;
    const q = dx * dx + dy * dy || 1e-18;
    let far = -1;
    let most = tolerance * tolerance;
    for (let i = a + 1; i < b; i++) {
      const t = Math.max(0, Math.min(1, ((xy[i * 2] - ax) * dx + (xy[i * 2 + 1] - ay) * dy) / q));
      const ex = xy[i * 2] - ax - t * dx;
      const ey = xy[i * 2 + 1] - ay - t * dy;
      const d = ex * ex + ey * ey;
      if (d > most) {
        most = d;
        far = i;
      }
    }
    if (far >= 0) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(xy[i * 2], xy[i * 2 + 1]);
  return Float64Array.from(out);
}

/** Segments as one file (core/rivers.ts RiverWidthsHeader). */
export function encodeSegments(segs: Segment[], box: [number, number, number, number]): Uint8Array {
  const start = new Uint32Array(segs.length + 1);
  segs.forEach((s, i) => (start[i + 1] = start[i] + s.xy.length / 2));
  const xy = new Float32Array(start[segs.length] * 2);
  segs.forEach((s, i) => xy.set(s.xy, start[i] * 2));
  const width = Float32Array.from(segs, (s) => s.width);
  const flag = Uint8Array.from(segs, (s) => Math.max(0, Math.min(255, Math.round(s.flag))));
  const header: RiverWidthsHeader = { format: 'lightworld-river-widths@1', box, segments: segs.length, start: 0, xy: 1, width: 2, flag: 3 };
  return encodeTile(header as unknown as Record<string, unknown>, [start, xy, width, flag], stableStringify);
}

/** Segments in tiles of `step` degrees: each tile holds every segment with a point in it, whole. */
export function tiles(segs: Segment[], step: number): Map<string, Segment[]> {
  const out = new Map<string, Segment[]>();
  for (const s of segs) {
    const keys = new Set<string>();
    for (let i = 0; i < s.xy.length; i += 2) keys.add(tileKey(s.xy[i], s.xy[i + 1], step));
    for (const k of keys) out.set(k, [...(out.get(k) ?? []), s]);
  }
  return out;
}
