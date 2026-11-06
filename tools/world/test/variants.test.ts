// Every competing date is solved, in every picture. There are thousands of them, each moving few dates,
// so each is kept only as it differs from its picture: reading one must give what solving it gives.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { lookup } from '../../../core/scenario.ts';
import { conflictIn, solve, type Constraint } from '../../../core/stn.ts';
import { conflictInScenario, scenariosOf, solveScenario, solveVariants } from '../src/chronology.ts';
import { validateWorld } from '../src/validate/index.ts';
import { loadWorld } from '../src/world.ts';

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const SOURCE = `id: src:test/report\ntype: publication\nkind: measurement\ncitation: A fixture source, not a real publication.\n`;
const cite = `source: { ref: src:test/report, loc: p. 1 }`;
const entity = (id: string, kind: string, body: string) => `id: ${id}\nkind: ${kind}\nauthor: fixture\n${body}`;

async function world(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'wikiworldmodel-fixture-'));
  dirs.push(root);
  for (const [path, text] of Object.entries({ 'sources/report.yaml': SOURCE, ...files })) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return loadWorld(root);
}

const FILES = {
  'entities/a.yaml': entity('test/flow', 'large-igneous-province', `claims:\n  start-a: { prop: start, value: 70 Ma, rank: preferred, ${cite} }\n  start-b: { prop: start, value: 75 Ma, ${cite} }\n  end: { prop: end, value: 60 Ma, ${cite} }\n`),
  'entities/b.yaml': entity('test/fossil', 'occurrence', `claims:\n  date: { prop: date, value: { ref: test/flow }, ${cite} }\n`),
  'entities/c.yaml': entity('test/other', 'large-igneous-province', `claims:\n  start-x: { prop: start, value: 50 Ma, rank: preferred, ${cite} }\n  start-y: { prop: start, value: 40 Ma, ${cite} }\n  end: { prop: end, value: 30 Ma, ${cite} }\n`),
};

describe('competing dates', () => {
  it('are each a scenario, after the picture they are picked in', async () => {
    const w = await world(FILES);
    const list = [...scenariosOf(w)];
    expect(list[0]).toEqual({});
    expect(list.map((s) => s.picks?.[0]).filter(Boolean).sort()).toEqual(['test/flow#start-b', 'test/other#start-y']);
  });

  it('read as they would solve, though kept as differences', async () => {
    const w = await world(FILES);
    const variants = solveVariants(w);
    expect(variants.length).toBe(3);
    for (const v of variants) {
      const fresh = solveScenario(w, v.scenario);
      const centres = solveScenario(w, v.scenario, true);
      expect(v.solution.ok && fresh.ok && centres.ok && v.centres.ok).toBe(true);
      if (!v.solution.ok || !fresh.ok || !v.centres.ok || !centres.ok) continue;
      for (const [point, b] of fresh.bounds) expect(v.solution.bounds.get(point), point).toEqual(b);
      for (const [point, b] of centres.bounds) expect(v.centres.bounds.get(point), point).toEqual(b);
    }
  });

  it('keep only what they change', async () => {
    const w = await world(FILES);
    const [base, ...picks] = solveVariants(w);
    if (!base.solution.ok) throw new Error('the base must hold');
    const whole = base.solution.bounds.size;
    expect(whole).toBeGreaterThan(4);
    for (const v of picks) if (v.solution.ok) expect(v.solution.bounds.size).toBeLessThan(whole);
  });

  it('say the same of a contradiction, whether or not bounds are worked out', async () => {
    const w = await world({
      'entities/a.yaml': entity('test/flow', 'large-igneous-province', `claims:\n  start-a: { prop: start, value: 70 Ma, rank: preferred, ${cite} }\n  start-b: { prop: start, value: 10 Ma, ${cite} }\n  end: { prop: end, value: 60 Ma, ${cite} }\n`),
    });
    const picked = { picks: ['test/flow#start-b'] };
    const solved = solveScenario(w, picked);
    expect(solved.ok).toBe(false);
    expect(conflictInScenario(w, picked)).toBeDefined();
    expect(conflictInScenario(w, {})).toBeUndefined();
    const c = (from: string, to: string, lo: number, hi: number): Constraint => ({ source: `${from}-${to}`, from, to, lo, hi });
    const bad = [c('$origin', 'a', 10, 10), c('a', 'b', 5, 5), c('b', 'a', 5, 5)];
    const report = solve(['a', 'b'], bad);
    expect(report.ok).toBe(false);
    expect(conflictIn(['a', 'b'], bad)?.constraints.length).toBeGreaterThan(0);
    expect(conflictIn(['a', 'b'], [c('$origin', 'a', 10, 10)])).toBeUndefined();
  });
});

describe('a quantity', () => {
  const issuesFor = async (value: string) => {
    const w = await world({ 'entities/a.yaml': entity('test/fossil', 'occurrence', `claims:\n  when: { prop: date, value: 70 Ma, ${cite} }\n  size: { prop: diameter, value: ${value}, ${cite} }\n`) });
    return (await validateWorld(w, { frames: false })).issues.filter((i) => i.level === 'error').map((i) => i.message);
  };

  it('is a number, or a number with the uncertainty its source gives', async () => {
    expect((await issuesFor('3')).filter((m) => /quantity/.test(m))).toEqual([]);
    expect((await issuesFor('{ mean: 3, sd: 0.5 }')).filter((m) => /quantity/.test(m))).toEqual([]);
    expect((await issuesFor('{ lo: 2, hi: 4 }')).filter((m) => /quantity/.test(m))).toEqual([]);
  });

  it('is nothing else', async () => {
    for (const bad of ['"three"', '{ lo: 4, hi: 2 }', '{ mean: 3 }', '{ mean: 3, sd: 1, extra: 2 }']) expect((await issuesFor(bad)).some((m) => /quantity/.test(m)), bad).toBe(true);
  });
});

describe('a value in a scenario', () => {
  const v = { 'alt:a/one': 'a', 'alt:b/one': 'b', 'alt:a/one r#x': 'a with x', 'r#y': 'y' };

  it('is the scenario itself, else the picture without its picks, else the default', () => {
    expect(lookup(v, {}, 'default')).toBe('default');
    expect(lookup(v, { alts: ['alt:a/one'] }, 'default')).toBe('a');
    expect(lookup(v, { alts: ['alt:a/one'], picks: ['r#x'] }, 'default')).toBe('a with x');
    expect(lookup(v, { alts: ['alt:b/one'], picks: ['r#x'] }, 'default')).toBe('b');
    expect(lookup(v, { picks: ['r#y'] }, 'default')).toBe('y');
    expect(lookup(undefined, { alts: ['alt:a/one'] }, 'default')).toBe('default');
  });

  it('takes from each alternative in turn where two groups are combined, as no build works those out', () => {
    expect(lookup(v, { alts: ['alt:a/one', 'alt:c/one'] }, 'default')).toBe('a');
    expect(lookup(v, { alts: ['alt:c/one', 'alt:b/one'] }, 'default')).toBe('b');
    expect(lookup(v, { alts: ['alt:c/one', 'alt:d/one'] }, 'default')).toBe('default');
    expect(lookup(v, { alts: ['alt:a/one', 'alt:c/one'], picks: ['r#x'] }, 'default')).toBe('a with x');
  });
});
