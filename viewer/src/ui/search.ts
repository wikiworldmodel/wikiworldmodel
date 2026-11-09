// Search entities and named periods; choosing a result flies there.
import type { PeriodRecord, SearchFile } from '../../../core/records.ts';

export type SearchHit =
  | { type: 'entity'; id: string; label: string; detail: string; located: boolean }
  | { type: 'period'; id: string; label: string; detail: string; start: number; end: number };

export class Search {
  readonly el: HTMLElement;
  private input: HTMLInputElement;
  private list: HTMLUListElement;
  private hits: SearchHit[] = [];
  private active = 0;
  onChoose: (h: SearchHit) => void = () => {};

  constructor(private index: SearchFile, private periods: PeriodRecord[], kindLabel: (k: string) => string) {
    this.el = document.createElement('div');
    this.el.className = 'search';
    this.el.innerHTML = `<input type="search" placeholder="Search places, events, periods…" aria-label="Search" autocomplete="off"><ul role="listbox" hidden></ul>`;
    this.input = this.el.querySelector('input')!;
    this.list = this.el.querySelector('ul')!;
    this.input.addEventListener('input', () => this.run(kindLabel));
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') this.move(1);
      else if (e.key === 'ArrowUp') this.move(-1);
      else if (e.key === 'Enter' && this.hits[this.active]) this.choose(this.hits[this.active]);
      else if (e.key === 'Escape') this.close();
      else return;
      e.preventDefault();
    });
    this.input.addEventListener('blur', () => setTimeout(() => this.close(), 150));
  }

  private run(kindLabel: (k: string) => string): void {
    const q = this.input.value.trim().toLowerCase();
    if (!q) return this.close();
    const words = q.split(/\s+/);
    const match = (s: string) => words.every((w) => s.toLowerCase().includes(w));
    // Records whose name matches come before those that match only in their summary or id.
    const ents: SearchHit[] = this.index.entities
      .filter((e) => match(`${e.label} ${e.summary ?? ''} ${e.id}`))
      .sort((a, b) => Number(match(b.label)) - Number(match(a.label)))
      .map((e) => ({ type: 'entity', id: e.id, label: e.label, detail: kindLabel(e.kind), located: e.located }));
    const pers: SearchHit[] = this.periods
      .filter((p) => match(p.name))
      .map((p) => ({ type: 'period', id: p.id, label: p.name, detail: p.rank, start: p.start, end: p.end }));
    this.hits = [...ents, ...pers].slice(0, 12);
    this.active = 0;
    this.render();
  }

  private render(): void {
    this.list.innerHTML = this.hits
      .map((h, i) => `<li role="option" data-i="${i}" class="${i === this.active ? 'active' : ''}"><span>${h.label.replace(/</g, '&lt;')}</span><small>${h.detail}</small></li>`)
      .join('');
    this.list.hidden = this.hits.length === 0;
    for (const li of this.list.querySelectorAll('li')) li.onmousedown = () => this.choose(this.hits[Number(li.dataset.i)]);
  }

  private move(d: number): void {
    if (!this.hits.length) return;
    this.active = (this.active + d + this.hits.length) % this.hits.length;
    this.render();
  }

  private choose(h: SearchHit): void {
    this.close();
    this.input.value = '';
    // On a touch screen the keyboard goes, so that what was chosen can be seen.
    if (matchMedia('(pointer: coarse)').matches) this.input.blur();
    this.onChoose(h);
  }

  private close(): void {
    this.list.hidden = true;
  }

  focus(): void {
    this.input.focus();
  }
}
