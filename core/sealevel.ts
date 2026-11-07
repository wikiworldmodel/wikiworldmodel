// The sea level a coast is drawn at, for an elevation field on a fixed datum (today's relief): a series of sea level
// relative to today's, read straight between its rows. From its youngest row the level goes straight to nothing at the
// present, where the datum is today's sea level by definition, and it stays there after. Before its oldest row the series
// says nothing, and the field does not cover the time.
import { PRESENT_YEAR } from './time.ts';

/** A series' rows, oldest first: [year, value, …]. */
export type SeaLevelRows = readonly (readonly [number, number, ...unknown[]])[];

/** Sea level relative to today's at `t` (an astronomical year), in the series' unit. */
export function seaLevelAt(rows: SeaLevelRows, t: number): number {
  if (!rows.length || t >= PRESENT_YEAR) return 0;
  if (t <= rows[0][0]) return rows[0][1];
  const last = rows[rows.length - 1];
  if (t >= last[0]) return last[0] >= PRESENT_YEAR ? 0 : (last[1] * (PRESENT_YEAR - t)) / (PRESENT_YEAR - last[0]);
  let lo = 0;
  let hi = rows.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (rows[mid][0] <= t) lo = mid;
    else hi = mid;
  }
  const [t0, v0] = rows[lo];
  const [t1, v1] = rows[hi];
  return t1 === t0 ? v0 : v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
}
