// Unit quaternions for finite rotations on the sphere, stored as [w, x, y, z].
// Rotating v by q is q·v·q*. Composing "apply b, then a" is mul(a, b).

export type Quat = [number, number, number, number];
export type Vec3 = [number, number, number];

export const IDENTITY: Quat = [1, 0, 0, 0];

const DEG = Math.PI / 180;

export function unitVector(latDeg: number, lonDeg: number): Vec3 {
  const lat = latDeg * DEG;
  const lon = lonDeg * DEG;
  return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
}

export function toLatLon(v: Vec3): [number, number] {
  const [x, y, z] = v;
  const lat = Math.atan2(z, Math.hypot(x, y)) / DEG;
  const lon = Math.atan2(y, x) / DEG;
  return [lat, lon];
}

/** A finite rotation given as an Euler pole and an angle, as in GPlates rotation files. */
export function fromPole(latDeg: number, lonDeg: number, angleDeg: number): Quat {
  if (angleDeg === 0) return [1, 0, 0, 0];
  const [x, y, z] = unitVector(latDeg, lonDeg);
  const h = (angleDeg * DEG) / 2;
  const s = Math.sin(h);
  return [Math.cos(h), s * x, s * y, s * z];
}

export function mul(a: Quat, b: Quat): Quat {
  const [aw, ax, ay, az] = a;
  const [bw, bx, by, bz] = b;
  return [
    aw * bw - ax * bx - ay * by - az * bz,
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
  ];
}

export function conj(q: Quat): Quat {
  return [q[0], -q[1], -q[2], -q[3]];
}

export function normalize(q: Quat): Quat {
  const n = Math.hypot(q[0], q[1], q[2], q[3]);
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

export function dot(a: Quat, b: Quat): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
}

/** Spherical linear interpolation along the shorter arc, as GPlates interpolates finite rotations. */
export function slerp(a: Quat, b: Quat, t: number): Quat {
  let d = dot(a, b);
  let bb = b;
  if (d < 0) {
    d = -d;
    bb = [-b[0], -b[1], -b[2], -b[3]];
  }
  if (d > 1 - 1e-12) {
    return normalize([
      a[0] + (bb[0] - a[0]) * t,
      a[1] + (bb[1] - a[1]) * t,
      a[2] + (bb[2] - a[2]) * t,
      a[3] + (bb[3] - a[3]) * t,
    ]);
  }
  const omega = Math.acos(Math.min(1, d));
  const s = Math.sin(omega);
  const wa = Math.sin((1 - t) * omega) / s;
  const wb = Math.sin(t * omega) / s;
  return [
    wa * a[0] + wb * bb[0],
    wa * a[1] + wb * bb[1],
    wa * a[2] + wb * bb[2],
    wa * a[3] + wb * bb[3],
  ];
}

export function rotate(q: Quat, v: Vec3): Vec3 {
  // v' = v + 2w(u×v) + 2u×(u×v), with u the vector part of q
  const [w, x, y, z] = q;
  const [vx, vy, vz] = v;
  const cx = y * vz - z * vy;
  const cy = z * vx - x * vz;
  const cz = x * vy - y * vx;
  const ccx = y * cz - z * cy;
  const ccy = z * cx - x * cz;
  const ccz = x * cy - y * cx;
  return [vx + 2 * (w * cx + ccx), vy + 2 * (w * cy + ccy), vz + 2 * (w * cz + ccz)];
}

/** Great-circle distance between two unit vectors, in radians. */
export function angleBetween(a: Vec3, b: Vec3): number {
  const cx = a[1] * b[2] - a[2] * b[1];
  const cy = a[2] * b[0] - a[0] * b[2];
  const cz = a[0] * b[1] - a[1] * b[0];
  return Math.atan2(Math.hypot(cx, cy, cz), a[0] * b[0] + a[1] * b[1] + a[2] * b[2]);
}
