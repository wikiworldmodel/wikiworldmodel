import { describe, expect, it } from 'vitest';
import { ORIGIN, solve, type Constraint } from '../../../core/stn.ts';

const c = (source: string, from: string, to: string, lo: number, hi: number): Constraint => ({ source, from, to, lo, hi });

describe('simple temporal network', () => {
  it('derives the tightest bounds', () => {
    const s = solve(['a', 'b'], [c('a-date', ORIGIN, 'a', 10, 20), c('b-after-a', 'a', 'b', 5, 7)]);
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    expect(s.bounds.get('b')).toMatchObject({ lo: 15, hi: 27 });
    expect(s.bounds.get('b')!.loBy).toEqual(['a-date', 'b-after-a']);
  });
  it('reports a minimal conflict: exactly the constraints on the negative cycle', () => {
    const s = solve(['a', 'b', 'c'], [
      c('a-date', ORIGIN, 'a', 100, 100),
      c('b-date', ORIGIN, 'b', 50, 60),
      c('b-after-a', 'a', 'b', 0, Infinity),
      c('c-unrelated', ORIGIN, 'c', 0, 1000),
    ]);
    expect(s.ok).toBe(false);
    if (s.ok) return;
    expect(s.conflict.constraints.map((x) => x.source).sort()).toEqual(['a-date', 'b-after-a', 'b-date']);
    expect(s.conflict.slack).toBe(-40);
  });
  it('accepts equalities and zero-length cycles', () => {
    const s = solve(['a', 'b'], [c('eq', 'a', 'b', 0, 0), c('a', ORIGIN, 'a', 5, 5)]);
    expect(s.ok && s.bounds.get('b')).toMatchObject({ lo: 5, hi: 5 });
  });
});
