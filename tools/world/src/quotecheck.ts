// The first step of the ladder (docs/STRUCTURE.md section 3.7, core/ladder.ts): a claim's quote found in
// the text its source was read in, by script, not by eye.
//
//   npm run world -- quote-check src:renne-2013-kpg-timescales renne-2013.txt [--by machine:<tool>] [--dry-run]
//
// The text is what was retrieved and read: a page saved as text, a PDF's text. It is not kept; the step
// records its name and sha256. Both sides are compared after normalizing: Unicode compatibility forms,
// curly quotes and dashes as plain ones, soft hyphens and words broken across a line joined, and every run
// of whitespace as one space. A quote with an ellipsis (… or ...) is found when its pieces are, in order.
// Each claim whose quote is found gets a `quoted` step written into its file, after what is there.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { isMap, isSeq, parseDocument, type Node, type YAMLMap } from 'yaml';
import type { CheckStep } from '../../../core/ladder.ts';
import type { Claim, Relation, World } from './world.ts';

/** A text as quotes are compared with it. */
export function normalizeText(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/­\s*/g, '')
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/(\w)-\s*\n\s*(\w)/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Is a quote in a text? Both normalized; an ellipsis is a gap, whose pieces must come in order. */
export function quoteIn(quote: string, text: string): boolean {
  const pieces = normalizeText(quote)
    .split(/\s*(?:…|\.\.\.)\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (!pieces.length) return false;
  let from = 0;
  for (const p of pieces) {
    const at = text.indexOf(p, from);
    if (at < 0) return false;
    from = at + p.length;
  }
  return true;
}

export interface QuoteResult {
  claim: Claim | Relation;
  quote: string;
  found: boolean;
}

/** Every quote from a source in the world's claims, and whether the text has it. */
export function checkQuotes(world: World, source: string, text: string): QuoteResult[] {
  const norm = normalizeText(text);
  const out: QuoteResult[] = [];
  for (const e of world.entities) {
    for (const c of [...e.claims, ...e.relations]) {
      for (const s of c.sources) if (s.ref === source && s.quote) out.push({ claim: c, quote: s.quote, found: quoteIn(s.quote, norm) });
    }
  }
  return out;
}

/** The column a node starts at, in a text. */
function columnOf(text: string, offset: number): number {
  return offset - (text.lastIndexOf('\n', offset - 1) + 1);
}

/** A step as one line of YAML, in the flow style the records use. */
function stepLine(s: CheckStep): string {
  const q = (v: string) => JSON.stringify(v);
  return `{ step: ${s.step}, by: ${s.by}, how: ${q(s.how)}${s.on ? `, on: ${q(s.on)}` : ''} }`;
}

/**
 * Add a step to a claim or relation in a record's text, after what is there, leaving the rest of the file as
 * it was. Returns the new text, or the old one if the claim already has a step of that kind.
 */
export function addStep(text: string, section: 'claims' | 'relations', key: string, step: CheckStep): string {
  const doc = parseDocument(text, { keepSourceTokens: true });
  const claim = doc.getIn([section, key], true) as YAMLMap | undefined;
  if (!claim || !isMap(claim) || claim.flow || !claim.items.length || !claim.range) throw new Error(`${section}.${key} is not a block mapping in this file: add its steps by hand`);
  const checked = claim.get('checked', true) as Node | undefined;
  if (checked && isSeq(checked) && checked.items.some((i) => isMap(i) && i.get('step') === step.step)) return text;
  const indent = columnOf(text, (claim.items[0].key as Node).range![0]);
  const pad = ' '.repeat(indent);
  if (checked) {
    if (!isSeq(checked) || checked.flow || !checked.range) throw new Error(`${section}.${key}.checked is not a block list: add the step by hand`);
    const itemPad = ' '.repeat(columnOf(text, (checked.items[0] as Node).range![0]) - 2);
    return insertLines(text, checked.range[1], [`${itemPad}- ${stepLine(step)}`]);
  }
  return insertLines(text, claim.range[1], [`${pad}checked:`, `${pad}  - ${stepLine(step)}`]);
}

/** Lines put in at the end of a block that ends at `at`, whether or not its last newline is part of it. */
function insertLines(text: string, at: number, lines: string[]): string {
  const block = lines.join('\n');
  return text[at - 1] === '\n' ? `${text.slice(0, at)}${block}\n${text.slice(at)}` : `${text.slice(0, at)}\n${block}${text.slice(at)}`;
}

export async function runQuoteCheck(world: World, args: string[]): Promise<number> {
  const [source, file] = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--by'));
  if (!source || !file) {
    console.error('usage: world quote-check src:<source> <text file> [--by machine:<tool>] [--dry-run]');
    return 2;
  }
  if (!world.source.has(source)) throw new Error(`no source ${source} in the world`);
  const by = args.includes('--by') ? args[args.indexOf('--by') + 1] : 'machine:quote-check';
  const dry = args.includes('--dry-run');
  const raw = readFileSync(file);
  const results = checkQuotes(world, source, raw.toString('utf8'));
  const step: CheckStep = {
    step: 'quoted',
    by,
    how: `Found in ${basename(file)} (sha256 ${createHash('sha256').update(raw).digest('hex').slice(0, 16)}), after normalizing whitespace and typography, by npm run world -- quote-check.`,
    on: new Date().toISOString().slice(0, 10),
  };
  const files = new Map<string, string>();
  let added = 0;
  for (const r of results.filter((x) => x.found)) {
    const c = r.claim;
    if (c.checked.some((s) => s.step === 'quoted') || c.where.split('.').length !== 2) continue;
    const [section, key] = c.where.split('.') as ['claims' | 'relations', string];
    const path = join(world.root, c.file);
    const before = files.get(path) ?? readFileSync(path, 'utf8');
    const after = addStep(before, section, key, step);
    if (after !== before) added++;
    files.set(path, after);
  }
  if (!dry) for (const [path, text] of files) writeFileSync(path, text);
  const missing = results.filter((r) => !r.found);
  console.log(`${source}: ${results.length - missing.length} of ${results.length} quotes found in ${basename(file)}; ${dry ? 'would record' : 'recorded'} the quoted step on ${added} claim${added === 1 ? '' : 's'}.`);
  for (const r of missing) console.log(`  not found  ${r.claim.file} ${r.claim.where}: ${r.quote}`);
  return missing.length ? 1 : 0;
}
