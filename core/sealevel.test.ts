// The sea level a coast on today's relief is drawn at: the series between its rows, and today's level at the present.
import { describe, expect, it } from 'vitest';
import { seaLevelAt } from './sealevel.ts';
import { PRESENT_YEAR } from './time.ts';

const ka = (k: number) => PRESENT_YEAR - k * 1000;
/** A made-up stack: low at 20 ka, its youngest row at 5 ka a little above today's. */
const ROWS = [
  [ka(30), -80, -90, -70],
  [ka(20), -120, -130, -110],
  [ka(10), -40, -50, -30],
  [ka(5), 4, -6, 14],
] as const;

describe('seaLevelAt', () => {
  it('reads the series straight between its rows', () => {
    expect(seaLevelAt(ROWS, ka(20))).toBe(-120);
    expect(seaLevelAt(ROWS, ka(25))).toBeCloseTo(-100, 9);
    expect(seaLevelAt(ROWS, ka(15))).toBeCloseTo(-80, 9);
  });

  it('goes from its youngest row to today’s level at the present, and holds it after', () => {
    expect(seaLevelAt(ROWS, ka(5))).toBe(4);
    expect(seaLevelAt(ROWS, ka(2.5))).toBeCloseTo(2, 9);
    expect(seaLevelAt(ROWS, PRESENT_YEAR)).toBe(0);
    expect(seaLevelAt(ROWS, PRESENT_YEAR + 5000)).toBe(0);
  });

  it('holds its oldest row before it, and is today’s level with no rows', () => {
    expect(seaLevelAt(ROWS, ka(100))).toBe(-80);
    expect(seaLevelAt([], ka(20))).toBe(0);
  });
});
