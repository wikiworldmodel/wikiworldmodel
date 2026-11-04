// View state and its URL form. The URL always names the build, the time, the camera and
// any non-default choices, so every view is a reproducible link. State is quantized to what
// the URL can carry, so a view and the view reloaded from its link are the same.
import { quantizeTime, timeFromParam, timeToParam } from '../../core/time.ts';
import type { CameraState } from './camera.ts';

export interface ViewState {
  /** astronomical year */
  t: number;
  cam: CameraState;
  /** the time control's window, [older, younger] astronomical years */
  window: [number, number];
  evidence: boolean;
  clouds: boolean;
  /** alternatives shown instead of the default picture, at most one per group */
  alt: string[];
  /** competing claims picked over their group's default (entity#key) */
  picks: string[];
  /** the entity whose record is open */
  sel: string | null;
  /** the hour of the day, in a city's light */
  hour: number;
  /** the tree of life is open */
  tree?: boolean;
  /** the world's languages are drawn */
  langs?: boolean;
  /**
   * A lighter way to draw the city, for slow machines and for tests run in software: no
   * shadows, occlusion, bloom or multisampling, and coarse meshes only. A link keeps it, so a
   * view and the view reloaded from its link are drawn alike.
   */
  quality?: 'fast';
}

/** The hours a city can be lit by: the sun is low but up at each end. Its sky has no twilight or night yet. */
export const HOURS: [number, number] = [5.4, 18.6];

/** The hour a city is lit by unless a link says otherwise: late afternoon, when the light is long. */
export const DEFAULT_HOUR = 17.4;

const q = (x: number, digits: number) => Number(x.toFixed(digits));

export function quantize(s: ViewState): ViewState {
  const lon = ((((s.cam.lon + 180) % 360) + 360) % 360) - 180;
  // Near the ground a view needs its place to the centimetre.
  const fine = s.cam.dist < 1.05;
  const place = fine ? 7 : 3;
  const cam: CameraState = { lat: q(Math.max(-89.5, Math.min(89.5, s.cam.lat)), place), lon: q(lon, place), dist: q(s.cam.dist, fine ? 10 : 3) };
  if (s.cam.heading) cam.heading = q(((s.cam.heading % 360) + 360) % 360, 2);
  if (s.cam.tilt) cam.tilt = q(s.cam.tilt, 2);
  return {
    ...s,
    t: quantizeTime(s.t),
    cam,
    window: [quantizeTime(s.window[0]), quantizeTime(s.window[1])],
    hour: Math.max(HOURS[0], Math.min(HOURS[1], s.hour)),
  };
}

export function toSearch(build: string, s: ViewState): string {
  const p = new URLSearchParams();
  p.set('b', build);
  p.set('t', timeToParam(s.t));
  p.set('lat', String(s.cam.lat));
  p.set('lon', String(s.cam.lon));
  p.set('d', String(s.cam.dist));
  p.set('w', `${timeToParam(s.window[0])}~${timeToParam(s.window[1])}`);
  if (s.cam.heading) p.set('h', String(s.cam.heading));
  if (s.cam.tilt) p.set('v', String(s.cam.tilt));
  if (s.hour !== DEFAULT_HOUR) p.set('hour', String(s.hour));
  if (s.evidence) p.set('ev', '1');
  if (!s.clouds) p.set('cl', '0');
  if (s.alt.length) p.set('alt', [...s.alt].sort().join(','));
  if (s.picks.length) p.set('pick', [...s.picks].sort().join(','));
  if (s.sel) p.set('sel', s.sel);
  if (s.tree) p.set('tree', '1');
  if (s.langs) p.set('langs', '1');
  if (s.quality) p.set('quality', s.quality);
  return `?${p.toString()}`;
}

/** The build a link names, if any. It is read first: the view's defaults depend on the build. */
export function buildOf(search: string): string | undefined {
  return new URLSearchParams(search).get('b') ?? undefined;
}

export function fromSearch(search: string, defaults: ViewState): { build?: string; state: ViewState } {
  const p = new URLSearchParams(search);
  const num = (k: string, d: number) => {
    const v = p.get(k);
    const x = v === null ? NaN : Number(v);
    return Number.isFinite(x) ? x : d;
  };
  const t = timeFromParam(p.get('t') ?? '') ?? defaults.t;
  let window = defaults.window;
  const w = p.get('w')?.split('~');
  if (w && w.length === 2) {
    const a = timeFromParam(w[0]);
    const b = timeFromParam(w[1]);
    if (a !== undefined && b !== undefined && a < b) window = [a, b];
  }
  const list = (k: string) => [...new Set((p.get(k) ?? '').split(',').filter(Boolean))].sort();
  const state = quantize({
    t,
    cam: { lat: num('lat', defaults.cam.lat), lon: num('lon', defaults.cam.lon), dist: num('d', defaults.cam.dist), heading: num('h', 0), tilt: num('v', 0) },
    window,
    evidence: p.get('ev') === '1',
    clouds: p.get('cl') !== '0',
    alt: list('alt'),
    picks: list('pick'),
    sel: p.get('sel'),
    hour: num('hour', defaults.hour),
    tree: p.get('tree') === '1' || undefined,
    langs: p.get('langs') === '1' || undefined,
    quality: p.get('quality') === 'fast' ? 'fast' : undefined,
  });
  return { build: buildOf(search), state };
}
