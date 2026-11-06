// How far a claim has been checked against its source (docs/STRUCTURE.md section 3.7). Status says
// whether a person has accepted a claim; the ladder says what has been done to it short of that, step
// by step, each with who did it and how:
//
//   quoted   the quote was found in the text the source was read in, by script
//   re-read  a second reader, reading the source on their own, reached the same value
//   audited  a person checked it, as part of a sample that measures how often machines are wrong
//   accepted a person accepted it: the claim's status
//
// A claim's level is the highest step it has reached with every step below it. With agents writing at
// scale almost everything stays proposed for a long time; the level is what says how far to trust it.

export const STEPS = ['quoted', 're-read', 'audited'] as const;
export type Step = (typeof STEPS)[number];

export interface CheckStep {
  step: Step;
  /** an account, or machine:<tool> */
  by: string;
  /** what was done, and with what: the text a quote was found in, the reading compared */
  how: string;
  /** the day it was done, YYYY-MM-DD */
  on?: string;
}

export const LEVELS = ['unchecked', 'quoted', 're-read', 'audited', 'accepted'] as const;
export type Level = (typeof LEVELS)[number];

export const LEVEL_LABEL: Record<Level, string> = {
  unchecked: 'not checked against its source yet',
  quoted: 'its quote was found in the source, by script',
  're-read': 'a second reader re-read the source and agrees',
  audited: 'a person checked it, in a sample',
  accepted: 'a person accepted it',
};

/** The highest step a claim has reached with every step below it; accepted if a person accepted it. */
export function levelOf(checked: readonly CheckStep[] | undefined, status: string): Level {
  if (status === 'accepted') return 'accepted';
  const done = new Set((checked ?? []).map((c) => c.step));
  let level: Level = 'unchecked';
  for (const s of STEPS) {
    if (!done.has(s)) break;
    level = s;
  }
  return level;
}

/** How many claims stand at each level. */
export function ladderCounts(claims: Iterable<{ checked?: readonly CheckStep[]; status: string }>): Record<Level, number> {
  const out = Object.fromEntries(LEVELS.map((l) => [l, 0])) as Record<Level, number>;
  for (const c of claims) out[levelOf(c.checked, c.status)]++;
  return out;
}
