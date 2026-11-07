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
  const root = mkdtempSync(join(tmpdir(), 'wikiworldmodel-fixture-'));
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
      'entities/a.yaml': entity('test/thing', 'volcano', `claims:\n  x: { prop: altitude, value: 3, ${cite}, method: guessing, confidence: probably }\n`),
      'entities/b.yaml': entity('test/other', 'occurrence', `relations:\n  r: { rel: inspired-by, to: test/thing, ${cite} }\n`),
    });
    expect(errors(issues).map((i) => i.message)).toEqual(
      expect.arrayContaining([
        'unknown kind "volcano"',
        'unknown property "altitude"',
        expect.stringContaining('unknown confidence word "probably"'),
        'unknown relation type "inspired-by"',
      ]),
    );
  });

  it('check that properties fit their subject and relations join the kinds their type allows', async () => {
    const issues = await check({
      'entities/a.yaml': entity('test/fossil', 'occurrence', `claims:\n  d: { prop: diameter, value: 3, ${cite} }\n  s: { prop: start, value: 70 Ma, ${cite} }\nrelations:\n  r: { rel: caused-by, to: test/plate, ${cite} }\n  l: { rel: descends-from, to: test/flow, ${cite} }\n`),
      'entities/b.yaml': entity('test/flow', 'large-igneous-province', `claims:\n  date: { prop: date, value: 70 Ma, ${cite} }\n`),
      'entities/c.yaml': entity('test/plate', 'plate', ''),
    });
    expect(errors(issues).map((i) => [i.check, i.message])).toEqual(
      expect.arrayContaining([
        ['fit', '"diameter" does not apply to an occurrence (it applies to landform/impact-crater)'],
        ['fit', '"start" does not apply to an occurrence (it applies to lasting)'],
        ['fit', '"caused-by" points to an event or large-igneous-province, not a plate'],
        ['fit', '"descends-from" joins a taxon, not an occurrence'],
        ['fit', '"descends-from" points to a taxon, not a large-igneous-province'],
        ['fit', '"date" does not apply to a large-igneous-province (it applies to moments)'],
      ]),
    );
  });

  it('fit a phase to its entity\'s kind, keep strings to their declared values, and count a lag from an edge', async () => {
    const issues = await check({
      'entities/a.yaml': entity('test/planet', 'body/planet', `phases:\n  - id: hot\n  - id: wet\nclaims:\n  s1: { prop: surface, subject: "@hot", value: magma, ${cite} }\n  s2: { prop: surface, subject: "@wet", value: lava, ${cite} }\n  e: { prop: end, subject: "@hot", value: { ref: test/flow, lag: 1 Myr }, ${cite} }\n`),
      'entities/b.yaml': entity('test/flow', 'large-igneous-province', `claims:\n  start: { prop: start, value: 70 Ma, ${cite} }\n  s: { prop: surface, value: magma, ${cite} }\n`),
    });
    expect(errors(issues).map((i) => [i.where, i.message])).toEqual([
      ['claims.s2.value', 'not one of the values of surface: magma, crust-and-magma, ocean, bare-rock'],
      ['claims.e.value', 'a lag counts from an edge of the record: add edge: start or end'],
      ['claims.s', '"surface" does not apply to a large-igneous-province (it applies to body/planet)'],
    ]);
  });

  it('read dates to the day, take a polity\'s territory from a dataset, and date a text', async () => {
    const issues = await check({
      'entities/a.yaml': entity(
        'test/state',
        'polity',
        `claims:\n  start: { prop: start, value: 21 April 753 BCE, ${cite} }\n  end: { prop: end, value: 30 February 1453 CE, ${cite} }\n  t1: { prop: territory, value: { from: src:test/report }, ${cite} }\n  t2: { prop: territory, value: { from: src:test/report, names: [Rome] }, rank: preferred, ${cite} }\n`,
      ),
      'sources/text.yaml': `id: src:test/text\ntype: text\nkind: historian\ncitation: A fixture text, not a real work.\nwritten: { lo: 17 CE, hi: 27 BCE }\n`,
    });
    expect(errors(issues).map((i) => [i.where, i.message])).toEqual([
      ['claims.end.value', '"30 February 1453 CE" is not a date in the Julian calendar'],
      ['claims.t1.value', 'a geometry names its dataset and rows or elements: { from: src:…, names: [...] } or { from: src:…, elements: [...] }'],
      ['claims.t2.value.from', 'src:test/report is a source but not a dataset in the manifest, so the build cannot fetch it'],
      ['written', 'lo is later than hi (17 CE after 27 BCE); lo is always the earlier time'],
    ]);
  });

  it('date a taxon no later than its oldest member, and a subgroup no earlier than its group', async () => {
    const member = await check({
      'entities/a.yaml': entity('test/fossil', 'occurrence', `claims:\n  date: { prop: date, value: 300 Ma, ${cite} }\nrelations:\n  m: { rel: member-of, to: test/clade, ${cite} }\n`),
      'entities/b.yaml': entity('test/clade', 'taxon', `claims:\n  start: { prop: start, value: 250 Ma, ${cite} }\n`),
    });
    expect(errors(member).map((i) => i.check)).toContain('chronology');
    const nested = await check({
      'entities/a.yaml': entity('test/clade', 'taxon', `claims:\n  start: { prop: start, value: 250 Ma, ${cite} }\n`),
      'entities/b.yaml': entity('test/subclade', 'taxon', `claims:\n  start: { prop: start, value: 300 Ma, ${cite} }\nrelations:\n  p: { rel: descends-from, to: test/clade, ${cite} }\n`),
    });
    expect(errors(nested).map((i) => i.check)).toContain('chronology');
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

describe('models', () => {
  const coast = `id: field:test/coast\ntype: field\ntitle: Coast\nderived: true\nfrom: [field:test/height]\nrule: isoline\nisoline_m: 20\n`;
  const model = (body: string) => `id: model:test/coast\ntype: model\ntitle: Coast\ndescription: A model written for the test.\ncode: tools/world/src/chronology.ts\nuncertainty: { kind: none, note: None. }\n${body}`;
  const of = (issues: Issue[]) => issues.filter((i) => i.check === 'models');

  it('want every derived field made by one', async () => {
    const issues = await check({ 'fields/coast.yaml': coast });
    expect(of(issues)).toEqual([expect.objectContaining({ level: 'warning', message: expect.stringContaining('field:test/coast among its outputs') })]);
  });

  it('say where each parameter of what it makes comes from, and name no other', async () => {
    const missing = await check({ 'fields/coast.yaml': coast, 'models/coast.yaml': model('inputs: [src:test/report]\noutputs: [field:test/coast]\n') });
    expect(errors(missing).map((i) => i.message)).toEqual(['say where "isoline_m" comes from: a source, a claim it follows, or a choice']);
    const extra = await check({
      'fields/coast.yaml': coast,
      'models/coast.yaml': model('inputs: [src:test/report]\noutputs: [field:test/coast]\nparams:\n  isoline_m: { choice: Where the coast sits. }\n  depth: { source: { ref: src:test/report, loc: p. 2 } }\n'),
    });
    expect(errors(extra).map((i) => i.message)).toEqual(['no output of this model has a parameter "depth"']);
  });

  it('make each field once', async () => {
    const issues = await check({
      'fields/coast.yaml': coast,
      'models/coast.yaml': model('inputs: [src:test/report]\noutputs: [field:test/coast]\nparams: { isoline_m: { choice: Where the coast sits. } }\n'),
      'models/again.yaml': model('inputs: [src:test/report]\noutputs: [field:test/coast]\nparams: { isoline_m: { choice: Where the coast sits. } }\n').replace('model:test/coast', 'model:test/again'),
    });
    expect(errors(issues).map((i) => i.message)).toEqual(['field:test/coast is made by model:test/again already']);
  });

  it('name checks that exist, by the name of their test', async () => {
    const good = await check({ 'models/dates.yaml': model('inputs: [{ prop: date }]\nderives: Dates.\nchecks:\n  - { test: tools/world/test/stn.test.ts, holds: derives the tightest bounds }\n') });
    expect(errors(good)).toEqual([]);
    const bad = await check({ 'models/dates.yaml': model('inputs: [{ prop: date }]\nderives: Dates.\nchecks:\n  - { test: tools/world/test/stn.test.ts, holds: never fails }\n') });
    expect(errors(bad).map((i) => i.message)).toEqual(['no test in tools/world/test/stn.test.ts is named "never fails"']);
  });

  it('read only terms the vocabularies declare', async () => {
    const issues = await check({ 'models/dates.yaml': model('inputs: [{ prop: when }, { rel: near }, { prop: date, kind: volcano }]\nderives: Dates.\n') });
    expect(errors(issues).map((i) => i.message)).toEqual(['unknown property "when"', 'unknown relation type "near"', 'unknown kind "volcano"']);
  });

  it('note a model no evidence of the world reaches, and not one it does', async () => {
    const run = `id: src:test/run\ntype: publication\nkind: model\ncitation: A fixture model, not a real publication.\n`;
    const issues = await check({ 'sources/run.yaml': run, 'models/dates.yaml': model('inputs: [src:test/run]\nderives: Dates.\n') });
    expect(of(issues)).toEqual([expect.objectContaining({ level: 'info', message: 'model:test/coast rests on no evidence of the world: only on models run elsewhere' })]);
    const fed = await check({ 'sources/run.yaml': run, 'models/dates.yaml': model('inputs: [src:test/run, { prop: date }]\nderives: Dates.\n') });
    expect(of(fed)).toEqual([]);
  });
});

describe('the ladder of checking (docs/STRUCTURE.md section 3.7)', () => {
  const quoted = `source: { ref: src:test/report, loc: p. 1, quote: "seventy million years ago" }`;
  const claim = (extra: string, src = quoted) => ({ 'entities/a.yaml': `id: test/flow\nkind: large-igneous-province\nauthor: machine:test\nclaims:\n  start:\n    prop: start\n    value: 70 Ma\n    ${src}\n${extra}` });
  const step = (s: string, by: string) => `      - { step: ${s}, by: ${by}, how: "A fixture step." }\n`;
  const review = (issues: Issue[]) => issues.filter((i) => i.check === 'review').map((i) => `${i.level}: ${i.message}`);

  it('accept the steps in order, each by someone who may take it', async () => {
    const issues = await check(claim(`    checked:\n${step('quoted', 'machine:quote-check')}${step('re-read', 'machine:other-reader')}${step('audited', 'kvh')}`));
    expect(review(issues)).toEqual([]);
  });

  it('refuse a quote found where there is none, a re-reading by its own author, an audit by a machine, and a step twice', async () => {
    const none = await check(claim(`    checked:\n${step('quoted', 'machine:quote-check')}`, cite));
    expect(review(none)).toEqual(['error: marked quoted, but none of its sources has a quote to find']);
    const own = await check(claim(`    checked:\n${step('quoted', 'machine:quote-check')}${step('re-read', 'machine:test')}`));
    expect(review(own)).toEqual(['error: re-read by machine:test, who wrote it: a second reader re-reads']);
    const machine = await check(claim(`    checked:\n${step('quoted', 'machine:q')}${step('re-read', 'machine:r')}${step('audited', 'machine:auditor')}`));
    expect(review(machine)).toEqual(['error: audited by machine:auditor: an audit is a person\'s']);
    const twice = await check(claim(`    checked:\n${step('quoted', 'machine:q')}${step('quoted', 'machine:q')}`));
    expect(review(twice)).toEqual(['error: "quoted" is recorded twice']);
  });

  it('note a step above a missing one', async () => {
    const issues = await check(claim(`    checked:\n${step('re-read', 'machine:other-reader')}`));
    expect(review(issues)).toEqual(['warning: re-read but not quoted: each step stands on the one below it']);
  });
});

describe('overlays: claims about rows of datasets (docs/STRUCTURE.md section 3.1)', () => {
  const DATASET = `publish: { licenses: [CC0-1.0] }
datasets:
  src:test/states:
    type: dataset
    kind: compilation
    citation: A fixture dataset of states, not a real one.
    license: CC0-1.0
    credit: Fixture
    version: "1"
    fetch: { url: "https://example.invalid/states.json", sha256: "0000000000000000000000000000000000000000000000000000000000000000", bytes: 1, format: json }
`;
  const FIELD = `id: field:test/states
type: field
title: States
grid: { kind: rows }
time: { lo: 3000 BCE, hi: 1950 CE }
data: { from: src:test/states, as: polities }
basis: reconstruction
spread: unknown
rows:
  kind: polity
  key: "{Name}@{FromYear}"
  claims:
    name: { column: Name, as: text }
    start: { column: FromYear, as: year }
    end: { column: ToYear, as: year-end }
`;
  const spec = { kind: 'polity', key: '{Name}@{FromYear}', claims: { name: { column: 'Name', as: 'text' as const }, start: { column: 'FromYear', as: 'year' as const }, end: { column: 'ToYear', as: 'year-end' as const } } };
  const tables = new Map([['src:test/states', { dataset: 'src:test/states', field: 'field:test/states', spec, rows: new Map([['Carthage@-500', { Name: 'Carthage', FromYear: -500, ToYear: -146 }]]) }]]);
  const overlay = (body: string, row = 'src:test/states#Carthage@-500') => `row: ${row}\nauthor: machine:test\n${body}`;
  async function checkRows(files: Record<string, string>, withTables = true): Promise<Issue[]> {
    const root = mkdtempSync(join(tmpdir(), 'wikiworldmodel-fixture-'));
    dirs.push(root);
    for (const [path, text] of Object.entries({ 'sources/report.yaml': SOURCE, 'manifest.yaml': DATASET, 'fields/states.yaml': FIELD, ...files })) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    return (await validateWorld(await loadWorld(root), { frames: false, tables: withTables ? tables : new Map() })).issues;
  }
  const rows = (issues: Issue[]) => issues.filter((i) => ['rows', 'refs', 'ids', 'load'].includes(i.check)).map((i) => `${i.level}: ${i.message}`);

  it('accept a correction, ranked preferred with a note, citing what it rests on', async () => {
    const issues = await checkRows({ 'overlays/carthage.yaml': overlay(`claims:\n  end:\n    prop: end\n    value: -145\n    rank: preferred\n    note: The row ends a year early.\n    ${cite}\n`) });
    expect(rows(issues)).toEqual([]);
    expect(errors(issues)).toEqual([]);
  });

  it('refuse a correction that is not ranked preferred or says not why', async () => {
    const issues = await checkRows({ 'overlays/carthage.yaml': overlay(`claims:\n  end: { prop: end, value: -145, ${cite} }\n`) });
    expect(rows(issues)).toEqual(['error: differs from the row\'s end (-144): a correction is ranked preferred, with a note saying why the row is wrong']);
  });

  it('note a claim that only restates the row, from the dataset itself', async () => {
    // Its last year, -146 as the dataset counts years, holds to its end: -144 on the axis.
    const issues = await checkRows({ 'overlays/carthage.yaml': overlay(`claims:\n  end: { prop: end, value: -144, source: { ref: src:test/states, loc: row } }\n`) });
    expect(rows(issues)).toEqual(["warning: restates the row's end; to corroborate it, cite another source"]);
  });

  it('refuse a row the dataset does not have, a property its rows do not give, and two files for one row', async () => {
    const missing = await checkRows({ 'overlays/rome.yaml': overlay(`same_as: test/rome\n`, 'src:test/states#Rome@-27') });
    expect(rows(missing)).toEqual(['error: src:test/states has no row "Rome@-27"']);
    const prop = await checkRows({ 'overlays/carthage.yaml': overlay(`claims:\n  area: { prop: area, value: 3, ${cite} }\n`) });
    expect(rows(prop)).toEqual(['error: the rows of src:test/states give no "area": they give name, start, end']);
    const twice = await checkRows({ 'overlays/a.yaml': overlay('same_as: test/carthage\n'), 'overlays/b.yaml': overlay('same_as: test/carthage\n') });
    expect(rows(twice)).toContain('error: src:test/states#Carthage@-500 has an overlay already, in overlays/a.yaml: one file per row');
  });

  it('say so when the dataset is not here to check the row against', async () => {
    const issues = await checkRows({ 'overlays/carthage.yaml': overlay('same_as: test/carthage\n') }, false);
    expect(rows(issues)).toEqual(['info: src:test/states is not fetched here, so its row could not be checked']);
  });

  it('refuse a row written otherwise than the build writes it', async () => {
    const issues = await checkRows({ 'overlays/carthage.yaml': overlay('same_as: test/carthage\n', 'src:test/states#Carthage%40-500') });
    expect(rows(issues)).toEqual(['error: write the row as src:test/states#Carthage@-500']);
  });
});

describe('spreads (docs/STRUCTURE.md section 3.2)', () => {
  const field = (id: string, spread: string) => `id: field:test/${id}\ntype: field\ntitle: ${id}\ngrid: { kind: series }\ntime: { lo: 1 Ma, hi: 0 Ma }\ndata: { from: src:test/report, prop: date }\nbasis: reconstruction\n${spread ? `spread: ${spread}\n` : ''}`;
  const model = (kind: string) => `id: model:test/m\ntype: model\ntitle: M\ndescription: A fixture model.\ncode: tools/world/src/world.ts\ninputs: [field:test/runs]\nderives: Nothing.\nuncertainty: { kind: ${kind}, note: A fixture. }\n`;
  const models = (issues: Issue[]) => issues.filter((i) => i.check === 'models' && i.level !== 'info').map((i) => `${i.level}: ${i.message}`);

  it('want every field read from a source to say how its uncertainty is carried', async () => {
    const issues = await check({ 'fields/a.yaml': field('runs', '') });
    expect(errors(issues).map((i) => i.message)).toContain("must have required property 'spread'");
  });

  it('note a model that reads a spread and carries none on', async () => {
    expect(models(await check({ 'fields/a.yaml': field('runs', 'ensemble'), 'models/m.yaml': model('none') }))).toEqual([
      'warning: reads field:test/runs, which carries an ensemble, and says its output carries none: run it once per member (core/samples.ts) and carry the spread on',
    ]);
    expect(models(await check({ 'fields/a.yaml': field('runs', 'ensemble'), 'models/m.yaml': model('ensemble') }))).toEqual([]);
    expect(models(await check({ 'fields/a.yaml': field('runs', 'unknown'), 'models/m.yaml': model('none') }))).toEqual([]);
  });
});

describe('generators sample models (docs/STRUCTURE.md section 3.4)', () => {
  const gen = (extra: string) => `id: gen:test/g\ntype: generator\ntitle: G\nversion: 1\ncode: generators/earth/clouds/v1.ts\nruns_in: [build]\noutputs: { basis: procedural }\ninputs: [{ prop: date }]\nslots: { s: { place: here, seed: s } }\nparams: {}\n${extra}`;
  const found = (issues: Issue[]) => issues.filter((i) => i.check === 'generators').map((i) => `${i.level}: ${i.message}`);

  it('want one that samples the world to name a test of what it makes, in aggregate', async () => {
    expect(found(await check({ 'generators/g.yaml': gen('') }))).toEqual(['warning: it samples fields or claims of the world: name a test that holds what it makes, in aggregate, to them']);
  });

  it('accept a check that names a test that exists, and refuse one that does not', async () => {
    const ok = `checks: [{ test: world/generators/life/scene/v3.test.ts, holds: "has a desert mostly bare, with no forest" }]\n`;
    expect(found(await check({ 'generators/g.yaml': gen(ok) }))).toEqual([]);
    const bad = `checks: [{ test: world/generators/life/scene/v3.test.ts, holds: "makes unicorns" }]\n`;
    expect(found(await check({ 'generators/g.yaml': gen(bad) }))).toEqual(['error: no test in world/generators/life/scene/v3.test.ts is named "makes unicorns"']);
  });
});

describe('areas written in claims, and frames in deep time (docs/STRUCTURE.md section 5)', () => {
  const FRAMES = {
    'frames/geographic.yaml': 'id: frame:earth/geographic\ntype: frame\nkind: body-fixed\ntitle: Geographic\n',
    'frames/present-day.yaml': 'id: frame:earth/present-day\ntype: frame\nkind: snapshot\ntitle: Present day\nparent: frame:earth/geographic\n',
    'frames/unplaced.yaml': 'id: frame:earth/unplaced\ntype: frame\nkind: placeholder\ntitle: Unplaced\nparent: frame:earth/present-day\n',
    'frames/andes.yaml': 'id: frame:test/andes\ntype: frame\nkind: deforming\ntitle: A deforming belt\nparent: frame:earth/geographic\n',
  };
  const ring = (closed = true) => `[[[10, 10], [20, 10], [20, 20], [10, 20]${closed ? ', [10, 10]' : ''}]]`;
  const polity = (value: string, prop = 'territory', kind = 'polity') => ({ 'entities/a.yaml': entity('test/realm', kind, `claims:\n  t: { prop: ${prop}, value: ${value}, ${cite} }\n`) });
  const located = (frame: string) => ({
    ...FRAMES,
    'entities/a.yaml': entity('test/site', 'occurrence', `claims:\n  date: { prop: date, value: 2000 Ma, ${cite} }\n  location: { prop: location, value: { lat: -1.6, lon: 13.5, frame: frame:earth/present-day }, ${cite} }\n  frame: { prop: frame, value: ${frame}, ${cite} }\n`),
  });
  async function checkWithFrames(files: Record<string, string>): Promise<Issue[]> {
    const root = mkdtempSync(join(tmpdir(), 'wikiworldmodel-fixture-'));
    dirs.push(root);
    for (const [path, text] of Object.entries({ 'sources/report.yaml': SOURCE, ...files })) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    return (await validateWorld(await loadWorld(root))).issues;
  }

  it("accept a polity's outline written in its claim, closed and on the globe, in a frame", async () => {
    expect(errors(await check({ ...FRAMES, ...polity(`{ type: Polygon, coordinates: ${ring()}, frame: frame:earth/present-day }`) }))).toEqual([]);
  });

  it("refuse an outline that does not close, or one where the property takes only a dataset's rows", async () => {
    const open = await check({ ...FRAMES, ...polity(`{ type: Polygon, coordinates: ${ring(false)}, frame: frame:earth/present-day }`) });
    expect(errors(open).map((i) => i.message)).toEqual(['ring 0 of polygon 0 does not close: its last point is not its first']);
    const foot = await check({ ...FRAMES, ...polity(`{ type: Polygon, coordinates: ${ring()}, frame: frame:earth/present-day }`, 'footprint', 'building/temple') });
    expect(errors(foot).map((i) => i.message)).toEqual(['"footprint" takes rows or elements of a dataset, not an outline written in the claim']);
  });

  it('hold a place no reconstruction can follow in the placeholder frame, where it is today', async () => {
    expect(errors(await checkWithFrames(located('frame:earth/unplaced')))).toEqual([]);
  });

  it('refuse to carry coordinates through a deforming frame, which the build cannot do yet', async () => {
    expect(errors(await checkWithFrames(located('frame:test/andes'))).map((i) => i.message)).toEqual(['the build cannot yet carry coordinates through a deforming frame (frame:test/andes)']);
  });
});
