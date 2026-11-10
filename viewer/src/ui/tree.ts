// The tree of life at the time shown: lineages branch at their start and end at their extinction, on
// the time control's own scale. It draws on a canvas, one row per taxon and only the rows in view, so
// it works the same with two dozen taxa and with thousands. A database's taxa stay folded under the
// nearest written one until asked for; choosing a group opens its record and lights up its fossils.
import { formatTime, PRESENT_YEAR } from '../../../core/time.ts';
import type { Scenario } from '../../../core/scenario.ts';
import { aliveAt, ancestors, indexTree, layoutTree, subtree, timeOfNode, type TreeFile, type TreeIndex, type TreeRow } from '../../../core/tree.ts';
import { positionOf, timeAt as timeAtPosition } from '../../../core/timescale.ts';

const GUTTER = 14;
const AXIS = 22;
const ROW = 15;
const MIN_ROW = 3;

export interface TreeView {
  t: number;
  window: [number, number];
  scenario: Scenario;
  selected: string | null;
}

export class TreePanel {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private count: HTMLElement;
  private tip: HTMLElement;
  private file: TreeFile | null = null;
  private index: TreeIndex | null = null;
  private byId = new Map<string, number>();
  private open = new Set<number>();
  private rows: TreeRow[] = [];
  private rowH = ROW;
  private scroll = 0;
  private view: TreeView | null = null;
  private hover = -1;
  private lit = new Set<number>();
  private litFor: string | null = null;
  private drawKey = '';
  /** fingers on the rows, where each is up and down them */
  private fingers = new Map<number, number>();
  /** what the fingers began from: the scroll, the row height, where they were and how far apart */
  private held: { scroll: number; rowH: number; y: number; span: number } | null = null;
  /** the fingers have moved the rows, so their lifting chooses nothing */
  private slid = false;
  onSelect: (id: string) => void = () => {};
  onClose: () => void = () => {};

  constructor() {
    this.el = document.createElement('section');
    this.el.className = 'tree-panel';
    this.el.hidden = true;
    this.el.setAttribute('aria-label', 'Tree of life at the time shown');
    this.el.innerHTML = `<header><h2>Tree of life</h2><span class="tree-count"></span><button class="close" aria-label="Close the tree of life">×</button></header><canvas></canvas><div class="tree-tip" hidden></div>`;
    this.canvas = this.el.querySelector('canvas')!;
    this.count = this.el.querySelector('.tree-count')!;
    this.tip = this.el.querySelector('.tree-tip')!;
    this.el.querySelector<HTMLButtonElement>('.close')!.onclick = () => this.onClose();
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.ctrlKey || e.metaKey) {
        const before = this.scroll + e.offsetY;
        const k = Math.exp(-e.deltaY * 0.002);
        const next = Math.max(MIN_ROW, Math.min(ROW * 1.4, this.rowH * k));
        this.scroll = (before * next) / this.rowH - e.offsetY;
        this.rowH = next;
      } else this.scroll += e.deltaY;
      this.clampScroll();
      this.redraw();
    }, { passive: false });
    // A finger drags the rows, and two spread them apart or together, as the wheel does; a tap chooses, as a click does.
    this.canvas.addEventListener('pointerdown', (e) => this.press(e));
    this.canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') this.slide(e);
      else this.hoverAt(e.offsetX, e.offsetY);
    });
    this.canvas.addEventListener('pointerup', (e) => this.release(e));
    this.canvas.addEventListener('pointercancel', (e) => this.release(e));
    this.canvas.addEventListener('pointerleave', () => this.hoverAt(-1, -1));
    this.canvas.addEventListener('click', (e) => {
      if (this.slid) this.slid = false;
      else this.clickAt(e.offsetX, e.offsetY);
    });
    window.addEventListener('resize', () => this.redraw());
  }

  private press(e: PointerEvent): void {
    if (e.pointerType !== 'touch') return;
    if (e.isPrimary) {
      this.fingers.clear();
      this.slid = false;
    }
    this.fingers.set(e.pointerId, e.offsetY);
    this.canvas.setPointerCapture(e.pointerId);
    this.hold();
  }

  /** Begin again from where the fingers are now. */
  private hold(): void {
    const ys = [...this.fingers.values()];
    this.held = ys.length ? { scroll: this.scroll, rowH: this.rowH, y: ys.reduce((s, y) => s + y, 0) / ys.length, span: ys.length > 1 ? Math.abs(ys[1] - ys[0]) : 0 } : null;
  }

  private slide(e: PointerEvent): void {
    const h = this.held;
    if (!h || !this.fingers.has(e.pointerId)) return;
    this.fingers.set(e.pointerId, e.offsetY);
    const ys = [...this.fingers.values()];
    const y = ys.reduce((s, v) => s + v, 0) / ys.length;
    const span = ys.length > 1 ? Math.abs(ys[1] - ys[0]) : 0;
    // A tap that wavers is still a tap.
    if (!this.slid && Math.abs(y - h.y) < 8 && Math.abs(span - h.span) < 8) return;
    this.slid = true;
    if (span > 0 && h.span > 0) {
      // The row between the fingers stays between them.
      const next = Math.max(MIN_ROW, Math.min(ROW * 1.4, (h.rowH * span) / h.span));
      this.scroll = ((h.scroll + h.y) * next) / h.rowH - y;
      this.rowH = next;
    } else this.scroll = h.scroll - (y - h.y);
    this.clampScroll();
    this.redraw();
  }

  private release(e: PointerEvent): void {
    if (this.fingers.delete(e.pointerId)) this.hold();
  }

  setFile(file: TreeFile): void {
    this.file = file;
    this.index = indexTree(file.nodes);
    this.byId = new Map(file.nodes.map((n, i) => [n.id, i]));
    this.layout();
  }

  /** The rows as they stand, for tests: which taxa have rows, and where each lineage's bar runs. */
  shownRows(): { id: string; start: number | null; end: number | null; alive: boolean; arisen: boolean }[] {
    const v = this.view;
    if (!this.file || !v) return [];
    return this.rows.map((r) => {
      const n = this.file!.nodes[r.node];
      const time = timeOfNode(n, v.scenario);
      return { id: n.id, start: time.start.best, end: time.end.best, alive: aliveAt(n, v.t, v.scenario), arisen: (time.start.best ?? -Infinity) <= v.t };
    });
  }

  private layout(): void {
    if (!this.file || !this.index) return;
    this.rows = layoutTree(this.file.nodes, this.index, this.open);
    this.clampScroll();
  }

  private clampScroll(): void {
    const h = this.canvas.clientHeight - AXIS;
    this.scroll = Math.max(0, Math.min(this.scroll, Math.max(0, this.rows.length * this.rowH - h)));
  }

  /** Fold open everything between the root and a taxon, and bring it into view. */
  private reveal(i: number): void {
    if (!this.file || !this.index) return;
    for (const a of ancestors(this.file.nodes, i)) this.open.add(a);
    this.layout();
    const row = this.rows.findIndex((r) => r.node === i);
    const h = this.canvas.clientHeight - AXIS;
    if (row >= 0 && (row * this.rowH < this.scroll || (row + 1) * this.rowH > this.scroll + h)) this.scroll = row * this.rowH - h / 3;
    this.clampScroll();
  }

  /** The node of a taxon's id, if it has one. */
  nodeOf(id: string | null): number | undefined {
    return id ? this.byId.get(id) : undefined;
  }

  /** Draw the panel for a view, if it is open. A chosen taxon is revealed the first time it is seen. */
  update(v: TreeView): void {
    this.view = v;
    if (this.el.hidden || !this.file || !this.index) return;
    if (v.selected !== this.litFor) {
      this.litFor = v.selected;
      const i = this.nodeOf(v.selected);
      this.lit = i === undefined ? new Set() : new Set(subtree(this.index, i));
      if (i !== undefined) this.reveal(i);
      this.drawKey = '';
    }
    this.redraw();
  }

  private x(t: number, w: number, win: [number, number]): number {
    const p0 = positionOf(win[0]);
    return GUTTER + ((w - GUTTER - 8) * (positionOf(t) - p0)) / (positionOf(win[1]) - p0);
  }

  /** The stretch of time the panel shows: the time control's window, within life's span and the present. */
  private span(v: TreeView): [number, number] {
    const oldest = Math.min(...this.index!.roots.map((r) => this.file!.nodes[r].time.start.best ?? 0));
    const a = Math.max(v.window[0], oldest - Math.abs(oldest) * 0.02);
    const b = Math.min(v.window[1], PRESENT_YEAR);
    return a < b ? [a, b] : [oldest, PRESENT_YEAR];
  }

  private redraw(force = false): void {
    const v = this.view;
    if (!this.file || !v || this.el.hidden) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    const key = JSON.stringify([v.t, v.window, v.scenario, v.selected, this.scroll, this.rowH, this.rows.length, this.hover, w, h]);
    if (key === this.drawKey && !force) return;
    this.drawKey = key;
    if (this.canvas.width !== w * dpr || this.canvas.height !== h * dpr) {
      this.canvas.width = w * dpr;
      this.canvas.height = h * dpr;
    }
    const g = this.canvas.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const nodes = this.file.nodes;
    const win = this.span(v);
    const X = (t: number) => this.x(t, w, win);
    const area = h - AXIS;
    const first = Math.max(0, Math.floor(this.scroll / this.rowH));
    const last = Math.min(this.rows.length - 1, Math.ceil((this.scroll + area) / this.rowH));
    const Y = (row: number) => row * this.rowH - this.scroll + this.rowH / 2;
    const labels = this.rowH >= 11;
    g.save();
    g.beginPath();
    g.rect(0, 0, w, area);
    g.clip();
    // Connectors first, so that bars lie over them. A long connector may cross the view from a row
    // outside it, so they go by the rows in view and their parents.
    g.lineWidth = 1;
    for (let r = first; r <= last; r++) {
      const row = this.rows[r];
      if (row.parentRow < 0) continue;
      const n = nodes[row.node];
      const start = timeOfNode(n, v.scenario).start.best;
      if (start === null || start > v.t) continue;
      const x = X(start);
      g.strokeStyle = this.lit.has(row.node) ? 'rgba(255, 196, 92, 0.55)' : 'rgba(170, 190, 210, 0.25)';
      g.beginPath();
      g.moveTo(x + 0.5, Y(row.parentRow));
      g.lineTo(x + 0.5, Y(r));
      g.stroke();
    }
    g.font = '11px system-ui, sans-serif';
    g.textBaseline = 'middle';
    let alive = 0;
    for (const row of this.rows) if (aliveAt(nodes[row.node], v.t, v.scenario)) alive++;
    for (let r = first; r <= last; r++) {
      const row = this.rows[r];
      const n = nodes[row.node];
      const time = timeOfNode(n, v.scenario);
      const start = time.start.best;
      const y = Y(r);
      if (r === this.hover) {
        g.fillStyle = 'rgba(255, 255, 255, 0.06)';
        g.fillRect(0, y - this.rowH / 2, w, this.rowH);
      }
      // A lineage that has not arisen by the time shown is not there yet.
      if (start === null || start > v.t) continue;
      const end = time.end.best ?? Infinity;
      const live = v.t <= end;
      const lit = this.lit.has(row.node);
      // The solver's bounds on its start, behind the bar.
      const lo = time.start.lo;
      const hi = time.start.hi;
      if (Number.isFinite(lo) && Number.isFinite(hi) && hi > lo) {
        g.fillStyle = lit ? 'rgba(255, 196, 92, 0.25)' : 'rgba(170, 200, 220, 0.14)';
        g.fillRect(X(lo), y - Math.max(1, this.rowH * 0.28), Math.max(1, X(Math.min(hi, v.t)) - X(lo)), Math.max(2, this.rowH * 0.56));
      }
      const x0 = X(start);
      const x1 = X(Math.min(end, v.t));
      g.fillStyle = lit ? '#ffc45c' : live ? '#bfe3cf' : '#66727f';
      g.fillRect(x0, y - Math.min(1, this.rowH * 0.2), Math.max(1.5, x1 - x0), Math.max(1, Math.min(2, this.rowH * 0.3)));
      if (labels) {
        const more = row.folded ? ` +${this.index!.size[row.node]}` : '';
        g.fillStyle = lit ? '#ffd98f' : live ? '#dfe8ef' : '#8a95a1';
        const text = n.label + more;
        const tw = g.measureText(text).width;
        const tx = x1 + 5 + tw > w - 2 ? Math.max(GUTTER, x0 - tw - 4) : x1 + 5;
        g.fillText(text, tx, y);
      }
      if (row.folded && labels) {
        g.fillStyle = '#9fb0c0';
        g.beginPath();
        g.moveTo(3, y - 4);
        g.lineTo(9, y);
        g.lineTo(3, y + 4);
        g.fill();
      }
    }
    // The time shown.
    const cursor = X(Math.min(v.t, win[1]));
    g.strokeStyle = '#ffb454';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(cursor + 0.5, 0);
    g.lineTo(cursor + 0.5, area);
    g.stroke();
    g.restore();
    // A ruler on the time control's scale.
    g.fillStyle = '#8a95a1';
    g.font = '10px system-ui, sans-serif';
    g.textBaseline = 'alphabetic';
    const ticks = 3;
    for (let i = 0; i <= ticks; i++) {
      const f = i / ticks;
      const p = positionOf(win[0]) + (positionOf(win[1]) - positionOf(win[0])) * f;
      const x = GUTTER + (w - GUTTER - 8) * f;
      const label = formatTime(timeAtPosition(p), 1e6);
      const tw = g.measureText(label).width;
      g.fillText(label, Math.max(2, Math.min(w - tw - 2, x - tw / 2)), h - 7);
      g.fillRect(x, area, 1, 4);
    }
    this.count.textContent = `${alive.toLocaleString('en-US')} of ${this.rows.length.toLocaleString('en-US')} lineages in view are alive`;
  }

  private rowAt(y: number): number {
    if (y < 0 || y > this.canvas.clientHeight - AXIS) return -1;
    const r = Math.floor((y + this.scroll) / this.rowH);
    return r >= 0 && r < this.rows.length ? r : -1;
  }

  private hoverAt(x: number, y: number): void {
    const r = x < 0 ? -1 : this.rowAt(y);
    if (r === this.hover) return;
    this.hover = r;
    this.tip.hidden = r < 0;
    if (r >= 0 && this.file && this.view) {
      const n = this.file.nodes[this.rows[r].node];
      const t = timeOfNode(n, this.view.scenario);
      const when = (e: number | null) => (e === null ? 'unknown' : formatTime(e, 1e4));
      this.tip.textContent = `${n.label}${n.rank ? ` (${n.rank})` : ''}: ${when(t.start.best)} to ${t.end.best === null ? 'today' : when(t.end.best)}`;
      this.tip.style.top = `${Math.max(30, Math.min(y + 34, this.canvas.clientHeight - 10))}px`;
    }
    this.redraw();
  }

  private clickAt(x: number, y: number): void {
    const r = this.rowAt(y);
    if (r < 0 || !this.file) return;
    const row = this.rows[r];
    // The gutter folds and unfolds; the rest chooses the group.
    if (x < GUTTER && this.index!.children[row.node].length) {
      if (this.open.has(row.node)) this.open.delete(row.node);
      else this.open.add(row.node);
      this.layout();
      this.redraw(true);
      return;
    }
    if (row.folded) this.open.add(row.node);
    this.layout();
    this.onSelect(this.file.nodes[row.node].id);
    this.redraw(true);
  }
}
