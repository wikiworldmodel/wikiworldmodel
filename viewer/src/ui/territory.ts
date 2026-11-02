// Polities' territory on the globe. The rows that hold at the time shown are filled into a
// texture, one polity per colour channel, which the globe shader tints the land with and
// outlines; each polity gets a map label at its rows' centre, and a click inside its polygons
// resolves to its record. Territory is drawn in today's coordinates: since the oldest row,
// about 3 kyr ago, the plates have moved less than a few hundred metres.
import { unitVector } from '../../../core/quat.ts';
import type { Scenario } from '../../../core/scenario.ts';
import { chosenClaim, spanOf } from '../../../core/planet.ts';
import { contains, territoriesAt, TERRITORY_SCALE, type TerritoryAt, type TerritoryClaim, type TerritoryFile } from '../../../core/territory.ts';
import type { Camera } from '../camera.ts';
import type { V3 } from '../mat.ts';

/** At most this many polities at once, one per colour channel of the texture. */
const CHANNELS = 3;
/** How far, in degrees, the land drawn reaches past a row's polygons: half its stroke. */
const DILATE = 0.1;
/**
 * The colour a polity is drawn in, by its channel: a choice of the viewer's, not a fact, so
 * the order follows when a polity first appears on screen.
 */
export const TERRITORY_COLORS: [number, number, number][] = [
  [0.88, 0.26, 0.45],
  [0.56, 0.45, 0.92],
  [0.25, 0.74, 0.66],
];

export class TerritoryLayer {
  readonly el: HTMLElement;
  /** the texture's source: an equirectangular map, row 0 at the north pole */
  readonly canvas: HTMLCanvasElement;
  private file: TerritoryFile | null = null;
  private key = '';
  private active: TerritoryAt[] = [];
  private channel = new Map<string, number>();
  private labels = new Map<string, HTMLElement>();

  constructor(width = 4096, height = 2048) {
    this.el = document.createElement('div');
    this.el.className = 'territory-labels';
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
  }

  setFile(file: TerritoryFile): void {
    this.file = file;
    this.key = '\0';
  }

  /** The span the territory file covers, if any: from its first row to its last. */
  span(): [number, number] | null {
    const rows = this.file?.territories.flatMap((t) => t.claims.flatMap((c) => c.rows)) ?? [];
    return rows.length ? [Math.min(...rows.map((r) => r.from)), Math.max(...rows.map((r) => r.to))] : null;
  }

  /** What holds at time t; redraws the texture when that changes, and says whether it did. */
  update(t: number, s: Scenario): boolean {
    const now = this.file ? territoriesAt(this.file, t, s).slice(0, CHANNELS) : [];
    const key = now.map((a) => `${a.territory.subject}:${a.claim.claim}:${a.rows.map((r) => `${r.name}@${r.from}`).join('+')}`).join('|');
    if (key === this.key) return false;
    this.key = key;
    this.active = now;
    // A polity keeps its colour while it is on screen; a new one takes a free channel.
    for (const id of [...this.channel.keys()]) if (!now.some((a) => a.territory.subject === id)) this.channel.delete(id);
    for (const a of now) {
      if (this.channel.has(a.territory.subject)) continue;
      const used = new Set(this.channel.values());
      this.channel.set(a.territory.subject, [0, 1, 2].find((c) => !used.has(c))!);
    }
    this.draw();
    return true;
  }

  /** Whether anything is drawn, and each channel's polity, for the shader. */
  get shown(): boolean {
    return this.active.length > 0;
  }

  channelOf(subject: string | null): number {
    return subject === null ? -1 : (this.channel.get(subject) ?? -1);
  }

  private draw(): void {
    const g = this.canvas.getContext('2d')!;
    const w = this.canvas.width;
    const h = this.canvas.height;
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
    // Channels add, so polities never mix; rows of one polity that overlap just stay full.
    // Each row is also stroked a little wide: its coast is coarser than the field's, and the
    // shader draws territory only over the field's land, so the land along the coast is not
    // left out. Frontiers move out by half the stroke, about 0.1°.
    g.globalCompositeOperation = 'lighter';
    g.lineJoin = 'round';
    g.lineWidth = (DILATE / 360) * w * 2;
    const k = 1 / TERRITORY_SCALE;
    for (const a of this.active) {
      const color = ['#ff0000', '#00ff00', '#0000ff'][this.channel.get(a.territory.subject)!];
      g.fillStyle = color;
      g.strokeStyle = color;
      for (const row of a.rows) {
        g.beginPath();
        for (const r of row.rings) {
          for (let i = 0; i < r.length; i += 2) {
            const x = ((r[i] * k + 180) / 360) * w;
            const y = ((90 - r[i + 1] * k) / 180) * h;
            if (i === 0) g.moveTo(x, y);
            else g.lineTo(x, y);
          }
          g.closePath();
        }
        g.fill('evenodd');
        g.stroke();
      }
    }
  }

  /** Where a polity's land is drawn at time t, or at the nearest time it has land: its largest row's centre. */
  centre(subject: string, t: number, s: Scenario): [number, number] | undefined {
    const ter = this.file?.territories.find((x) => x.subject === subject);
    const claim = ter ? (chosenClaim(ter.claims, s) as TerritoryClaim | undefined) : undefined;
    if (!claim?.rows.length) return undefined;
    const away = (r: { from: number; to: number }) => (t < r.from ? r.from - t : t >= r.to ? t - r.to : 0);
    const near = Math.min(...claim.rows.map(away));
    return claim.rows.filter((r) => away(r) === near).reduce((x, y) => (y.area > x.area ? y : x)).at;
  }

  /**
   * The polity whose polygons hold a point at the time drawn, and the row there; failing that,
   * one within a quarter degree, since the dataset's coasts are coarser than the land drawn.
   */
  pick(lon: number, lat: number): { at: TerritoryAt; row: TerritoryAt['rows'][number] } | undefined {
    const near = [[0, 0], ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => [Math.cos((i * Math.PI) / 4) * 0.25, Math.sin((i * Math.PI) / 4) * 0.25])];
    for (const [dx, dy] of near) {
      for (const at of this.active) {
        const row = at.rows.find((r) => contains(r, lon + dx / Math.max(Math.cos((lat * Math.PI) / 180), 0.2), lat + dy));
        if (row) return { at, row };
      }
    }
    return undefined;
  }

  /**
   * Place a label for each polity, at the centre of its largest row, named for its phase at
   * the time: "Rome · Republic".
   */
  place(camera: Camera, t: number, s: Scenario, selected: string | null): void {
    const seen = new Set<string>();
    for (const a of this.active) {
      const id = a.territory.subject;
      const row = a.rows.reduce((x, y) => (y.area > x.area ? y : x));
      const p = unitVector(row.at[1], row.at[0]) as V3;
      const at = camera.project(p);
      if (!at.visible) continue;
      seen.add(id);
      let el = this.labels.get(id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'territory-label';
        el.dataset.entity = id;
        this.el.appendChild(el);
        this.labels.set(id, el);
      }
      const phase = a.territory.phases?.find((ph) => {
        const [x, y] = spanOf(ph, s);
        return x <= t && t < y;
      });
      const text = phase ? `${a.territory.label} · ${phase.label}` : a.territory.label;
      if (el.textContent !== text) el.textContent = text;
      const [r, g, b] = TERRITORY_COLORS[this.channel.get(id)!].map((c) => Math.round(Math.min(1, c * 0.4 + 0.6) * 255));
      el.style.color = `rgb(${r}, ${g}, ${b})`;
      el.style.transform = `translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px) translate(-50%, -50%)`;
      el.classList.toggle('selected', selected === id);
      el.style.display = '';
    }
    for (const [id, el] of this.labels) if (!seen.has(id)) el.style.display = 'none';
  }
}
