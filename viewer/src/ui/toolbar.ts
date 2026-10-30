// Display toggles and the evidence legend.
export interface ToolbarState {
  evidence: boolean;
  clouds: boolean;
}

export class Toolbar {
  readonly el: HTMLElement;
  onChange: (s: Partial<ToolbarState>) => void = () => {};

  constructor(buildId: string) {
    this.el = document.createElement('div');
    this.el.className = 'toolbar';
    this.el.innerHTML = `
      <button class="tg-evidence" aria-pressed="false" title="Evidence mode (E): tint what is reconstructed or generated">Evidence</button>
      <button class="tg-clouds" aria-pressed="true" title="Clouds (C)">Clouds</button>
      <div class="legend" hidden>
        <div><span class="sw evidence"></span>Evidence: sourced records</div>
        <div><span class="sw reconstruction"></span>Reconstruction: PaleoDEM terrain, plate positions</div>
        <div><span class="sw procedural"></span>Procedural: generated clouds</div>
        <div><span class="sw derived"></span>Dashed: dates derived by the solver</div>
      </div>
      <div class="build" title="Data version: the build this view shows">build ${buildId}</div>`;
    this.el.querySelector<HTMLButtonElement>('.tg-evidence')!.onclick = () => this.onChange({ evidence: !this.is('.tg-evidence') });
    this.el.querySelector<HTMLButtonElement>('.tg-clouds')!.onclick = () => this.onChange({ clouds: !this.is('.tg-clouds') });
  }

  private is(sel: string): boolean {
    return this.el.querySelector(sel)!.getAttribute('aria-pressed') === 'true';
  }

  set(s: ToolbarState): void {
    this.el.querySelector('.tg-evidence')!.setAttribute('aria-pressed', String(s.evidence));
    this.el.querySelector('.tg-clouds')!.setAttribute('aria-pressed', String(s.clouds));
    this.el.querySelector<HTMLElement>('.legend')!.hidden = !s.evidence;
  }
}
