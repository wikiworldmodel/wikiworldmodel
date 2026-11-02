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
import { EARTH_RADIUS, fromLocal, toLocal, type CityStructure } from '../../core/city.ts';
import { Camera, MAX_DIST, MIN_DIST } from './camera.ts';
import { CityScene } from './city/scene.ts';
import { autoTilt, groundHit, localView, projectLocal, rayOf, sunAt, type LocalView } from './city/view.ts';
import { CityLabels } from './ui/citylabels.ts';
import { fetchLog, getJSON, latestBuild, loadBuild, loadRecord, type Build } from './data.ts';
import { FieldRenderer, type FieldTileGPU } from './gl/field.ts';
import { globeLook, GlobeRenderer } from './gl/globe.ts';
import { add, cross, norm, scale, type V3 } from './mat.ts';
import { buildOf, DEFAULT_HOUR, fromSearch, HOURS, quantize, toSearch, type ViewState } from './state.ts';
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
  /** the plan of the city's generated fabric, here and in the build */
  fabric(): { expected: string; actual: string | null } | null;
  /** how much of the city is on the GPU */
  cityStats(): { cells: number; coarse: number; fine: number; megabytes: number } | null;
  /** where a structure's label would be on the screen, for tests */
  structureAt(id: string): { x: number; y: number } | undefined;
  set(s: Partial<ViewState>): void;
}

/** Below this the city's scene is drawn, fading in over the globe; and below the lower height the globe is gone. */
const CITY_TOP = 1.1e6;
const CITY_SOLID = 4.5e5;
const GLOBE_GONE = 4.5e4;
const RAD = Math.PI / 180;
/** Kinds that belong to a city: they are drawn and named in the city's scene, not on the globe. */
const cityKind = (k: string) => /^(building|monument|works|open)(\/|$)/.test(k);

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
    hour: DEFAULT_HOUR,
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
  // The city: its scene loads as the camera comes near it, or at once if a link starts there.
  const site = ts.site;
  let city: CityScene | null = null;
  let cityLoading = false;
  const labels = new CityLabels();
  labels.el.hidden = true;
  stage.appendChild(labels.el);
  const cityBar = document.createElement('div');
  cityBar.className = 'citybar';
  cityBar.hidden = true;
  cityBar.innerHTML = `<label title="The hour of the day">Light <input type="range" min="${HOURS[0]}" max="${HOURS[1]}" step="0.05" aria-label="Hour of the day" /></label><button class="to-globe" title="Back out to the whole Earth">Globe</button><span class="city-help" title="Drag to move over the ground. Right-drag or shift-drag to turn and tilt. Scroll to go towards what the pointer is on. W, A, S and D to walk. L for the light. Click anything to see how we know.">?</span>`;
  stage.appendChild(cityBar);
  const cityEnter = document.createElement('button');
  cityEnter.className = 'city-enter';
  cityEnter.hidden = true;
  stage.appendChild(cityEnter);
  let frameView: LocalView | null = null;
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
  timebar.setRecords(build.search.entities.filter((e) => e.kind !== 'plate' && !cityKind(e.kind)));
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

  /** Is a time one the site is drawn for? */
  const siteOpen = (t: number) => !!site && t >= site.span[0] && t <= site.span[1];
  /** How far a point on the globe is from the site, in metres. */
  function siteDistance(lat: number, lon: number): number {
    if (!site) return Infinity;
    const dLat = (lat - site.origin.lat) * RAD;
    const dLon = (lon - site.origin.lon) * RAD;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat * RAD) * Math.cos(site.origin.lat * RAD) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  /** How close to the Earth a view may come here: to the street at the site, nowhere near it elsewhere. */
  function lowestDist(cam: ViewState['cam'], t: number): number {
    if (!siteOpen(t)) return MIN_DIST;
    const d = siteDistance(cam.lat, cam.lon);
    if (d > 1.4e6) return MIN_DIST;
    if (d < 7e4) return 1 + 2 / EARTH_RADIUS;
    return 1 + (((MIN_DIST - 1) * EARTH_RADIUS) * ((d - 7e4) / 1.33e6) ** 1.2) / EARTH_RADIUS + 3e3 / EARTH_RADIUS;
  }

  function setState(p: Partial<ViewState>): void {
    const next = quantize({ ...state, ...p });
    next.t = Math.max(dataRange[0], Math.min(dataRange[1], next.t));
    // A time the site is not drawn for takes the camera back up to the globe.
    if (next.cam.dist < MIN_DIST && !siteOpen(next.t)) next.cam = { lat: next.cam.lat, lon: next.cam.lon, dist: MIN_DIST };
    const selChanged = next.sel !== state.sel;
    const altsChanged = JSON.stringify([next.alt, next.picks]) !== JSON.stringify([state.alt, state.picks]);
    state = next;
    if (altsChanged) {
      timebar.setScenario(scenario());
      timebar.setStates(stateBands(scenario()));
      city?.setScenario(scenario());
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
    const range = (state.cam.dist - 1) * EARTH_RADIUS;
    const wantsCity = !!site && siteOpen(state.t) && range < CITY_TOP * 1.4 && siteDistance(state.cam.lat, state.cam.lon) < 1.6e6;
    // Loaded before it is needed: as soon as the way down is on offer.
    if (site && siteOpen(state.t) && state.cam.dist < 2.2 && siteDistance(state.cam.lat, state.cam.lon) < 2e6 && !city && !cityLoading) void loadCity();
    const inCity = wantsCity && !!city?.ready && range < CITY_TOP;
    const globeHidden = inCity && range < GLOBE_GONE;
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
    if (!globeHidden) globe.render(
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
    frameView = null;
    if (inCity) {
      const v = localView(state.cam, site!.origin, city!.ground, stage.clientWidth, stage.clientHeight);
      // The scene's own frame, its pixel size in device pixels.
      v.width = stage.clientWidth;
      v.height = stage.clientHeight;
      frameView = v;
      const t0 = 1 - Math.max(0, Math.min(1, (range - CITY_SOLID) / (CITY_TOP - CITY_SOLID)));
      const alpha = t0 * t0 * (3 - 2 * t0);
      city!.select(state.sel);
      city!.render(v, sunAt(state.hour, site!.origin.lat), state.t, state.evidence, alpha, globeHidden, w, h);
      labels.update(v, city!.ground, city!.skyline, state.t, state.sel);
    }
    labels.el.hidden = !inCity || range > 2.2e4;
    planet.el.hidden = inCity && range < 6e4;
    credits.classList.toggle('in-city', inCity && range < 6e4);
    cityBar.hidden = !inCity || range > CITY_SOLID;
    canvas.classList.toggle('in-city', inCity);
    if (inCity) cityBar.querySelector<HTMLInputElement>('input')!.value = String(state.hour);
    const enter = !!site && !inCity && state.cam.dist < 2.2 && siteDistance(state.cam.lat, state.cam.lon) < 1.5e6;
    cityEnter.hidden = !enter;
    if (enter) cityEnter.textContent = `Fly down into ${site!.label}, ${formatTime(site!.slice)}`;
    if (inCity) {
      const slice = site!.slice;
      const why = state.t < -200 || state.t > 700 ? `${site!.label}'s ordinary housing is generated for ${formatTime(slice)}; what stands here at this date is only what the records and the map date to it.` : '';
      if (why && notice.textContent !== why) notice.textContent = why;
      notice.hidden = !why;
    }

    const nowTotals = new Map<number, Quat>();
    const onGlobe = [...features.values()].filter((f) => !cityKind(f.kind));
    markers.el.hidden = inCity && range < 1.2e5;
    markers.update(onGlobe, camera, {
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
    if (flight) stepFlight(now);
    if (walking.size && frameView) walk((now - lastFrame) / 1000);
    lastFrame = now;
    if (!dirty) return;
    dirty = false;
    render();
    // Tiles may still be arriving; keep rendering until they have.
    if (tiles.busy) dirty = true;
  }

  // Globe interaction, and near the ground, a map's: drag the ground, turn with the right button
  // or shift, and scroll towards what the pointer is on.
  let drag: { x: number; y: number; cam: ViewState['cam']; moved: boolean; turn: boolean } | null = null;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    flight = null;
    drag = { x: e.clientX, y: e.clientY, cam: { ...state.cam }, moved: false, turn: e.button === 2 || e.shiftKey || e.altKey };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    const range = (drag.cam.dist - 1) * EARTH_RADIUS;
    if (frameView && drag.turn) {
      setState({ cam: { ...drag.cam, heading: (drag.cam.heading ?? 0) + dx * 0.28, tilt: Math.max(0, Math.min(112, (drag.cam.tilt ?? 0) + dy * 0.22)) } });
      return;
    }
    if (frameView && range < 6e5) {
      // The ground follows the pointer.
      const v = frameView;
      const tilt = ((drag.cam.tilt ?? 0) * Math.PI) / 180;
      const k = (range * 2 * Math.tan(v.fov / 2)) / v.height;
      const along = (dy * k) / Math.max(0.3, Math.cos(Math.min(tilt, 1.2)));
      const h = ((drag.cam.heading ?? 0) * Math.PI) / 180;
      const mx = -dx * k * Math.cos(h) + along * Math.sin(h);
      const my = dx * k * Math.sin(h) + along * Math.cos(h);
      const [x, y] = toLocal(site!.origin, drag.cam.lat, drag.cam.lon);
      const [lat, lon] = fromLocal(site!.origin, x + mx, y + my);
      setState({ cam: { ...drag.cam, lat, lon } });
      return;
    }
    const k = (0.22 * (drag.cam.dist - 1)) / 2.3;
    setState({ cam: { ...drag.cam, lat: drag.cam.lat + dy * k, lon: drag.cam.lon - dx * k } });
  });
  canvas.addEventListener('pointerup', (e) => {
    const d = drag;
    drag = null;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    if (d && !d.moved) pickAt(e.offsetX, e.offsetY);
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    flight = null;
    zoomBy(e.deltaY, e.offsetX, e.offsetY);
  }, { passive: false });

  // Walking: W, A, S and D move the camera over the ground, at a pace that suits its height.
  const walking = new Set<string>();
  function walk(dt: number): void {
    const range = (state.cam.dist - 1) * EARTH_RADIUS;
    const speed = Math.max(5, range * 0.7) * Math.min(dt, 0.1);
    const h = ((state.cam.heading ?? 0) * Math.PI) / 180;
    const go = (walking.has('w') ? 1 : 0) - (walking.has('s') ? 1 : 0);
    const side = (walking.has('d') ? 1 : 0) - (walking.has('a') ? 1 : 0);
    const [x, y] = toLocal(site!.origin, state.cam.lat, state.cam.lon);
    const [lat, lon] = fromLocal(site!.origin, x + (Math.sin(h) * go + Math.cos(h) * side) * speed, y + (Math.cos(h) * go - Math.sin(h) * side) * speed);
    setState({ cam: { ...state.cam, lat, lon } });
  }
  window.addEventListener('keyup', (e) => walking.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => walking.clear());

  /** Zoom: from orbit, towards the site if it is near; close by, towards what the pointer is on. */
  function zoomBy(deltaY: number, sx: number, sy: number): void {
    const cam = state.cam;
    const factor = Math.exp(deltaY * 0.0012);
    const lowest = lowestDist(cam, state.t);
    const dist = Math.max(lowest, Math.min(MAX_DIST, 1 + (cam.dist - 1) * factor));
    const before = (cam.dist - 1) * EARTH_RADIUS;
    const after = (dist - 1) * EARTH_RADIUS;
    let lat = cam.lat;
    let lon = cam.lon;
    if (frameView && deltaY < 0 && after <= (lowest - 1) * EARTH_RADIUS + 0.01) {
      // At the street, scrolling on walks forward.
      const v = frameView;
      const step = Math.min(6, -deltaY * 0.03);
      const [x, y] = toLocal(site!.origin, cam.lat, cam.lon);
      [lat, lon] = fromLocal(site!.origin, x + Math.sin(((cam.heading ?? 0) * Math.PI) / 180) * step, y + Math.cos(((cam.heading ?? 0) * Math.PI) / 180) * step);
      void v;
    } else if (site && dist < MIN_DIST && siteOpen(state.t)) {
      if (frameView && before < 4e5) {
        // Keep the ground under the pointer where it is.
        const hit = groundHit(frameView, rayOf(frameView, sx, sy), city!.ground);
        if (hit) {
          const [x, y] = toLocal(site.origin, cam.lat, cam.lon);
          const k = after / before;
          [lat, lon] = fromLocal(site.origin, hit[0] + (x - hit[0]) * k, hit[1] + (y - hit[1]) * k);
        }
      } else if (deltaY < 0) {
        // Coming down from orbit, drift towards the city.
        const k = Math.min(1, (before - after) / Math.max(before, 1)) * 0.9;
        lat += (site.origin.lat - lat) * k;
        lon += (site.origin.lon - lon) * k;
      }
    }
    const tilt = Math.max(0, Math.min(112, (cam.tilt ?? 0) + autoTilt(after) - autoTilt(before)));
    const high = after > 4.2e5;
    setState({ cam: { lat, lon, dist, heading: high ? 0 : cam.heading, tilt: high ? 0 : tilt } });
  }

  /** A flight: from where the camera is to a view, over a few seconds, in the logarithm of its height. */
  interface Flight {
    from: ViewState['cam'];
    to: ViewState['cam'];
    t0: number;
    ms: number;
  }
  let flight: Flight | null = null;

  function flyTo(to: ViewState['cam'], ms = 3600): void {
    // A link is the place it names: tests and shared views arrive at once.
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return setState({ cam: to });
    flight = { from: { ...state.cam, heading: state.cam.heading ?? 0, tilt: state.cam.tilt ?? 0 }, to: { ...to, heading: to.heading ?? 0, tilt: to.tilt ?? 0 }, t0: performance.now(), ms };
    dirty = true;
  }

  function stepFlight(now: number): void {
    const f = flight!;
    let u = Math.min(1, (now - f.t0) / f.ms);
    // A flight into the city waits above it until the city is ready.
    if (u > 0.3 && f.to.dist < MIN_DIST && !city?.ready) {
      u = 0.3;
      f.t0 = now - u * f.ms;
    }
    const e = u * u * (3 - 2 * u);
    // The place arrives before the height does, so the descent ends over the city.
    const g = Math.min(1, e * 1.5);
    const a0 = Math.log(f.from.dist - 1);
    const a1 = Math.log(f.to.dist - 1);
    let dh = ((f.to.heading! - f.from.heading! + 540) % 360) - 180;
    if (Math.abs(dh) < 1e-6) dh = 0;
    setState({
      cam: {
        lat: f.from.lat + (f.to.lat - f.from.lat) * g,
        lon: f.from.lon + (f.to.lon - f.from.lon) * g,
        dist: 1 + Math.exp(a0 + (a1 - a0) * e),
        heading: f.from.heading! + dh * e,
        tilt: f.from.tilt! + (f.to.tilt! - f.from.tilt!) * e,
      },
    });
    if (u >= 1) flight = null;
  }

  async function loadCity(): Promise<void> {
    cityLoading = true;
    try {
      const scene = new CityScene(gl!, build);
      scene.onChange = () => (dirty = true);
      await scene.load();
      city = scene;
      scene.setScenario(scenario());
      labels.setStructures(scene.file.structures, scene.tops, scene.file.site.label, (s) => s.label);
      labels.onSelect = (id) => goTo(id);
    } catch (err) {
      // The globe still works without the city.
      console.error(`city: ${err instanceof Error ? err.message : String(err)}`.slice(0, 900));
      notice.textContent = `The city could not be drawn here: ${err instanceof Error ? err.message.split('\n')[0] : err}`;
      notice.hidden = false;
    }
    dirty = true;
  }

  /** The default way into the city: from the south-east, over the Colosseum towards the Forum. */
  const cityCam = (): ViewState['cam'] => {
    const [lat, lon] = fromLocal(site!.origin, 240, -60);
    return { lat, lon, dist: 1 + 1500 / EARTH_RADIUS, heading: 302, tilt: 66 };
  };

  function enterCity(): void {
    if (!site) return;
    if (!city && !cityLoading) void loadCity();
    const inSlice = state.t >= -200 && state.t <= 700;
    setState({ t: inSlice ? state.t : site.slice, window: inSlice ? state.window : clampWindow([-800, 1200], limits) });
    flyTo(cityCam(), 5200);
  }
  cityEnter.onclick = () => enterCity();
  cityBar.querySelector<HTMLInputElement>('input')!.oninput = (e) => setState({ hour: Number((e.target as HTMLInputElement).value) });
  cityBar.querySelector<HTMLButtonElement>('.to-globe')!.onclick = () => flyTo({ lat: state.cam.lat, lon: state.cam.lon, dist: 2.6 }, 4200);

  /** Fly to a structure of the city, looking at its front, at a time it stands. */
  function flyToStructure(s: CityStructure): void {
    const a = s.time.start.best ?? -Infinity;
    const b = s.time.end.best ?? Infinity;
    const t = state.t >= a && state.t <= b ? state.t : site!.slice >= a && site!.slice <= b ? site!.slice : Math.max(a, Math.min(b, state.t));
    const [lat, lon] = fromLocal(site!.origin, s.at[0], s.at[1]);
    let extent = 60;
    for (const r of s.rings) for (let i = 0; i < r.length; i += 2) extent = Math.max(extent, Math.hypot(r[i] - s.at[0], r[i + 1] - s.at[1]));
    const range = Math.max(90, Math.min(1800, extent * 2.6));
    setState({ t, sel: s.id, window: t >= state.window[0] && t <= state.window[1] && state.window[1] - state.window[0] < 5000 ? state.window : clampWindow([-800, 1200], limits) });
    flyTo({ lat, lon, dist: 1 + range / EARTH_RADIUS, heading: state.cam.dist < 1.01 ? state.cam.heading : 330, tilt: 62 }, state.cam.dist < 1.001 ? 1800 : 4600);
  }

  function pickAt(x: number, y: number): void {
    if (frameView && city && (state.cam.dist - 1) * EARTH_RADIUS < 6e4) {
      const dpr = canvas.width / stage.clientWidth;
      const found = city.pick(Math.round(x * dpr), canvas.height - 1 - Math.round(y * dpr));
      dirty = true;
      here = null;
      if (found.structure) return setState({ sel: found.structure.id });
      setState({ sel: null });
      shownRecord = null;
      if (found.lot !== undefined) {
        const reg = city.file.fabric.regions[city.lotRegion[found.lot]];
        const kind = city.lotType[found.lot];
        const words = kind === 0 ? 'A block of apartments and shops' : kind === 1 ? 'A town house' : 'A house outside the walls';
        return inspect.showGenerated(words, 'Generated building', `In ${reg?.label ?? 'the city'}. Nothing is known of this building: the generator placed it here so that the city stands around its monuments.`, `${city.file.fabric.generator}, version ${city.file.fabric.version}, seed "${city.file.fabric.seed}": its streets and lots are invented, and only how densely it builds each region comes from the world, from what the Regionary Catalogues count there.`);
      }
      if (found.tree) return inspect.showGenerated('A tree', 'Generated', 'Trees are placed by the generator in the mapped gardens and across the open country. No one recorded this one.', `${city.file.fabric.generator}, version ${city.file.fabric.version}.`);
      if (found.crowd) return inspect.showGenerated('A passer-by', 'Generated', 'Figures to give the streets and squares their scale. Nobody in particular.', `${city.file.fabric.generator}, version ${city.file.fabric.version}.`);
      inspect.hide();
      return;
    }
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
    if (entry && cityKind(entry.kind) && site) {
      const open = () => {
        const s = city?.file.structures.find((x) => x.id === id);
        if (s) flyToStructure(s);
        else setState({ sel: id });
      };
      if (city) open();
      else if (!cityLoading) void loadCity().then(open);
      return;
    }
    if (id === 'places/rome' && site) {
      setState({ sel: id });
      return enterCity();
    }
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
    if (frameView && 'wasd'.includes(e.key.toLowerCase()) && e.key.length === 1) {
      walking.add(e.key.toLowerCase());
      flight = null;
      dirty = true;
      e.preventDefault();
      return;
    }
    if (e.key === 'e' || e.key === 'E') setState({ evidence: !state.evidence });
    else if (e.key === 'c' || e.key === 'C') setState({ clouds: !state.clouds });
    else if (e.key === ' ') togglePlay();
    else if (e.key === 'ArrowLeft') setState({ t: timebar.stepFrom(state.t, -1 / 200) });
    else if (e.key === 'ArrowRight') setState({ t: timebar.stepFrom(state.t, 1 / 200) });
    else if (e.key === 'l' || e.key === 'L') setState({ hour: state.hour >= HOURS[1] ? HOURS[0] : state.hour + 0.4 });
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

  /** Is the view waiting on the city's scene? */
  const cityWanted = () => !!site && siteOpen(state.t) && (state.cam.dist - 1) * EARTH_RADIUS < CITY_TOP * 1.4 && siteDistance(state.cam.lat, state.cam.lon) < 1.6e6 && !(city?.settled && city.plan.actual);
  history.replaceState(null, '', toSearch(build.id, state));
  window.__lightworld = {
    build: build.id,
    idle: () => !tiles.busy && !dirty && cloudsReady && surfaceReady && territoryReady && cubeKey.startsWith(`${state.t}|`) && (!state.sel || shownRecord === state.sel) && !flight && !cityWanted() ,
    state: () => state,
    url: () => toSearch(build.id, state),
    requests: fetchLog,
    clouds,
    surface,
    fabric: () => (city ? city.plan : null),
    cityStats: () => (city ? city.stats() : null),
    structureAt: (id) => {
      const s = city?.file.structures.find((x) => x.id === id);
      return s && frameView ? projectLocal(frameView, s.at[0], s.at[1], s.base) : undefined;
    },
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
