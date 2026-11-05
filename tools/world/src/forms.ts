// Forms on the tree of life: walking up from a taxon to what its body, and its size, come from. Any
// taxon the tree reaches has a form as soon as any node above it has a body plan. The nearest node that
// says something wins, and the file says whose it was.
import { canonicalForm, formSource, resolveForm, type Form, type FormChange, type FormSource, type TreeStep } from '../../../core/form.ts';
import { splitRef } from '../../../core/refs.ts';
import { chosen, claimGroup } from './chronology.ts';
import type { Claim, World } from './world.ts';

/** What a part of a form may hold at the top level. */
const CHANGE_KEYS = new Set(['hip', 'mass_length', 'behave', 'parts']);

/** What is wrong with the value of a body_form claim, before it is merged into anything. */
export function changeProblems(v: unknown): string[] {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return ['a body_form holds any of hip, mass_length, behave and parts'];
  const out: string[] = [];
  for (const k of Object.keys(v)) if (!CHANGE_KEYS.has(k)) out.push(`a body_form has no field "${k}"; it may hold ${[...CHANGE_KEYS].join(', ')}`);
  const parts = (v as { parts?: unknown }).parts;
  if (parts !== undefined && (typeof parts !== 'object' || parts === null || Array.isArray(parts))) out.push('its parts are named: { parts: { frill: { r: 0.3 } } }');
  return out;
}

/** A quantity's value, as the generator takes it: a range stays a range, so that a member can be anywhere within it. */
export interface SizeClaim {
  lo: number;
  hi: number;
  /** the record whose claim it is */
  from: string;
  /** whether that record is the taxon's own */
  own: boolean;
}

/** The middle and the ends of a claimed quantity. */
function rangeOf(v: unknown): { lo: number; hi: number } | undefined {
  if (typeof v === 'number') return { lo: v, hi: v };
  if (v && typeof v === 'object') {
    const q = v as { value?: number; mean?: number; sd?: number; lo?: number; hi?: number };
    if (typeof q.value === 'number') return { lo: q.value, hi: q.value };
    if (typeof q.mean === 'number') return { lo: q.mean, hi: q.mean };
    if (typeof q.lo === 'number' && typeof q.hi === 'number') return { lo: q.lo, hi: q.hi };
  }
  return undefined;
}

export class FormTree {
  private up = new Map<string, string | undefined>();
  private forms = new Map<string, Form | null>();

  constructor(private world: World) {}

  /** A record's parent in the tree. */
  parent(id: string): string | undefined {
    if (this.up.has(id)) return this.up.get(id);
    const e = this.world.entity.get(id);
    const r = e?.relations.find((x) => x.rel === 'descends-from' && x.rank !== 'deprecated' && x.status !== 'deprecated');
    const p = r ? splitRef(r.to).record : undefined;
    this.up.set(id, p);
    return p;
  }

  /** The chosen claim of a property on one record. */
  private claim(id: string, prop: string): Claim | undefined {
    const g = claimGroup(this.world, id, prop);
    return g ? chosen(g) ?? g.claims.find((c) => c.rank !== 'deprecated') : undefined;
  }

  /** One node of the walk: what it says of its body. */
  step(id: string): TreeStep {
    const plan = this.claim(id, 'body_plan')?.value as string | undefined;
    const change = this.claim(id, 'body_form')?.value as FormChange | undefined;
    return { id, ...(plan ? { plan } : {}), ...(change ? { change } : {}) };
  }

  /** The way up from a taxon to the root, itself first. */
  path(id: string): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (let x: string | undefined = id; x && !seen.has(x); x = this.parent(x)) {
      seen.add(x);
      out.push(x);
    }
    return out;
  }

  /** Where a taxon's form comes from, or undefined if no node above it has a body plan. */
  source(id: string): FormSource | undefined {
    return formSource(this.path(id).map((x) => this.step(x)));
  }

  /** A taxon's whole form, or undefined if no node above it has a body plan. */
  form(id: string): Form | undefined {
    const known = this.forms.get(id);
    if (known !== undefined) return known ?? undefined;
    const s = this.source(id);
    const f = s && this.world.plans[s.plan] ? resolveForm(this.world.plans, s) : undefined;
    this.forms.set(id, f ?? null);
    return f;
  }

  /** The nearest claim of a size at or above a taxon: a clade's range stands for any member not measured. */
  size(id: string, prop: 'body_length' | 'hip_height' | 'plant_height' | 'body_mass'): SizeClaim | undefined {
    for (const x of this.path(id)) {
      const c = this.claim(x, prop);
      const r = c ? rangeOf(c.value) : undefined;
      if (r) return { ...r, from: x, own: x === id };
    }
    return undefined;
  }

  /** The nearest posture at or above a taxon. */
  posture(id: string): string | undefined {
    for (const x of this.path(id)) {
      const c = this.claim(x, 'posture');
      if (c) return c.value as string;
    }
    return undefined;
  }
}

/** A plan as a form, with no taxon: for a sheet of it, or a test. */
export const planForm = (world: World, name: string): Form | undefined => (world.plans[name] ? canonicalForm(world.plans[name]) : undefined);
