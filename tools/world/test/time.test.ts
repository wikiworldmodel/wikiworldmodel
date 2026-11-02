import { describe, expect, it } from 'vitest';
import { bounds, centre, dateAt, formatTime, formatTimeValue, fromMa, parseLag, parsePoint, parseTime, PRESENT_YEAR, quantizeTime, timeFromParam, timeToParam, toMa } from '../../../core/time.ts';

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
  it('writes the future from now, and reads it back', () => {
    expect(parseTime('10 kyr from now')).toEqual({ kind: 'instant', t: PRESENT_YEAR + 1e4 });
    expect(formatTime(PRESENT_YEAR + 5e9)).toBe('5 Gyr from now');
    expect(formatTime(PRESENT_YEAR + 1.08e9)).toBe('1.08 Gyr from now');
    expect(formatTime(PRESENT_YEAR + 4e4)).toBe('40 kyr from now');
    expect(formatTime(2012)).toBe('2012 CE');
    for (const t of [PRESENT_YEAR + 62, PRESENT_YEAR + 7.6e9]) expect(timeFromParam(timeToParam(t))).toBe(t);
  });
  it('formats by magnitude', () => {
    expect(formatTime(fromMa(66.04))).toBe('66.04 Ma');
    expect(formatTime(fromMa(280))).toBe('280 Ma');
    expect(formatTime(-43)).toBe('44 BCE');
  });
  it('names the calendar year a time falls in, and its middle is still that year', () => {
    // 44 BCE runs from −43 to −42: −42.2 is in it, −43.8 in the year before.
    expect(formatTime(-42.2)).toBe('44 BCE');
    expect(formatTime(-43.8)).toBe('45 BCE');
    expect(formatTime(80.5)).toBe('80 CE');
    expect(formatTime(-3198.5)).toBe('3200 BCE');
    expect(formatTimeValue(parseTime('80 CE'))).toBe('80 CE');
    expect(formatTimeValue(parseTime({ lo: 1990, hi: 2000 }))).toBe('1990 CE – 2000 CE');
    expect(formatTimeValue(parseTime({ hi: '600 BCE' }))).toBe('no later than 600 BCE');
  });
});

describe('calendar dates', () => {
  it('reads a day as that whole day, in the Julian calendar before 1582', () => {
    const ides = parseTime('15 March 44 BCE');
    expect(ides.kind).toBe('interval');
    if (ides.kind !== 'interval') return;
    // 73 days into a common year of 365.
    expect(ides.lo).toBeCloseTo(-43 + 73 / 365, 12);
    expect(ides.hi - ides.lo).toBeCloseTo(1 / 365, 12);
    expect(formatTimeValue(ides)).toBe('15 March 44 BCE');
    expect(dateAt(ides.lo)).toEqual({ year: -43, month: 3, day: 15 });
  });
  it('reads a month as that whole month, and ranges of days', () => {
    expect(formatTimeValue(parseTime('March 44 BCE'))).toBe('March 44 BCE');
    expect(formatTimeValue(parseTime({ lo: '2 September 31 BCE', hi: '16 January 27 BCE' }))).toBe('2 September 31 BCE – 16 January 27 BCE');
    expect(formatTimeValue(parseTime({ lo: '1 Ga', hi: 2100 }))).toBe('1000 Ma – 2100 CE');
  });
  it('switches to the Gregorian calendar on 15 October 1582, with no gap on the axis', () => {
    const a = parsePoint('4 October 1582 CE');
    const b = parsePoint('15 October 1582 CE');
    // 1582 lost ten days, so its days are a 355th of the year.
    expect(b.t - a.t).toBeCloseTo(1 / 355, 12);
    expect(a.whole).toBeCloseTo(1 / 355, 12);
    expect(formatTimeValue(parseTime('25 October 1917 CE Julian'))).toBe('7 November 1917 CE');
    expect(formatTime(parsePoint('31 December 1 BCE').t, 1 / 365)).toBe('31 December 1 BCE');
    expect(parsePoint('1 January 1 CE').t).toBe(1);
  });
  it('rejects days a calendar does not have, and dates before day numbers start', () => {
    expect(() => parseTime('29 February 1900 CE')).toThrow(/not a date in the Gregorian calendar/);
    expect(() => parseTime('30 February 44 BCE')).toThrow(/not a date in the Julian calendar/);
    expect(() => parseTime('15 March 5000 BCE')).toThrow(/from 4713 BCE/);
    expect(() => parseTime('15 March 44')).toThrow(/not a time/);
  });
  it('shows a month or a day when the resolution asks for it', () => {
    expect(formatTime(-42.79, 0.01)).toBe('March 44 BCE');
    expect(formatTime(-42.7986, 0.001)).toBe('15 March 44 BCE');
    expect(formatTime(-42.79, 1)).toBe('44 BCE');
  });
  it('takes lags in days', () => {
    expect(parseLag('40 days')).toEqual([40 / 365.25, 40 / 365.25]);
  });
  it('carries historical times in the URL to a thousandth of a year, deep times in Ma', () => {
    expect(timeToParam(-42.79612)).toBe('-42.796');
    expect(timeFromParam('-42.796')).toBe(-42.796);
    expect(quantizeTime(-42.79612)).toBe(-42.796);
    expect(timeToParam(fromMa(66.043))).toBe('66.043Ma');
    expect(timeFromParam('44BCE')).toBe(-43);
    expect(timeFromParam('476CE')).toBe(476);
  });
});
