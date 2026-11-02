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
}

const q = (x: number, digits: number) => Number(x.toFixed(digits));

export function quantize(s: ViewState): ViewState {
  const lon = ((((s.cam.lon + 180) % 360) + 360) % 360) - 180;
  return {
    ...s,
    t: quantizeTime(s.t),
    cam: { lat: q(Math.max(-89.5, Math.min(89.5, s.cam.lat)), 3), lon: q(lon, 3), dist: q(s.cam.dist, 3) },
    window: [quantizeTime(s.window[0]), quantizeTime(s.window[1])],
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
  if (s.evidence) p.set('ev', '1');
  if (!s.clouds) p.set('cl', '0');
  if (s.alt.length) p.set('alt', [...s.alt].sort().join(','));
  if (s.picks.length) p.set('pick', [...s.picks].sort().join(','));
  if (s.sel) p.set('sel', s.sel);
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
    cam: { lat: num('lat', defaults.cam.lat), lon: num('lon', defaults.cam.lon), dist: num('d', defaults.cam.dist) },
    window,
    evidence: p.get('ev') === '1',
    clouds: p.get('cl') !== '0',
    alt: list('alt'),
    picks: list('pick'),
    sel: p.get('sel'),
  });
  return { build: buildOf(search), state };
}
