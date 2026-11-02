// The planet's states for the viewer (planet.json): the phases of the planet's record, and
// the episodes that change its look while they last, each with its intervals and the claims
// that decide how it looks. The look itself is derived in the viewer, at the time shown.
import type { PlanetFile, PlanetState, StateClaim } from '../../../../core/planet.ts';
import type { Entity } from '../world.ts';
import { labeller, subjectTime, type Solved } from './records.ts';

/** The planet the globe shows. */
export const PLANET = 'space/bodies/earth';
/** Properties that decide how a phase of the planet looks. */
const PHASE_PROPS = ['surface', 'atmosphere'];
/** Properties that make an event an episode of the planet's look. */
const EPISODE_PROPS = ['ice_reach'];

function values(e: Entity, subject: string, props: string[]): Record<string, StateClaim[]> {
  const out: Record<string, StateClaim[]> = {};
  for (const c of e.claims) {
    if (c.subject !== subject || !props.includes(c.prop) || c.status === 'deprecated') continue;
    (out[c.prop] ??= []).push({ claim: c.ref, value: c.value as string | number, rank: c.rank, alt: c.alt, basis: c.basis });
  }
  return out;
}

export function planet(s: Solved): PlanetFile {
  const w = s.world;
  const labelOf = labeller(s);
  const e = w.entity.get(PLANET);
  const episodes: PlanetState[] = w.entities
    .filter((x) => x.claims.some((c) => c.subject === x.id && EPISODE_PROPS.includes(c.prop)))
    .map((x) => ({ subject: x.id, label: labelOf(x.id), ...subjectTime(s, x.id), values: values(x, x.id, EPISODE_PROPS) }))
    .sort((a, b) => (a.subject < b.subject ? -1 : 1));
  if (!e) return { planet: null, episodes };
  return {
    planet: {
      id: e.id,
      label: labelOf(e.id),
      ...subjectTime(s, e.id),
      phases: e.phases.map((p) => {
        const subject = `${e.id}@${p.id}`;
        return { subject, label: p.label ?? p.id, ...subjectTime(s, subject), values: values(e, subject, PHASE_PROPS) };
      }),
    },
    episodes,
  };
}
