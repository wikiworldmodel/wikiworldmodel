// The real world validates, and its chronology behaves as the records say it should.
import { cpSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { toMa } from '../../../core/time.ts';
import { pointOf, solveScenario } from '../src/chronology.ts';
import { WORLD } from '../src/paths.ts';
import { validateWorld } from '../src/validate/index.ts';
import { loadWorld } from '../src/world.ts';

const ma = (y: number) => Math.round(toMa(y) * 1000) / 1000;

describe('the world', async () => {
  const world = await loadWorld();
  const report = await validateWorld(world);

  it('validates, plate frames included', () => {
    expect(report.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(report.issues.filter((i) => i.level === 'warning')).toEqual([]);
  });

  it('has every record it refers to: the Mesosaurus taxon, once wanted, is written', () => {
    expect(report.wanted).toEqual([]);
    expect(world.entity.get('life/taxa/mesosaurus-tenuidens')?.kind).toBe('taxon');
  });

  it('marks every machine-made claim as proposed', () => {
    for (const e of world.entities) {
      for (const c of [...e.claims, ...e.relations]) if (c.author.startsWith('machine:')) expect(c.status).toBe('proposed');
    }
  });

  it('says so for every claim without a source', () => {
    const unsourced = world.entities.flatMap((e) => e.claims).filter((c) => !c.sources.length);
    expect(unsourced.length).toBeGreaterThan(0);
    for (const c of unsourced) expect(c.unsourced).toBeTruthy();
  });

  const sol = solveScenario(world);
  const best = solveScenario(world, {}, true);
  if (!sol.ok || !best.ok) throw new Error('the world has no solution');
  const at = (b: typeof sol.bounds, subject: string, edge: 'start' | 'end') => {
    const x = b.get(pointOf(world, subject, edge))!;
    return [ma(x.lo), ma(x.hi)];
  };

  it('derives the crater from the impact and the Himalaya from the collision', () => {
    expect(at(sol.bounds, 'earth/structures/chicxulub-crater', 'start')).toEqual(at(sol.bounds, 'earth/events/chicxulub-impact', 'start'));
    expect(at(best.bounds, 'earth/orogens/himalaya', 'start')[0]).toBeCloseTo(59, 6);
  });

  it('tiles the Deccan Traps\' lifetime with its phases', () => {
    expect(at(sol.bounds, 'earth/lips/deccan-traps', 'start')).toEqual([66.413, 66.413]);
    expect(at(sol.bounds, 'earth/lips/deccan-traps@after', 'start')).toEqual([65.422, 65.422]);
    expect(sol.bounds.get(pointOf(world, 'earth/lips/deccan-traps', 'end'))!.hi).toBe(Infinity);
  });

  it('dates the Mesosaurus records by the stage they cite, under either time scale', () => {
    expect(at(sol.bounds, 'life/mesosaurus/kabus', 'start')).toEqual([290.1, 283.5]);
    const pbdb = solveScenario(world, { alts: ['alt:time-scale/pbdb-2022'] });
    expect(pbdb.ok && at(pbdb.bounds, 'life/mesosaurus/kabus', 'start')).toEqual([290.1, 279.3]);
    expect(pbdb.ok && at(pbdb.bounds, 'ics/artinskian', 'end')).toEqual([279.3, 279.3]);
  });

  it('finds the 1992 Chicxulub date inconsistent with the rest of the world, and says why', () => {
    // Two picks, not the thousands solveVariants makes: those are tested in variants.test.ts.
    const picked = (pick: string) => ({ solution: solveScenario(world, { picks: [pick] }), centres: solveScenario(world, { picks: [pick] }, true) });
    const swisher = picked('earth/events/chicxulub-impact#date-swisher-1992');
    expect(swisher.solution.ok).toBe(false);
    if (swisher.solution.ok) return;
    // It is too young for the Deccan eruptions it falls within, and for the extinction it
    // caused at the base of the Danian; the solver names one minimal set of the clashing
    // constraints.
    const clash = swisher.solution.conflict.constraints.map((c) => c.source).sort();
    expect([
      ['earth/events/chicxulub-impact#date-swisher-1992', 'earth/events/chicxulub-impact#during-deccan', 'earth/lips/deccan-traps#main-end'],
      ['earth/events/chicxulub-impact#date-swisher-1992', 'earth/events/kpg-extinction#caused-by-chicxulub', 'earth/events/kpg-extinction#date-ics', 'ics/danian#ics-start'],
    ]).toContainEqual(clash);
    const yin = picked('earth/events/india-asia-collision#date-yin-harrison-2000');
    expect(yin.centres.ok && at(yin.centres.bounds, 'earth/orogens/himalaya', 'start')[0]).toBeCloseTo(70, 6);
  });

  describe('ids carry no meaning', () => {
    const copy = mkdtempSync(join(tmpdir(), 'lightworld-'));
    afterAll(() => rmSync(copy, { recursive: true, force: true }));
    it('so moving a file changes nothing', async () => {
      cpSync(WORLD, copy, { recursive: true });
      renameSync(join(copy, 'entities/earth/orogens/himalaya.yaml'), join(copy, 'entities/life/mesosaurus/somewhere-else.yaml'));
      const moved = await loadWorld(copy);
      const r = await validateWorld(moved, { frames: false });
      expect(r.issues.filter((i) => i.level !== 'info')).toEqual([]);
      const s = solveScenario(moved);
      expect(s.ok && s.bounds.get('earth/orogens/himalaya|start')).toEqual(sol.bounds.get('earth/orogens/himalaya|start'));
    });
  });
});
