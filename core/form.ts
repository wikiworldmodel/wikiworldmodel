// A living thing's form: what its body is like, as data on a node of the tree of life. A form is a
// few named parts in proportions of the body's own length. A child inherits its parent's and says
// only what differs, part by part, so that any taxon can be drawn from its nearest node that has one,
// and gets better as agents write forms lower down. The world/generators/life/forms.ts draws them.

export type Pose = 'stand' | 'walk' | 'graze' | 'drink' | 'alert' | 'rest' | 'fly';

/**
 * How a kind of body keeps. All of it is the generator's: what the records say is who lived there and
 * how big they grew, and these only say how a body plan is laid out for a visitor to see.
 */
export interface Behave {
  /** the fewest and most in a group */
  group?: [number, number];
  /** where it is looked for */
  habitat?: 'open' | 'any' | 'edge' | 'forest' | 'air' | 'canopy' | 'wet' | 'water';
  /** the poses it may be in */
  poses?: Pose[];
  /** how high it flies, in metres, least and most */
  flies?: [number, number];
  /** for a plant: its weight in the canopy, and how much more where the ground is wet */
  weight?: number;
  wet?: number;
  /** for a plant: the layer it grows in */
  layer?: 'canopy' | 'under' | 'float';
}

/** A part of a body. Which fields it has depends on its type: see PART_FIELDS in the generator. */
export interface Part {
  type: string;
  [field: string]: unknown;
}

export interface Form {
  kind: 'animal' | 'plant';
  /** what the body plan is, for its entry in the vocabulary */
  description?: string;
  /** how high the hips stand, as a share of the length, where no claim says */
  hip?: number;
  /** what a claimed mass gives: kilograms per cubic metre of length */
  mass_length?: number;
  behave?: Behave;
  /** the parts, by name: a child replaces or adds to them by name, field by field, and null takes one away */
  parts: Record<string, Part | null>;
}

/** What a `body_form` claim holds: any of a form's fields, each overriding the parent's. */
export interface FormChange {
  kind?: Form['kind'];
  hip?: number;
  mass_length?: number;
  behave?: Partial<Behave>;
  parts?: Record<string, Partial<Part> | null>;
}

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** A child's values over a parent's: objects merge by key, lists replace whole, and null takes a key away. */
function merged(base: unknown, over: unknown): unknown {
  if (!isObject(over) || !isObject(base)) return over;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (v === null) delete out[k];
    else out[k] = merged(out[k], v);
  }
  return out;
}

/** A form with a child's changes over it. Keys come out sorted, so equal forms are equal bytes. */
export function applyChange(base: Form, change: FormChange): Form {
  return sorted(merged(base, change)) as Form;
}

function sorted(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(sorted);
  if (!isObject(x)) return x;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(x).sort()) out[k] = sorted(x[k]);
  return out;
}

/** A form's own canonical form: keys sorted, and parts taken away gone. */
export const canonicalForm = (f: Form): Form => sorted(merged({}, f)) as Form;

/**
 * Where a taxon's form comes from: the path from its nearest body plan down to it. `plan` is the name
 * of that plan and `node` the record that says it; `changes` are each node's own changes on the way
 * down, from `from` the record that last wrote one, which is the taxon's own if `own` is true.
 */
export interface FormSource {
  plan: string;
  node: string;
  changes: { node: string; change: FormChange }[];
  /** the nearest node that has anything to say of its form */
  from: string;
  /** whether that is the taxon itself */
  own: boolean;
}

/** One step of the walk up the tree, as resolveForm needs it. */
export interface TreeStep {
  /** the node's name for what it draws, if it has one */
  id: string;
  plan?: string;
  change?: FormChange;
}

/** Walk up from a taxon: the nearest plan, and every change below it. Undefined if no node on the way has a plan. */
export function formSource(path: TreeStep[]): FormSource | undefined {
  const changes: { node: string; change: FormChange }[] = [];
  for (let i = 0; i < path.length; i++) {
    const step = path[i];
    if (step.change) changes.push({ node: step.id, change: step.change });
    if (step.plan) {
      changes.reverse();
      const from = changes.length ? changes[changes.length - 1].node : step.id;
      return { plan: step.plan, node: step.id, changes, from, own: from === path[0].id };
    }
  }
  return undefined;
}

/** A form from its plan and the changes on the way down to the taxon. */
export function resolveForm(plans: Record<string, Form>, source: FormSource): Form {
  const plan = plans[source.plan];
  if (!plan) throw new Error(`no body plan "${source.plan}"`);
  let f = canonicalForm(plan);
  for (const { change } of source.changes) f = applyChange(f, change);
  return f;
}
