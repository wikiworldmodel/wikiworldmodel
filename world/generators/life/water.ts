// The water a scene is given (docs/slices/EIGHTH-SLICE.md): the rivers Landsat saw near a place, joined end to end, and the
// drainage's reaches where it saw none, each in the scene's metres about where its relief is read and its water's
// height above the coast. One function, so that a browser and the build make the same scene from the same files.
import { tileKey, type ObservedRivers, type RiverKey, type RiverNet, type RiversInfo, type RiversSet, type RiverWidths } from '../../../core/rivers.ts';
import type { ChannelLaws, SceneRiver, SceneWater } from '../../../core/scene.ts';

/** How far from where its relief is read a scene takes rivers from, m; and the tiles of observed rivers it reads, in degrees. */
export const WATER_REACH = 40000;
export const WATER_TILES_DEG = 0.5;

/** The files of the observed rivers' tiles within `deg` of a place, in the order a scene reads them. */
export function observedFiles(o: ObservedRivers, lat: number, lon: number, deg = WATER_TILES_DEG): string[] {
  const files = new Set<string>();
  for (const la of [lat - deg, lat, lat + deg]) {
    for (const lo of [lon - deg, lon, lon + deg]) {
      const f = o.tiles[tileKey(((lo + 540) % 360) - 180, Math.max(-89.9, Math.min(89.9, la)), o.step)];
      if (f) files.add(f);
    }
  }
  return [...files];
}

/** The keyframe of a set nearest an age: its file and its place in it. */
export function keyFile(set: RiversSet, ageMa: number): { file: string; i: number } | undefined {
  let best: { file: string; i: number; d: number } | undefined;
  for (const c of set.chunks) {
    c.keyframesMa.forEach((a, i) => {
      const d = Math.abs(a - ageMa);
      if (!best || d < best.d) best = { file: c.file, i, d };
    });
  }
  return best && { file: best.file, i: best.i };
}

/**
 * A scene's water from a set's network and keyframe and the observed rivers of the tiles near it: those Landsat saw,
 * on today's ground, and the drainage's reaches where Landsat saw none. A reach most of whose course here runs within
 * a few km of a river Landsat saw is that river, drawn coarsely, and is left out.
 */
export function sceneWater(info: RiversInfo, set: RiversSet, net: RiverNet, key: RiverKey, observedTiles: RiverWidths[], at: { lat: number; lon: number }, isoline: number, reach = WATER_REACH): SceneWater {
  const ky = (6371000 * Math.PI) / 180;
  const kx = ky * Math.cos((at.lat * Math.PI) / 180);
  const local = (la: number, lo: number): [number, number] => [(((lo - at.lon + 540) % 360) - 180) * kx, (la - at.lat) * ky];
  const rivers: SceneRiver[] = [];
  const seen: number[] = [];
  // Rivers Landsat saw, on today's ground: evidence today, and held on today's ground through the glacial cycles.
  if (set.today && info.observed) {
    const segs: { key: string; xy: number[]; width: number }[] = [];
    const names = new Set<string>();
    for (const w of observedTiles) {
      for (let i = 0; i + 1 < w.start.length; i++) {
        // Not the lakes, nor a segment with no width.
        if (w.flag[i] === 1 || !(w.width[i] > 0)) continue;
        const name = `grwl#${w.xy[w.start[i] * 2].toFixed(4)},${w.xy[w.start[i] * 2 + 1].toFixed(4)}`;
        if (names.has(name)) continue;
        const xy: number[] = [];
        let near = false;
        for (let k = w.start[i]; k < w.start[i + 1]; k++) {
          const [x, y] = local(w.xy[k * 2 + 1], w.xy[k * 2]);
          xy.push(x, y);
          if (x * x + y * y < (reach * 1.5) ** 2) near = true;
        }
        if (!near || xy.length < 4) continue;
        names.add(name);
        segs.push({ key: name, xy, width: w.width[i] });
      }
    }
    for (const r of joinSegments(segs)) {
      if (!r.xy.some((_, k) => k % 2 === 0 && r.xy[k] ** 2 + r.xy[k + 1] ** 2 < reach * reach)) continue;
      rivers.push({ key: r.key, from: 'observed', xy: r.xy, s0: 0, width: r.width });
      for (let k = 0; k < r.xy.length; k += 2) seen.push(r.xy[k], r.xy[k + 1]);
    }
  }
  const observed = rivers.length > 0;
  // The drainage's reaches, where Landsat saw no river.
  const clear = 6000;
  for (let i = 0; i < net.count; i++) {
    if (!key.q[i]) continue;
    const xy: number[] = [];
    const q: number[] = [];
    const z: number[] = [];
    let inside = 0;
    let covered = 0;
    for (let j = net.start[i]; j < net.start[i + 1]; j++) {
      if (!net.wet(j, key)) {
        if (xy.length) break;
        continue;
      }
      const [la, lo] = net.latLon(net.nodes[j]);
      const [x, y] = local(la, lo);
      xy.push(x, y);
      q.push(net.q(i, j, key));
      z.push(net.z[j] - isoline);
      if (x * x + y * y < reach * reach) {
        inside++;
        for (let k = 0; k < seen.length; k += 2) {
          if ((seen[k] - x) ** 2 + (seen[k + 1] - y) ** 2 < clear * clear) {
            covered++;
            break;
          }
        }
      }
    }
    if (!inside || xy.length < 4 || covered > inside * 0.6) continue;
    rivers.push({ key: `${set.network}#${i}`, from: 'model', xy, s0: 0, q, z });
  }
  return { rivers, laws: info.params as unknown as ChannelLaws, tier: observed ? 'evidence' : 'model', from: [...(observed && info.observed ? [info.observed.field] : []), info.field] };
}

/**
 * GRWL's segments run from one tributary junction to the next, in no set direction. Joined end to end, the widest
 * first and each onto the end it meets most nearly in width, they make rivers whose water runs on through their
 * junctions; each keeps the width of the segment each of its points came from.
 */
export function joinSegments(segs: { key: string; xy: number[]; width: number }[], touch = 60): { key: string; xy: number[]; width: number[] }[] {
  const order = segs.map((_, i) => i).sort((a, b) => segs[b].width - segs[a].width);
  const used = new Uint8Array(segs.length);
  const end = (s: { xy: number[] }, last: boolean): [number, number] => (last ? [s.xy[s.xy.length - 2], s.xy[s.xy.length - 1]] : [s.xy[0], s.xy[1]]);
  const out: { key: string; xy: number[]; width: number[] }[] = [];
  for (const first of order) {
    if (used[first]) continue;
    used[first] = 1;
    const xy = [...segs[first].xy];
    const width = Array<number>(xy.length / 2).fill(segs[first].width);
    for (const atEnd of [true, false]) {
      for (;;) {
        const [px, py] = atEnd ? [xy[xy.length - 2], xy[xy.length - 1]] : [xy[0], xy[1]];
        const here = atEnd ? width[width.length - 1] : width[0];
        let best = -1;
        let flip = false;
        for (let i = 0; i < segs.length; i++) {
          if (used[i]) continue;
          for (const last of [false, true]) {
            const [qx, qy] = end(segs[i], last);
            if (Math.hypot(qx - px, qy - py) > touch) continue;
            if (best < 0 || Math.abs(segs[i].width - here) < Math.abs(segs[best].width - here)) {
              best = i;
              flip = last;
            }
          }
        }
        if (best < 0) break;
        used[best] = 1;
        // Its points running away from the end that touches, which is left out as the river has it already.
        const pts: number[] = [];
        const s = segs[best].xy;
        if (!flip) for (let k = 2; k < s.length; k += 2) pts.push(s[k], s[k + 1]);
        else for (let k = s.length - 4; k >= 0; k -= 2) pts.push(s[k], s[k + 1]);
        const w = Array<number>(pts.length / 2).fill(segs[best].width);
        if (atEnd) {
          xy.push(...pts);
          width.push(...w);
        } else {
          const back: number[] = [];
          for (let k = pts.length - 2; k >= 0; k -= 2) back.push(pts[k], pts[k + 1]);
          xy.unshift(...back);
          width.unshift(...w);
        }
      }
    }
    out.push({ key: segs[first].key, xy, width });
  }
  return out;
}
