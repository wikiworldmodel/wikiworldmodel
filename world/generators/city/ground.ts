// The ground of a site, read from its nested grids of heights: the finest grid that covers a
// place, easing into the next across its last stretch so that no seam shows. The renderer's
// terrain shader computes the same thing, so buildings stand on what is drawn.

export interface GroundGridData {
  nx: number;
  ny: number;
  x0: number;
  y0: number;
  cell: number;
  /** heights, row 0 at the south: in metres (Float32) or decimetres (Int16) */
  z: Float32Array | Int16Array;
}

const smooth = (t: number) => {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
};

/** How many cells a grid eases into the next, at its edges. */
export const EASE_CELLS = 32;

export class GroundSampler {
  private scale: number[];
  constructor(readonly levels: GroundGridData[]) {
    this.scale = levels.map((g) => (g.z instanceof Int16Array ? 0.1 : 1));
  }

  private read(k: number, x: number, y: number): number {
    const g = this.levels[k];
    const fx = (x - g.x0) / g.cell;
    const fy = (y - g.y0) / g.cell;
    const cx = fx < 0 ? 0 : fx > g.nx - 1.001 ? g.nx - 1.001 : fx;
    const cy = fy < 0 ? 0 : fy > g.ny - 1.001 ? g.ny - 1.001 : fy;
    const i = Math.floor(cx);
    const j = Math.floor(cy);
    const u = cx - i;
    const v = cy - j;
    const at = j * g.nx + i;
    return (g.z[at] * (1 - u) * (1 - v) + g.z[at + 1] * u * (1 - v) + g.z[at + g.nx] * (1 - u) * v + g.z[at + g.nx + 1] * u * v) * this.scale[k];
  }

  /** How far a point is inside a grid, as a share of the easing: 0 at its edge or outside, 1 well inside. */
  weight(k: number, x: number, y: number): number {
    const g = this.levels[k];
    const dx = Math.min(x - g.x0, g.x0 + (g.nx - 1) * g.cell - x);
    const dy = Math.min(y - g.y0, g.y0 + (g.ny - 1) * g.cell - y);
    return smooth(Math.min(dx, dy) / (EASE_CELLS * g.cell));
  }

  /** The height of the ground at a point, in metres above sea level. */
  at(x: number, y: number): number {
    const last = this.levels.length - 1;
    let z = this.read(last, x, y);
    for (let k = last - 1; k >= 0; k--) {
      const w = this.weight(k, x, y);
      if (w > 0) z += (this.read(k, x, y) - z) * w;
    }
    return z;
  }
}
