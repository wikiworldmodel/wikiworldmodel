// ArchaeoGLOBE's assessments of past land use, as one table kept in world/snapshots.
//
// The ArchaeoGLOBE Project (Stephens et al. 2019) asked archaeologists how widespread foraging, pastoralism, extensive
// and intensive agriculture were in each of 146 regions at ten times from 10,000 BP to 1850 CE, and whether there were
// dense urban centres. Its public data on Harvard Dataverse (CC0) holds a summary table for each answer: the consensus
// its authors settled on, and the least, median and most of the answers, with the experts' own scores of how well the
// region is known. This joins those tables into one row for each region and time, so that a row says everything the
// project says of that region then. Nothing is changed but the layout; `npm run world -- archaeoglobe-snapshot` makes it
// again, to the byte, and checks each table against the MD5 the Dataverse record gives it.
import { createHash } from 'node:crypto';

/** The Dataverse record and the summary tables read from it, by their file ids there. */
export const RECORD = { doi: '10.7910/DVN/CNCANQ', api: 'https://dataverse.harvard.edu/api', version: '3.0' };
export const TABLES = {
  consensus: { id: 3442650, name: 'ARCHAEOGLOBE_CONSENSUS_ASSESSMENT.tab' },
  minimum: { id: 3332500, name: 'ARCHAEOGLOBE_MINIMUM_ASSESSMENT.tab' },
  median: { id: 3332499, name: 'ARCHAEOGLOBE_MEDIAN_ASSESSMENT.tab' },
  maximum: { id: 3332505, name: 'ARCHAEOGLOBE_MAXIMUM_ASSESSMENT.tab' },
  urban: { id: 3332501, name: 'ARCHAEOGLOBE_URBANCENTERS_MEDIAN_ASSESSMENT.tab' },
  quality: { id: 3332498, name: 'ARCHAEOGLOBE_DATA_QUALITY_MEDIAN_ASSESSMENT.tab' },
  expertise: { id: 3332503, name: 'ARCHAEOGLOBE_EXPERTISE_AVERAGE.tab' },
  excavations: { id: 3332502, name: 'ARCHAEOGLOBE_PUBLISHED_EXCAVATIONS_MEDIAN_ASSESSMENT.tab' },
} as const;
export const SNAPSHOT = 'world/snapshots/archaeoglobe-2019-assessments.csv';

/** The ten times of the survey: how its columns name them, and the year on the world's axis. 2,000 BP is "0 CE" in the survey, the axis's year 0. */
export const SLICES: { key: string; label: string; year: number }[] = [
  { key: '10K', label: '10,000 BP (8000 BCE)', year: -7999 },
  { key: '8K', label: '8,000 BP (6000 BCE)', year: -5999 },
  { key: '6K', label: '6,000 BP (4000 BCE)', year: -3999 },
  { key: '4K', label: '4,000 BP (2000 BCE)', year: -1999 },
  { key: '3K', label: '3,000 BP (1000 BCE)', year: -999 },
  { key: '2K', label: '2,000 BP (0 CE)', year: 0 },
  { key: '1K', label: '1,000 BP (1000 CE)', year: 1000 },
  { key: '1500CE', label: '1500 CE', year: 1500 },
  { key: '1750CE', label: '1750 CE', year: 1750 },
  { key: '1850CE', label: '1850 CE', year: 1850 },
];

/** The four kinds of land use, as the tables' columns begin. The consensus table spells some of its columns EXAGR_. */
export const USES = { FHG: 'foraging', EXAG: 'extensive', INAG: 'intensive', PAS: 'pastoral' } as const;
export const LEVELS = ['None', 'Minimal', 'Common', 'Widespread'] as const;

/** A table, read as CSV with a header: by its first column, the region's number, each row's cells by column name. */
export function readTable(text: string): Map<number, Record<string, string>> {
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim());
  const split = (l: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (quoted) {
        if (ch === '"' && l[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') quoted = false;
        else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') {
        out.push(cur);
        cur = '';
      } else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const head = split(lines[0]);
  const out = new Map<number, Record<string, string>>();
  for (const l of lines.slice(1)) {
    const cells = split(l);
    out.set(Number(cells[0]), Object.fromEntries(head.map((h, i) => [h, (cells[i] ?? '').trim()])));
  }
  return out;
}

/** A cell of a table for a use and a time, whichever way its column is spelt: the consensus table has EXAGR_ for some. */
function cell(row: Record<string, string>, prefix: string, slice: string): string {
  const names = (prefix === 'EXAG' ? ['EXAG', 'EXAGR'] : [prefix]).flatMap((p) => [`${p}_${slice}BP`, `${p}_${slice}`]).map((s) => s.toLowerCase());
  for (const [k, v] of Object.entries(row)) if (names.includes(k.toLowerCase())) return v;
  throw new Error(`no column ${prefix}_${slice} in a table with ${Object.keys(row).join(', ')}`);
}

export interface Tables {
  consensus: string;
  minimum: string;
  median: string;
  maximum: string;
  urban: string;
  quality: string;
  expertise: string;
  excavations: string;
}

/** The snapshot's text: a line for each table it came from, then a row for each region and time. */
export function snapshotText(t: Tables, md5: Record<keyof Tables, string>, sha: Record<keyof Tables, string>): string {
  const tables = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, readTable(v)])) as Record<keyof Tables, Map<number, Record<string, string>>>;
  const regions = [...tables.consensus.keys()].sort((a, b) => a - b);
  const level = (v: string, what: string) => {
    if (!(LEVELS as readonly string[]).includes(v)) throw new Error(`${what}: "${v}" is not one of ${LEVELS.join(', ')}`);
    return v;
  };
  const head = [
    '# ArchaeoGLOBE Public Data (ArchaeoGLOBE Project 2019), its summary tables joined: one row for each of its 146 regions at each of its ten times.',
    '# This is not a file of ArchaeoGLOBE\'s. Each value is copied from the table named in its column\'s note below, unchanged; only the layout is new.',
    '# Uses: foraging = Foraging/Hunting/Gathering/Fishing; extensive = extensive agriculture (swidden, shifting and other non-continuous cultivation);',
    '#   intensive = intensive agriculture (all continuous cultivation); pastoral = pastoralism. Levels, as the survey defined them: None (no evidence of the use),',
    '#   Minimal (present, less than 1% of the land), Common (1-20% of the land), Widespread (more than 20% of the land).',
    '# <use>: the consensus assessment (CONSENSUS); <use>_min, <use>_median, <use>_max: the least, median (the lesser of the two middle answers) and most of the answers.',
    '# urban: the consensus on dense urban centres (Present or Absent); urban_median: the median answer, or Split. quality: the median score of how well the',
    '#   region\'s land use is known then (0 unknown, 1 moderate, 2 good); expertise: the mean of the respondents\' own expertise (0 none, 1 low, 2 high);',
    '#   excavations: the median answer for how many excavations are published for the region.',
    '# year: the time on the world\'s axis (astronomical years: -1999 is 2000 BCE); the survey\'s 2,000 BP is its "0 CE", year 0 here.',
    `# Made by \`npm run world -- archaeoglobe-snapshot\` (tools/world/src/archaeoglobe.ts) from the Dataverse record doi:${RECORD.doi}, version ${RECORD.version}, CC0 1.0.`,
    '# Tables: name, Dataverse file id, MD5 as the record gives it, sha256 of the bytes read.',
    ...Object.entries(TABLES).map(([k, v]) => `# ${v.name},${v.id},${md5[k as keyof Tables]},${sha[k as keyof Tables]}`),
  ];
  const cols = ['region', 'label', 'slice', 'year'];
  for (const u of Object.values(USES)) cols.push(u, `${u}_min`, `${u}_median`, `${u}_max`);
  cols.push('urban', 'urban_median', 'quality', 'expertise', 'excavations');
  const quote = (s: string) => (/[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const rows: string[] = [cols.join(',')];
  for (const r of regions) {
    const c = tables.consensus.get(r)!;
    for (const s of SLICES) {
      const out: string[] = [String(r), quote(c.Label), s.key, String(s.year)];
      for (const prefix of Object.keys(USES)) {
        const where = `region ${r}, ${prefix} ${s.key}`;
        out.push(level(cell(c, prefix, s.key), `consensus, ${where}`));
        for (const t of ['minimum', 'median', 'maximum'] as const) out.push(level(cell(tables[t].get(r)!, prefix, s.key), `${t}, ${where}`));
      }
      out.push(cell(c, 'URBAN', s.key), cell(tables.urban.get(r)!, 'URBAN', s.key), cell(tables.quality.get(r)!, 'DQ', s.key), cell(tables.expertise.get(r)!, 'EXPERTISE', s.key), quote(tables.excavations.get(r)!.SITES));
      rows.push(out.join(','));
    }
  }
  return `${[...head, ...rows].join('\n')}\n`;
}

/** Every table, read from Dataverse and checked against the MD5 its record gives. */
export async function exportAssessments(log: (s: string) => void = console.log): Promise<string> {
  const meta = (await (await fetch(`${RECORD.api}/datasets/:persistentId/?persistentId=doi:${RECORD.doi}`)).json()) as {
    data: { latestVersion: { versionNumber: number; versionMinorNumber: number; files: { dataFile: { id: number; md5: string; originalFileFormat?: string } }[] } };
  };
  const v = meta.data.latestVersion;
  if (`${v.versionNumber}.${v.versionMinorNumber}` !== RECORD.version) throw new Error(`the record is at version ${v.versionNumber}.${v.versionMinorNumber}, not ${RECORD.version}: read what changed before making the snapshot again`);
  const text = {} as Tables;
  const md5 = {} as Record<keyof Tables, string>;
  const sha = {} as Record<keyof Tables, string>;
  for (const [k, t] of Object.entries(TABLES) as [keyof Tables, (typeof TABLES)[keyof Tables]][]) {
    const f = v.files.find((x) => x.dataFile.id === t.id);
    if (!f) throw new Error(`the record has no file ${t.id} (${t.name})`);
    // The table as it was uploaded, not as Dataverse re-tabulated it: that is what its MD5 is of.
    const res = await fetch(`${RECORD.api}/access/datafile/${t.id}?format=original`, { headers: { 'User-Agent': 'wikiworldmodel-world-tools' } });
    if (!res.ok) throw new Error(`${t.name}: HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const got = createHash('md5').update(bytes).digest('hex');
    if (got !== f.dataFile.md5) throw new Error(`${t.name}: MD5 ${got} where the record gives ${f.dataFile.md5}`);
    md5[k] = got;
    sha[k] = createHash('sha256').update(bytes).digest('hex');
    // The tables are in Latin-1: "Côte d'Ivoire" is one byte for its ô.
    text[k] = new TextDecoder('latin1').decode(bytes);
    log(`${t.name}: ${bytes.length} bytes, MD5 as the record gives it`);
  }
  return snapshotText(text, md5, sha);
}
