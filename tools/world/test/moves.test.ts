// A thing that moved: an obelisk taken from Heliopolis to Rome is where it was at the time shown.
import { describe, expect, it } from 'vitest';
import { placeAt, type Feature, type FeatureMove, type FeatureTime } from '../../../core/tileset.ts';

const span = (a: number, b: number | null): FeatureTime => ({
  start: { best: a, lo: a, hi: a, derived: false },
  end: { best: b, lo: b ?? Infinity, hi: b ?? Infinity, derived: false },
  instant: false,
});
const move = (label: string, a: number, b: number | null, lat: number, plate?: number): FeatureMove => ({ label, location: { lat, lon: 0 }, time: span(a, b), ...(plate ? { plate } : {}) });

const feature = (moves?: FeatureMove[]) => ({ id: 'x', label: 'x', kind: 'artefact', frame: 'f', plate: 701, location: { lat: 1, lon: 0 }, moves, time: span(-1300, null) }) as unknown as Feature;

describe('where a thing is at a time', () => {
  const f = feature([move('Heliopolis', -1300, -10, 30, 701), move('Rome', -10, 1589, 41, 307), move('Piazza del Popolo', 1589, null, 41.9, 307)]);

  it('is where its phase has it, and carried by that phase’s plate', () => {
    expect(placeAt(f, -500).location.lat).toBe(30);
    expect(placeAt(f, -500).plate).toBe(701);
    expect(placeAt(f, 100).location.lat).toBe(41);
    expect(placeAt(f, 100).plate).toBe(307);
    expect(placeAt(f, 1900).location.lat).toBe(41.9);
  });

  it('moves at the moment a phase begins', () => {
    expect(placeAt(f, -10.001).location.lat).toBe(30);
    expect(placeAt(f, -10).location.lat).toBe(41);
  });

  it('is at its first place before any phase, and at its last after them all', () => {
    expect(placeAt(f, -5000).location.lat).toBe(30);
    const ended = feature([move('a', 0, 100, 10), move('b', 100, 200, 20)]);
    expect(placeAt(ended, 900).location.lat).toBe(20);
  });

  it('follows a scenario’s dates for its phases', () => {
    const late = placeAt(f, -5, (m) => (m.label === 'Rome' ? span(10, 1589) : m.time));
    expect(late.location.lat).toBe(30);
  });

  it('is simply where it is, for anything that does not move', () => {
    expect(placeAt(feature(), 100).location.lat).toBe(1);
    expect(placeAt(feature(), 100).plate).toBe(701);
  });
});
