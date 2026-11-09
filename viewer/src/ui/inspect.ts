// The inspect panel: what something is, when and where, every claim with its sources and
// locators, the competing claims (which can be picked), its relations and the ones other
// records make to it, and what the derived dates rest on.
import type { ClimateClass } from '../../../core/climate.ts';
import type { Cover } from '../../../core/planet.ts';
import type { LivingTaxon, SceneSpec } from '../../../core/scene.ts';
import type { CitationRecord, ClaimRecord, EntityRecord, OverlaysFile, SeriesRecord, SourceRecord } from '../../../core/records.ts';
import { LEVEL_LABEL } from '../../../core/ladder.ts';
import { SPREAD_TEXT, type FieldSpread } from '../../../core/samples.ts';
import type { Answer } from '../../../core/resolve.ts';
import { splitRef } from '../../../core/refs.ts';
import { lookup, scenarioKey, type Scenario } from '../../../core/scenario.ts';
import type { Estimate, FeatureTime } from '../../../core/tileset.ts';
import { formatTime, fromMa, historical, PRESENT_YEAR } from '../../../core/time.ts';

const esc = (s: unknown) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function short(s: SourceRecord | undefined, ref: string): string {
  if (!s) return ref;
  const names = (s.authors ?? []).map((a) => a.split(',')[0]);
  const who = names.length === 0 ? s.container ?? s.title ?? s.id : names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} & ${names[1]}` : `${names[0]} et al.`;
  // A text is cited by its author, as classicists do; its edition's year is not when it was written.
  return s.published && s.type !== 'text' ? `${who} ${s.published}` : who;
}

const finite = (x: number) => Number.isFinite(x);

/** The precision an estimate supports: a day or a month where its bounds are that close, else a year (or the age's). */
const resolutionOf = (e: Estimate) => (finite(e.lo) && finite(e.hi) && historical(e.lo) && e.hi - e.lo < 1 ? Math.max(e.hi - e.lo, 1e-6) : 1e3);

function fmtEstimate(e: Estimate, open: 'start' | 'end', unknown = false): string {
  const res = resolutionOf(e);
  // An upper bound is where the last unit inside it ends: 16 March for a moment on 15 March.
  const upper = (x: number) => formatTime(historical(x) ? x - 1e-7 : x, res);
  if (e.best === null && open === 'end') return unknown ? 'end unknown' : 'still exists';
  if (e.best === null) return finite(e.lo) ? `unknown, no earlier than ${formatTime(e.lo, res)}` : finite(e.hi) ? `unknown, no later than ${upper(e.hi)}` : 'unknown';
  const main = formatTime(e.best, res);
  const lo = finite(e.lo) ? formatTime(e.lo, res) : null;
  const hi = finite(e.hi) ? upper(e.hi) : null;
  let range = '';
  if (lo && hi && lo !== hi) range = ` (${lo} – ${hi})`;
  else if (lo && !hi && lo !== main) range = ` (no earlier than ${lo})`;
  else if (!lo && hi && hi !== main) range = ` (no later than ${hi})`;
  return `${main}${range}`;
}

export function fmtTime(t: FeatureTime): string {
  if (t.instant) return fmtEstimate(t.start, 'start');
  return `${fmtEstimate(t.start, 'start')} → ${fmtEstimate(t.end, 'end', t.endUnknown)}`;
}

const PROP_LABEL: Record<string, string> = {
  name: 'Name',
  date: 'Date',
  start: 'Start',
  end: 'End',
  earlier_than: 'Earlier than',
  later_than: 'Later than',
  location: 'Location',
  frame: 'Frame',
  identified_as: 'Identified as',
  formation: 'Formation',
  diameter: 'Diameter',
  area: 'Area',
  color: 'Chart colour',
  surface: 'Surface',
  atmosphere: 'Atmosphere',
  ice_reach: 'Ice reached',
  territory: 'Territory',
};

/** A property with no label of its own, in words: sea_level as "Sea level". */
const words = (prop: string) => prop.charAt(0).toUpperCase() + prop.slice(1).replace(/_/g, ' ');

const REL_LABEL: Record<string, string> = {
  before: 'before',
  after: 'after',
  during: 'during',
  contains: 'contains',
  'part-of': 'part of',
  'has-part': 'has part',
  'member-of': 'member of',
  'has-member': 'has member',
  'caused-by': 'caused by',
  caused: 'caused',
  'descends-from': 'descends from',
  'gave-rise-to': 'gave rise to',
  carries: 'carries',
};

export interface InspectCallbacks {
  /** pick a competing claim over its group's default (null: back to the default) */
  onPick(group: string[], claim: string | null): void;
  onClose(): void;
  onOpen(entityId: string): void;
  labelOf(ref: string): string;
  altTitle(id: string): string;
}

export interface TerrainInfo {
  /** elevation: metres of the time; blocks: positive inside a continental block */
  mode: 'elevation' | 'blocks';
  lat: number;
  lon: number;
  elevation: number;
  plate: number | null;
  plateLabel?: string;
  keyframes: [number, number];
  mix: number;
  t: number;
  source: SourceRecord | undefined;
  fieldTitle: string;
  fieldDescription?: string;
  /** how the field carries its uncertainty */
  fieldSpread?: FieldSpread;
  coastline?: string;
  datum?: string;
  /** for a field of today's ground: the sea level of the time, relative to today's, and the series it is read from */
  seaLevel?: { m: number; title: string };
  state?: PlanetStateInfo;
  /** what covers the land here: the class the climate field gives, and which transitions have happened */
  biome?: BiomeHere;
  /** the state a borders dataset draws here, at this time */
  polity?: { name: string; from: number; to: number; area: number; wikipedia?: string; source?: SourceRecord; row?: RowInfo };
  /** what a grid of people gives for the cell here, at this time, if it is drawn */
  people?: PeopleHere;
  /** what the ice-sheet field gives here, where it has any ice near */
  ice?: IceHere;
}

/** The ice-sheet field at a place and time: what it gives, and how far to trust it. */
export interface IceHere {
  title: string;
  /** the globe draws ice here at this time */
  drawn: boolean;
  /** between its keyframes, in metres */
  thickness: number;
  marginM: number;
  /** the keyframes read, and their thickness here */
  at: { ageMa: number; thickness: number }[];
  /** where the dataset gives several for this time: the scenario drawn, and the others */
  scenario?: { id: string; title: string };
  others: { id: string; title: string; thickness: number; drawn: boolean }[];
  uncertainty?: string;
  /** after the present: why the youngest keyframe is held */
  held?: string;
  source?: SourceRecord;
}

/** What a grid of people gives for the cell a click fell in, at the time shown. */
export interface PeopleHere {
  t: number;
  /** the cell's south-west corner, and how wide it is, in degrees */
  south: number;
  west: number;
  res: number;
  /** how many people it holds at this time */
  people: number;
  /** its land in km², which may be none */
  land: number;
  /** the two time steps it lies between, the same one if it is on a step, and what the dataset gives at each */
  from: { step: number; people: number };
  to: { step: number; people: number };
  /** the range the authors give for their numbers at this time, in percent either way */
  range?: number;
  description?: string;
  source?: SourceRecord;
}

/** A time step of the grid, as the dataset labels it. The axis reads the labels as they stand, so it would call 0 AD 1 BCE. */
export const stepName = (step: number) => (step < 0 ? `${(-step).toLocaleString('en-US')} BC` : `${step} AD`);

/** The land's cover at a place and time, and what it rests on. */
export interface BiomeHere {
  climate: ClimateClass;
  label: string;
  cover: Cover;
  /** a field says where the ice sheets are at this time, and the climate's own reading of ice gives way to it */
  sheets?: boolean;
  title: string;
  /** the transitions that have happened by this time, and the next that has not */
  transitions: { id: string; label: string }[];
  next?: { id: string; label: string };
  rule: string;
  ruleSource?: SourceRecord;
}

/** In words, what the globe paints: the climate's class, as far as the transitions have gone. */
export function coverWords(b: Pick<BiomeHere, 'climate' | 'cover' | 'sheets'>): string {
  const { climate, cover } = b;
  if (climate === 'ice') return b.sheets ? 'Bare ground that never thaws' : 'Ice';
  if (cover.plants <= 0) return cover.crust > 0 ? 'Bare ground, under microbial crusts' : 'Bare rock and sand';
  if (climate === 'desert') return 'Desert';
  if (climate === 'tundra') return cover.plants < 0.5 ? 'Bare ground and the first low plants' : 'Tundra';
  if (climate === 'steppe') return cover.grasses > 0.5 ? 'Grassland' : 'Low plants and scrub';
  if (climate === 'savanna') return cover.grasses > 0.5 ? 'Savanna: grass and scattered trees' : cover.forests > 0.5 ? 'Dry woodland' : 'Low plants';
  if (cover.forests < 0.5) return 'Low plants, without forests yet';
  return climate === 'rainforest' ? 'Tropical rain forest' : climate === 'cold' ? 'Cold-winter forest' : 'Temperate forest';
}

/** The planet's phase and ice at the time shown, and the records that say so. */
export interface PlanetStateInfo {
  planet: string;
  phase: string;
  ice?: { id: string; label: string; reach: string };
}

/** A taxon as a living scene draws it. */
export interface OrganismHere {
  taxon: LivingTaxon;
  site: string;
  slice: number;
  /** the stage of the chart it is drawn for, if it is a place with no scene of its own */
  stage?: string;
  fossils: SceneSpec['fossils'];
  generator: string;
  /** it is on the sea's list: its fossils are near or far by sea, and those of the region in a like belt of latitude */
  sea?: boolean;
}

const fmt = (x: number) => (x >= 10 ? x.toFixed(0) : x >= 1 ? x.toFixed(1) : x.toFixed(2));

/** Where a click on the globe fell inside a polity's territory: the dataset's row drawn there. */
export interface TerritoryHere {
  t: number;
  /** the dataset's name for the row, and the years it holds */
  name: string;
  from: number;
  to: number;
  area: number;
  source: SourceRecord | undefined;
}

/** A series' value at a time, with its band, interpolated between its points. */
export interface SeriesValue {
  value: number;
  lo: number | null;
  hi: number | null;
}

/** A number to three significant figures, as people write it. */
export const fmtValue = (x: number): string => {
  // Three significant figures however small: a pressure of 0.0000113 bar is not 0.
  const three = (v: number) => Number(v.toPrecision(3)).toLocaleString('en-US', { maximumFractionDigits: 20 });
  const size = Math.abs(x);
  return size >= 1e9 ? `${three(x / 1e9)} billion` : size >= 1e6 ? `${three(x / 1e6)} million` : three(x);
};

/** A row of a dataset, as a click finds it (docs/STRUCTURE.md section 3.1): its address, and what overlays say of it. */
export interface RowInfo {
  ref?: string;
  /** what overlays changed in it, by property */
  corrected?: string[];
  overlay?: OverlaysFile['rows'][string];
}

/** A row's address, for an overlay to name, and the overlay's claims on it beside the row's own. */
function rowSection(row: RowInfo | undefined): string {
  if (!row?.ref) return '';
  const claims = (row.overlay?.claims ?? [])
    .map((c) => `<li><span class="badge">${esc(c.origin === 'row' ? 'the row' : 'overlay')}</span> ${esc(words(c.prop))}: ${esc(typeof c.value === 'object' ? JSON.stringify(c.value) : String(c.value))}${c.rank !== 'normal' ? ` <span class="badge rank">${esc(c.rank)}</span>` : ''}${c.origin === 'overlay' ? ` <span class="author">${esc(c.author)}</span>` : ''}${c.note ? `<p class="note">${esc(c.note)}</p>` : ''}${c.origin === 'overlay' ? c.sources.filter((x) => x.quote).map((x) => `<blockquote>${esc(x.quote!)}</blockquote>`).join('') : ''}</li>`)
    .join('');
  return `<section class="row"><h3>The row</h3><p class="method">Its address in the dataset, which an overlay names to correct it or tie it to a record: <code>${esc(row.ref)}</code></p>${row.corrected ? `<p class="note">An overlay corrects its ${esc(row.corrected.map(words).join(', '))}.</p>` : ''}${row.overlay?.same_as ? `<p class="method">It is a row of ${esc(row.overlay.same_as)}.</p>` : ''}${claims ? `<ul class="row-claims">${claims}</ul>` : ''}</section>`;
}

/** What a claim's checking badge says on hover: its level, then each step with who did it and how. */
function checkedTitle(c: ClaimRecord): string {
  return [LEVEL_LABEL[c.level], ...(c.checked ?? []).map((s) => `${s.step} by ${s.by}${s.on ? ` on ${s.on}` : ''}: ${s.how}`)].join('\n');
}

export class InspectPanel {
  readonly el: HTMLElement;

  constructor(private cb: InspectCallbacks) {
    this.el = document.createElement('aside');
    this.el.className = 'inspect';
    this.el.hidden = true;
    this.el.setAttribute('aria-live', 'polite');
  }

  hide(): void {
    this.el.hidden = true;
    this.el.innerHTML = '';
  }

  private frame(title: string, body: string): void {
    this.el.innerHTML = `<header><h2>${esc(title)}</h2><button class="close" aria-label="Close">×</button></header>${body}`;
    this.el.querySelector<HTMLButtonElement>('.close')!.onclick = () => this.cb.onClose();
    for (const a of this.el.querySelectorAll<HTMLAnchorElement>('a.open')) {
      a.onclick = (e) => {
        e.preventDefault();
        this.cb.onOpen(a.dataset.entity!);
      };
    }
    this.el.hidden = false;
  }

  /** The planet's state at the time, with links to the records it comes from. */
  private stateSection(s: PlanetStateInfo | undefined): string {
    if (!s) return '';
    return `<section class="planet-state"><h3>The planet then</h3><p>${this.link(s.planet, s.phase)}${s.ice ? `, with ice to ${esc(s.ice.reach)} during the ${this.link(s.ice.id, s.ice.label)}` : ''}.</p></section>`;
  }

  private cites(r: EntityRecord, cs: CitationRecord[], unsourced?: string): string {
    if (unsourced) return `<span class="cite unsourced">No source: ${esc(unsourced)}</span>`;
    return cs.map((c) => `<span class="cite">${esc(short(r.sources[c.ref], c.ref))}${c.loc ? `, ${esc(c.loc)}` : ''}</span>`).join('<span class="cite">; </span>');
  }

  private link(ref: string, label: string, wanted = false): string {
    if (wanted) return `<span class="wanted" title="Not written yet">${esc(label)} <span class="badge">wanted</span></span>`;
    const id = splitRef(ref).record;
    return `<a href="#" class="open" data-entity="${esc(id)}">${esc(label)}</a>`;
  }

  /** How to go and see a taxon where it lived, if there is somewhere to go: what the panel offers. */
  seeIt: ((id: string) => { label: string; go: () => void } | undefined) | null = null;

  showEntity(r: EntityRecord, scenario: Scenario, time: FeatureTime, here?: TerritoryHere, organism?: OrganismHere): void {
    const status = r.claims.every((c) => c.status === 'accepted') ? 'accepted' : r.claims.some((c) => c.status === 'disputed') ? 'disputed' : 'proposed';
    const machine = r.claims.some((c) => c.author.startsWith('machine:'));
    const alts = new Set(scenario.alts ?? []);
    const picks = new Set(scenario.picks ?? []);
    const groups = new Map<string, ClaimRecord[]>();
    for (const c of r.claims) groups.set(c.group, [...(groups.get(c.group) ?? []), c]);
    const variant = (pick: string) => r.variants.find((v) => v.key === scenarioKey({ alts: scenario.alts, picks: [pick] }));
    const derivation = (refs: string[]) =>
      refs
        .filter((x) => x.includes('#'))
        .map((x) => {
          const { record: entity, part: key } = splitRef(x);
          return `<li>${entity === r.id ? esc(r.label) : this.link(entity, this.cb.labelOf(entity))} · <code>${esc(key)}</code></li>`;
        })
        .join('');
    const derivedRefs = [...new Set([...(time.start.derived ? r.derivedBy.start : []), ...(!time.instant && time.end.derived ? r.derivedBy.end : [])])];

    let claims = '';
    for (const [group, all] of groups) {
      // A claim of an alternative shows when that alternative is chosen; it replaces the
      // default picture's claims of its group.
      const own = all.filter((c) => c.alt && alts.has(c.alt));
      const cs = own.length ? own : all.filter((c) => !c.alt);
      const others = all.filter((c) => !cs.includes(c));
      const prop = cs[0]?.prop ?? all[0].prop;
      const competing = cs.length > 1;
      const def = cs.find((c) => c.rank === 'preferred') ?? (cs.filter((c) => c.rank !== 'deprecated').length === 1 ? cs.find((c) => c.rank !== 'deprecated') : undefined);
      const chosen = cs.find((c) => picks.has(c.ref)) ?? def;
      const phaseId = cs[0] ? splitRef(cs[0].subject).phase : undefined;
      const phase = phaseId ? r.phases.find((p) => p.id === phaseId) : undefined;
      claims += `<div class="claim-group${competing ? ' competing' : ''}"><h4>${esc(PROP_LABEL[prop] ?? words(prop))}${phase ? ` <span class="phase">· ${esc(phase.label)}</span>` : ''}${competing ? ' <span class="badge">competing claims</span>' : ''}</h4>`;
      for (const c of cs) {
        const v = competing && c !== def ? variant(c.ref) : undefined;
        const inconsistent = v && !v.consistent;
        const radio = competing
          ? `<input type="radio" name="${esc(group)}" value="${esc(c.ref)}" data-default="${esc(def?.ref ?? '')}" data-members="${esc(all.map((x) => x.ref).join(' '))}" ${c === chosen ? 'checked' : ''} ${inconsistent ? 'disabled' : ''} aria-label="Use this claim">`
          : '';
        const conf = c.confidence !== undefined ? `confidence: ${typeof c.confidence === 'number' ? c.confidence : `${c.confidence}${c.confidenceRange ? ` (${c.confidenceRange[0]}–${c.confidenceRange[1]})` : ''}`}` : '';
        claims += `<div class="claim rank-${esc(c.rank)}${inconsistent ? ' inconsistent' : ''}" data-claim="${esc(c.ref)}">
          <label>${radio}<span class="value">${esc(c.valueText)}</span>${this.cites(r, c.sources, c.unsourced)}</label>
          <div class="claim-meta"><span class="badge rank">${esc(c.rank)}</span><span class="badge status-${esc(c.status)}">${esc(c.status)}</span>${c.level && c.level !== 'unchecked' && c.level !== 'accepted' ? `<span class="badge ladder" title="${esc(checkedTitle(c))}">checked: ${esc(c.level)}</span>` : ''}${c.basis !== 'evidence' ? `<span class="badge basis-${esc(c.basis)}">${esc(c.basis)}</span>` : ''}${c.alt ? `<span class="badge alt">${esc(this.cb.altTitle(c.alt))}</span>` : ''}${conf ? `<span class="badge">${esc(conf)}</span>` : ''}${c.methodLabel ? `<span class="badge">${esc(c.methodLabel)}</span>` : ''}<span class="author">${esc(c.author)}</span></div>
          ${c.validText ? `<p class="method">Holds: ${esc(c.validText)}</p>` : ''}
          ${c.sources.filter((s) => s.quote).map((s) => `<blockquote>${esc(s.quote)}</blockquote>`).join('')}
          ${c.note ? `<p class="note">${esc(c.note)}</p>` : ''}
          ${inconsistent ? `<p class="conflict">Contradicts the rest of the world, so it cannot be shown. Conflicting with:</p><ul class="conflict">${derivation(v!.conflict!.filter((x) => x !== c.ref))}</ul>` : ''}
        </div>`;
      }
      if (others.length) claims += `<p class="method">${others.length} more in ${esc([...new Set(others.map((c) => (c.alt ? this.cb.altTitle(c.alt) : 'the default picture')))].join(', '))}.</p>`;
      claims += `</div>`;
    }
    const relations = r.relations
      .filter((x) => !x.alt || alts.has(x.alt))
      .map((x) => `<li><strong>${esc(REL_LABEL[x.rel] ?? x.rel.replace(/-/g, ' '))}</strong> ${this.link(x.to, x.toLabel, x.wanted)}${x.lagText ? ` <span class="muted">(${esc(x.lagText)})</span>` : ''} <span class="cite">— ${this.cites(r, x.sources, x.unsourced)}</span>${x.sources.filter((s) => s.quote).map((s) => `<blockquote>${esc(s.quote)}</blockquote>`).join('')}${x.note ? `<p class="note">${esc(x.note)}</p>` : ''}</li>`)
      .join('');
    const inverse = r.inverse.map((x) => `<li><strong>${esc(REL_LABEL[x.rel] ?? x.rel.replace(/-/g, ' '))}</strong> ${this.link(x.from, x.fromLabel)} <span class="muted">(stated by that record)</span></li>`).join('');
    const sources = Object.values(r.sources)
      .map((s) => `<li id="src-${esc(s.id)}"><p>${esc(s.citation)}</p>${s.doi ? `<a href="https://doi.org/${encodeURI(s.doi)}" target="_blank" rel="noopener">doi:${esc(s.doi)}</a>` : s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.url)}</a>` : ''} <span class="badge">${esc(s.kind)}</span>${s.license ? ` <span class="badge">${esc(s.license)}</span>` : ''}${s.written ? `<p class="written">Written ${esc(s.written)}.</p>` : ''}${s.type === 'text' && s.reliability ? `<p class="note">${esc(s.reliability)}</p>` : ''}${s.verified ? `<p class="verified">Checked: ${esc(s.verified.how)}</p>` : ''}</li>`)
      .join('');
    const f = r.frame;
    const where = !f
      ? r.claims.some((c) => c.prop === 'territory')
        ? 'Its territory is drawn on the globe, from the rows of a borders dataset, for the years each row gives.'
        : 'No location: shown through what it is related to.'
      : f.plate !== undefined
        ? `Moves with ${f.entity ? this.link(f.entity, f.entityLabel ?? f.entity) : esc(f.title)} (plate ${f.plate} of the PALEOMAP model); its position at other times is reconstructed by the plate model.`
        : esc(f.title);
    const phases = r.phases.map((p) => `<li>${esc(p.label)}${p.gap ? ' <span class="badge">gap</span>' : ''}: ${esc(fmtTime(lookup(p.variants, scenario, p.time)))}</li>`).join('');
    const chosenAlts = [...alts].filter((a) => r.claims.some((c) => c.alt === a) || r.variants.some((v) => v.key.split(' ').includes(a)));
    this.frame(
      r.label,
      `<div class="meta"><span class="kind">${esc(r.kindLabel)}</span><span class="badge basis-${esc(r.basis.time)}" title="How directly its dates rest on evidence">${esc(r.basis.time)}</span><span class="badge status-${status}">${status}${machine && status === 'proposed' ? ' · machine-made, needs review' : ''}</span></div>
      ${r.summary ? `<p class="summary">${esc(r.summary)}</p>` : ''}
      ${here ? this.hereSection(here) : ''}
      ${organism ? this.organismSection(organism) : ''}
      <section><h3>When</h3><p class="when">${esc(fmtTime(time))}${picks.size || chosenAlts.length ? ' <span class="badge">with your choices</span>' : ''}</p>
      ${chosenAlts.map((a) => `<p class="method">In the alternative “${esc(this.cb.altTitle(a))}”.</p>`).join('')}
      ${phases ? `<ul class="phases">${phases}</ul>` : ''}
      ${derivedRefs.length ? `<p class="derived">Derived by the chronology solver from:</p><ul class="derived">${derivation(derivedRefs)}</ul>` : ''}</section>
      <section><h3>Where</h3><p>${where}</p></section>
      <section><h3>Claims</h3>${claims}</section>
      ${relations ? `<section><h3>Relations</h3><ul class="relations">${relations}</ul></section>` : ''}
      ${inverse ? `<section><h3>Related records</h3><ul class="relations inverse">${inverse}</ul></section>` : ''}
      ${r.wanted.length ? `<section><h3>Wanted</h3><p class="method">Referred to here but not written yet: ${r.wanted.map((w) => `<code>${esc(w)}</code>`).join(', ')}.</p></section>` : ''}
      <section><h3>Sources</h3><ol class="sources">${sources}</ol></section>`,
    );
    // A taxon can be gone and seen, where the most of its fossils are.
    const see = organism ? undefined : this.seeIt?.(r.id);
    if (see) {
      const button = document.createElement('button');
      button.className = 'see-it';
      button.textContent = see.label;
      button.onclick = see.go;
      this.el.querySelector('.meta')?.after(button);
    }
    for (const input of this.el.querySelectorAll<HTMLInputElement>('input[type=radio]')) {
      input.onchange = () => this.cb.onPick(input.dataset.members!.split(' '), input.value === input.dataset.default ? null : input.value);
    }
  }

  /** In a living scene: what puts this taxon there, from the records; and what the generator made up. */
  private organismSection(o: OrganismHere): string {
    const t = o.taxon;
    const sizes = [t.fromMass ? `${fmt(t.mass!)} kg` : t.length !== undefined ? `${fmt(t.length)} m long` : '', t.hip !== undefined ? `${fmt(t.hip)} m at the hips` : '', t.height !== undefined ? `${fmt(t.height)} m tall` : ''].filter(Boolean).join(', ');
    const rows = `${t.rows} ${t.rows === 1 ? 'occurrence' : 'occurrences'}`;
    const where = (km: number) => (km < 20 ? 'close by' : `about ${(Math.round(km / 10) * 10).toLocaleString('en-US')} km from here, ${o.sea ? 'by sea' : 'over land'}`);
    const recorded =
      t.tier === 'formation'
        ? `<strong>Recorded:</strong> ${rows} in ${t.collections} ${t.collections === 1 ? 'collection' : 'collections'} of ${esc(o.fossils.title)}${sizes && !t.size_from ? `; grown, ${esc(sizes)}, as the claims below say` : ''}.`
        : t.tier === 'here'
          ? `<strong>Recorded here:</strong> ${rows} of ${esc(o.fossils.title)} in this stage, the nearest ${where(t.km ?? 0)}.`
          : t.tier === 'region'
            ? `<strong>Inferred:</strong> the nearest of its ${rows} in this stage is ${where(t.km ?? 0)}, and no fossil puts it at this spot. ${o.sea ? 'That it lived here too is a guess from the sea between, in a like belt of latitude.' : 'That it lived here too is a guess from the land and the climate between.'}`
            : o.sea
              ? `<strong>A stand-in:</strong> nothing is recorded in the sea within reach: the nearest fossil of any kind is ${where(t.km ?? 0)}. ${esc(t.label)} is among the commonest of this stage in a like belt of latitude, and stands for what sort of thing may have lived here; it is no claim that it did.`
              : `<strong>A stand-in:</strong> nothing of this kind is recorded within reach: the nearest fossil of any kind is ${where(t.km ?? 0)}. ${esc(t.label)} stands for what sort of thing may have lived here, and is no claim that it did.`;
    const body = t.own ? `<p><strong>Its body:</strong> its own form, as the claims below say.</p>` : `<p><strong>Its body:</strong> drawn from the form of ${esc(t.form_label)}, the nearest node of the tree with one. No one has written its own yet.</p>`;
    const size = t.size_from ? `<p><strong>Its size:</strong> ${esc(sizes)}, within the range the record of ${esc(t.size_from)} gives. No one has measured it here.</p>` : '';
    return `<section class="here organism"><h3>In ${esc(o.site)}, ${esc(o.stage ?? formatTime(o.slice))}</h3>
      <p>${recorded}</p>${body}${size}
      <p><strong>Generated:</strong> where each stands, how many there are, what each is doing, how old it is and its colour${t.fromMass ? ', and its length, from its mass and the shape of the plan' : ''}. Nobody recorded these. <span class="method">${esc(o.generator)}, shown in magenta in evidence mode.</span></p></section>`;
  }

  /**
   * What the records say lived at this place and time, in tiers, and what was made of it. `list` is the atlas the taxa
   * are from, the land's or the sea's; `sea` that the scene is of the sea.
   */
  showLifeHere(spec: SceneSpec, note?: string, where: { list: 'land' | 'sea'; sea: boolean } = { list: 'land', sea: false }): void {
    const group = (tier: string, title: string, say: string) => {
      const list = spec.taxa.filter((t) => t.tier === tier);
      if (!list.length) return '';
      const items = list.map((t) => {
        const name = t.id.startsWith('txn:') ? esc(t.label) : this.link(t.id, t.label);
        const size = t.length !== undefined ? `${fmt(t.length)} m` : t.height !== undefined ? `${fmt(t.height)} m tall` : '';
        const own = t.own ? '' : `, drawn as ${esc(t.form_label)}`;
        return `<li>${name}${size ? ` <span class="method">${esc(size)}${own}</span>` : own ? ` <span class="method">${own.slice(2)}</span>` : ''}</li>`;
      });
      return `<section class="here organism"><h3>${esc(title)}</h3><p class="note">${esc(say)}</p><ul>${items.join('')}</ul></section>`;
    };
    const b = spec.biome;
    const none = spec.taxa.length
      ? ''
      : where.sea
        ? '<section class="here organism"><h3>Nothing of the sea drawn</h3><p>None of what the atlas of the sea lists here, if it lists anything, has a body to draw it with yet. The sea is drawn empty: its floor, and the water over it.</p></section>'
        : '<section class="here organism"><h3>Nothing on land</h3><p>No fossil of anything living on land is known from this stage, anywhere within reach. The land is drawn bare.</p></section>';
    const tiers =
      where.list === 'sea'
        ? `${group('here', 'Recorded here', 'A fossil of it within a few hundred km by sea, from this stage.')}${group('region', 'Recorded in the region', 'A fossil of it can be reached by sea, in a like belt of latitude. That it lived at this spot is an inference.')}${group('standin', 'Stand-ins', 'Nothing is recorded in the sea within reach. These are among the commonest of the stage in a like belt of latitude, and stand for what sort of thing may have lived here; they are no claim that it did.')}`
        : `${group('here', 'Recorded here', 'A fossil of it within a few hundred km, from this stage.')}${group('region', 'Recorded in the region', 'A fossil of it can be reached overland, in a like climate. That it lived at this spot is an inference.')}${group('standin', 'Stand-ins', 'Nothing of this kind is known within reach. These stand for what sort of thing may have lived here, and are no claim that it did.')}`;
    const summary = where.sea
      ? 'A sea, drawn at the depth the elevation field gives it. Every animal you see is placed by a generator: only who could be here comes from fossils.'
      : `Where the climate field reads the land at ${esc(String(b.ageMa))} Ma it is ${esc(b.label.toLowerCase())}, and the transitions allow forest over ${Math.round(b.cover.forests * 100)}% of it and grass over ${Math.round(b.cover.grasses * 100)}%. Every plant and animal you see is placed by a generator: only who could be here comes from fossils.`;
    this.frame(spec.site.stage ?? 'This place', `<div class="meta"><span class="kind">What lived here</span> <span class="badge basis-procedural">procedural</span></div>
      <p class="summary">${summary}</p>
      ${none}${tiers}
      ${note ? `<section><p class="note">${esc(note)}</p></section>` : ''}`);
  }

  /** A living thing that is only a row of a database: what the row says, and what was made of it. */
  showOrganism(t: LivingTaxon, o: OrganismHere, src: SourceRecord | undefined): void {
    const source = `<section><h3>Source</h3><ol class="sources"><li><p>${esc(src?.citation ?? '')}</p></li></ol></section>`;
    this.frame(t.label, `<div class="meta"><span class="kind">Taxon, in the Paleobiology Database</span> <span class="badge basis-procedural">procedural</span></div>${this.organismSection(o)}${source}`);
  }

  /** Inside a polity's territory: which of the dataset's rows is drawn there, and for what years. */
  private hereSection(h: TerritoryHere): string {
    const years = formatTime(h.from) === formatTime(h.to - 1) ? formatTime(h.from) : `${formatTime(h.from)} – ${formatTime(h.to - 1)}`;
    const area = h.area >= 1e6 ? `${fmtValue(h.area / 1e6)} million km²` : `${fmtValue(h.area)} km²`;
    const who = h.source ? short(h.source, h.source.id) : 'its dataset';
    return `<section class="here"><h3>Here, at ${esc(formatTime(h.t))}</h3><p>Inside its territory, as ${esc(who)} draws it for ${esc(years)}: the row named “${esc(h.name)}”, ${esc(area)}.</p>${h.source?.reliability ? `<p class="note">${esc(h.source.reliability)}</p>` : ''}</section>`;
  }

  showTerrain(info: TerrainInfo): void {
    const lat = `${Math.abs(info.lat).toFixed(2)}°${info.lat >= 0 ? 'N' : 'S'}`;
    const lon = `${Math.abs(info.lon).toFixed(2)}°${info.lon >= 0 ? 'E' : 'W'}`;
    const [k0, k1] = info.keyframes;
    const blend = k0 === k1 ? `the ${k0} Ma snapshot` : `the ${k0} and ${k1} Ma snapshots (${Math.round(info.mix * 100)}% of the way to ${k1} Ma)`;
    const s = info.source;
    const source = `<section><h3>Source</h3><ol class="sources"><li><p>${esc(s?.citation ?? '')}</p>${s?.doi ? `<a href="https://doi.org/${encodeURI(s.doi)}" target="_blank" rel="noopener">doi:${esc(s.doi)}</a>` : ''}${s?.reliability ? `<p class="note">${esc(s.reliability)}</p>` : ''}</li></ol></section>`;
    if (info.mode === 'blocks') {
      const inside = info.elevation > 0;
      this.frame(
        inside ? 'Continental block' : 'Between the blocks',
        `<div class="meta"><span class="kind">${esc(info.fieldTitle)}</span><span class="badge basis-reconstruction">reconstruction</span></div>
        <section><h3>Here, at ${esc(formatTime(info.t, 1e4))}</h3>
        <p class="big">${inside ? 'Inside a continental block' : 'Outside the continental blocks'}</p>
        <p>${lat}, ${lon} in the geographic frame of this time${info.plate ? `, on plate ${info.plate}${info.plateLabel ? ` (${esc(info.plateLabel)})` : ''}` : ''}.</p>
        ${info.fieldDescription ? `<p class="note">${esc(info.fieldDescription)}</p>` : ''}
        <p class="method">Interpolated between ${esc(blend)}, each moved with its plates to this time.</p></section>${this.stateSection(info.state)}${source}`,
      );
      return;
    }
    // A cell can hold people where the click fell on its sea, and there it should still say so.
    const people = info.people && (info.people.people >= 0.5 || info.elevation >= 0) ? this.peopleSection(info.people) : '';
    const underIce = !!info.ice?.drawn;
    this.frame(
      underIce ? 'Ice sheet' : info.elevation >= 0 ? 'Land surface' : 'Sea floor',
      `<div class="meta"><span class="kind">${esc(underIce ? info.ice!.title : info.fieldTitle)}</span><span class="badge basis-reconstruction">reconstruction</span></div>
      ${people}
      <section><h3>Here, at ${esc(formatTime(info.t, 1e4))}</h3>
      ${underIce ? this.iceSection(info.ice!) : ''}
      ${underIce
        ? `<p>The ground beneath it is ${Math.abs(Math.round(info.elevation)).toLocaleString('en-US')} m ${info.elevation >= 0 ? 'above' : 'below'} the sea level of the time, as ${esc(info.fieldTitle.toLowerCase())} has it.</p>`
        : `<p class="big">${info.elevation >= 0 ? '' : '−'}${Math.abs(Math.round(info.elevation)).toLocaleString('en-US')} m <span class="muted">${info.elevation >= 0 ? 'above' : 'below'} the sea level of the time</span></p>`}
      <p>${lat}, ${lon} in the geographic frame of this time${info.plate ? `, on plate ${info.plate}${info.plateLabel ? ` (${esc(info.plateLabel)})` : ''}` : ', on no plate polygon (ocean floor the model does not track)'}.</p>
      ${info.ice && !underIce ? this.iceSection(info.ice) : ''}
      ${info.polity && info.elevation >= 0 ? this.politySection(info.polity) : ''}
      ${info.biome && info.elevation >= 0 && !underIce ? this.biomeSection(info.biome) : ''}
      <p class="method">${info.seaLevel ? this.seaLevelMethod(info.seaLevel, info.coastline) : `Interpolated between ${esc(blend)}, each moved with its plates to this time. The ${esc((info.coastline ?? 'coastline').toLowerCase())} is derived, not stored: the ${esc(info.datum === 'contemporaneous-sea-level' ? '0 m' : 'sea-level')} isoline of this field.`}${info.fieldSpread ? ` ${esc(SPREAD_TEXT[info.fieldSpread])}` : ''}</p></section>${this.stateSection(info.state)}${source}`,
    );
  }

  /** How a coast is drawn on today's ground: where it meets the sea level of the time. */
  private seaLevelMethod(level: { m: number; title: string }, coastline: string | undefined): string {
    const m = Math.round(level.m);
    const where = m === 0 ? 'at today\'s' : `${Math.abs(m).toLocaleString('en-US')} m ${m < 0 ? 'below' : 'above'} today's`;
    return `Today's ground, moved with its plates to this time, under the sea of the time: ${where}, as ${esc(level.title.toLowerCase())} has it. The ${esc((coastline ?? 'coastline').toLowerCase())} is derived, not stored: where today's ground meets that level.`;
  }

  /** What the ice-sheet field gives here, in the dataset's own terms, and how far to trust it. */
  private iceSection(i: IceHere): string {
    // Each is known to a few metres at best on these grids, and the panel reads them from a byte.
    const metres = (m: number) => `${(Math.round(m / 10) * 10).toLocaleString('en-US')} m`;
    const when = (ageMa: number) => (ageMa === 0 ? 'the present' : formatTime(fromMa(ageMa)));
    const given = i.at.map((k) => `${k.thickness < 1 ? 'none' : metres(k.thickness)} at ${when(k.ageMa)}`).join(' and ');
    const s = i.source;
    return `<div class="ice"><h3>${i.drawn ? 'Ice here' : 'Beyond the ice sheets, at this time'}</h3>
      ${i.drawn ? `<p class="big">About ${metres(i.thickness)} <span class="muted">of ice</span></p>` : ''}
      <p>${esc(short(s, s?.id ?? 'The dataset'))} gives ${esc(given)}.${i.scenario ? ` Drawn here: ${esc(i.scenario.title)}.` : ''}</p>
      ${i.others.map((o) => `<p>In its other scenario here, ${esc(o.title)}: ${o.drawn ? `about ${metres(o.thickness)}` : 'none'}.</p>`).join('')}
      ${i.held ? `<p class="note">${esc(i.held)}</p>` : ''}
      ${i.uncertainty ? `<p class="note">${esc(i.uncertainty)}</p>` : ''}
      <p class="method">The edge drawn is the ${esc(i.marginM)} m contour of the dataset's grid, and between keyframes it moves evenly from one to the next, as the thickness does: no one reconstructed those years. <span class="badge basis-reconstruction">reconstruction</span></p>
      <p class="method">${esc(s?.citation ?? '')}${s?.doi ? ` <a href="https://doi.org/${encodeURI(s.doi)}" target="_blank" rel="noopener">doi:${esc(s.doi)}</a>` : ''}</p></div>`;
  }

  /** What a grid of people gives for this cell, and how far to trust it. */
  private peopleSection(p: PeopleHere): string {
    const ns = (x: number) => `${Math.abs(x)}°${x >= 0 ? 'N' : 'S'}`;
    const ew = (x: number) => `${Math.abs(x)}°${x >= 0 ? 'E' : 'W'}`;
    const someone = p.people >= 0.5;
    const count = someone ? `About ${fmtValue(p.people)} ${p.people < 1.5 ? 'person' : 'people'}` : 'Nobody';
    const cell = `the ${p.res}° cell from ${ns(p.south)} to ${ns(p.south + p.res)} and ${ew(p.west)} to ${ew(p.west + p.res)}`;
    const dense = someone && p.land > 0 ? `: about ${fmtValue(p.people / p.land)} per km² of its ${p.land.toLocaleString('en-US')} km² of land` : '';
    const given = (s: PeopleHere['from']) => `${Math.round(s.people).toLocaleString('en-US')} at its step ${esc(stepName(s.step))}`;
    const steps = p.from.step === p.to.step ? `The dataset gives ${given(p.from)}.` : `The dataset gives ${given(p.from)} and ${given(p.to)}. Between its steps the line is simply straight, not an estimate.`;
    const range = p.range === undefined ? '' : `<p><strong>How sure:</strong> a reconstruction, not a count. Its authors put the range of their numbers at about ±${Math.round(p.range)}% at this time, partly on their own judgement, and give no range for a single place.</p>`;
    return `<section class="people"><h3>People here, at ${esc(formatTime(p.t, 1e4))} <span class="badge basis-reconstruction">reconstruction</span></h3>
      <p class="big">${count}</p>
      <p>In ${cell}${dense}.</p>
      <p>${steps}</p>
      ${range}
      ${p.description ? `<p class="note">${esc(p.description)}</p>` : ''}
      <p class="method">${esc(p.source?.citation ?? '')}${p.source?.doi ? ` <a href="https://doi.org/${encodeURI(p.source.doi)}" target="_blank" rel="noopener">doi:${esc(p.source.doi)}</a>` : ''}</p></section>`;
  }

  /** Which state a borders dataset draws here. */
  private politySection(p: NonNullable<TerrainInfo['polity']>): string {
    return `<div class="polity"><h3>Held by</h3><p class="big">${esc(p.name)}</p>
      <p>As drawn for ${esc(formatTime(p.from))} to ${esc(formatTime(p.to - 1))}, at about ${p.area.toLocaleString('en-US')} km².${p.wikipedia ? ` <span class="muted">Wikipedia: ${esc(p.wikipedia)}.</span>` : ''}</p>
      <p class="method">A row of ${esc(short(p.source, 'the borders dataset'))}, not a record of ours: its name, its years and its outline are as that dataset gives them, thinned for the globe${p.row?.corrected ? ', except where an overlay corrects them' : ''}.</p>${rowSection(p.row)}</div>`;
  }

  /** What covers the land here: the climate field's class, what the transitions allow by now, and what is generated. */
  private biomeSection(b: BiomeHere): string {
    const by = b.transitions.map((t) => this.link(t.id, t.label)).join(', ');
    return `<div class="biome"><h3>Covered with</h3><p class="big">${esc(coverWords(b))}</p>
      <p>The climate here is ${esc(b.label.toLowerCase())}, in ${esc(b.title)}.${by ? ` So far: ${by}.` : ' No transition has happened yet.'}${b.next ? ` Not yet: ${this.link(b.next.id, b.next.label)}.` : ''}</p>
      <p class="method">${esc(b.rule)}${b.ruleSource ? ` The climate is from ${esc(short(b.ruleSource, b.ruleSource.id))}.` : ''} The pattern within it is generated: <span class="badge basis-procedural">procedural</span></p></div>`;
  }

  /** The globe where no field covers the time shown: what is not known, and why; and the planet's state, if it has one. */
  showUnknown(t: number, why: string, state?: PlanetStateInfo, here?: Answer): void {
    const generic = here?.tier === 'generic' && (here.value === 'land' || here.value === 'sea');
    const note = generic
      ? `Nothing records where the land was, so generic land is drawn: a placeholder, flat and muted under a graticule. Where it stands and its shape are invented, and how much of the planet it covers is a stated placeholder, not a reconstruction. Here it is ${here!.value === 'land' ? 'generic land' : 'generic sea'}. What covers the planet, and any ice, follows its states; the patterns they are drawn with are procedural.`
      : state
        ? 'Where the land was is not known, so none is drawn. What covers the planet, and any ice, follows its states; the patterns they are drawn with are procedural.'
        : 'The globe is drawn plain on purpose: nothing here rests on evidence, a reconstruction or a projection.';
    this.frame(
      'Geography unknown',
      `${generic ? '<div class="meta"><span class="kind">Generic land</span><span class="badge basis-procedural">generic</span></div>' : ''}<section><h3>At ${esc(formatTime(t, 1e4))}</h3><p>${esc(why)}</p>
      <p class="note">${esc(note)}</p></section>${this.stateSection(state)}`,
    );
  }

  /** A global series: its value at a time, how it is known, and its source. */
  /** Something generated rather than recorded: what it is, and what it is made to fit. */
  /** A row of a dataset drawn on the globe: what it says, and the dataset it comes from. */
  showRow(title: string, kind: string, lines: string[], src: SourceRecord | undefined, note?: string, row?: RowInfo): void {
    const source = `<section><h3>Source</h3><ol class="sources"><li><p>${esc(src?.citation ?? '')}</p>${src?.doi ? `<a href="https://doi.org/${encodeURI(src.doi)}" target="_blank" rel="noopener">doi:${esc(src.doi)}</a>` : ''}</li></ol></section>`;
    this.frame(title, `<div class="meta"><span class="kind">${esc(kind)}</span><span class="badge basis-evidence">evidence</span>${row?.corrected ? '<span class="badge corrected">corrected</span>' : ''}</div>
      <section>${lines.map((l) => `<p>${esc(l)}</p>`).join('')}${note ? `<p class="note">${esc(note)}</p>` : ''}</section>${rowSection(row)}${source}`);
  }

  showGenerated(title: string, kind: string, text: string, why: string): void {
    this.el.hidden = false;
    this.el.innerHTML = `<header><h2>${esc(title)}</h2><button class="close" aria-label="Close">×</button></header>
      <div class="meta"><span class="kind">${esc(kind)}</span> <span class="badge basis-procedural">procedural</span></div>
      <p class="summary">${esc(text)}</p>
      <h3>How we know</h3><p class="muted">${esc(why)}</p>`;
    this.el.querySelector<HTMLButtonElement>('.close')!.onclick = () => this.cb.onClose();
  }

  showSeries(s: SeriesRecord, t: number, v: SeriesValue | null): void {
    const src = s.sourceRecord;
    const projected = s.projectedAfter !== undefined && t > s.projectedAfter;
    const basis = projected ? 'projection' : s.basis;
    const band = v && v.lo !== null && v.hi !== null ? `<p>${fmtValue(v.lo)} – ${fmtValue(v.hi)} ${esc(s.unit ?? '')}${s.band ? `: ${esc(s.band)}` : ''}</p>` : '';
    const when = (t: number) => (t === PRESENT_YEAR ? 'the present' : formatTime(t));
    const span = `${when(s.points[0][0])} to ${when(s.points.at(-1)![0])}`;
    this.frame(
      s.title,
      `<div class="meta"><span class="kind">${esc(s.quantity ?? 'Global series')}</span><span class="badge basis-${esc(basis)}">${esc(basis)}</span></div>
      ${s.description ? `<p class="summary">${esc(s.description)}</p>` : ''}
      <section><h3>At ${esc(formatTime(t, 1e4))}</h3>
      <p class="big">${v ? `${fmtValue(v.value)} ${esc(s.unit ?? '')}` : '<span class="muted">No value at this time</span>'}</p>${band}${s.spread && s.spread !== 'band' ? `<p class="method">${esc(SPREAD_TEXT[s.spread])}</p>` : ''}
      <p class="method">${s.rule ? `Computed with ${esc(s.rule.name)}${Object.keys(s.rule.params).length ? ` (${Object.entries(s.rule.params).map(([k, x]) => `${esc(k)} ${esc(String(x))}`).join(', ')})` : ''}, every step from ${esc(span)}` : `Read from the dataset's table, from ${esc(span)}`}; between its ${s.points.length.toLocaleString('en-US')} points the value is interpolated (${esc(s.interpolation)}).${projected ? ' After the present it is a projection.' : ''}</p></section>
      <section><h3>Source</h3><ol class="sources"><li><p>${esc(src?.citation ?? s.source.ref)}${s.source.loc ? `, ${esc(s.source.loc)}` : ''}</p>${src?.doi ? `<a href="https://doi.org/${encodeURI(src.doi)}" target="_blank" rel="noopener">doi:${esc(src.doi)}</a>` : ''}${src?.reliability ? `<p class="note">${esc(src.reliability)}</p>` : ''}${src?.verified ? `<p class="verified">Checked: ${esc(src.verified.how)}</p>` : ''}</li></ol></section>`,
    );
  }
}
