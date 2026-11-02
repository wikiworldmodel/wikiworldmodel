// The Lightworld viewer: fly around the globe and through time, click anything to see what
// it is and how we know. Everything shown comes from one build of the world.
import './style.css';
import { lookAt, spanOf, valueOf, type Look } from '../../core/planet.ts';
import { conj, mul, type Quat } from '../../core/quat.ts';
import type { EntityRecord } from '../../core/records.ts';
import { splitRef } from '../../core/refs.ts';
import { lookup, type Scenario } from '../../core/scenario.ts';
import type { TerritoryFile } from '../../core/territory.ts';
import type { Feature, FeatureTime, FieldInfo, GeneratorConstraint } from '../../core/tileset.ts';
import { formatTime, fromMa, historical, PRESENT_YEAR, toMa } from '../../core/time.ts';
import { GENERATOR as CLOUDS, generateClouds, type CloudParams } from '../../world/generators/earth/clouds/v1.ts';
import { GENERATOR as SURFACE, generateSurface, type SurfaceParams } from '../../world/generators/earth/surface/v1.ts';
import { Camera, MAX_DIST, MIN_DIST } from './camera.ts';
import { fetchLog, getJSON, latestBuild, loadBuild, loadRecord, type Build } from './data.ts';
import { FieldRenderer, type FieldTileGPU } from './gl/field.ts';
import { globeLook, GlobeRenderer } from './gl/globe.ts';
import { add, cross, norm, scale, type V3 } from './mat.ts';
import { buildOf, fromSearch, quantize, toSearch, type ViewState } from './state.ts';
import { TileManager, type LoadedTile } from './tiles.ts';
import { InspectPanel, type PlanetStateInfo, type TerritoryHere } from './ui/inspect.ts';
import { Markers, timeFor, visibility } from './ui/markers.ts';
import { PlanetPanel, valueAt } from './ui/planet.ts';
import { Search } from './ui/search.ts';
import { TERRITORY_COLORS, TerritoryLayer } from './ui/territory.ts';
import { clampWindow, fitWindow, Timebar, xOf, type StateBand } from './ui/timebar.ts';
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
  surface: { expected: string; actual: string | null };
  set(s: Partial<ViewState>): void;
}

const ROOT = new URL('./', location.href).href;

/** Time-control colours for the planet's states, by atmosphere or else by surface. */
const STATE_COLORS: Record<string, string> = {
  'rock-vapour': '#ffc061',
  steam: '#c9ced8',
  magma: '#e2572b',
  'crust-and-magma': '#8a3a1a',
  ocean: '#2f6fa3',
  'bare-rock': '#9b7d5b',
};

/** How far ice reached, in words: "the equator", or a latitude. */
const reachText = (deg: number) => (deg <= 0 ? 'the equator' : `${deg}°`);

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
  let surfaceSpec: GeneratorConstraint | null = null;
  const surface = { expected: '', actual: null as string | null };
  let surfaceReady = false;
  const earth = build.planet.planet;

  // Territory loads behind the first globe: it is only drawn for the times it covers.
  const territory = new TerritoryLayer();
  stage.appendChild(territory.el);
  let territoryReady = !ts.files.territory;
  if (ts.files.territory) {
    void getJSON<TerritoryFile>(build.base + ts.files.territory).then((f) => {
      territory.setFile(f);
      territoryReady = true;
      dirty = true;
    });
  }
  /** Where the last click inside a territory fell, for the record it opened. */
  let here: { entity: string; source: string; info: Omit<TerritoryHere, 'source'> } | null = null;

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
    // Open a state's record, moving into the state if the time shown is outside it.
    onState: (b) => {
      const end = Number.isFinite(b.end) ? b.end : dataRange[1];
      const t = state.t >= b.start && state.t < b.end ? state.t : (Math.max(b.start, dataRange[0]) + Math.min(end, dataRange[1])) / 2;
      setState({ sel: b.id, t });
    },
  });
  timebar.setKeyframes([...new Set(ts.fields.flatMap((f) => f.keyframesMa))].map(fromMa));
  timebar.setRecords(build.search.entities.filter((e) => e.kind !== 'plate'));
  timebar.setScenario(scenario());
  timebar.setStates(stateBands(scenario()));
  root.appendChild(timebar.el);

  const planet = new PlanetPanel(build.series.series, earth?.label);
  planet.onOpen = (id) => showSeries(id);
  planet.onRecord = (id) => setState({ sel: id });
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
    if (altsChanged) {
      timebar.setScenario(scenario());
      timebar.setStates(stateBands(scenario()));
    }
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
    const inside = here?.entity === id ? { ...here.info, source: r.sources[here.source] } : undefined;
    inspect.showEntity(r, scenario(), f ? timeFor(f, scenario()) : recordTime(r, scenario()), inside);
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
    if (!surfaceSpec && t.header.generators.length) {
      surfaceSpec = t.header.generators.find((g) => g.generator === SURFACE) ?? null;
      if (surfaceSpec) void makeSurface(surfaceSpec);
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

  async function makeSurface(spec: GeneratorConstraint): Promise<void> {
    const p = spec.params as unknown as SurfaceParams;
    const rgba = generateSurface(spec.seed, p);
    globe.setPattern(p.width, p.height, rgba);
    surface.expected = spec.outputSha256;
    surface.actual = await sha256Hex(rgba);
    if (surface.actual !== surface.expected) console.error(`surface generator output differs from the build's: ${surface.actual} vs ${surface.expected}`);
    surfaceReady = true;
    dirty = true;
  }

  /** The planet's phases and episodes along the time control, each coloured by how it looks. */
  function stateBands(s: Scenario): StateBand[] {
    const out: StateBand[] = [];
    for (const ph of earth?.phases ?? []) {
      const [start, end] = spanOf(ph, s);
      const look = String(valueOf(ph, 'atmosphere', s) ?? valueOf(ph, 'surface', s) ?? '');
      out.push({ id: earth!.id, label: `${earth!.label}: ${ph.label}`, start, end, color: STATE_COLORS[look] ?? '#5b6b85', over: false });
    }
    for (const ep of build.planet.episodes) {
      const [start, end] = spanOf(ep, s);
      const reach = valueOf(ep, 'ice_reach', s);
      if (typeof reach === 'number') out.push({ id: ep.subject, label: `${ep.label}: ice to ${reachText(reach)}`, start, end, color: '#eef4fa', over: true });
    }
    return out;
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
  let frameLook: Look = lookAt(build.planet, state.t, scenario());
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
    const look = lookAt(build.planet, state.t, scenario());
    frameLook = look;
    const why = !look.formed ? beforeWhy() : fi ? '' : unknownWhy(state.t);
    if (notice.textContent !== why) notice.textContent = why;
    notice.hidden = !why;

    // Light from over the viewer's left shoulder, so the visible side is lit.
    const eye = camera.eye;
    const fwd = norm(scale(eye, -1));
    const right = norm(cross(fwd, [0, 0, 1]));
    const up = cross(right, fwd);
    const sun = norm(add(add(scale(norm(eye), 0.75), scale(right, -0.45)), scale(up, 0.5))) as V3;
    if (territory.update(state.t, scenario())) globe.setTerritory(territory.canvas);
    const showTerritory = territory.shown && !!fi && look.formed;
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
        look: globeLook(look, (surfaceSpec?.params as unknown as SurfaceParams | undefined)?.draw),
        showClouds: state.clouds && cloudsReady,
        territory: { on: showTerritory, colors: TERRITORY_COLORS, selected: territory.channelOf(state.sel) },
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
    territory.el.hidden = !showTerritory;
    if (showTerritory) territory.place(camera, state.t, scenario(), state.sel);
    timebar.set(state.t, state.window, playing);
    planet.update(state.t, look);
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
    here = null;
    const fi = frameField;
    if (!frameLook.formed) return inspect.hide();
    // Inside a polity's territory: open its record, saying which row of its dataset is drawn here.
    const inside = fi && territory.shown ? territory.pick(hit.lon, hit.lat) : undefined;
    if (inside) {
      const entity = splitRef(inside.at.territory.subject).record;
      const { name, from, to, area } = inside.row;
      here = { entity, source: inside.at.claim.source, info: { t: state.t, name, from, to, area } };
      return setState({ sel: entity });
    }
    if (!fi) return inspect.showUnknown(state.t, unknownWhy(state.t), stateOf(frameLook));
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
      state: stateOf(frameLook),
    });
  }

  /** The planet's phase and ice at a time, for the panels: what they are and which records say so. */
  function stateOf(look: Look): PlanetStateInfo | undefined {
    if (!earth || !look.phase) return undefined;
    return {
      planet: earth.id,
      phase: look.phase.label,
      ice: look.ice ? { id: look.ice.subject, label: look.ice.label, reach: reachText(look.iceReach) } : undefined,
    };
  }

  /** Why the globe is empty: the planet's record has not started. */
  function beforeWhy(): string {
    const born = earth ? lookup(earth.variants, scenario(), earth.time).start.best : null;
    return earth && born !== null ? `Before ${earth.label}: it began to form ${formatTime(born)}.` : '';
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
    return Math.max(timebar.yearsPerPixels(t, 12), 1e-3);
  }

  markers.onSelect = (id) => {
    here = null;
    setState({ sel: id });
  };
  toolbar.onChange = (s) => setState(s);
  search.onChoose = (h) => {
    if (h.type === 'period') {
      setState({ window: fitWindow(h.start, h.end, limits), t: Math.max(dataRange[0], Math.min(dataRange[1], (h.start + h.end) / 2)) });
      return;
    }
    goTo(h.id);
  };

  /**
   * A window that shows a record of the calendar's times, if it would be lost in the window
   * shown, taking under a thirtieth of the strip: deep time is browsed by zooming.
   */
  function windowFor(time: FeatureTime): [number, number] | undefined {
    const a = time.start.best;
    if (a === null || !historical(a)) return undefined;
    const b = time.instant ? a : Math.min(time.end.best ?? PRESENT_YEAR, PRESENT_YEAR);
    const span = Math.max(b - a, 40);
    if (xOf(a + span, state.window, 1) - xOf(a, state.window, 1) > 1 / 30) return undefined;
    const pad = span * 0.15 + 5;
    return clampWindow([a - pad, b + pad], limits);
  }

  /** Open an entity, and move to its time and place if it is not in view. */
  function goTo(id: string): void {
    here = null;
    const f = features.get(id) ?? null;
    const entry = build.search.entities.find((e) => e.id === id)!;
    const time = f ? timeFor(f, scenario()) : entry.time;
    let t = state.t;
    if (visibility(time, t, halo(t), false) < 0.5) t = time.start.best ?? t;
    t = Math.max(dataRange[0], Math.min(dataRange[1], t));
    const window = windowFor(time) ?? state.window;
    if (!entry.located) {
      // A polity is where its land was drawn then.
      const c = territory.centre(id, t, scenario());
      const cam = c ? { lat: c[1], lon: c[0], dist: Math.min(state.cam.dist, 2.6) } : state.cam;
      return setState({ t, sel: id, window, cam });
    }
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
    setState({ t, cam, sel: id, window });
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
    idle: () => !tiles.busy && !dirty && cloudsReady && surfaceReady && territoryReady && cubeKey.startsWith(`${state.t}|`) && (!state.sel || shownRecord === state.sel),
    state: () => state,
    url: () => toSearch(build.id, state),
    requests: fetchLog,
    clouds,
    surface,
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
