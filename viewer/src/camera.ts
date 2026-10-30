// An orbit camera around the globe (radius 1), north up. Its position is given in the planet
// frame at the current time, so a link to a place 250 Ma looks at where that place was.
import { unitVector, toLatLon } from '../../core/quat.ts';
import { invert, lookAt, multiply, norm, perspective, sub, transform, type Mat4, type V3 } from './mat.ts';

export interface CameraState {
  lat: number;
  lon: number;
  /** distance from the centre, in Earth radii */
  dist: number;
}

export const MIN_DIST = 1.25;
export const MAX_DIST = 8;
const FOV = (32 * Math.PI) / 180;

export class Camera {
  view!: Mat4;
  proj!: Mat4;
  viewProj!: Mat4;
  invViewProj!: Mat4;
  eye!: V3;
  width = 1;
  height = 1;

  update(s: CameraState, width: number, height: number): void {
    this.width = width;
    this.height = height;
    const lat = Math.max(-89.5, Math.min(89.5, s.lat));
    this.eye = unitVector(lat, s.lon).map((c) => c * s.dist) as V3;
    this.view = lookAt(this.eye, [0, 0, 0], [0, 0, 1]);
    this.proj = perspective(FOV, width / height, 0.02, 50);
    this.viewProj = multiply(this.proj, this.view);
    this.invViewProj = invert(this.viewProj);
  }

  /** Screen position (CSS pixels) of a world point, and whether it faces the camera. */
  project(p: V3): { x: number; y: number; visible: boolean } {
    const c = transform(this.viewProj, p);
    const x = ((c[0] / c[3]) * 0.5 + 0.5) * this.width;
    const y = (1 - ((c[1] / c[3]) * 0.5 + 0.5)) * this.height;
    // On the near side of the globe if the point is in front of the horizon plane.
    const d = this.eye[0] * p[0] + this.eye[1] * p[1] + this.eye[2] * p[2];
    return { x, y, visible: d > 1.0 };
  }

  /** The globe point under a screen position, or undefined if the ray misses. */
  pick(x: number, y: number): { point: V3; lat: number; lon: number } | undefined {
    const nx = (x / this.width) * 2 - 1;
    const ny = 1 - (y / this.height) * 2;
    const a = transform(this.invViewProj, [nx, ny, -1]);
    const b = transform(this.invViewProj, [nx, ny, 1]);
    const p0: V3 = [a[0] / a[3], a[1] / a[3], a[2] / a[3]];
    const p1: V3 = [b[0] / b[3], b[1] / b[3], b[2] / b[3]];
    const d = norm(sub(p1, p0));
    // |p0 + s d| = 1
    const bq = p0[0] * d[0] + p0[1] * d[1] + p0[2] * d[2];
    const cq = p0[0] * p0[0] + p0[1] * p0[1] + p0[2] * p0[2] - 1;
    const disc = bq * bq - cq;
    if (disc < 0) return undefined;
    const s = -bq - Math.sqrt(disc);
    const point: V3 = [p0[0] + s * d[0], p0[1] + s * d[1], p0[2] + s * d[2]];
    const [lat, lon] = toLatLon(point);
    return { point, lat, lon };
  }
}
