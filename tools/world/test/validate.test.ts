// Each validator catches what it is for (section 9.2), on small worlds written for the test.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { validateWorld, type Issue } from '../src/validate/index.ts';
import { loadWorld } from '../src/world.ts';

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const SOURCE = `id: src:test/report\ntype: publication\nkind: measurement\ncitation: A fixture source, not a real publication.\n`;

/** A world of a source plus the given files, validated without the plate-model check. */
async function check(files: Record<string, string>): Promise<Issue[]> {
  const root = mkdtempSync(join(tmpdir(), 'lightworld-fixture-'));
  dirs.push(root);
  for (const [path, text] of Object.entries({ 'sources/report.yaml': SOURCE, ...files })) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return (await validateWorld(await loadWorld(root), { frames: false })).issues;
}

const errors = (issues: Issue[]) => issues.filter((i) => i.level === 'error');

/** An entity file: kind, then claims and relations as YAML lines indented by two. */
const entity = (id: string, kind: string, body: string) => `id: ${id}\nkind: ${kind}\nauthor: fixture\n${body}`;
const cite = `source: { ref: src:test/report, loc: p. 1 }`;

describe('validators', () => {
  it('accept a small consistent world', async () => {
    const issues = await check({
      'entities/a.yaml': entity('test/flow', 'large-igneous-province', `claims:\n  start: { prop: start, value: 70 Ma, ${cite} }\n  end: { prop: end, value: 69 Ma, ${cite} }\n`),
      'entities/b.yaml': entity('test/fossil', 'occurrence', `claims:\n  date: { prop: date, value: { ref: test/flow }, ${cite} }\n`),
    });
    expect(issues).toEqual([]);
  });

  it('report a reference to a missing record as wanted, not as an error', async () => {
    const issues = await check({ 'entities/a.yaml': entity('test/fossil', 'occurrence', `relations:\n  taxon: { rel: member-of, to: test/taxa/unwritten, ${cite} }\n`) });
    expect(errors(issues)).toEqual([]);
    expect(issues).toEqual([expect.objectContaining({ level: 'info', check: 'wanted', message: expect.stringContaining('test/taxa/unwritten is wanted') })]);
  });

  it('reject terms that were never declared', async () => {
    const issues = await check({
      'entities/a.yaml': entity('test/thing', 'volcano', `claims:\n  x: { prop: height, value: 3, ${cite}, method: guessing, confidence: probably }\n`),
      'entities/b.yaml': entity('test/other', 'occurrence', `relations:\n  r: { rel: inspired-by, to: test/thing, ${cite} }\n`),
    });
    expect(errors(issues).map((i) => i.message)).toEqual(
      expect.arrayContaining([
        'unknown kind "volcano"',
        'unknown property "height"',
        expect.stringContaining('unknown confidence word "probably"'),
        'unknown relation type "inspired-by"',
      ]),
    );
  });

  it('check that properties fit their subject and relations join the kinds their type allows', async () => {
    const issues = await check({
      'entities/a.yaml': entity('test/fossil', 'occurrence', `claims:\n  d: { prop: diameter, value: 3, ${cite} }\n  s: { prop: start, value: 70 Ma, ${cite} }\nrelations:\n  r: { rel: caused-by, to: test/flow, ${cite} }\n`),
      'entities/b.yaml': entity('test/flow', 'large-igneous-province', `claims:\n  date: { prop: date, value: 70 Ma, ${cite} }\n`),
    });
    expect(errors(issues).map((i) => [i.check, i.message])).toEqual(
      expect.arrayContaining([
        ['fit', '"diameter" does not apply to an occurrence (it applies to landform/impact-crater)'],
        ['fit', '"start" does not apply to an occurrence (it applies to lasting)'],
        ['fit', '"caused-by" points to an event, not a large-igneous-province'],
        ['fit', '"date" does not apply to a large-igneous-province (it applies to moments)'],
      ]),
    );
  });

  it('keep each claim in its subject\'s file', async () => {
    const issues = await check({
      'entities/a.yaml': entity('test/a', 'occurrence', `claims:\n  x: { prop: date, subject: test/b, value: 70 Ma, ${cite} }\n`),
      'entities/b.yaml': entity('test/b', 'occurrence', ''),
    });
    expect(errors(issues).map((i) => i.message)).toEqual([expect.stringContaining("a claim lives in its subject's file")]);
  });

  it('need a source or an explicit reason for having none', async () => {
    const issues = await check({ 'entities/a.yaml': entity('test/a', 'occurrence', `claims:\n  x: { prop: date, value: 70 Ma }\n  y: { prop: identified_as, value: X, unsourced: An editorial note. }\n`) });
    expect(errors(issues)).toEqual([expect.objectContaining({ check: 'schema', where: '/claims/x', message: 'a claim needs a source, or `unsourced:` saying why it has none' })]);
  });

  it('keep machine-made claims proposed until a person accepts them', async () => {
    const issues = await check({ 'entities/a.yaml': entity('test/a', 'occurrence', `claims:\n  x: { prop: date, value: 70 Ma, ${cite}, author: machine:extractor, status: accepted }\n`) });
    expect(errors(issues)).toEqual([expect.objectContaining({ check: 'review' })]);
  });

  it('read lo as the earlier time, whatever the unit', async () => {
    const issues = await check({ 'entities/a.yaml': entity('test/a', 'occurrence', `claims:\n  x: { prop: date, value: { lo: 283.5 Ma, hi: 290.1 Ma }, ${cite} }\n`) });
    expect(errors(issues)).toEqual([expect.objectContaining({ check: 'values', message: expect.stringContaining('lo is later than hi') })]);
  });

  it('turn a restated value into a corroboration, and want one preferred claim among competitors', async () => {
    const issues = await check({
      'entities/a.yaml': entity('test/a', 'occurrence', `claims:\n  x: { prop: date, value: 70 Ma, ${cite}, rank: preferred }\n  y: { prop: date, value: 70 Ma, ${cite} }\n`),
      'entities/b.yaml': entity('test/b', 'occurrence', `claims:\n  x: { prop: date, value: 70 Ma, ${cite}, rank: preferred }\n  y: { prop: date, value: 71 Ma, ${cite}, rank: preferred }\n`),
    });
    expect(issues.filter((i) => i.level !== 'info').map((i) => [i.level, i.check, i.where])).toEqual([
      ['error', 'ranks', 'claims.x, claims.y'],
      ['warning', 'duplicates', 'claims.y'],
    ]);
  });

  it('find a cause dated after its effect', async () => {
    const issues = await check({
      'entities/a.yaml': entity('test/impact', 'event/impact', `claims:\n  date: { prop: date, value: 66 Ma, ${cite} }\n`),
      'entities/b.yaml': entity('test/crater', 'landform/impact-crater', `claims:\n  start: { prop: start, value: 67 Ma, ${cite} }\nrelations:\n  formed-by: { rel: caused-by, to: test/impact, ${cite} }\n`),
    });
    expect(errors(issues)).toEqual([expect.objectContaining({ check: 'chronology', message: expect.stringContaining('entities/b.yaml relations.formed-by') })]);
  });

  it('check each alternative as its own world, combined with the default', async () => {
    const issues = await check({
      'alternatives/g.yaml': `id: alt:test/g\ntype: group\ntitle: G\nshow: [alt:test/g/late]\ndefault: null\n`,
      'alternatives/late.yaml': `id: alt:test/g/late\ntype: alternative\nkind: hypothesis\ngroup: alt:test/g\ntitle: Late\n`,
      'entities/a.yaml': entity('test/flow', 'large-igneous-province', `claims:\n  start: { prop: start, value: 70 Ma, ${cite} }\n  end: { prop: end, value: 69 Ma, ${cite} }\n`),
      'entities/b.yaml': entity('test/fossil', 'occurrence', `claims:\n  date: { prop: date, value: 72 Ma, ${cite} }\n  late: { prop: date, value: 68 Ma, ${cite}, alt: alt:test/g/late }\nrelations:\n  below: { rel: before, to: test/flow, ${cite} }\n`),
    });
    expect(errors(issues)).toEqual([expect.objectContaining({ check: 'chronology', message: expect.stringMatching(/^with alt:test\/g\/late, these constraints cannot all hold/) })]);
  });

  it('never check an id against its file\'s path', async () => {
    const issues = await check({ 'entities/somewhere/else.yaml': entity('test/fossil', 'occurrence', `claims:\n  date: { prop: date, value: 70 Ma, ${cite} }\n`) });
    expect(issues).toEqual([]);
  });
});
