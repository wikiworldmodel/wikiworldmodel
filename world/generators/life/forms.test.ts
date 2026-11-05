// Forms: what a body is made of, as data. These check the language and the plans without a build.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { applyChange, canonicalForm, formSource, resolveForm, type Form, type TreeStep } from '../../../core/form.ts';
import { Mesh } from '../city/kit.ts';
import { checkForm, drawAnimal, drawPlant, meshBounds, POSE, unitStance } from './forms.ts';

const PLANS = join(import.meta.dirname, '../../plans');
const plans: Record<string, Form> = Object.fromEntries(readdirSync(PLANS).filter((f) => f.endsWith('.yaml')).map((f) => [f.replace('.yaml', ''), parse(readFileSync(join(PLANS, f), 'utf8')) as Form]));

const bytes = (m: Mesh) => {
  const { vertices, indices } = m.arrays();
  return Buffer.concat([Buffer.from(vertices), Buffer.from(indices.buffer, indices.byteOffset, indices.byteLength)]).toString('base64');
};

describe('a child form', () => {
  const base = canonicalForm(plans.ceratopsian);

  it('changes only what it names: everything else is its parent\'s', () => {
    const child = applyChange(base, { parts: { brow: { r: 0.05 } } });
    expect(child.parts.brow!.r).toBe(0.05);
    expect(child.parts.brow!.from).toEqual(base.parts.brow!.from);
    const { brow: _a, ...restChild } = child.parts;
    const { brow: _b, ...restBase } = base.parts;
    expect(restChild).toEqual(restBase);
    expect(child.behave).toEqual(base.behave);
  });

  it('takes a part away with null, and adds one by a new name', () => {
    const child = applyChange(base, { parts: { nose: null, crest: { type: 'lump', at: [0, 0, 1], r: [0.1, 0.1, 0.1] } } });
    expect(child.parts.nose).toBeUndefined();
    expect(child.parts.crest!.type).toBe('lump');
  });

  it('replaces a list whole', () => {
    const child = applyChange(base, { parts: { brow: { to: [0.1, 0.2, 0.3] } } });
    expect(child.parts.brow!.to).toEqual([0.1, 0.2, 0.3]);
  });

  it('comes out the same whichever way its keys were written', () => {
    const a = applyChange(base, { hip: 0.4, parts: { brow: { r: 0.05, tint: 3 } } });
    const b = applyChange(base, { parts: { brow: { tint: 3, r: 0.05 } }, hip: 0.4 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('the walk up the tree', () => {
  const path = (own: boolean, family: boolean): TreeStep[] => [
    { id: 'species', ...(own ? { change: { parts: { brow: { r: 0.05 } } } } : {}) },
    { id: 'genus' },
    { id: 'family', ...(family ? { change: { parts: { nose: null } } } : {}), plan: 'ceratopsian' },
    { id: 'order', plan: 'hadrosaur' },
  ];

  it('stops at the nearest plan', () => {
    expect(formSource(path(false, false))!.plan).toBe('ceratopsian');
  });

  it('says whose form it is: its own, or the nearest node that has one', () => {
    expect(formSource(path(true, false))).toMatchObject({ from: 'species', own: true });
    expect(formSource(path(false, true))).toMatchObject({ from: 'family', own: false });
    expect(formSource(path(false, false))).toMatchObject({ from: 'family', own: false });
  });

  it('with its form taken away, falls back to the node above, and nothing else changes', () => {
    const withOwn = resolveForm(plans, formSource(path(true, true))!);
    const without = resolveForm(plans, formSource(path(false, true))!);
    expect(withOwn.parts.brow!.r).toBe(0.05);
    expect(without.parts.brow!.r).toBe(canonicalForm(plans.ceratopsian).parts.brow!.r);
    expect(without.parts.nose).toBeUndefined();
    expect(withOwn.parts.nose).toBeUndefined();
  });

  it('has nothing to draw if no node above has a plan', () => {
    expect(formSource([{ id: 'a' }, { id: 'b', change: { hip: 0.2 } }])).toBeUndefined();
  });
});

describe('the plans', () => {
  const names = Object.keys(plans);

  it('are many, and each one is written to the rules', () => {
    expect(names.length).toBeGreaterThanOrEqual(15);
    for (const n of names) expect(checkForm(canonicalForm(plans[n])), n).toEqual([]);
  });

  it('say what they are', () => {
    for (const n of names) expect(plans[n].description, n).toBeTruthy();
  });

  it('draw the same bytes each time', () => {
    for (const n of names) {
      const f = canonicalForm(plans[n]);
      const draw = () => {
        const m = new Mesh(4096);
        if (f.kind === 'animal') drawAnimal(m, f, unitStance(f, POSE.walk, 2));
        else drawPlant(m, f, 12, 7, 2, 90);
        return bytes(m);
      };
      expect(draw(), n).toBe(draw());
    }
  });

  it('get smaller with distance', () => {
    for (const n of names) {
      const f = canonicalForm(plans[n]);
      const size = (d: 0 | 1 | 2) => {
        const m = new Mesh(4096);
        if (f.kind === 'animal') drawAnimal(m, f, unitStance(f, POSE.stand, d));
        else drawPlant(m, f, 12, 7, d, 90);
        return m.verts;
      };
      expect(size(1), n).toBeLessThanOrEqual(size(2));
      expect(size(0), n).toBeLessThanOrEqual(size(1));
    }
  });

  it('stand on the ground', () => {
    for (const n of names) {
      const f = canonicalForm(plans[n]);
      if (f.kind !== 'animal') continue;
      const m = new Mesh(4096);
      drawAnimal(m, f, unitStance(f, POSE.stand, 2));
      const { low, high } = meshBounds(m);
      expect(low, n).toBeGreaterThan(-0.06);
      expect(high, n).toBeGreaterThan(0);
    }
  });
});

describe('the validator', () => {
  const good = () => canonicalForm(plans.ceratopsian);

  it('refuses a part it does not know', () => {
    const f = good();
    f.parts.wings = { type: 'propeller' };
    expect(checkForm(f).join()).toContain('no type "propeller"');
  });

  it('refuses a field a part does not have', () => {
    const f = good();
    f.parts.brow = { ...f.parts.brow!, curl: 3 };
    expect(checkForm(f).join()).toContain('no field "curl"');
  });

  it('refuses a part with something it needs missing', () => {
    const f = good();
    f.parts.brow = { type: 'spike', from: [0, 0, 0] };
    expect(checkForm(f).join()).toContain('needs "to"');
  });

  it('refuses a material there is not', () => {
    const f = good();
    f.parts.brow = { ...f.parts.brow!, mat: 'chrome' };
    expect(checkForm(f).join()).toContain('no material "chrome"');
  });

  it('refuses a plant\'s part on an animal', () => {
    const f = good();
    f.parts.crown = { type: 'palm' };
    expect(checkForm(f).join()).toContain('belongs to a plant');
  });

  it('refuses a body below the ground', () => {
    const f = good();
    f.parts.anchor = { type: 'lump', at: [0, 0, -2], r: [0.1, 0.1, 0.1] };
    expect(checkForm(f).join()).toContain('below the ground');
  });

  it('refuses a body past its budget', () => {
    const f = good();
    f.parts.fuzz = { type: 'row', n: 400, from: [0, -0.5, 1], to: [0, 0.5, 1], item: 'lump', r: [0.01, 0.01, 0.01], mirror: true };
    f.parts.fuzz2 = { type: 'lump', at: [0, 0, 1], r: [0.1, 0.1, 0.1], sides: [200, 100], bands: [200, 100] };
    expect(checkForm(f).join()).toContain('over the budget');
  });
});
