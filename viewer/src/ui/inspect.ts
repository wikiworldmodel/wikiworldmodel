// The inspect panel: what something is, when and where, every claim with its source, the
// competing claims (which can be switched), and what the derived dates rest on.
import type { ClaimRecord, EntityRecord, SourceRecord } from '../../../core/records.ts';
import type { Estimate, FeatureTime } from '../../../core/tileset.ts';
import { formatTime } from '../../../core/time.ts';

const esc = (s: unknown) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function short(s: SourceRecord | undefined): string {
  if (!s) return 'unknown source';
  const names = (s.authors ?? []).map((a) => a.split(',')[0]);
  const who = names.length === 0 ? s.container ?? s.id : names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} & ${names[1]}` : `${names[0]} et al.`;
  return s.year ? `${who} ${s.year}` : who;
}

const finite = (x: number) => Number.isFinite(x);

function fmtEstimate(e: Estimate, open: 'start' | 'end'): string {
  if (e.best === null) return open === 'end' ? 'still exists' : 'unknown';
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
  return `${fmtEstimate(t.start, 'start')} → ${fmtEstimate(t.end, 'end')}`;
}

function valueOf(c: ClaimRecord): string {
  if (c.valueText) return c.valueText;
  const v = c.value as unknown;
  if (v && typeof v === 'object' && 'lat' in (v as object)) {
    const p = v as { lat: number; lon: number };
    return `${Math.abs(p.lat).toFixed(3)}°${p.lat >= 0 ? 'N' : 'S'}, ${Math.abs(p.lon).toFixed(3)}°${p.lon >= 0 ? 'E' : 'W'}`;
  }
  if (typeof v === 'number') return v.toLocaleString('en-US');
  return String(v);
}

const PROP_LABEL: Record<string, string> = {
  date: 'Date',
  start: 'Start',
  end: 'End',
  date_before: 'No later than',
  date_after: 'No earlier than',
  location: 'Location (present-day)',
  taxon: 'Taxon',
  identified_as: 'Identified as',
  formation: 'Formation',
  diameter_km: 'Diameter (km)',
  area_km2: 'Area (km²)',
};

export interface InspectCallbacks {
  onChoose(group: string, claim: string | null): void;
  onClose(): void;
  labelOf(entityId: string): string;
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

  showEntity(r: EntityRecord, alts: Record<string, string>, time: FeatureTime): void {
    const status = r.claims.every((c) => c.status === 'accepted') ? 'accepted' : r.claims.some((c) => c.status === 'disputed') ? 'disputed' : 'proposed';
    const machine = r.claims.some((c) => c.author.startsWith('machine:'));
    const groups = new Map<string, ClaimRecord[]>();
    for (const c of r.claims) groups.set(c.group, [...(groups.get(c.group) ?? []), c]);
    const altByClaim = new Map(r.alternatives.map((a) => [`${a.group}=${a.claim}`, a]));
    const derivation = (refs: string[]) =>
      refs
        .filter((x) => !x.endsWith(':structure'))
        .map((x) => {
          const [entity, where] = x.split(':');
          return `<li>${esc(entity === r.id ? r.label : this.cb.labelOf(entity))} · <code>${esc(where)}</code></li>`;
        })
        .join('');
    const derivedRefs = [...new Set([...(time.start.derived ? r.derivedBy.start : []), ...(!time.instant && time.end.derived ? r.derivedBy.end : [])])];

    let claims = '';
    for (const [group, cs] of groups) {
      const prop = cs[0].prop;
      const competing = cs.length > 1;
      const chosen = alts[group] ?? cs.find((c) => c.chosen)?.id;
      claims += `<div class="claim-group${competing ? ' competing' : ''}"><h4>${esc(PROP_LABEL[prop] ?? prop)}${cs[0].phase ? ` <span class="phase">· ${esc(r.phases.find((p) => p.id === cs[0].phase)?.label ?? cs[0].phase)}</span>` : ''}${competing ? ' <span class="badge">competing claims</span>' : ''}</h4>`;
      for (const c of cs) {
        const alt = altByClaim.get(`${group}=${c.id}`);
        const inconsistent = alt && !alt.consistent;
        const src = r.sources[c.source];
        const radio = competing
          ? `<input type="radio" name="${esc(group)}" value="${esc(c.id)}" ${c.id === chosen ? 'checked' : ''} ${inconsistent ? 'disabled' : ''} aria-label="Use this claim">`
          : '';
        claims += `<div class="claim rank-${esc(c.rank)}${inconsistent ? ' inconsistent' : ''}">
          <label>${radio}<span class="value">${esc(valueOf(c))}</span>
          <span class="cite">${esc(short(src))}${c.locator ? `, ${esc(c.locator)}` : ''}</span></label>
          <div class="claim-meta"><span class="badge rank">${esc(c.rank)}</span><span class="badge status-${esc(c.status)}">${esc(c.status)}</span>${c.confidence ? `<span class="badge">confidence: ${esc(c.confidence)}</span>` : ''}<span class="author">${esc(c.author)}</span></div>
          ${c.quote ? `<blockquote>${esc(c.quote)}</blockquote>` : ''}
          ${c.method ? `<p class="method">${esc(c.method)}</p>` : ''}
          ${c.note ? `<p class="note">${esc(c.note)}</p>` : ''}
          ${inconsistent ? `<p class="conflict">Contradicts the rest of the world, so it cannot be shown. Conflicting with:</p><ul class="conflict">${derivation(alt!.conflict!.filter((x) => !x.endsWith(`claims.${c.id}`)))}</ul>` : ''}
        </div>`;
      }
      claims += `</div>`;
    }
    const relations = r.relations
      .map((x) => `<li><strong>${esc(x.type)}</strong> ${esc(x.ofLabel)} <span class="cite">— ${esc(short(r.sources[x.source]))}</span>${x.quote ? `<blockquote>${esc(x.quote)}</blockquote>` : ''}${x.note ? `<p class="note">${esc(x.note)}</p>` : ''}</li>`)
      .join('');
    const sources = Object.values(r.sources)
      .map((s) => `<li id="src-${esc(s.id)}"><p>${esc(s.citation)}</p>${s.doi ? `<a href="https://doi.org/${encodeURI(s.doi)}" target="_blank" rel="noopener">doi:${esc(s.doi)}</a>` : s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.url)}</a>` : ''}${s.license ? ` <span class="badge">${esc(s.license)}</span>` : ''}${s.verified ? `<p class="verified">Checked: ${esc(s.verified.how)}</p>` : ''}</li>`)
      .join('');
    const where = r.frame.plate
      ? `Rides plate ${r.frame.plate}${r.frame.plateLabel ? ` (${esc(r.frame.plateLabel)})` : ''} of the PALEOMAP model; its position at other times is reconstructed by the plate model.`
      : esc(r.frame.title);
    const phases = r.phases.map((p) => `<li>${esc(p.label)}: ${esc(fmtTime(p.time))}</li>`).join('');
    this.frame(
      r.label,
      `<div class="meta"><span class="kind">${esc(r.kindLabel)}</span><span class="badge basis-${esc(r.basis)}">${esc(r.basis)}</span><span class="badge status-${status}">${status}${machine && status === 'proposed' ? ' · machine-made, needs review' : ''}</span></div>
      ${r.summary ? `<p class="summary">${esc(r.summary)}</p>` : ''}
      <section><h3>When</h3><p class="when">${esc(fmtTime(time))}${Object.keys(alts).length ? ' <span class="badge">with your claim choices</span>' : ''}</p>
      ${phases ? `<ul class="phases">${phases}</ul>` : ''}
      ${derivedRefs.length ? `<p class="derived">Derived by the chronology solver from:</p><ul class="derived">${derivation(derivedRefs)}</ul>` : ''}</section>
      <section><h3>Where</h3><p>${where}</p></section>
      <section><h3>Claims</h3>${claims}</section>
      ${relations ? `<section><h3>Relations</h3><ul class="relations">${relations}</ul></section>` : ''}
      <section><h3>Sources</h3><ol class="sources">${sources}</ol></section>`,
    );
    for (const input of this.el.querySelectorAll<HTMLInputElement>('input[type=radio]')) {
      input.onchange = () => {
        const g = input.name;
        const def = r.claims.find((c) => c.group === g && c.chosen)?.id;
        this.cb.onChoose(g, input.value === def ? null : input.value);
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
      <p>${lat}, ${lon} in the plate model's frame at this time${info.plate ? `, on plate ${info.plate}${info.plateLabel ? ` (${esc(info.plateLabel)})` : ''}` : ', on no plate polygon (ocean floor the model does not track)'}.</p>
      <p class="method">Interpolated between ${esc(blend)}, each moved with its plates to this time. The coastline is the ${esc(info.datum === 'contemporaneous-sea-level' ? '0 m' : 'sea-level')} isoline of this field.</p></section>
      <section><h3>Source</h3><ol class="sources"><li><p>${esc(s?.citation ?? '')}</p>${s?.doi ? `<a href="https://doi.org/${encodeURI(s.doi)}" target="_blank" rel="noopener">doi:${esc(s.doi)}</a>` : ''}${s?.reliability ? `<p class="note">${esc(s.reliability)}</p>` : ''}</li></ol></section>`,
    );
  }
}

