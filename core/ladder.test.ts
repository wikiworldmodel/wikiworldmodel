// A claim's level is the highest step it has reached with every step below it, or accepted if a person accepted it.
import { describe, expect, it } from 'vitest';
import { ladderCounts, levelOf, type CheckStep } from './ladder.ts';

const s = (step: CheckStep['step']): CheckStep => ({ step, by: 'machine:test', how: 'A test.' });

describe('the ladder', () => {
  it('climbs only with every step below', () => {
    expect(levelOf([], 'proposed')).toBe('unchecked');
    expect(levelOf([s('quoted')], 'proposed')).toBe('quoted');
    expect(levelOf([s('quoted'), s('re-read')], 'proposed')).toBe('re-read');
    expect(levelOf([s('re-read'), s('audited')], 'proposed')).toBe('unchecked');
    expect(levelOf([s('quoted'), s('re-read'), s('audited')], 'proposed')).toBe('audited');
  });

  it('is accepted when a person accepted the claim, whatever the steps', () => {
    expect(levelOf([], 'accepted')).toBe('accepted');
  });

  it('counts claims at each level', () => {
    expect(ladderCounts([{ status: 'proposed' }, { status: 'proposed', checked: [s('quoted')] }, { status: 'accepted' }])).toEqual({ unchecked: 1, quoted: 1, 're-read': 0, audited: 0, accepted: 1 });
  });
});
