import { describe, expect, it } from 'vitest';
import { buildStore } from './records.ts';

describe('where the builds of an index are', () => {
  const index = 'https://wikiworldmodel.org/world/builds/index.json';

  it('beside the index, when it names no store', () => {
    expect(buildStore({}, index)).toBe('https://wikiworldmodel.org/world/builds/');
    expect(buildStore({}, 'http://localhost:4173/builds/index.json')).toBe('http://localhost:4173/builds/');
  });

  it('in the store it names, absolute or relative to the index, always as a directory', () => {
    expect(buildStore({ store: 'https://builds.wikiworldmodel.org/' }, index)).toBe('https://builds.wikiworldmodel.org/');
    expect(buildStore({ store: 'https://builds.wikiworldmodel.org' }, index)).toBe('https://builds.wikiworldmodel.org/');
    expect(buildStore({ store: '../store' }, index)).toBe('https://wikiworldmodel.org/world/store/');
  });
});
