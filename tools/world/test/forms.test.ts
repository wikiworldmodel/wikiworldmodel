// Forms on the real tree: what the world's taxa inherit, and what the validator says of the plans and records.
import { beforeAll, describe, expect, it } from 'vitest';
import { checkForm } from '../../../world/generators/life/forms.ts';
import { canonicalForm } from '../../../core/form.ts';
import { classify, type AtlasParams } from '../src/build/atlas.ts';
import { changeProblems, FormTree, planForm } from '../src/forms.ts';
import { formsWanted } from '../src/formsWanted.ts';
import { loadWorld, type World } from '../src/world.ts';

let world: World;
let tree: FormTree;

beforeAll(async () => {
  world = await loadWorld();
  tree = new FormTree(world);
});

describe('the tree of life, for forms', () => {
  it('gives a taxon its own plan', () => {
    const s = tree.source('life/taxa/triceratops')!;
    expect(s.plan).toBeTruthy();
    expect(tree.form('life/taxa/triceratops')!.kind).toBe('animal');
  });

  it('walks every taxon up its parents to the root', () => {
    const p = tree.path('life/taxa/triceratops');
    expect(p[0]).toBe('life/taxa/triceratops');
    expect(p).toContain('life/taxa/dinosauria');
    expect(p.length).toBeGreaterThan(3);
  });

  it('has every plan in the vocabulary, each drawable', () => {
    const values = world.vocab.properties.body_plan.values!;
    for (const name of Object.keys(world.plans)) {
      expect(values[name], name).toBeTruthy();
      expect(checkForm(planForm(world, name)!), name).toEqual([]);
    }
  });

  it('has every taxon that says anything of its body draw, whichever node it comes from', () => {
    for (const e of world.entities) {
      if (e.kind !== 'taxon') continue;
      if (!e.claims.some((c) => c.prop === 'body_plan' || c.prop === 'body_form')) continue;
      const f = tree.form(e.id);
      expect(f, e.id).toBeDefined();
      expect(checkForm(canonicalForm(f!)), e.id).toEqual([]);
    }
  });

  it('keeps every claim a machine made of a body as proposed', () => {
    for (const e of world.entities) {
      for (const c of e.claims) {
        if (c.prop !== 'body_plan' && c.prop !== 'body_form') continue;
        expect(c.status, `${e.id} ${c.key}`).toBe('proposed');
        expect(c.author, `${e.id} ${c.key}`).toMatch(/^machine:/);
      }
    }
  });

  it('refuses a body_form with fields it does not know', () => {
    expect(changeProblems({ wings: 2 }).join()).toContain('no field "wings"');
    expect(changeProblems('tall').length).toBeGreaterThan(0);
    expect(changeProblems({ parts: { a: { r: 1 } }, hip: 0.3 })).toEqual([]);
  });
});

describe('the atlas\'s taxa', () => {
  const params = () => world.fields.find((f) => f.data?.as === 'community')!.params as unknown as AtlasParams;

  it('draw only what some node above them can draw, with a size', () => {
    const snap = [...world.landFossils.values()][0];
    const known = classify(world, snap, params());
    expect(known.size).toBeGreaterThan(100);
    for (const k of known.values()) {
      expect(known.forms.has(k.taxon.form)).toBe(true);
      expect(k.taxon.length ?? k.taxon.mass ?? k.taxon.height ?? known.forms.get(k.taxon.form)?.behave?.layer, k.taxon.label).toBeTruthy();
    }
  });

  it('say whose form it is: a genus with none of its own names the node above it', () => {
    const snap = [...world.landFossils.values()][0];
    const known = classify(world, snap, params());
    const inherited = [...known.values()].filter((k) => !k.taxon.own);
    expect(inherited.length).toBeGreaterThan(0);
    for (const k of inherited.slice(0, 200)) {
      expect(k.taxon.form_from).toBeTruthy();
      expect(k.taxon.form_from).not.toBe(k.taxon.id);
    }
  });

  it('list what most wants a form', () => {
    const out = formsWanted(world, ['--n', '5']);
    expect(out).toContain('rows');
    expect(out).toContain('txn:');
  });
});
