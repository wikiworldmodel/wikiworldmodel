// A contradictory world must fail validation and name the minimal set of conflicting claims.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { solveScenario } from '../src/chronology.ts';
import { REPO } from '../src/paths.ts';
import { validateWorld } from '../src/validate/index.ts';
import { loadWorld } from '../src/world.ts';

const FIXTURE = join(REPO, 'tools/world/test/fixtures/contradiction');

describe('contradiction fixture', () => {
  it('has a chronology conflict made of exactly the three clashing constraints', async () => {
    const sol = solveScenario(await loadWorld(FIXTURE));
    expect(sol.ok).toBe(false);
    if (sol.ok) return;
    expect(sol.conflict.constraints.map((c) => c.source).sort()).toEqual(['test/fossil-below#below-flow', 'test/fossil-below#date', 'test/lava-flow#start']);
  });

  it('fails validation with one chronology error naming them, and nothing about the other fossil', async () => {
    const { issues } = await validateWorld(await loadWorld(FIXTURE), { frames: false });
    const errors = issues.filter((i) => i.level === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].check).toBe('chronology');
    for (const s of ['entities/test/lava-flow.yaml claims.start', 'entities/test/fossil-below.yaml claims.date', 'entities/test/fossil-below.yaml relations.below-flow']) {
      expect(errors[0].message).toContain(s);
    }
    expect(errors[0].message).not.toContain('fossil-above');
  });

  it('makes the validate command exit non-zero, as CI needs', () => {
    let code = 0;
    let out = '';
    try {
      execFileSync('npx', ['tsx', 'tools/world/src/cli.ts', 'validate', '--world', FIXTURE, '--no-frames'], { cwd: REPO, encoding: 'utf8', stdio: 'pipe' });
    } catch (e) {
      const err = e as { status: number; stdout: string };
      code = err.status;
      out = err.stdout;
    }
    expect(code).toBe(1);
    expect(out).toContain('cannot all hold');
  });
});
