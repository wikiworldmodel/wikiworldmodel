// The camera in a scene of the sea (docs/slices/TENTH-SLICE.md): the pure functions of viewer/src/city/view.ts that
// take a visitor down through the sea's surface to near its floor, and leave a scene on land as it was.
import { describe, expect, it } from 'vitest';
import { EARTH_RADIUS, fromLocal } from '../../../core/city.ts';
import { GroundSampler } from '../../../world/generators/city/ground.ts';
import { localView, lookThrough, underSea } from '../../../viewer/src/city/view.ts';

/** A flat ground at a height, over 20 km. */
const flat = (z: number) => new GroundSampler([{ nx: 201, ny: 201, x0: -10000, y0: -10000, cell: 100, z: new Float32Array(201 * 201).fill(z) }]);
const ORIGIN = { lat: 48, lon: 2 };

describe('the way under a sea', () => {
  it('is none of a sight line above it, all of one below it, and the share of one through it', () => {
    expect(underSea([0, 0, 10], [100, 0, 5])).toBe(0);
    expect(underSea([0, 0, -10], [30, 40, -10])).toBeCloseTo(50, 9);
    // From 10 m up to 30 m down: three quarters of the way is in the water, either way round.
    expect(underSea([0, 0, 10], [0, 0, -30])).toBeCloseTo(30, 9);
    expect(underSea([0, 0, -30], [0, 0, 10])).toBeCloseTo(30, 9);
    expect(underSea([0, 0, 5], [0, 0, -5], 10)).toBeCloseTo(10, 9);
  });
});

describe('a look through a point', () => {
  it('comes down to the ground beyond it, and the camera it gives puts the eye back where it was', () => {
    const ground = flat(-40);
    const eye: [number, number, number] = [120, -80, -20];
    const at: [number, number, number] = [130, -80, -21];
    const aim = lookThrough(eye, at, ground)!;
    expect(aim).toBeDefined();
    expect(aim.target[2]).toBeCloseTo(-40, 1);
    expect(aim.heading).toBeCloseTo(90, 6);
    // Down one metre in ten: the target is two hundred metres on.
    expect(aim.target[0]).toBeCloseTo(320, 0);
    const [lat, lon] = fromLocal(ORIGIN, aim.target[0], aim.target[1]);
    const v = localView({ lat, lon, dist: 1 + aim.range / EARTH_RADIUS, heading: aim.heading, tilt: aim.tilt }, ORIGIN, ground, 960, 560, 0);
    for (let k = 0; k < 3; k++) expect(v.eye[k]).toBeCloseTo(eye[k], 1);
  });

  it('is none where it does not come down', () => {
    expect(lookThrough([0, 0, -20], [10, 0, -10], flat(-40))).toBeUndefined();
  });
});

describe('the eye in a scene of the sea', () => {
  it('goes down through the surface to a little over the floor, and sees what swims beside it', () => {
    const ground = flat(-40);
    const low = localView({ ...ORIGIN, dist: 1 + 2 / EARTH_RADIUS, heading: 30, tilt: 80 }, ORIGIN, ground, 960, 560, 0);
    expect(low.eye[2]).toBeLessThan(0);
    expect(low.eye[2] + 40).toBeGreaterThanOrEqual(1.7 - 1e-9);
    expect(low.eye[2] + 40).toBeLessThan(3);
    // Mid-water, high over the floor, the near plane is still close by.
    const mid = localView({ ...ORIGIN, dist: 1 + 150 / EARTH_RADIUS, heading: 30, tilt: 82 }, ORIGIN, ground, 960, 560, 0);
    expect(mid.eye[2]).toBeLessThan(0);
    expect(mid.near).toBeLessThanOrEqual(0.5);
  });

  it('is on land as it was: the sea, where none is said, changes nothing', () => {
    const ground = flat(25);
    const s = { ...ORIGIN, dist: 1 + 150 / EARTH_RADIUS, heading: 30, tilt: 82 };
    const a = localView(s, ORIGIN, ground, 960, 560);
    expect(a.near).toBeCloseTo(Math.max(0.2, Math.min(a.clearance * 0.4, a.range * 0.3, 40000)), 12);
  });
});
