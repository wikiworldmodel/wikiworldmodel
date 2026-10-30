import { describe, expect, it } from 'vitest';
import { bounds, centre, formatTime, formatTimeValue, fromMa, parseLag, parseTime, PRESENT_YEAR, timeFromParam, timeToParam, toMa } from '../../../core/time.ts';

describe('time axis', () => {
  it('uses astronomical years: 44 BCE is −43, and a bare year is that whole year', () => {
    expect(parseTime('44 BCE')).toEqual({ kind: 'interval', lo: -43, hi: -42 });
    expect(parseTime('80 CE')).toEqual({ kind: 'interval', lo: 80, hi: 81 });
    expect(parseTime(1990.611)).toEqual({ kind: 'instant', t: 1990.611 });
    expect(parseTime({ lo: 1990, hi: 2000 })).toEqual({ kind: 'interval', lo: 1990, hi: 2001 });
  });
  it('counts BP, ka, Ma and Ga back from 1950, and Myr or Gyr from now forward', () => {
    expect(fromMa(66)).toBe(1950 - 66e6);
    expect(toMa(fromMa(280))).toBeCloseTo(280, 9);
    expect(parseTime('4550 BP')).toEqual({ kind: 'instant', t: -2600 });
    expect(parseTime('12.9 ka')).toEqual({ kind: 'instant', t: 1950 - 12900 });
    expect(parseTime('1 Ga')).toEqual({ kind: 'instant', t: 1950 - 1e9 });
    expect(parseTime('5 Gyr from now')).toEqual({ kind: 'instant', t: PRESENT_YEAR + 5e9 });
  });
  it('takes each bound in its own unit, and lo is always the earlier time', () => {
    expect(parseTime({ lo: '1 Ga', hi: 2100 })).toEqual({ kind: 'interval', lo: 1950 - 1e9, hi: 2101 });
    expect(parseTime({ lo: '290.1 Ma', hi: '283.5 Ma' })).toEqual({ kind: 'interval', lo: fromMa(290.1), hi: fromMa(283.5) });
    expect(() => parseTime({ lo: '283.5 Ma', hi: '290.1 Ma' })).toThrow(/lo is later than hi/);
  });
  it('tells an open end (still holds) from an unknown one', () => {
    expect(parseTime({ lo: 80 })).toEqual({ kind: 'interval', lo: 80, hi: Infinity });
    expect(parseTime({ lo: 80, hi: 'unknown' })).toEqual({ kind: 'interval', lo: 80, hi: Infinity, hiUnknown: true });
    expect(parseTime('unknown')).toEqual({ kind: 'unknown' });
  });
  it('reads a normal distribution at ±2σ for bounds and its mean for the centre', () => {
    const v = parseTime({ mean: '59 Ma', sd: '1 Myr' });
    expect(bounds(v)).toEqual([fromMa(61), fromMa(57)]);
    expect(centre(v)).toEqual([fromMa(59), fromMa(59)]);
    expect(formatTimeValue(v)).toBe('59 ± 1 Ma (1σ)');
  });
  it('refers to another record\'s interval or edge, with a lag', () => {
    expect(parseTime({ ref: 'ics/artinskian' })).toEqual({ kind: 'ref', ref: 'ics/artinskian', lag: [0, 0] });
    expect(parseTime({ ref: 'x/fire', edge: 'end', lag: { lo: '10 yr', hi: '30 yr' } })).toEqual({ kind: 'ref', ref: 'x/fire', edge: 'end', lag: [10, 30] });
    expect(parseLag(undefined)).toEqual([0, Infinity]);
    expect(parseLag('0 yr')).toEqual([0, 0]);
    expect(parseLag({ lo: '1 kyr' })).toEqual([1000, Infinity]);
  });
  it('rejects forms outside the convention', () => {
    for (const bad of ['66 Myr', '66Ma', { ma: 66 }, { mean: 66 }, { lo: '1 Ga', hi: '2 Ga' }]) expect(() => parseTime(bad as never)).toThrow();
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
