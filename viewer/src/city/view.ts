// The camera near the ground, in a site's local metres. It works in double precision and hands
// the GPU only what is relative to the eye, so a view from the street is as steady as one from
// orbit. The state it reads is the same as the globe's: a point on the ground, a distance from it
// (in Earth radii, plus one), a heading and a tilt.
import { EARTH_RADIUS, toLocal } from '../../../core/city.ts';
import type { GroundSampler } from '../../../world/generators/city/ground.ts';
import type { CameraState } from '../camera.ts';
import { perspective, type Mat4, type V3 } from '../mat.ts';

const RAD = Math.PI / 180;
export const drop = (x: number, y: number) => (x * x + y * y) / (2 * EARTH_RADIUS);

/** How high the eye is held above the ground, walking. */
export const EYE_HEIGHT = 1.7;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export interface LocalView {
  /** where the eye is, its z above sea level before the curve of the Earth is taken off */
  eye: V3;
  /** the eye as the GPU sees it: the curve taken off */
  gpuEye: V3;
  target: V3;
  forward: V3;
  right: V3;
  up: V3;
  view: Mat4;
  proj: Mat4;
  farProj: Mat4;
  fov: number;
  aspect: number;
  near: number;
  far: number;
  range: number;
  clearance: number;
  width: number;
  height: number;
}

/** Field of view: narrow from orbit, as the globe has it, and wider nearer the ground, as an eye would see. */
export function fovFor(range: number): number {
  return (32 + 26 * (1 - smooth(Math.log(1500), Math.log(60000), Math.log(Math.max(range, 1))))) * RAD;
}

export function localView(s: CameraState, origin: { lat: number; lon: number }, ground: GroundSampler, width: number, height: number): LocalView {
  const range = (s.dist - 1) * EARTH_RADIUS;
  const [tx, ty] = toLocal(origin, s.lat, s.lon);
  const h = (s.heading ?? 0) * RAD;
  const tau = (s.tilt ?? 0) * RAD;
  const fx = Math.sin(h);
  const fy = Math.cos(h);
  const st = Math.sin(tau);
  const ct = Math.cos(tau);
  const forward: V3 = [fx * st, fy * st, -ct];
  let tz = ground.at(tx, ty);
  let ex = tx - forward[0] * range;
  let ey = ty - forward[1] * range;
  let ez = tz - forward[2] * range;
  const g = ground.at(ex, ey);
  const lowest = g + EYE_HEIGHT;
  if (ez < lowest) {
    tz += lowest - ez;
    ez = lowest;
  }
  const right: V3 = [fy, -fx, 0];
  const up: V3 = [right[1] * forward[2] - right[2] * forward[1], right[2] * forward[0] - right[0] * forward[2], right[0] * forward[1] - right[1] * forward[0]];
  const view = new Float32Array([right[0], up[0], -forward[0], 0, right[1], up[1], -forward[1], 0, right[2], up[2], -forward[2], 0, 0, 0, 0, 1]);
  const clearance = Math.max(ez - g, 0.5);
  const fov = fovFor(range);
  const aspect = width / height;
  const near = Math.max(0.2, Math.min(clearance * 0.4, range * 0.3, 40000));
  const far = Math.max(26000, clearance * 6);
  return {
    eye: [ex, ey, ez],
    gpuEye: [ex, ey, ez - drop(ex, ey)],
    target: [tx, ty, tz],
    forward,
    right,
    up,
    view,
    proj: perspective(fov, aspect, near, far),
    farProj: perspective(fov, aspect, far * 0.6, Math.max(far * 200, 5e6)),
    fov,
    aspect,
    near,
    far,
    range,
    clearance,
    width,
    height,
  };
}

/** Where a point of the site lands on the screen, in CSS pixels; undefined if it is behind the eye. */
export function projectLocal(v: LocalView, x: number, y: number, z: number): { x: number; y: number; depth: number } | undefined {
  const dx = x - v.eye[0];
  const dy = y - v.eye[1];
  const dz = z - v.eye[2];
  const c = dx * v.forward[0] + dy * v.forward[1] + dz * v.forward[2];
  if (c <= 0.5) return undefined;
  const k = 1 / (Math.tan(v.fov / 2) * c);
  const rx = dx * v.right[0] + dy * v.right[1] + dz * v.right[2];
  const ry = dx * v.up[0] + dy * v.up[1] + dz * v.up[2];
  return { x: (0.5 + 0.5 * ((rx * k) / v.aspect)) * v.width, y: (0.5 - 0.5 * ry * k) * v.height, depth: c };
}

/** The direction of a screen position, from the eye. */
export function rayOf(v: LocalView, sx: number, sy: number): V3 {
  const t = Math.tan(v.fov / 2);
  const ax = ((sx / v.width) * 2 - 1) * t * v.aspect;
  const ay = (1 - (sy / v.height) * 2) * t;
  const d: V3 = [v.forward[0] + v.right[0] * ax + v.up[0] * ay, v.forward[1] + v.right[1] * ax + v.up[1] * ay, v.forward[2] + v.right[2] * ax + v.up[2] * ay];
  const l = Math.hypot(d[0], d[1], d[2]);
  return [d[0] / l, d[1] / l, d[2] / l];
}

/** Where a ray from the eye meets the ground, marching out in growing steps. */
export function groundHit(v: LocalView, dir: V3, ground: GroundSampler): V3 | undefined {
  let t = Math.max(v.clearance * 0.1, 1);
  let prev = 0;
  for (let i = 0; i < 90; i++) {
    const x = v.eye[0] + dir[0] * t;
    const y = v.eye[1] + dir[1] * t;
    const z = v.eye[2] + dir[2] * t;
    if (z < ground.at(x, y)) {
      // Close in on it.
      let a = prev;
      let b = t;
      for (let k = 0; k < 16; k++) {
        const m = (a + b) / 2;
        if (v.eye[2] + dir[2] * m < ground.at(v.eye[0] + dir[0] * m, v.eye[1] + dir[1] * m)) b = m;
        else a = m;
      }
      return [v.eye[0] + dir[0] * b, v.eye[1] + dir[1] * b, v.eye[2] + dir[2] * b];
    }
    prev = t;
    t *= 1.14;
    t += 1;
    if (t > 2e6) break;
  }
  return undefined;
}

/**
 * The tilt the camera takes on by itself as it comes down: straight down from high up, and a long
 * look over the land near the ground.
 */
export function autoTilt(range: number): number {
  return 66 * (1 - smooth(Math.log(4000), Math.log(420000), Math.log(Math.max(range, 1))));
}

/**
 * Where the sun is at an hour at a site's latitude: a direction, x east, y north, z up. The sun's declination is the
 * day's, in radians, where a scene has a day; a late spring day in the site's hemisphere where it does not.
 */
export function sunAt(hour: number, lat: number, declination?: number): V3 {
  const decl = declination ?? (lat < 0 ? -16 : 16) * RAD;
  const phi = lat * RAD;
  const ha = ((hour - 12) / 12) * Math.PI;
  const sinEl = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(ha);
  const cosEl = Math.sqrt(Math.max(0, 1 - sinEl * sinEl));
  // East of south by the hour angle.
  const east = -Math.cos(decl) * Math.sin(ha);
  const north = Math.cos(phi) * Math.sin(decl) - Math.sin(phi) * Math.cos(decl) * Math.cos(ha);
  const l = Math.hypot(east, north) || 1;
  return [(east / l) * cosEl, (north / l) * cosEl, sinEl];
}
