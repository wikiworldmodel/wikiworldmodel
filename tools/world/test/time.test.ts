import { describe, expect, it } from 'vitest';
import { bounds, formatTime, fromMa, parseTime, timeFromParam, timeToParam, toMa } from '../../../core/time.ts';

describe('time axis', () => {
  it('uses astronomical years: 44 BCE is −43', () => {
    expect(parseTime({ bce: 44 })).toEqual({ kind: 'instant', t: -43 });
    expect(parseTime({ ce: 80 })).toEqual({ kind: 'instant', t: 80 });
  });
  it('counts Ma back from 1950', () => {
    expect(fromMa(66)).toBe(1950 - 66e6);
    expect(toMa(fromMa(280))).toBeCloseTo(280, 9);
  });
  it('reads a stated ± of unknown level as 1σ, the wider reading', () => {
    expect(bounds(parseTime({ ma: 59, pm: 1 }))).toEqual([fromMa(61), fromMa(57)]);
    expect(bounds(parseTime({ ma: 278.4, pm: 2.2, sigma: 2 }))[0]).toBeCloseTo(fromMa(280.6), 3);
  });
  it('orders interval ends regardless of how they are written', () => {
    expect(parseTime({ ma: [279.3, 290.1] })).toEqual({ kind: 'interval', lo: fromMa(290.1), hi: fromMa(279.3) });
  });
  it('round-trips through the URL form', () => {
    for (const t of [fromMa(66.043), fromMa(280), 1950, fromMa(0.0001), Math.round(fromMa(123.456789))]) {
      const r = Math.round(t);
      expect(timeFromParam(timeToParam(r))).toBe(r);
    }
  });
  it('formats by magnitude', () => {
    expect(formatTime(fromMa(66.04))).toBe('66.04 Ma');
    expect(formatTime(fromMa(280))).toBe('280 Ma');
    expect(formatTime(-43)).toBe('44 BCE');
  });
});
