// The first step of the ladder: a quote found in the text its source was read in, by script, and the step
// written into the record's file without disturbing the rest of it.
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { addStep, normalizeText, quoteIn } from '../src/quotecheck.ts';

const STEP = { step: 'quoted' as const, by: 'machine:quote-check', how: 'Found in a.txt.', on: '2026-11-06' };

const RECORD = `# A record, with a comment that must stay.
id: earth/events/x
kind: event/impact
author: machine:claude-code
claims:
  date:
    prop: date
    value: { mean: 66.038 Ma, sd: 0.049 Myr }
    source:
      ref: src:x
      loc: p. 2
      quote: "the impact at 66.038 ± 0.049 Ma"
    note: >-
      A folded note
      that spans lines.
  name:
    prop: name
    value: { en: X }
    unsourced: An editorial label.
relations:
  during:
    rel: during
    to: earth/events/y
    source: { ref: src:x, loc: p. 3, quote: "within Y" }
`;

describe('quotes against a text', () => {
  it('are compared after normalizing whitespace, quotes, dashes and words broken across a line', () => {
    const text = normalizeText('The “impact” at 66.038 ±\n  0.049 Ma, a well-\nknown age – about 66 Ma.');
    expect(quoteIn('the "impact" at 66.038 ± 0.049 Ma'.replace('the', 'The'), text)).toBe(true);
    expect(quoteIn('a wellknown age - about 66 Ma', text)).toBe(true);
    expect(quoteIn('at 66.039 ± 0.049 Ma', text)).toBe(false);
  });

  it('join a word an OCR broke at a soft hyphen and the end of a line', () => {
    expect(quoteIn('increase downstream with discharge', normalizeText('increase downstream with dis\u00ad \ncharge in the form'))).toBe(true);
  });

  it('find a quote with an ellipsis when its pieces come in order, and not out of order', () => {
    const text = normalizeText('First the ash fell. Much later the iridium settled.');
    expect(quoteIn('First the ash … the iridium settled', text)).toBe(true);
    expect(quoteIn('the iridium settled ... First the ash', text)).toBe(false);
  });
});

describe('a step written into a record', () => {
  it('adds a checked list after what the claim holds, and leaves everything else as it was', () => {
    const out = addStep(RECORD, 'claims', 'date', STEP);
    expect(out).toContain('# A record, with a comment that must stay.');
    expect(out).toContain('    note: >-\n      A folded note\n      that spans lines.\n    checked:\n      - { step: quoted,');
    const before = parse(RECORD);
    const after = parse(out);
    expect(after.claims.date.checked).toEqual([STEP]);
    delete after.claims.date.checked;
    expect(after).toEqual(before);
  });

  it('adds to a list that is there, and does not add a step twice', () => {
    const once = addStep(RECORD, 'relations', 'during', STEP);
    expect(parse(once).relations.during.checked).toEqual([STEP]);
    expect(addStep(once, 'relations', 'during', STEP)).toBe(once);
    const reread = { step: 're-read' as const, by: 'kvh', how: 'Read it again.' };
    expect(parse(addStep(once, 'relations', 'during', reread)).relations.during.checked).toEqual([STEP, reread]);
  });

  it('refuses a claim written in one line, rather than rewrite it', () => {
    const flow = RECORD.replace(/  name:\n    prop: name\n    value: \{ en: X \}\n    unsourced: An editorial label.\n/, '  name: { prop: name, value: { en: X }, unsourced: An editorial label. }\n');
    expect(() => addStep(flow, 'claims', 'name', STEP)).toThrow(/by hand/);
  });
});
