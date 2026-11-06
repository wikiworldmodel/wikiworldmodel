// A generator's output is compared by meaning, not by bytes (docs/STRUCTURE.md section 3.5): which things,
// exactly; where and how big, within a tolerance that floats differing in their last bits pass and any
// change a person could see fails.
import { describe, expect, it } from 'vitest';
import { bytesPrint, fingerprint, fingerprintProblems, printCheck, settlePrint } from './fingerprint.ts';

const positions = (n: number, nudge = 0) => Float64Array.from({ length: n }, (_, i) => Math.sin(i * 0.37) * 100 + i * 0.01 + nudge * Math.cos(i));

describe('fingerprints', () => {
  it('agree when floats differ only in their last bits', () => {
    const a = fingerprint([{ name: 'xy', values: positions(5000) }]);
    const b = fingerprint([{ name: 'xy', values: positions(5000, 1e-9) }]);
    expect(fingerprintProblems(a, b)).toEqual([]);
  });

  it('differ when something moves enough to see', () => {
    const a = fingerprint([{ name: 'xy', values: positions(5000) }]);
    const moved = positions(5000).map((x) => x + 0.5);
    expect(fingerprintProblems(a, fingerprint([{ name: 'xy', values: moved }]))).not.toEqual([]);
  });

  it('hold identities exactly: one different taxon fails', () => {
    const taxa = Uint16Array.from({ length: 300 }, (_, i) => i % 7);
    const other = taxa.slice();
    other[123] = 6 - other[123];
    const a = fingerprint([{ name: 'taxon', values: taxa, identity: true }]);
    expect(fingerprintProblems(a, fingerprint([{ name: 'taxon', values: taxa.slice(), identity: true }]))).toEqual([]);
    expect(fingerprintProblems(a, fingerprint([{ name: 'taxon', values: other, identity: true }]))).toEqual([expect.stringMatching(/^taxon: different values/)]);
  });

  it('count exactly: one more individual fails', () => {
    const a = fingerprint([{ name: 'xy', values: positions(100) }]);
    expect(fingerprintProblems(a, fingerprint([{ name: 'xy', values: positions(101) }]))).toEqual(['xy: 101 values, not 100']);
  });

  it('notice a part that is missing or not expected', () => {
    const a = fingerprint([{ name: 'a', values: [1, 2] }]);
    const b = fingerprint([{ name: 'b', values: [1, 2] }]);
    expect(fingerprintProblems(a, b)).toEqual(['a: missing', 'b: not expected']);
  });

  it('notice a picture whose pixels moved between brightnesses, though its average held', () => {
    const flat = new Uint8Array(4096).fill(128);
    const split = new Uint8Array(4096).map((_, i) => (i % 2 ? 255 : 1));
    expect(fingerprintProblems(bytesPrint('pixels', flat), bytesPrint('pixels', split))).not.toEqual([]);
  });

  it('settle a check: what this machine made, and what differs from the build', () => {
    const expected = fingerprint([{ name: 'xy', values: positions(10) }]);
    const check = printCheck(expected);
    expect(settlePrint(check, fingerprint([{ name: 'xy', values: positions(10, 1e-10) }]))).toEqual([]);
    expect(check.actual).not.toBeNull();
    expect(settlePrint(check, fingerprint([{ name: 'xy', values: positions(9) }]))).toEqual(['xy: 9 values, not 10']);
  });
});
