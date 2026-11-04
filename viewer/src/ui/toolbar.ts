// Display toggles, the alternatives the build shows, and the evidence legend.
import type { AlternativeGroupInfo } from '../../../core/tileset.ts';

export interface ToolbarState {
  evidence: boolean;
  clouds: boolean;
  /** the alternatives shown, at most one per group */
  alt: string[];
  /** the tree of life is open */
  tree: boolean;
  /** the world's languages are drawn */
  langs: boolean;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export class Toolbar {
  readonly el: HTMLElement;
  onChange: (s: Partial<ToolbarState>) => void = () => {};
  private alt: string[] = [];

  constructor(buildId: string, private groups: AlternativeGroupInfo[]) {
    this.el = document.createElement('div');
    this.el.className = 'toolbar';
    const selects = groups
      .map(
        (g) => `<label class="alt-group" title="${esc(g.description ?? '')}"><span>${esc(g.title)}</span>
          <select data-group="${esc(g.id)}"><option value="">Default picture</option>${g.members.map((m) => `<option value="${esc(m.id)}" title="${esc(m.description ?? '')}">${esc(m.title)}</option>`).join('')}</select></label>`,
      )
      .join('');
    this.el.innerHTML = `
      <button class="tg-evidence" aria-pressed="false" title="Evidence mode (E): tint what is reconstructed or generated">Evidence</button>
      <button class="tg-clouds" aria-pressed="true" title="Clouds (C)">Clouds</button>
      <button class="tg-tree" aria-pressed="false" title="Tree of life (T): the lineages alive at the time shown">Tree</button>
      <button class="tg-langs" aria-pressed="false" title="Languages: the world's languages today, from Glottolog, at the present on the time control">Languages</button>
      ${groups.length ? '<button class="tg-alts" aria-pressed="false" aria-expanded="false" title="Other whole pictures of the world: hypotheses, readings and scenarios, each its own consistent world">Alternatives</button>' : ''}
      <div class="build" title="Data version: the build this view shows">build ${buildId}</div>
      <div class="alts" hidden>
        <p>Each is a whole picture of the world, checked to be consistent in itself.</p>
        ${selects}
      </div>
      <div class="legend" hidden>
        <div><span class="sw evidence"></span>Evidence: sourced records</div>
        <div><span class="sw reconstruction"></span>In a city, amber: raised from a record or the map's footprint, its architecture part fact and part rule of thumb</div>
        <div><span class="sw procedural"></span>In a city, magenta: invented housing, streets, trees and people, in the density the sources give</div>
        <div><span class="sw procedural"></span>In a living scene, magenta: every animal and plant; its taxon and size are recorded, where it stands is invented</div>
        <div><span class="sw evidence"></span>Rings on the globe: eruptions, earthquakes and tsunamis of about the time shown, from NOAA's databases</div>
        <div><span class="sw reconstruction"></span>Reconstruction: PaleoDEM terrain, the plate model's blocks; ringed markers are placed by the plate model</div>
        <div><span class="sw procedural"></span>Procedural: generated clouds, and the patterns the planet's states are drawn with (magma, ice, oceans where the map is unknown); projection: values after the present</div>
        <div><span class="sw derived"></span>Dashed: dates derived by the solver</div>
        <div><span class="sw unknown"></span>Plain globe: no geography and no state of the planet known at this time</div>
      </div>`;
    this.el.querySelector<HTMLButtonElement>('.tg-evidence')!.onclick = () => this.onChange({ evidence: !this.is('.tg-evidence') });
    this.el.querySelector<HTMLButtonElement>('.tg-clouds')!.onclick = () => this.onChange({ clouds: !this.is('.tg-clouds') });
    this.el.querySelector<HTMLButtonElement>('.tg-tree')!.onclick = () => this.onChange({ tree: !this.is('.tg-tree') });
    this.el.querySelector<HTMLButtonElement>('.tg-langs')!.onclick = () => this.onChange({ langs: !this.is('.tg-langs') });
    const alts = this.el.querySelector<HTMLButtonElement>('.tg-alts');
    if (alts) alts.onclick = () => {
      const panel = this.el.querySelector<HTMLElement>('.alts')!;
      panel.hidden = !panel.hidden;
      alts.setAttribute('aria-expanded', String(!panel.hidden));
      this.showAlts();
    };
    for (const sel of this.el.querySelectorAll<HTMLSelectElement>('select[data-group]')) {
      sel.onchange = () => {
        const members = new Set(this.groups.find((g) => g.id === sel.dataset.group)!.members.map((m) => m.id));
        this.onChange({ alt: [...this.alt.filter((a) => !members.has(a)), ...(sel.value ? [sel.value] : [])].sort() });
      };
    }
  }

  private is(sel: string): boolean {
    return this.el.querySelector(sel)!.getAttribute('aria-pressed') === 'true';
  }

  /** The button lights while its panel is open or an alternative is chosen, and says how many are. */
  private showAlts(): void {
    const button = this.el.querySelector<HTMLButtonElement>('.tg-alts');
    if (!button) return;
    const text = this.alt.length ? `Alternatives · ${this.alt.length}` : 'Alternatives';
    if (button.textContent !== text) button.textContent = text;
    button.setAttribute('aria-pressed', String(this.alt.length > 0 || button.getAttribute('aria-expanded') === 'true'));
  }

  set(s: ToolbarState): void {
    this.alt = s.alt;
    this.showAlts();
    this.el.querySelector('.tg-evidence')!.setAttribute('aria-pressed', String(s.evidence));
    this.el.querySelector('.tg-clouds')!.setAttribute('aria-pressed', String(s.clouds));
    this.el.querySelector('.tg-tree')!.setAttribute('aria-pressed', String(s.tree));
    this.el.querySelector('.tg-langs')!.setAttribute('aria-pressed', String(s.langs));
    this.el.querySelector<HTMLElement>('.legend')!.hidden = !s.evidence;
    for (const sel of this.el.querySelectorAll<HTMLSelectElement>('select[data-group]')) {
      const g = this.groups.find((x) => x.id === sel.dataset.group)!;
      const v = s.alt.find((a) => g.members.some((m) => m.id === a)) ?? '';
      if (sel.value !== v) sel.value = v;
    }
  }
}
