// The sea's atlas (tools/world/src/build/sea.ts): what it takes a like sea to be, where no field gives the sea's temperature.
import { describe, expect, it } from 'vitest';
import { beltOf } from '../src/build/sea.ts';

describe('the belts of latitude the sea\'s atlas likens places by', () => {
  it('counts a belt from the equator out, either side alike', () => {
    expect([0, 29.9, 30, -45, 60, -89].map((lat) => beltOf(lat, [30, 60]))).toEqual([0, 0, 1, 1, 2, 2]);
  });
});
