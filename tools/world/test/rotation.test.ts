// The rotation model must reproduce pyGPlates, the reference implementation of GPlates.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bakeRotationModel, parseRot, RotationModel } from '../../../core/rotation-model.ts';
import { fromPole, mul, rotate, slerp, unitVector, angleBetween } from '../../../core/quat.ts';
import { sha256 } from '../src/util.ts';
import { dataset } from './helpers.ts';

/** Rotation angle between two unit quaternions, in degrees, robust near zero. */
function distanceDeg(a: number[], b: number[]): number {
  const s = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0 ? -1 : 1;
  const d = Math.hypot(a[0] - s * b[0], a[1] - s * b[1], a[2] - s * b[2], a[3] - s * b[3]);
  return (4 * Math.asin(d / 2) * 180) / Math.PI;
}

describe('quaternions', () => {
  it('rotates a point by an Euler pole the right way round', () => {
    // 90° about the north pole takes (0°N, 0°E) to (0°N, 90°E).
    const p = rotate(fromPole(90, 0, 90), unitVector(0, 0));
    expect(angleBetween(p, unitVector(0, 90))).toBeLessThan(1e-12);
  });
  it('composes in order: mul(a, b) applies b first', () => {
    const a = fromPole(90, 0, 90);
    const b = fromPole(0, 0, 90);
    const v = unitVector(0, 90);
    const viaMul = rotate(mul(a, b), v);
    const stepwise = rotate(a, rotate(b, v));
    expect(angleBetween(viaMul, stepwise)).toBeLessThan(1e-12);
  });
  it('slerps along the shorter arc', () => {
    const a = fromPole(10, 20, 30);
    const b = fromPole(10, 20, 40);
    const half = slerp(a, [-b[0], -b[1], -b[2], -b[3]], 0.5);
    expect(distanceDeg(half, fromPole(10, 20, 35))).toBeLessThan(1e-9);
  });
});

describe('PALEOMAP rotation model', async () => {
  const rotPath = await dataset('paleomap-plate-model', 'rotations');
  const text = readFileSync(rotPath, 'latin1');
  const model = new RotationModel(bakeRotationModel(parseRot(text)));
  const golden = JSON.parse(readFileSync(new URL('./fixtures/paleomap-rotations-pygplates.json', import.meta.url), 'utf8'));

  it('is the rotation file the reference values were computed from', () => {
    expect(sha256(readFileSync(rotPath))).toBe(golden.rotationFileSha256);
  });

  it('matches pyGPlates for every plate at every reference age, crossovers included', () => {
    let worst = 0;
    const bad: string[] = [];
    for (const [plate, age, ...q] of golden.cases as number[][]) {
      const d = distanceDeg(model.total(plate, age), q);
      worst = Math.max(worst, d);
      if (d > 1e-7) bad.push(`${plate} @ ${age} Ma: ${d.toExponential(2)}°`);
    }
    expect(bad).toEqual([]);
    expect(golden.cases.length).toBeGreaterThan(2000);
    expect(worst).toBeLessThan(1e-7);
  });
});
