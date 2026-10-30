// The real world validates, and its chronology behaves as the records say it should.
import { describe, expect, it } from 'vitest';
import { fromMa, toMa } from '../../../core/time.ts';
import { solveAlternatives, solveWorld } from '../src/chronology.ts';
import { validateWorld } from '../src/validate/index.ts';
import { loadWorld } from '../src/world.ts';

describe('the world', async () => {
  const world = await loadWorld();

  it('validates, plate frames included', async () => {
    const issues = await validateWorld(world);
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(issues.filter((i) => i.level === 'warning')).toEqual([]);
  });

  it('marks every machine-made claim as proposed', () => {
    for (const { data: e } of world.entities) {
      for (const c of Object.values(e.claims)) if (c.author.startsWith('machine:')) expect(c.status).toBe('proposed');
    }
  });

  it('derives the crater from the impact and the Himalaya from the collision', () => {
    const sol = solveWorld(world);
    const best = solveWorld(world, {}, true);
    expect(sol.ok && best.ok).toBe(true);
    if (!sol.ok || !best.ok) return;
    const crater = sol.bounds.get('earth/structures/chicxulub-crater@start')!;
    const impact = sol.bounds.get('earth/events/chicxulub-impact@date')!;
    expect([crater.lo, crater.hi]).toEqual([impact.lo, impact.hi]);
    const himalaya = best.bounds.get('earth/orogens/himalaya@start')!;
    expect(toMa(himalaya.lo)).toBeCloseTo(59, 6);
  });

  it('finds the 1992 Chicxulub date inconsistent with the Deccan eruption dates', () => {
    const alts = solveAlternatives(world);
    const swisher = alts.find((a) => a.claim === 'date-swisher-1992')!;
    expect(swisher.solution.ok).toBe(false);
    if (swisher.solution.ok) return;
    expect(swisher.solution.conflict.constraints.map((c) => c.source).sort()).toEqual([
      'earth/events/chicxulub-impact:claims.date-swisher-1992',
      'earth/events/chicxulub-impact:relations.during-deccan',
      'earth/lips/deccan-traps:claims.main-end',
    ]);
    const yin = alts.find((a) => a.claim === 'date-yin-harrison-2000')!;
    expect(yin.centres.ok && toMa(yin.centres.bounds.get('earth/orogens/himalaya@start')!.lo)).toBeCloseTo(70, 6);
    expect(fromMa(70)).toBeLessThan(fromMa(59));
  });
});
