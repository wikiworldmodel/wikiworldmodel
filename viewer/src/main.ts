// The Lightworld viewer: fly around the globe and through time, click anything to see what
// it is and how we know. Everything shown comes from one build of the world.
import './style.css';
import { conj, mul, type Quat } from '../../core/quat.ts';
import type { EntityRecord } from '../../core/records.ts';
import { splitRef } from '../../core/refs.ts';
import { lookup, type Scenario } from '../../core/scenario.ts';
import type { Feature, FeatureTime, FieldInfo, GeneratorConstraint } from '../../core/tileset.ts';
import { formatTime, fromMa, PRESENT_YEAR, toMa } from '../../core/time.ts';
import { GENERATOR as CLOUDS, generateClouds, type CloudParams } from '../../world/generators/earth/clouds/v1.ts';
import { Camera, MAX_DIST, MIN_DIST } from './camera.ts';
import { fetchLog, latestBuild, loadBuild, loadRecord, type Build } from './data.ts';
import { FieldRenderer, type FieldTileGPU } from './gl/field.ts';
import { GlobeRenderer } from './gl/globe.ts';
import { add, cross, norm, scale, type V3 } from './mat.ts';
import { buildOf, fromSearch, quantize, toSearch, type ViewState } from './state.ts';
import { TileManager, type LoadedTile } from './tiles.ts';
import { InspectPanel } from './ui/inspect.ts';
import { Markers, timeFor, visibility } from './ui/markers.ts';
import { PlanetPanel, valueAt } from './ui/planet.ts';
import { Search } from './ui/search.ts';
import { Timebar } from './ui/timebar.ts';
import { Toolbar } from './ui/toolbar.ts';

declare global {
  interface Window {
    __lightworld?: LightworldHandle;
  }
}

/** What tests and the console can see. */
export interface LightworldHandle {
  build: string;
  idle(): boolean;
  state(): ViewState;
  url(): string;
  requests: string[];
  clouds: { expected: string; actual: string | null };
  set(s: Partial<ViewState>): void;
}

const ROOT = new URL('./', location.href).href;

async function sha256Hex(data: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', data as unknown as ArrayBuffer);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fail(root: HTMLElement, message: string): void {
  root.innerHTML = `<div class="fatal"><h1>Lightworld</h1><p>${message.replace(/</g, '&lt;')}</p></div>`;
}

async function start(root: HTMLElement): Promise<void> {
  const buildId = buildOf(location.search) ?? (await latestBuild(ROOT));
  const build: Build = await loadBuild(ROOT, buildId);
  const ts = build.tileset;
  const dataRange: [number, number] = ts.timeRange;
  // The time control reaches a little past the data at each end, so the data's edges show.
  const pad = (t: number) => Math.abs(PRESENT_YEAR - t) / 15;
  const limits: [number, number] = [dataRange[0] - pad(dataRange[0]), dataRange[1] + pad(dataRange[1])];
  /** The gridded field that covers a time, if any: the first listed where two meet. */
  const fieldAt = (t: number): FieldInfo | undefined => ts.fields.find((f) => f.coverage[0] <= t && t <= f.coverage[1]);
  const defaults: ViewState = {
    t: PRESENT_YEAR,
    cam: { lat: 12, lon: -28, dist: 3.3 },
    window: limits,
    evidence: false,
    clouds: true,
    alt: [],
    picks: [],
    sel: null,
  };
  const parsed = fromSearch(location.search, defaults);
  let state: ViewState = quantize({ ...parsed.state, t: Math.max(dataRange[0], Math.min(dataRange[1], parsed.state.t)) });

  // Page structure.
  root.innerHTML = '';
  const stage = document.createElement('div');
  stage.className = 'stage';
  const canvas = document.createElement('canvas');
  canvas.className = 'globe';
  canvas.setAttribute('aria-label', 'Globe: drag to rotate, scroll to zoom, click to inspect');
  stage.appendChild(canvas);
  root.appendChild(stage);
  const gl = canvas.getContext('webgl2', { antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  if (!gl) return fail(root, 'This viewer needs WebGL2.');

  const field = new FieldRenderer(gl, build.frames.plateIndex.length);
  const globe = new GlobeRenderer(gl, field.cube.texture, field.cube.size);
  const camera = new Camera();
  const tiles = new TileManager(build);
  const gpuTiles = new Map<string, FieldTileGPU>();
  const features = new Map<string, Feature>();
  let cloudSpec: GeneratorConstraint | null = null;
  const clouds = { expected: '', actual: null as string | null };
  let cloudsReady = false;

  const markers = new Markers();
  stage.appendChild(markers.el);
  const credits = document.createElement('div');
  credits.className = 'credits';
  credits.textContent = `Data: ${ts.credits.map((c) => `${c.label}, ${c.license}`).join(' · ')}`;
  stage.appendChild(credits);
  const kindLabel = (k: string) => ts.kinds[k] ?? k;
  const labelOf = (ref: string) => {
    const id = splitRef(ref).record;
    return build.search.entities.find((e) => e.id === id)?.label ?? build.periods.periods.find((p) => p.id === id)?.name ?? ref;
  };
  const altTitle = (id: string) => ts.alternatives.flatMap((g) => g.members).find((m) => m.id === id)?.title ?? id;
  const scenario = (): Scenario => ({ alts: state.alt, picks: state.picks });
  const inspect = new InspectPanel({
    onPick: (group, claim) => setState({ picks: [...state.picks.filter((p) => !group.includes(p)), ...(claim ? [claim] : [])].sort() }),
    onClose: () => setState({ sel: null }),
    onOpen: (id) => setState({ sel: id }),
    labelOf,
    altTitle,
  });
  stage.appendChild(inspect.el);

  const top = document.createElement('div');
  top.className = 'topbar';
  const brand = document.createElement('div');
  brand.className = 'brand';
  // Named for the span the build covers: the finest named period at its start, to its end.
  const named = (t: number) => ['period', 'era', 'eon'].map((rank) => build.periods.periods.find((p) => p.rank === rank && p.start <= t && t <= p.end)).find(Boolean);
  const until = dataRange[1] > PRESENT_YEAR ? formatTime(dataRange[1]) : 'today';
  brand.innerHTML = `<strong>Lightworld</strong><span>${named(dataRange[0])?.name ?? formatTime(dataRange[0])} to ${until}</span>`;
  const search = new Search(build.search, build.periods.periods, kindLabel);
  const toolbar = new Toolbar(build.id, ts.alternatives);
  top.append(brand, search.el, toolbar.el);
  root.appendChild(top);

  const timebar = new Timebar(build.periods.periods, limits, dataRange, {
    onTime: (t) => setState({ t }),
    onWindow: (w) => setState({ window: w }),
    onPlay: () => togglePlay(),
    onRecord: (id) => goTo(id),
  });
  timebar.setKeyframes([...new Set(ts.fields.flatMap((f) => f.keyframesMa))].map(fromMa));
  timebar.setRecords(build.search.entities.filter((e) => e.kind !== 'plate'));
  timebar.setScenario(scenario());
  root.appendChild(timebar.el);

  const planet = new PlanetPanel(build.series.series);
  planet.onOpen = (id) => showSeries(id);
  stage.appendChild(planet.el);
  const notice = document.createElement('div');
  notice.className = 'notice';
  notice.hidden = true;
  stage.appendChild(notice);

  // State.
  let dirty = true;
  let urlTimer = 0;
  let playing = false;
  let lastFrame = performance.now();
  let shownRecord: string | null = null;

  function setState(p: Partial<ViewState>): void {
    const next = quantize({ ...state, ...p });
    next.t = Math.max(dataRange[0], Math.min(dataRange[1], next.t));
    const selChanged = next.sel !== state.sel;
    const altsChanged = JSON.stringify([next.alt, next.picks]) !== JSON.stringify([state.alt, state.picks]);
    state = next;
    if (altsChanged) timebar.setScenario(scenario());
    dirty = true;
    clearTimeout(urlTimer);
    urlTimer = window.setTimeout(() => history.replaceState(null, '', toSearch(build.id, state)), 120);
    if (selChanged || altsChanged) void showSelection();
  }

  async function showSelection(): Promise<void> {
    const id = state.sel;
    if (!id) {
      shownRecord = null;
      inspect.hide();
      return;
    }
    const r = await loadRecord(build, id);
    if (state.sel !== id) return;
    const f = features.get(id);
    shownRecord = id;
    inspect.showEntity(r, scenario(), f ? timeFor(f, scenario()) : recordTime(r, scenario()));
  }

  /** An entity's interval in a scenario, from its record (for entities with no marker). */
  function recordTime(r: EntityRecord, s: Scenario): FeatureTime {
    const v: Record<string, FeatureTime> = {};
    for (const x of r.variants) if (x.time) v[x.key] = x.time;
    return lookup(v, s, r.time);
  }

  function togglePlay(): void {
    playing = !playing;
    if (playing && state.t >= Math.min(state.window[1], dataRange[1]) - 1) setState({ t: Math.max(state.window[0], dataRange[0]) });
    lastFrame = performance.now();
    dirty = true;
  }

  // Tiles → GPU, features, generator constraints.
  tiles.onLoad = (t: LoadedTile) => {
    if (t.header.field) gpuTiles.set(t.ref.id, field.addTile(t.ref.id, t.ref.lod, t.header.field.grid, t.keyframes));
    for (const f of t.header.features) features.set(f.id, f);
    if (!cloudSpec && t.header.generators.length) {
      cloudSpec = t.header.generators.find((g) => g.generator === CLOUDS) ?? null;
      if (cloudSpec) void makeClouds(cloudSpec);
    }
    if (state.sel && !shownRecord) void showSelection();
    dirty = true;
  };
  tiles.onEvict = (t) => {
    const g = gpuTiles.get(t.ref.id);
    if (g) field.removeTile(g);
    gpuTiles.delete(t.ref.id);
  };

  async function makeClouds(spec: GeneratorConstraint): Promise<void> {
    const p = spec.params as unknown as CloudParams;
    const density = generateClouds(spec.seed, p);
    globe.setClouds(p.width, p.height, density);
    clouds.expected = spec.outputSha256;
    clouds.actual = await sha256Hex(density);
    if (clouds.actual !== clouds.expected) console.error(`clouds generator output differs from the build's: ${clouds.actual} vs ${clouds.expected}`);
    cloudsReady = true;
    dirty = true;
  }

  // Rotations: totals per keyframe are cached; deltas move each keyframe to the current time.
  const plateIds = build.frames.plateIndex;
  const keyTotals = new Map<number, Quat[]>();
  const totalsAt = (ageMa: number): Quat[] => {
    let q = keyTotals.get(ageMa);
    if (!q) {
      q = plateIds.map((id) => (id === 0 ? ([1, 0, 0, 0] as Quat) : build.model.total(id, ageMa)));
      keyTotals.set(ageMa, q);
    }
    return q;
  };
  const deltas = (now: Quat[], key: Quat[]): Float32Array => {
    const out = new Float32Array(plateIds.length * 4);
    for (let i = 0; i < plateIds.length; i++) out.set(mul(now[i], conj(key[i])), i * 4);
    return out;
  };

  let cubeKey = '';
  let frameMix = 0;
  let frameKeys: [number, number] = [0, 0];
  let frameField: FieldInfo | undefined;

  function render(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(stage.clientWidth * dpr));
    const h = Math.max(1, Math.round(stage.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    camera.update(state.cam, stage.clientWidth, stage.clientHeight);
    // A projection holds the field's youngest keyframe, and the plates where they are then.
    const fi = fieldAt(state.t);
    const age = fi ? Math.max(toMa(state.t), fi.keyframesMa[0]) : toMa(state.t);
    let mix = 0;
    const loaded = tiles.update(state.t, camera.eye);
    if (fi) {
      const keys = fi.keyframesMa;
      let k1 = keys.find((k) => k >= age) ?? keys[keys.length - 1];
      let k0 = [...keys].reverse().find((k) => k <= age) ?? keys[0];
      if (k0 > k1) [k0, k1] = [k1, k0];
      mix = k1 === k0 ? 0 : (age - k0) / (k1 - k0);
      frameKeys = [k0, k1];
      const drawn = loaded.filter((l) => l.header.field?.id === fi.id).map((l) => gpuTiles.get(l.ref.id)).filter((g): g is FieldTileGPU => !!g);
      const key = `${state.t}|${fi.id}|${drawn.map((d) => d.id).join(',')}`;
      if (key !== cubeKey && drawn.length) {
        const now = totalsAt(age);
        field.render(k0, k1, deltas(now, totalsAt(k0)), deltas(now, totalsAt(k1)), drawn);
        cubeKey = key;
      }
    } else cubeKey = `${state.t}|none`;
    frameMix = mix;
    frameField = fi;
    const why = fi ? '' : unknownWhy(state.t);
    if (notice.textContent !== why) notice.textContent = why;
    notice.hidden = !why;

    // Light from over the viewer's left shoulder, so the visible side is lit.
    const eye = camera.eye;
    const fwd = norm(scale(eye, -1));
    const right = norm(cross(fwd, [0, 0, 1]));
    const up = cross(right, fwd);
    const sun = norm(add(add(scale(norm(eye), 0.75), scale(right, -0.45)), scale(up, 0.5))) as V3;
    globe.render(
      {
        viewProj: camera.viewProj,
        invViewProj: camera.invViewProj,
        eye,
        sun,
        mix,
        evidence: state.evidence ? 1 : 0,
        coast: fi?.coastline?.isolineM ?? 0,
        mode: !fi ? 2 : fi.mode === 'blocks' ? 1 : 0,
        showClouds: state.clouds && cloudsReady,
      },
      w,
      h,
    );

    const nowTotals = new Map<number, Quat>();
    markers.update([...features.values()], camera, {
      t: state.t,
      halo: halo(state.t),
      evidence: state.evidence,
      scenario: scenario(),
      selected: state.sel,
      plateRotation: (plate) => {
        let q = nowTotals.get(plate);
        if (!q) {
          q = build.model.total(plate, age);
          nowTotals.set(plate, q);
        }
        return q;
      },
      // Where no field covers the time, or the plate model does not reach, nothing is placed.
      placed: (plate) => !!fi && build.model.reaches(plate, age),
    });
    timebar.set(state.t, state.window, playing);
    planet.update(state.t);
    toolbar.set({ evidence: state.evidence, clouds: state.clouds, alt: state.alt });
    document.body.classList.toggle('evidence', state.evidence);
  }

  function frame(now: number): void {
    requestAnimationFrame(frame);
    if (playing) {
      // Play at an even pace along the time control, whatever its warp: a 24th of it a second.
      const dt = Math.min(0.1, (now - lastFrame) / 1000);
      const t = timebar.stepFrom(state.t, dt / 24);
      if (t >= Math.min(state.window[1], dataRange[1])) {
        playing = false;
        setState({ t: Math.min(state.window[1], dataRange[1]) });
      } else setState({ t });
    }
    lastFrame = now;
    if (!dirty) return;
    dirty = false;
    render();
    // Tiles may still be arriving; keep rendering until they have.
    if (tiles.busy) dirty = true;
  }

  // Globe interaction.
  let drag: { x: number; y: number; cam: ViewState['cam']; moved: boolean } | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, cam: { ...state.cam }, moved: false };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    const k = (0.22 * (drag.cam.dist - 1)) / 2.3;
    setState({ cam: { lat: drag.cam.lat + dy * k, lon: drag.cam.lon - dx * k, dist: drag.cam.dist } });
  });
  canvas.addEventListener('pointerup', (e) => {
    const d = drag;
    drag = null;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    if (d && !d.moved) pickAt(e.offsetX, e.offsetY);
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const dist = Math.max(MIN_DIST, Math.min(MAX_DIST, 1 + (state.cam.dist - 1) * Math.exp(e.deltaY * 0.0012)));
    setState({ cam: { ...state.cam, dist } });
  }, { passive: false });

  function pickAt(x: number, y: number): void {
    const hit = camera.pick(x, y);
    if (!hit) {
      setState({ sel: null });
      inspect.hide();
      return;
    }
    setState({ sel: null });
    shownRecord = null;
    const fi = frameField;
    if (!fi) return inspect.showUnknown(state.t, unknownWhy(state.t));
    const [e0, e1, p0] = field.sample(hit.point);
    const elevation = e0 + (e1 - e0) * frameMix;
    const plate = build.frames.plateIndex[Math.round(p0)] || null;
    inspect.showTerrain({
      mode: fi.mode,
      lat: hit.lat,
      lon: hit.lon,
      elevation,
      plate,
      plateLabel: plate ? build.model.label(plate) : undefined,
      keyframes: frameKeys,
      mix: frameMix,
      t: state.t,
      source: fi.sourceRecord,
      fieldTitle: fi.title,
      fieldDescription: fi.description,
      coastline: fi.coastline?.title,
      datum: fi.datum,
    });
  }

  /** Why no geography is shown at a time: before the plate model reaches, or after the projection. */
  function unknownWhy(t: number): string {
    const oldest = Math.min(...ts.fields.map((f) => f.coverage[0]));
    const furthest = Math.max(...ts.fields.map((f) => f.coverage[1]));
    if (t < oldest) return `Geography unknown: the plate model reaches back to ${formatTime(oldest)}.`;
    if (t > furthest) return `Geography unknown: today's map is held only to ${formatTime(furthest)}, and nothing models it after.`;
    return '';
  }

  function showSeries(id: string): void {
    const s = build.series.series.find((x) => x.id === id);
    if (!s) return;
    setState({ sel: null });
    shownRecord = null;
    inspect.showSeries(s, state.t, valueAt(s, state.t));
  }

  /** How long an instant stays visible around its time: a dozen pixels of the time control. */
  function halo(t: number): number {
    return Math.max(timebar.yearsPerPixels(t, 12), 2e4);
  }

  markers.onSelect = (id) => setState({ sel: id });
  toolbar.onChange = (s) => setState(s);
  search.onChoose = (h) => {
    if (h.type === 'period') {
      const pad = (h.end - h.start) * 0.06;
      setState({ window: [Math.max(limits[0], h.start - pad), Math.min(limits[1], h.end + pad)], t: Math.max(dataRange[0], Math.min(dataRange[1], (h.start + h.end) / 2)) });
      return;
    }
    goTo(h.id);
  };

  /** Open an entity, and move to its time and place if it is not in view. */
  function goTo(id: string): void {
    const f = features.get(id) ?? null;
    const entry = build.search.entities.find((e) => e.id === id)!;
    const time = f ? timeFor(f, scenario()) : entry.time;
    let t = state.t;
    if (visibility(time, t, halo(t), false) < 0.5) t = time.start.best ?? t;
    t = Math.max(dataRange[0], Math.min(dataRange[1], t));
    if (!entry.located) return setState({ t, sel: id });
    const ageAt = toMa(t);
    const loc = f?.location;
    let cam = state.cam;
    if (loc && f?.plate) {
      const q = build.model.total(f.plate, ageAt);
      const v = [Math.cos((loc.lat * Math.PI) / 180) * Math.cos((loc.lon * Math.PI) / 180), Math.cos((loc.lat * Math.PI) / 180) * Math.sin((loc.lon * Math.PI) / 180), Math.sin((loc.lat * Math.PI) / 180)] as V3;
      const u = q.slice(1) as V3;
      const c = cross(u, v);
      const p = add(v, scale(add(scale(c, q[0]), cross(u, c)), 2));
      cam = { lat: (Math.asin(Math.max(-1, Math.min(1, p[2]))) * 180) / Math.PI, lon: (Math.atan2(p[1], p[0]) * 180) / Math.PI, dist: Math.min(state.cam.dist, 2.4) };
    }
    setState({ t, cam, sel: id });
  }

  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    if (e.key === 'e' || e.key === 'E') setState({ evidence: !state.evidence });
    else if (e.key === 'c' || e.key === 'C') setState({ clouds: !state.clouds });
    else if (e.key === ' ') togglePlay();
    else if (e.key === 'ArrowLeft') setState({ t: timebar.stepFrom(state.t, -1 / 200) });
    else if (e.key === 'ArrowRight') setState({ t: timebar.stepFrom(state.t, 1 / 200) });
    else if (e.key === '/') search.focus();
    else if (e.key === 'Escape') setState({ sel: null });
    else return;
    e.preventDefault();
  });
  window.addEventListener('resize', () => (dirty = true));
  window.addEventListener('popstate', () => {
    const p = fromSearch(location.search, state);
    setState(p.state);
  });

  history.replaceState(null, '', toSearch(build.id, state));
  window.__lightworld = {
    build: build.id,
    idle: () => !tiles.busy && !dirty && cloudsReady && cubeKey.startsWith(`${state.t}|`) && (!state.sel || shownRecord === state.sel),
    state: () => state,
    url: () => toSearch(build.id, state),
    requests: fetchLog,
    clouds,
    set: (s) => setState(s),
  };
  if (state.sel) void showSelection();
  requestAnimationFrame(frame);
}

const root = document.getElementById('app')!;
start(root).catch((err) => {
  console.error(err);
  fail(root, err instanceof Error ? err.message : String(err));
});
