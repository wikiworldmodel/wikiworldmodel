// Display toggles, the alternatives the build shows, and the evidence legend.
import type { AlternativeGroupInfo } from '../../../core/tileset.ts';

export interface ToolbarState {
  evidence: boolean;
  clouds: boolean;
  /** the alternatives shown, at most one per group */
  alt: string[];
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
        (g) => `<label class="alt-group" title="${esc(g.description ?? '')}">${esc(g.title)}
          <select data-group="${esc(g.id)}"><option value="">Default picture</option>${g.members.map((m) => `<option value="${esc(m.id)}" title="${esc(m.description ?? '')}">${esc(m.title)}</option>`).join('')}</select></label>`,
      )
      .join('');
    this.el.innerHTML = `
      <button class="tg-evidence" aria-pressed="false" title="Evidence mode (E): tint what is reconstructed or generated">Evidence</button>
      <button class="tg-clouds" aria-pressed="true" title="Clouds (C)">Clouds</button>
      ${selects}
      <div class="legend" hidden>
        <div><span class="sw evidence"></span>Evidence: sourced records</div>
        <div><span class="sw reconstruction"></span>In a city, amber: raised from a record or the map's footprint, its architecture part fact and part rule of thumb</div>
        <div><span class="sw procedural"></span>In a city, magenta: invented housing, streets, trees and people, in the density the sources give</div>
        <div><span class="sw reconstruction"></span>Reconstruction: PaleoDEM terrain, the plate model's blocks; ringed markers are placed by the plate model</div>
        <div><span class="sw procedural"></span>Procedural: generated clouds, and the patterns the planet's states are drawn with (magma, ice, oceans where the map is unknown); projection: values after the present</div>
        <div><span class="sw derived"></span>Dashed: dates derived by the solver</div>
        <div><span class="sw unknown"></span>Plain globe: no geography and no state of the planet known at this time</div>
      </div>
      <div class="build" title="Data version: the build this view shows">build ${buildId}</div>`;
    this.el.querySelector<HTMLButtonElement>('.tg-evidence')!.onclick = () => this.onChange({ evidence: !this.is('.tg-evidence') });
    this.el.querySelector<HTMLButtonElement>('.tg-clouds')!.onclick = () => this.onChange({ clouds: !this.is('.tg-clouds') });
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

  set(s: ToolbarState): void {
    this.alt = s.alt;
    this.el.querySelector('.tg-evidence')!.setAttribute('aria-pressed', String(s.evidence));
    this.el.querySelector('.tg-clouds')!.setAttribute('aria-pressed', String(s.clouds));
    this.el.querySelector<HTMLElement>('.legend')!.hidden = !s.evidence;
    for (const sel of this.el.querySelectorAll<HTMLSelectElement>('select[data-group]')) {
      const g = this.groups.find((x) => x.id === sel.dataset.group)!;
      const v = s.alt.find((a) => g.members.some((m) => m.id === a)) ?? '';
      if (sel.value !== v) sel.value = v;
    }
  }
}
