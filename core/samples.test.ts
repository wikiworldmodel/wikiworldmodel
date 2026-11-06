// Uncertainty travels as samples (docs/STRUCTURE.md section 3.2): member 0 is the central value, every member is
// the same on every machine, and running a model once per member carries the uncertainty of what it reads.
import { describe, expect, it } from 'vitest';
import { BETWEEN, central, perMember, sample, samples, spread, uncertainOf } from './samples.ts';

describe('samples', () => {
  it("read the world's quantities: a bare number is a value whose uncertainty nobody gave", () => {
    expect(uncertainOf(3)).toEqual({ kind: 'unknown', value: 3 });
    expect(uncertainOf({ mean: 66.038, sd: 0.049 })).toEqual({ kind: 'normal', mean: 66.038, sd: 0.049 });
    expect(uncertainOf({ lo: 9, hi: 6 })).toEqual({ kind: 'range', lo: 6, hi: 9 });
    expect(() => uncertainOf('six')).toThrow();
  });

  it('make member 0 the central value', () => {
    expect(sample({ kind: 'normal', mean: 10, sd: 2 }, 'x', 0)).toBe(10);
    expect(sample({ kind: 'range', lo: 6, hi: 9 }, 'x', 0)).toBe(7.5);
    expect(central({ kind: 'members', values: [3, 1, 2] })).toBe(2);
    expect(sample({ kind: 'alternatives', values: [{ id: 'a', value: 5 }, { id: 'b', value: 8 }] }, 'x', 0)).toBe(5);
  });

  it('draw the same member for the same seed, and others for others', () => {
    const u = { kind: 'normal' as const, mean: 0, sd: 1 };
    expect(samples(u, 'claim#a', 32)).toEqual(samples(u, 'claim#a', 32));
    expect(samples(u, 'claim#a', 32)).not.toEqual(samples(u, 'claim#b', 32));
  });

  it('spread a normal value as its sd says, and keep a range inside its ends', () => {
    const n = spread(samples({ kind: 'normal', mean: 100, sd: 5 }, 'm', 4000));
    expect(n.median).toBeCloseTo(100, 0);
    expect(n.sd).toBeGreaterThan(4.6);
    expect(n.sd).toBeLessThan(5.4);
    expect(n.hi - n.lo).toBeGreaterThan(15);
    expect(n.hi - n.lo).toBeLessThan(18);
    const r = samples({ kind: 'range', lo: 6, hi: 9 }, 'r', 500);
    expect(Math.min(...r)).toBeGreaterThanOrEqual(6);
    expect(Math.max(...r)).toBeLessThanOrEqual(9);
  });

  it('run a model once per member, joint across what it reads: N runs, not N squared', () => {
    const a = { kind: 'normal' as const, mean: 10, sd: 1 };
    const b = { kind: 'members' as const, values: [1, 2, 3, 4] };
    let runs = 0;
    const out = perMember(16, (m) => {
      runs++;
      return sample(a, 'a', m) * sample(b, 'b', m);
    });
    expect(runs).toBe(16);
    expect(out[0]).toBe(10 * 2.5);
  });

  it('band alternatives from the lowest to the highest', () => {
    const s = spread([-80, -116], BETWEEN);
    expect([s.central, s.lo, s.hi]).toEqual([-80, -116, -80]);
  });
});
