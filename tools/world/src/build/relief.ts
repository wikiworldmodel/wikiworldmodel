// Today's relief, made ready for a sea that rises and falls over it (field:earth/relief): today's water marked on its
// grid, and every hollow that today's ocean does not reach filled to the pass it would spill over, so that a sea level
// laid over it floods only what the ocean could reach. Death Valley and the Dead Sea's valley lie below sea level and
// stay dry; the shelves flood as the sea rises over them.

/** GeoJSON areas, as Natural Earth writes them. */
export interface Areas {
  features: { geometry: { type: string; coordinates: unknown } }[];
}

/** What each node of the grid is today: land, a lake (or an inland sea), or the ocean. */
export const WATER = { land: 0, lake: 1, ocean: 2 } as const;

type Ring = number[][];

/** The latitude a row is tested at: its own, but for the poles' rows, which are tested half a step in, inside the cap. */
const rowLat = (r: number, step: number) => Math.max(-90 + step / 2, Math.min(90 - step / 2, 90 - r * step));

/** Each polygon of a layer, as its rings: the outer one and its holes. */
function polygonsOf(a: Areas): Ring[][] {
  return a.features.flatMap((f) => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates as Ring[]] : f.geometry.type === 'MultiPolygon' ? (f.geometry.coordinates as Ring[][]) : []));
}

/**
 * The nodes of a grid `step` degrees apart, from 90°N and 180°W, whose points lie inside a polygon's rings, by the
 * even-odd rule: rows are scanned along their latitude, and the node between two crossings of an edge is inside.
 */
export function rasterize(rings: Ring[], nx: number, ny: number, step: number): Uint8Array {
  const crossings: number[][] = Array.from({ length: ny }, () => []);
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[(i + 1) % ring.length];
      if (y1 === y2) continue;
      // The rows whose latitude the edge crosses, its lower end in and its upper end out.
      const top = Math.max(y1, y2);
      const bottom = Math.min(y1, y2);
      const first = Math.max(0, Math.ceil((90 - top) / step - 1e-9) - 1);
      const last = Math.min(ny - 1, Math.floor((90 - bottom) / step + 1e-9) + 1);
      for (let r = first; r <= last; r++) {
        const lat = rowLat(r, step);
        if (!(lat >= bottom && lat < top)) continue;
        crossings[r].push(x1 + ((lat - y1) * (x2 - x1)) / (y2 - y1));
      }
    }
  }
  const out = new Uint8Array(nx * ny);
  for (let r = 0; r < ny; r++) {
    const xs = crossings[r].sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil((xs[k] + 180) / step - 1e-9));
      const to = Math.min(nx - 1, Math.floor((xs[k + 1] + 180) / step - 1e-9));
      for (let c = from; c <= to; c++) out[r * nx + c] = 1;
    }
  }
  return out;
}

/**
 * Today's water on a grid: the ocean is the largest of the ocean layer's polygons, and any other polygon of it is an
 * inland sea, which is held as a lake, as the lakes are.
 */
export function waterMask(ocean: Areas, lakes: Areas, nx: number, ny: number, step: number): Uint8Array {
  const out = new Uint8Array(nx * ny);
  const parts = polygonsOf(ocean).map((p) => rasterize(p, nx, ny, step));
  const sizes = parts.map((m) => m.reduce((n, v) => n + v, 0));
  const main = sizes.indexOf(Math.max(...sizes));
  parts.forEach((m, i) => {
    for (let k = 0; k < m.length; k++) if (m[k]) out[k] = i === main ? WATER.ocean : WATER.lake;
  });
  for (const p of polygonsOf(lakes)) {
    const m = rasterize(p, nx, ny, step);
    for (let k = 0; k < m.length; k++) if (m[k] && out[k] !== WATER.ocean) out[k] = WATER.lake;
  }
  return out;
}

/** A min-heap of nodes by level. */
class Heap {
  private level: Float32Array;
  private node: Int32Array;
  size = 0;
  constructor(capacity: number) {
    this.level = new Float32Array(capacity);
    this.node = new Int32Array(capacity);
  }
  push(level: number, node: number): void {
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.level[p] <= level) break;
      this.level[i] = this.level[p];
      this.node[i] = this.node[p];
      i = p;
    }
    this.level[i] = level;
    this.node[i] = node;
  }
  /** The node of the lowest level, taken off; its level is left in `top`. */
  top = 0;
  pop(): number {
    const out = this.node[0];
    this.top = this.level[0];
    const level = this.level[--this.size];
    const node = this.node[this.size];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && this.level[c + 1] < this.level[c]) c++;
      if (this.level[c] >= level) break;
      this.level[i] = this.level[c];
      this.node[i] = this.node[c];
      i = c;
    }
    this.level[i] = level;
    this.node[i] = node;
    return out;
  }
}

/**
 * The ground a coast is drawn on (Barnes et al.'s priority flood, from today's ocean): today's ocean keeps its depth,
 * and at least a metre of it, so that it is sea at today's sea level; a lake keeps its own depth; and land is held at
 * the lowest level a sea would have to reach to flood it from the ocean, and at least a metre above today's sea, so
 * that it is land at today's sea level. Nodes are joined to their eight neighbours, east to west around the globe.
 */
export function fillFromOcean(elev: ArrayLike<number>, water: Uint8Array, nx: number, ny: number): Int16Array {
  const n = nx * ny;
  const level = new Float32Array(n);
  const closed = new Uint8Array(n);
  const heap = new Heap(n);
  const neighbours = (k: number, each: (q: number) => void) => {
    const r = Math.floor(k / nx);
    const c = k - r * nx;
    for (let dr = -1; dr <= 1; dr++) {
      const rr = r + dr;
      if (rr < 0 || rr >= ny) continue;
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        each(rr * nx + ((c + dc + nx) % nx));
      }
    }
  };
  for (let k = 0; k < n; k++) {
    if (water[k] !== WATER.ocean) continue;
    closed[k] = 1;
    level[k] = Math.min(elev[k], -1);
    let coast = false;
    neighbours(k, (q) => {
      if (water[q] !== WATER.ocean) coast = true;
    });
    if (coast) heap.push(level[k], k);
  }
  while (heap.size) {
    const k = heap.pop();
    const at = heap.top;
    neighbours(k, (q) => {
      if (closed[q]) return;
      closed[q] = 1;
      level[q] = Math.max(elev[q], at);
      heap.push(level[q], q);
    });
  }
  const clamp = (v: number) => Math.max(-32768, Math.min(32767, Math.round(v)));
  const out = new Int16Array(n);
  for (let k = 0; k < n; k++) {
    // Ground no sea reaches from the ocean, cut off from it on every side, is held where it is.
    const reach = closed[k] ? level[k] : elev[k];
    out[k] = clamp(water[k] === WATER.ocean ? Math.min(elev[k], -1) : water[k] === WATER.lake ? elev[k] : Math.max(reach, 1));
  }
  return out;
}
