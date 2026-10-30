// A scenario is a picture of the world: the default picture, plus at most one alternative
// from each group, plus competing claims picked over the default ones. The build and the
// viewer name scenarios the same way.

export interface Scenario {
  /** alternatives in the picture, at most one per group */
  alts?: string[];
  /** claims (entity#key) chosen over the default claim of their group */
  picks?: string[];
}

/** A canonical name for a scenario: its alternatives and picks, sorted. "" is the default. */
export function scenarioKey(s: Scenario): string {
  return [...(s.alts ?? []).slice().sort(), ...(s.picks ?? []).slice().sort()].join(' ');
}

/**
 * The value a scenario has, from values the build stored where they differ: the scenario
 * itself; else the first pick that changes it (combinations of picks are not precomputed);
 * else the picture without picks; else the default.
 */
export function lookup<T>(variants: Record<string, T> | undefined, s: Scenario, fallback: T): T {
  if (!variants) return fallback;
  const exact = variants[scenarioKey(s)];
  if (exact) return exact;
  for (const p of (s.picks ?? []).slice().sort()) {
    const one = variants[scenarioKey({ alts: s.alts, picks: [p] })];
    if (one) return one;
  }
  return variants[scenarioKey({ alts: s.alts })] ?? fallback;
}
