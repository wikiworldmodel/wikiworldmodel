// The inspect panel: what something is, when and where, every claim with its sources and
// locators, the competing claims (which can be picked), its relations and the ones other
// records make to it, and what the derived dates rest on.
import type { CitationRecord, ClaimRecord, EntityRecord, SourceRecord } from '../../../core/records.ts';
import { splitRef } from '../../../core/refs.ts';
import { scenarioKey, type Scenario } from '../../../core/scenario.ts';
import type { Estimate, FeatureTime } from '../../../core/tileset.ts';
import { formatTime } from '../../../core/time.ts';

const esc = (s: unknown) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function short(s: SourceRecord | undefined, ref: string): string {
  if (!s) return ref;
  const names = (s.authors ?? []).map((a) => a.split(',')[0]);
  const who = names.length === 0 ? s.container ?? s.title ?? s.id : names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} & ${names[1]}` : `${names[0]} et al.`;
  return s.published ? `${who} ${s.published}` : who;
}

const finite = (x: number) => Number.isFinite(x);

function fmtEstimate(e: Estimate, open: 'start' | 'end', unknown = false): string {
  if (e.best === null) return open === 'end' ? (unknown ? 'end unknown' : 'still exists') : 'unknown';
  const main = formatTime(e.best, 1e3);
  const lo = finite(e.lo) ? formatTime(e.lo, 1e3) : null;
  const hi = finite(e.hi) ? formatTime(e.hi, 1e3) : null;
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
};

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
  coastline: string;
  datum: string;
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
    this.el.hidden = false;
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

  showEntity(r: EntityRecord, scenario: Scenario, time: FeatureTime): void {
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
      claims += `<div class="claim-group${competing ? ' competing' : ''}"><h4>${esc(PROP_LABEL[prop] ?? prop)}${phase ? ` <span class="phase">· ${esc(phase.label)}</span>` : ''}${competing ? ' <span class="badge">competing claims</span>' : ''}</h4>`;
      for (const c of cs) {
        const v = competing && c !== def ? variant(c.ref) : undefined;
        const inconsistent = v && !v.consistent;
        const radio = competing
          ? `<input type="radio" name="${esc(group)}" value="${esc(c.ref)}" data-default="${esc(def?.ref ?? '')}" data-members="${esc(all.map((x) => x.ref).join(' '))}" ${c === chosen ? 'checked' : ''} ${inconsistent ? 'disabled' : ''} aria-label="Use this claim">`
          : '';
        const conf = c.confidence !== undefined ? `confidence: ${typeof c.confidence === 'number' ? c.confidence : `${c.confidence}${c.confidenceRange ? ` (${c.confidenceRange[0]}–${c.confidenceRange[1]})` : ''}`}` : '';
        claims += `<div class="claim rank-${esc(c.rank)}${inconsistent ? ' inconsistent' : ''}" data-claim="${esc(c.ref)}">
          <label>${radio}<span class="value">${esc(c.valueText)}</span>${this.cites(r, c.sources, c.unsourced)}</label>
          <div class="claim-meta"><span class="badge rank">${esc(c.rank)}</span><span class="badge status-${esc(c.status)}">${esc(c.status)}</span>${c.basis !== 'evidence' ? `<span class="badge basis-${esc(c.basis)}">${esc(c.basis)}</span>` : ''}${c.alt ? `<span class="badge alt">${esc(this.cb.altTitle(c.alt))}</span>` : ''}${conf ? `<span class="badge">${esc(conf)}</span>` : ''}${c.methodLabel ? `<span class="badge">${esc(c.methodLabel)}</span>` : ''}<span class="author">${esc(c.author)}</span></div>
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
      .map((x) => `<li><strong>${esc(REL_LABEL[x.rel] ?? x.rel)}</strong> ${this.link(x.to, x.toLabel, x.wanted)}${x.lagText ? ` <span class="muted">(${esc(x.lagText)})</span>` : ''} <span class="cite">— ${this.cites(r, x.sources, x.unsourced)}</span>${x.sources.filter((s) => s.quote).map((s) => `<blockquote>${esc(s.quote)}</blockquote>`).join('')}${x.note ? `<p class="note">${esc(x.note)}</p>` : ''}</li>`)
      .join('');
    const inverse = r.inverse.map((x) => `<li><strong>${esc(REL_LABEL[x.rel] ?? x.rel)}</strong> ${this.link(x.from, x.fromLabel)} <span class="muted">(stated by that record)</span></li>`).join('');
    const sources = Object.values(r.sources)
      .map((s) => `<li id="src-${esc(s.id)}"><p>${esc(s.citation)}</p>${s.doi ? `<a href="https://doi.org/${encodeURI(s.doi)}" target="_blank" rel="noopener">doi:${esc(s.doi)}</a>` : s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.url)}</a>` : ''} <span class="badge">${esc(s.kind)}</span>${s.license ? ` <span class="badge">${esc(s.license)}</span>` : ''}${s.verified ? `<p class="verified">Checked: ${esc(s.verified.how)}</p>` : ''}</li>`)
      .join('');
    const f = r.frame;
    const where = !f
      ? 'No location: shown through what it is related to.'
      : f.plate !== undefined
        ? `Moves with ${f.entity ? this.link(f.entity, f.entityLabel ?? f.entity) : esc(f.title)} (plate ${f.plate} of the PALEOMAP model); its position at other times is reconstructed by the plate model.`
        : esc(f.title);
    const phases = r.phases.map((p) => `<li>${esc(p.label)}${p.gap ? ' <span class="badge">gap</span>' : ''}: ${esc(fmtTime(p.time))}</li>`).join('');
    const chosenAlts = [...alts].filter((a) => r.claims.some((c) => c.alt === a) || r.variants.some((v) => v.key.split(' ').includes(a)));
    this.frame(
      r.label,
      `<div class="meta"><span class="kind">${esc(r.kindLabel)}</span><span class="badge basis-${esc(r.basis.time)}" title="How directly its dates rest on evidence">${esc(r.basis.time)}</span><span class="badge status-${status}">${status}${machine && status === 'proposed' ? ' · machine-made, needs review' : ''}</span></div>
      ${r.summary ? `<p class="summary">${esc(r.summary)}</p>` : ''}
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
    for (const input of this.el.querySelectorAll<HTMLInputElement>('input[type=radio]')) {
      input.onchange = () => this.cb.onPick(input.dataset.members!.split(' '), input.value === input.dataset.default ? null : input.value);
    }
    for (const a of this.el.querySelectorAll<HTMLAnchorElement>('a.open')) {
      a.onclick = (e) => {
        e.preventDefault();
        this.cb.onOpen(a.dataset.entity!);
      };
    }
  }

  showTerrain(info: TerrainInfo): void {
    const lat = `${Math.abs(info.lat).toFixed(2)}°${info.lat >= 0 ? 'N' : 'S'}`;
    const lon = `${Math.abs(info.lon).toFixed(2)}°${info.lon >= 0 ? 'E' : 'W'}`;
    const [k0, k1] = info.keyframes;
    const blend = k0 === k1 ? `the ${k0} Ma snapshot` : `the ${k0} and ${k1} Ma snapshots (${Math.round(info.mix * 100)}% of the way to ${k1} Ma)`;
    const s = info.source;
    this.frame(
      info.elevation >= 0 ? 'Land surface' : 'Sea floor',
      `<div class="meta"><span class="kind">${esc(info.fieldTitle)}</span><span class="badge basis-reconstruction">reconstruction</span></div>
      <section><h3>Here, at ${esc(formatTime(info.t, 1e4))}</h3>
      <p class="big">${info.elevation >= 0 ? '' : '−'}${Math.abs(Math.round(info.elevation)).toLocaleString('en-US')} m <span class="muted">${info.elevation >= 0 ? 'above' : 'below'} the sea level of the time</span></p>
      <p>${lat}, ${lon} in the geographic frame of this time${info.plate ? `, on plate ${info.plate}${info.plateLabel ? ` (${esc(info.plateLabel)})` : ''}` : ', on no plate polygon (ocean floor the model does not track)'}.</p>
      <p class="method">Interpolated between ${esc(blend)}, each moved with its plates to this time. The ${esc(info.coastline.toLowerCase())} is derived, not stored: the ${esc(info.datum === 'contemporaneous-sea-level' ? '0 m' : 'sea-level')} isoline of this field.</p></section>
      <section><h3>Source</h3><ol class="sources"><li><p>${esc(s?.citation ?? '')}</p>${s?.doi ? `<a href="https://doi.org/${encodeURI(s.doi)}" target="_blank" rel="noopener">doi:${esc(s.doi)}</a>` : ''}${s?.reliability ? `<p class="note">${esc(s.reliability)}</p>` : ''}</li></ol></section>`,
    );
  }
}
