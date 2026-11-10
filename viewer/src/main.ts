// The WikiWorldModel viewer: fly around the globe and through time, click anything to see what
// it is and how we know. Everything shown comes from one build of the world.
import './style.css';
import { CLIMATE_LABEL, climateClass, decodeNode, type ClimateClass, type ClimateHeader, type ClimateNode, type ClimateRule } from '../../core/climate.ts';
import { decodeTile, type TypedArray } from '../../core/container.ts';
import { bytesPrint, printCheck, settlePrint, type Fingerprint, type PrintCheck } from '../../core/fingerprint.ts';
import { decodeMargin, decodeThickness, iceFrame, iceKeysAt, iceScenario, sampleGrid, type IceHeader, type IceKeyframe, type IceScenario } from '../../core/ice.ts';
import { levelOf, type HazardFile, type HazardRow, type PeopleFile, type PeopleHeader, type PolitiesFile, type PresentFile } from '../../core/layers.ts';
import { coverAt, lookAt, spanOf, valueOf, type Cover, type Look } from '../../core/planet.ts';
import { conj, mul, rotate, toLatLon, unitVector, type Quat } from '../../core/quat.ts';
import type { EntityRecord, OverlaysFile } from '../../core/records.ts';
import { encodeRowKey, splitRef } from '../../core/refs.ts';
import { seaLevelAt } from '../../core/sealevel.ts';
import { lookup, scenarioKey, type Scenario } from '../../core/scenario.ts';
import type { TerritoryFile } from '../../core/territory.ts';
import { indexTree, subtree, type TreeFile } from '../../core/tree.ts';
import { cityKind, placeAt, type FeatureTime, type FieldInfo, type GeneratorConstraint, type SiteInfo } from '../../core/tileset.ts';
import { formatTime, fromMa, historical, MONTH_NAMES, PRESENT_YEAR, toMa } from '../../core/time.ts';
import { warmestMonth } from '../../core/months.ts';
import { snowOf } from '../../world/generators/life/climate.ts';
import { GENERATOR as BIOME_TEXTURE, type BiomeTextureParams } from '../../world/generators/earth/biome/v1.ts';
import { GENERATOR as CLOUDS, type CloudParams } from '../../world/generators/earth/clouds/v1.ts';
import { GENERATOR as SURFACE, type SurfaceParams } from '../../world/generators/earth/surface/v1.ts';
import { GENERATOR as GENERIC_LAND, genericLandAt, type GenericLandParams } from '../../world/generators/earth/generic-land/v1.ts';
import { resolve as resolveLayer, type Answer, type LayerId, type ResolveWorld } from '../../core/resolve.ts';
import type { FromGlobeWorker, ToGlobeWorker } from './gl/globeworker.ts';
import { EARTH_RADIUS, fromLocal, toLocal, type CityStructure } from '../../core/city.ts';
import type { AtlasWhere } from '../../core/atlas.ts';
import type { SceneFileV2 } from '../../core/scene.ts';
import { latticeOf } from '../../world/generators/life/spec.ts';
import type { LivingParams } from '../../world/generators/life/scene/v5.ts';
import { Camera, MAX_DIST, MIN_DIST } from './camera.ts';
import { LifeAtlas, type ClimateData } from './city/lifeatlas.ts';
import { Climates, type ClimateAt } from './climates.ts';
import { LifeScene } from './city/life.ts';
import type { PeopleSummary } from './city/lifeworker.ts';
import { LandscapeAtlas } from './city/landscape.ts';
import { anthromeOf, classAtStep, nearestStep, PATTERN_LABEL, USE_LABEL, USES, LEVEL_WORDS, type Pattern } from '../../core/landscape.ts';
import { specText } from '../../core/dwelling.ts';
import { CityScene } from './city/scene.ts';
import { autoTilt, EYE_HEIGHT, groundHit, localView, lookThrough, projectLocal, rayOf, sunAt, underSea, type LocalView } from './city/view.ts';
import { SEA } from './gl/cityShaders.ts';
import { CityLabels } from './ui/citylabels.ts';
import { FeatureTiles } from './features.ts';
import { fetchLog, getBytes, getJSON, latestBuild, loadBuild, loadRecord, type Build } from './data.ts';
import { FieldRenderer, type FieldTileGPU } from './gl/field.ts';
import { globeLook, GlobeRenderer, type CloudDrift } from './gl/globe.ts';
import { add, cross, norm, scale, type V3 } from './mat.ts';
import { buildOf, DEFAULT_HOUR, fromSearch, HOURS, quantize, toSearch, type ViewState } from './state.ts';
import { TileManager, type LoadedTile } from './tiles.ts';
import { InspectPanel, stepName, type BiomeHere, type IceHere, type LandscapeHere, type OrganismHere, type PlanetStateInfo, type RowInfo, type TerrainInfo, type TerritoryHere } from './ui/inspect.ts';
import { Markers, timeFor, visibility } from './ui/markers.ts';
import { PlanetPanel, valueAt } from './ui/planet.ts';
import { Search } from './ui/search.ts';
import { TERRITORY_COLORS, TerritoryLayer } from './ui/territory.ts';
import { FossilLayer } from './ui/fossils.ts';
import { HazardLayer, PeopleLayer, PolityLayer, PresentLayer } from './ui/layers.ts';
import { FieldLayer } from './ui/fieldlayer.ts';
import { Rivers } from './rivers.ts';
import { RIVERS_TOGGLE, RiversLayer, type RiverNear, type RiversDrawn } from './ui/riverslayer.ts';
import { TreePanel } from './ui/tree.ts';
import { clampWindow, fitWindow, Timebar, xOf, type StateBand } from './ui/timebar.ts';
import { Toolbar } from './ui/toolbar.ts';

declare global {
  interface Window {
    __wikiworldmodel?: WikiWorldModelHandle;
  }
}

/** What tests and the console can see. */
export interface WikiWorldModelHandle {
  build: string;
  idle(): boolean;
  /** what the view is still waiting on before it is idle, by name */
  waiting(): string[];
  state(): ViewState;
  url(): string;
  requests: string[];
  /** the globe's generators' output, as the build recorded it and as this browser made it */
  clouds: PrintCheck;
  surface: PrintCheck;
  biomeTexture: PrintCheck;
  genericLand: PrintCheck;
  /** what a layer has at a place, at the time shown, and which tier answered (core/resolve.ts) */
  resolve(lat: number, lon: number, layer: LayerId): Answer;
  /** the land's climate and cover at a place on the globe at the time shown, if the field reaches there */
  biomeAt(lat: number, lon: number): { climate: ClimateClass; cover: Cover } | null;
  /** the numbers the climate field holds there, as the globe reads them */
  climateAt(lat: number, lon: number): ClimateNode | null;
  /** the climate field the land is painted from at the time shown, while it is */
  climateField(): string | null;
  /** the ground's height above the sea of the time shown at a place, as the globe holds it */
  groundAt(lat: number, lon: number): number | null;
  /** what the globe has of the ice sheets at a place, at the time shown: null where the field does not reach the time */
  iceAt(lat: number, lon: number): { drawn: boolean; marginKm: number; thickness: number } | null;
  /** the tree of life as the panel has it: its rows, and how many fossil rows the group chosen lights up */
  tree(): { rows: ReturnType<TreePanel['shownRows']>; litRows: number; litMarkers: string[] } | null;
  /** what is drawn over the globe as rows of a dataset */
  layers(): { present: { lines: number; names: number }; holds: boolean; hazards: number; hazardPlaces: { name: string; x: number; y: number }[]; placeAt(name: string): { x: number; y: number } | undefined; polities: { rows: number; names: number }; polityAt(lon: number, lat: number): string | undefined; routes: number; languages: number; languageAt(name: string): { x: number; y: number } | undefined; people: { drawn: boolean; holds: boolean; total: number; lit: number }; peopleAt(lon: number, lat: number): { people: number; land: number; level: number; x: number; y: number; visible: boolean } | undefined };
  /** the plan of the city's generated fabric, here and in the build */
  fabric(): PrintCheck | null;
  /** how much of the city is on the GPU */
  cityStats(): { cells: number; coarse: number; fine: number; megabytes: number } | null;
  /** where a structure's label would be on the screen, for tests */
  structureAt(id: string): { x: number; y: number } | undefined;
  /** where the settlements of the scene drawn stand on the screen, those in view: the lists' cities by name */
  settlementsAt(): { pattern: string; city?: string; houses: number; x: number; y: number }[];
  /** the living scene as the viewer has it, if one is loaded */
  scene(): { site: string; plan: PrintCheck; taxa: { id: string; label: string; form: string; own: boolean; tier: string; km?: number; rows: number; drawn: boolean }[]; instances: number; triangles: number; meshes: number; groundMs: number; stage?: string; climate: string; climateField: string; month: number | null; snow: number | null; focus: [number, number]; toRiver: [number, number]; origin: { lat: number; lon: number }; water: { tier: string; rivers: { key: string; from: string }[] } | null; sea: boolean; list: 'land' | 'sea'; eye: { z: number; floor: number } | null; people: { asked: boolean; houses: number; drawn: number; expected: number; settlements: number; pattern?: string; tier?: string; forms: string[] } | null } | null;
  /** a browser's fingerprint of the scene of a place and a time, as a witness in the build has it */
  lifePrint(lat: number, lon: number, t: number): Promise<Fingerprint | null>;
  /** how far the atlas reaches, as the build says */
  atlas(): { bins: number; coverage: unknown } | null;
  /** what the rivers layer drew in the last frame; of it, the reaches that pass near a place, and the lake over one */
  rivers(): RiversDrawn & { near(lat: number, lon: number, deg: number): RiverNear[]; lakeAt(lat: number, lon: number): { level: number; spills: boolean; cells: number } | null };
  /** where each group of a taxon stands: on the screen, and on the globe, for tests */
  organismsAt(id: string): { x: number; y: number; depth: number }[];
  organismPlaces(id: string): { lat: number; lon: number; x: number; y: number }[];
  set(s: Partial<ViewState>): void;
  /** for a capture: how far the clouds have drifted along their bands, or null to put them back */
  driftClouds(d: CloudDrift | null): void;
}

/** Below this the city's scene is drawn, fading in over the globe; and below the lower height the globe is gone. */
const CITY_TOP = 1.1e6;
const CITY_SOLID = 4.5e5;
/** The same for a scene of any place: it is made as it is needed, so it starts nearer the ground. */
const LIFE_TOP = 3.2e5;
const LIFE_SOLID = 1.2e5;
const GLOBE_GONE = 4.5e4;
/** How far one sees through the sea's water, as it is drawn: until its green light falls to a twentieth. */
const SEEN_THROUGH_WATER = Math.log(20) / SEA.extinction[1];
const RAD = Math.PI / 180;
/** Kinds that belong to a city: they are drawn and named in the city's scene, not on the globe. */

const ROOT = new URL('./', location.href).href;

/** A settlement of each way of life, one and many, for the panel of a house. */
const SETTLEMENT_WORDS: Record<Pattern, [string, string]> = {
  none: ['place', 'places'],
  foragers: ["foragers' camp", "foragers' camps"],
  herders: ["herders' camp", "herders' camps"],
  shifting: ["shifting cultivators' hamlet", "shifting cultivators' hamlets"],
  farmsteads: ['group of farmsteads', 'groups of farmsteads'],
  hamlets: ['hamlet', 'hamlets'],
  villages: ['village', 'villages'],
  towns: ['town', 'towns'],
  city: ['city of the anthromes', 'cities of the anthromes'],
};

/** A scene's people in a few words, for its bar: the cities of the lists it holds, and how people lived at its middle. */
function peopleWords(folk: PeopleSummary): string {
  const names = folk.settlements.filter((x) => x.city).sort((a, b) => b.people - a.people).map((x) => x.city!);
  const way = PATTERN_LABEL[folk.lifeway.pattern];
  const towns = names.length > 2 ? `${names.slice(0, 2).join(', ')} and ${names.length - 2} more` : names.join(' and ');
  const what = !names.length ? way : ['city', 'towns', 'none'].includes(folk.lifeway.pattern) ? towns : `${towns} among ${way.toLowerCase()}`;
  return `${what}${folk.houses ? `, ${folk.houses.toLocaleString('en-US')} houses` : ''}`;
}

/** How to move about near the ground, with a mouse and keys, and on a touch screen. */
const MOUSE_HELP = 'Drag to move over the ground. Right-drag or shift-drag to turn and tilt. Scroll to go towards what the pointer is on. W, A, S and D to walk. L for the light. Click anything to see how we know.';
const TOUCH_HELP = 'Drag to move over the ground. Pinch to come nearer or go back, twist two fingers to turn, and move two fingers up or down together to tilt. Tap anything to see how we know.';

const HAZARD_WORDS: Record<HazardRow['kind'], string> = { eruption: 'Eruption', earthquake: 'Earthquake', tsunami: 'Tsunami' };
const HAZARD_SIZE: Record<HazardRow['kind'], string> = { eruption: 'Volcanic explosivity index', earthquake: 'Magnitude', tsunami: 'Tsunami intensity' };

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

function fail(root: HTMLElement, message: string): void {
  root.innerHTML = `<div class="fatal"><h1>WikiWorldModel</h1><p>${message.replace(/</g, '&lt;')}</p></div>`;
}

async function start(root: HTMLElement): Promise<void> {
  const linked = buildOf(location.search);
  const newest = await latestBuild(ROOT).catch(() => linked ?? '');
  const buildId = linked ?? newest;
  const build: Build = await loadBuild(ROOT, buildId);
  const ts = build.tileset;
  const dataRange: [number, number] = ts.timeRange;
  // The time control reaches a little past the data at each end, so the data's edges show.
  const pad = (t: number) => Math.abs(PRESENT_YEAR - t) / 15;
  const limits: [number, number] = [dataRange[0] - pad(dataRange[0]), dataRange[1] + pad(dataRange[1])];
  /** The gridded field that covers a time, if any: the first listed where two meet. */
  const fieldAt = (t: number): FieldInfo | undefined => ts.fields.find((f) => f.coverage[0] <= t && t <= f.coverage[1]);
  /** For a field of today's ground, the sea level of a time relative to today's, from the series its coastline reads; else none. */
  const seaLevelOf = (f: FieldInfo | undefined, t: number): number => (f?.coastline?.seaLevel ? seaLevelAt(build.series.series.find((x) => x.id === f.coastline!.seaLevel)?.points ?? [], t) : 0);
  /** Where a field's coast is drawn at a time: its isoline, risen or fallen with the sea. */
  const coastOf = (f: FieldInfo | undefined, t: number): number => (f?.coastline?.isolineM ?? 0) + seaLevelOf(f, t);
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
    tree: undefined,
    layers: undefined,
    people: undefined,
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

  // A cube fine enough for the finest level of the tiles: twice the texels where a field is finer than 1°.
  const field = new FieldRenderer(gl, build.frames.plateIndex.length, ts.lods.some((l) => l.step < 1) ? 1024 : 512);
  const globe = new GlobeRenderer(gl, field.cube.texture, field.cube.size);
  const camera = new Camera();
  const tiles = new TileManager(build);
  const gpuTiles = new Map<string, FieldTileGPU>();
  const features = new FeatureTiles(build, build.features);
  features.onLoad = () => {
    dirty = true;
    if (state.sel && !shownRecord) void showSelection();
  };
  let cloudSpec: GeneratorConstraint | null = null;
  const clouds = printCheck();
  let cloudsReady = false;
  /** how far a capture has drifted the clouds, if one has */
  let cloudDrift: CloudDrift | undefined;
  let surfaceSpec: GeneratorConstraint | null = null;
  const surface = printCheck();
  let surfaceReady = false;
  let biomeSpec: GeneratorConstraint | null = null;
  const biomeTexture = printCheck();
  let biomeTexReady = false;
  // Generic land, for where no map covers the time (docs/STRUCTURE.md section 3.3).
  let genericSpec: GeneratorConstraint | null = null;
  const genericLand = printCheck();
  let genericReady = false;
  let genericMask: { mask: Uint8Array; params: GenericLandParams } | null = null;
  const earth = build.planet.planet;

  // The climate fields, behind the first globe: until the deep past's runs come the land is drawn from its height, and
  // the finer climates of the recent past come a span of keyframes at a time, as the time shown reaches them.
  let climateRule: (ClimateRule & { reef_depth: number; reef_latitude: number }) | null = null;
  let climateReady = !ts.files.climate;
  let climateData: ClimateData | null = null;
  const climates = new Climates(build, field, () => {
    cubeKey = '';
    dirty = true;
  });
  if (ts.files.climate) {
    void getBytes(build.base + ts.files.climate).then((data) => {
      const { header, arrays } = decodeTile<ClimateHeader>(data);
      climateData = { header, arrays };
      climates.setDeep(ts.climate?.field ?? 'field:earth/climate', ts.climate?.title ?? 'Climate', header, arrays);
      globe.climateCubes = [field.climateCubes![0].texture, field.climateCubes![1].texture];
      climateRule = header.rule as ClimateRule & { reef_depth: number; reef_latitude: number };
      climateReady = true;
      cubeKey = '';
      dirty = true;
    });
  }

  // The ice sheets, behind the first globe too: where the field covers the time, they take the place of
  // a claimed latitude of ice. A byte per node is what the panel reads as well.
  let iceFile: { header: IceHeader; arrays: TypedArray[]; ages: number[] } | null = null;
  let iceReady = !ts.files.ice;
  let iceKey = '';
  if (ts.files.ice) {
    void getBytes(build.base + ts.files.ice).then((data) => {
      const { header, arrays } = decodeTile<IceHeader>(data);
      field.setIce(header.grid, arrays[header.plate] as Uint16Array, header.scenarios.flatMap((s) => s.keyframes.map((k) => ({ key: k.margin, margin: arrays[k.margin] as Uint8Array, thickness: arrays[k.thickness] as Uint8Array }))));
      globe.iceCube = field.iceCube!.texture;
      iceFile = { header, arrays, ages: header.scenarios[0].keyframes.map((k) => k.ageMa).sort((a, b) => a - b) };
      iceReady = true;
      iceKey = '';
      dirty = true;
    });
  }

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
  const fossils = new FossilLayer();
  stage.appendChild(fossils.el);
  // Today's map and the hazards of the time shown: rows of a dataset, drawn on canvases of their own.
  const present = new PresentLayer();
  const hazards = new HazardLayer();
  const polities = new PolityLayer();
  // Fields of points, lines and areas: one renderer for all, as their records say (docs/STRUCTURE.md section 3.6).
  const fieldLayers = (ts.layers ?? []).map((info) => new FieldLayer(info, build.base));
  for (const fl of fieldLayers) fl.onLoad = () => (dirty = true);
  const fieldOn = (fl: FieldLayer) => !fl.info.style.toggle || !!state.layers?.includes(fl.info.style.toggle.key);
  const fieldLayer = (id: string) => fieldLayers.find((fl) => fl.info.field === id);
  // The rivers and lakes of the time shown, when asked for: over the states' colours, under the roads and today's map.
  const rivers = ts.rivers ? new Rivers(build, () => (dirty = true)) : null;
  const riversLayer = rivers ? new RiversLayer(rivers, build.model) : null;
  const riversOn = () => !!state.layers?.includes(RIVERS_TOGGLE.key);
  stage.append(polities.el, ...(riversLayer ? [riversLayer.el] : []), ...fieldLayers.filter((fl) => fl.info.kind !== 'points').map((fl) => fl.el), present.el, ...fieldLayers.filter((fl) => fl.info.kind === 'points').map((fl) => fl.el), hazards.el);
  // Where people lived goes to the globe's shader, and loads when it is first asked for.
  const people = new PeopleLayer();
  let peopleLoading = false;
  // The grid of people is fetched once, for the layer and for the scenes' people alike.
  let peopleFileP: Promise<PeopleFile | null> | null = null;
  const peopleFile = () =>
    (peopleFileP ??= ts.files.people
      ? getBytes(build.base + ts.files.people).then((data) => {
          const { header, arrays } = decodeTile<PeopleHeader>(data);
          return { ...header, cell: arrays[0] as Uint32Array, land: arrays[1] as Uint32Array, people: arrays[2] as Uint32Array } as PeopleFile;
        })
      : Promise.resolve(null));
  const wantPeople = () => {
    if (peopleLoading || !ts.files.people) return;
    peopleLoading = true;
    void peopleFile().then((f) => {
      if (f) people.setFile(f);
      dirty = true;
    });
  };
  // The anonymous human landscape (docs/HUMAN-LANDSCAPE.md): what kind of place any land was, what people a scene draws,
  // and the globe's picture of it, which its toggle draws.
  const landscape = ts.files.landscape ? new LandscapeAtlas(build.base, ts.files.landscape, peopleFile) : null;
  const LANDSCAPE_TOGGLE = { key: 'landscape', label: 'Settlement', title: 'How people lived: the anthromes of HYDE, from wildlands to cities' };
  const landscapeOn = () => !!landscape && !!state.layers?.includes(LANDSCAPE_TOGGLE.key);
  if (landscape) void landscape.loadIndex().then(() => (dirty = true));
  const landscapeLegend = document.createElement('div');
  landscapeLegend.className = 'landscape-legend';
  landscapeLegend.hidden = true;
  let landscapeStep: number | null = null;
  let landscapeLoading = false;
  /** The globe's picture of the human landscape at the step nearest a time: made again only when the step changes. */
  const drawLandscape = (t: number): boolean => {
    if (!landscape || !landscape.index) return false;
    const i = nearestStep(landscape.index.steps, t);
    if (i < 0) return false;
    if (!landscape.globe) {
      if (!landscapeLoading) {
        landscapeLoading = true;
        void landscape.loadGlobe().then(() => (dirty = true));
      }
      return false;
    }
    if (landscapeStep !== i) {
      const g = landscape.globe;
      const map = new Uint8Array(g.nx * g.ny);
      for (let c = 0; c < map.length; c++) map[c] = classAtStep(g, c, i);
      globe.setAnthromes(g.nx, g.ny, map, [[0, 0, 0], ...landscape.index.classes.map((k) => k.rgb)]);
      landscapeStep = i;
      // The legend: the classes present, by their level.
      const present = new Set(map);
      landscapeLegend.innerHTML = `<div class="pl-title"><span>${landscape.index.title}, ${stepName(landscape.index.steps[i])}</span> <span class="badge basis-reconstruction">reconstruction</span></div><div class="ll-items">${landscape.index.classes
        .map((k, n) => (present.has(n + 1) && k.code !== 70 ? `<span class="ll-item"><i style="background:rgb(${k.rgb.join(',')})"></i>${k.label}</span>` : ''))
        .join('')}</div>`;
    }
    return true;
  };
  // The states of the world are the heaviest of these: loaded when a time first shows them.
  let politiesLoading: Promise<void> | null = null;
  let politiesReady = !ts.files.polities;
  const wantPolities = () => {
    if (politiesLoading || !ts.files.polities) return;
    politiesLoading = getJSON<PolitiesFile>(build.base + ts.files.polities).then((f) => {
      polities.file = f;
      politiesReady = true;
      dirty = true;
    });
  };
  let layersReady = !ts.files.present && !ts.files.hazards;
  // What overlays say of rows of datasets, for the panel of a row that is clicked.
  let overlays: OverlaysFile | null = null;
  if (ts.files.overlays) void getJSON<OverlaysFile>(build.base + ts.files.overlays).then((f) => (overlays = f));
  const rowInfo = (row: { row?: string; corrected?: string[] }, dataset?: string, key?: string): RowInfo | undefined => {
    const ref = row.row ?? (dataset && key ? `${dataset}#${encodeRowKey(key)}` : undefined);
    return ref ? { ref, corrected: row.corrected, overlay: overlays?.rows[ref] } : undefined;
  };
  void Promise.all([ts.files.present ? getJSON<PresentFile>(build.base + ts.files.present) : null, ts.files.hazards ? getJSON<HazardFile>(build.base + ts.files.hazards) : null]).then(([p, h]) => {
    present.file = p;
    hazards.file = h;
    layersReady = true;
    dirty = true;
  });
  stage.appendChild(markers.el);
  // The tree of life loads when it is first wanted: when it is opened, or a taxon is chosen.
  const treePanel = new TreePanel();
  stage.appendChild(treePanel.el);
  let treeFile: TreeFile | null = null;
  let treeLoading = false;
  let litFor: string | null = null;
  let litMarkers: ReadonlySet<string> | null = null;
  const taxonKind = (id: string | null) => !!id && build.search.entities.find((e) => e.id === id)?.kind === 'taxon';
  function wantTree(): void {
    if (treeFile || treeLoading || !ts.files.tree) return;
    treeLoading = true;
    void getJSON<TreeFile>(build.base + ts.files.tree).then((f) => {
      treeFile = f;
      treePanel.setFile(f);
      treeLoading = false;
      litFor = null;
      dirty = true;
    });
  }
  /** Light up the fossils of the group chosen, on the globe and along the time control. */
  function lightGroup(): void {
    const id = state.sel && treeFile && taxonKind(state.sel) ? state.sel : null;
    if (id === litFor) return;
    litFor = id;
    const i = id ? treePanel.nodeOf(id) : undefined;
    if (i === undefined || !treeFile) {
      fossils.set(null, null);
      litMarkers = null;
      timebar.setLit([]);
      return;
    }
    const nodes = new Set(subtree(indexTree(treeFile.nodes), i));
    fossils.set(treeFile, nodes);
    const records = treeFile.members.filter((m) => nodes.has(m.taxon));
    litMarkers = new Set(records.map((m) => m.entity));
    void features.load(litMarkers).then(() => {
      if (litFor !== id) return;
      const times = records.map((m) => features.get(m.entity)?.time.start.best).filter((x): x is number => typeof x === 'number');
      timebar.setLit([...fossils.times(), ...times].sort((a, b) => a - b));
      dirty = true;
    });
  }
  // The sites: each one's scene loads as the camera comes near it, or at once if a link starts there.
  // The site is the one the view is at: of those drawn for the time shown, the one the camera is near;
  // otherwise whichever it is nearest.
  const sites: SiteInfo[] = ts.sites ?? [];
  const scenes = new Map<string, CityScene | LifeScene>();
  const loadingScenes = new Set<string>();
  /** Scenes that could not be made, and why, said while the camera is at them. */
  const failedScenes = new Map<string, string>();
  let site: SiteInfo | undefined;
  let city: CityScene | LifeScene | null = null;
  let labelledSite: string | null = null;
  // Anywhere else on land, at any time the atlas covers: a scene the browser makes as it is wanted.
  const lifeAtlas = build.atlas ? new LifeAtlas(build, build.atlas, () => (climateData && climateRule ? { data: climateData, rule: climateRule } : null), build.atlas.generator, build.planet, build.model, coastOf) : null;
  /** the scene of the place the camera is over, and the one being made to take its place */
  let lifeSite: SiteInfo | null = null;
  let lifeLoading: string | null = null;
  let lifeRest = 0;
  let lifeKey = '';
  /** a place with no land under it, or nothing to draw: not asked again until the view moves */
  const lifeEmpty = new Set<string>();
  const labels = new CityLabels();
  // A name that belongs to a record opens it; one that is only a row of a database says what the row says.
  labels.onSelect = (id) => {
    // In a living scene a name is of something standing here: it opens where it is, at the time shown.
    if (!(city instanceof LifeScene)) return goTo(id);
    if (!id.startsWith('txn:')) return setState({ sel: id });
    const info = organismInfo(id);
    if (!info) return;
    setState({ sel: null });
    shownRecord = null;
    inspect.showOrganism(info.taxon, info, organismSource(info));
  };
  labels.el.hidden = true;
  stage.appendChild(labels.el);
  const cityBar = document.createElement('div');
  cityBar.className = 'citybar';
  cityBar.hidden = true;
  cityBar.innerHTML = `<label title="The hour of the day">Light <input type="range" min="${HOURS[0]}" max="${HOURS[1]}" step="0.05" aria-label="Hour of the day" /></label><label class="life-month" hidden title="The month the land is drawn in: its snow and the sun's height. Unless one is chosen, the place's warmest month">Month <select aria-label="Month of the year"><option value="">warmest</option>${MONTH_NAMES.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('')}</select></label><button class="life-here" hidden title="What the records say lived here, and how sure that is"></button><button class="life-go" hidden title="Go down to where something of each is standing">Go and see</button><button class="to-globe" title="Back out to the whole Earth">Globe</button><button class="city-help" aria-expanded="false" aria-label="How to move about" title="${MOUSE_HELP}">?</button><p class="city-tips" hidden></p>`;
  stage.appendChild(cityBar);
  const cityEnter = document.createElement('button');
  cityEnter.className = 'city-enter';
  cityEnter.hidden = true;
  stage.appendChild(cityEnter);
  let frameView: LocalView | null = null;
  const credits = document.createElement('details');
  credits.className = 'credits';
  const creditsTitle = document.createElement('summary');
  creditsTitle.textContent = 'Data and licences';
  credits.append(creditsTitle, ts.credits.map((c) => `${c.label}, ${c.license}`).join(' · '));
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
    onClose: () => closePanel(),
    onOpen: (id) => setState({ sel: id }),
    labelOf,
    altTitle,
  });
  stage.appendChild(inspect.el);
  /** Close the panel. One that is not a record's (the ground, a row of a dataset, a series) has no selection to clear. */
  const closePanel = () => {
    if (!state.sel) inspect.hide();
    setState({ sel: null });
  };

  const top = document.createElement('div');
  top.className = 'topbar';
  const brand = document.createElement('div');
  brand.className = 'brand';
  // Named for the span the build covers: the finest named period at its start, to its end.
  const named = (t: number) => ['period', 'era', 'eon'].map((rank) => build.periods.periods.find((p) => p.rank === rank && p.start <= t && t <= p.end)).find(Boolean);
  const until = dataRange[1] > PRESENT_YEAR ? formatTime(dataRange[1]) : 'today';
  brand.innerHTML = `<strong>WikiWorldModel</strong><span>${named(dataRange[0])?.name ?? formatTime(dataRange[0])} to ${until}</span><a class="coverage-link" title="How much of the world each layer knows, across time and the globe">How much is known →</a>`;
  brand.querySelector<HTMLAnchorElement>('.coverage-link')!.href = `./coverage.html?b=${encodeURIComponent(build.id)}`;
  const search = new Search(build.search, build.periods.periods, kindLabel);
  const toolbar = new Toolbar(build.id, ts.alternatives, ts.layers ?? []);
  // The rivers' toggle sits with the fields' and is kept as theirs are, by its key in the link's `ly=`: the toolbar
  // lights it with them.
  if (riversLayer) {
    const b = document.createElement('button');
    b.className = `tg-${RIVERS_TOGGLE.key} tg-layer`;
    b.dataset.layer = RIVERS_TOGGLE.key;
    b.setAttribute('aria-pressed', 'false');
    b.title = riversLayer.title;
    b.textContent = RIVERS_TOGGLE.label;
    b.onclick = () => {
      const layers = state.layers ?? [];
      setState({ layers: (riversOn() ? layers.filter((k) => k !== RIVERS_TOGGLE.key) : [...layers, RIVERS_TOGGLE.key]).sort() });
    };
    toolbar.el.querySelector('.tg-people')!.before(b);
  }
  if (landscape) {
    const b = document.createElement('button');
    b.className = `tg-${LANDSCAPE_TOGGLE.key} tg-layer`;
    b.dataset.layer = LANDSCAPE_TOGGLE.key;
    b.setAttribute('aria-pressed', 'false');
    b.title = LANDSCAPE_TOGGLE.title;
    b.textContent = LANDSCAPE_TOGGLE.label;
    b.onclick = () => {
      const layers = state.layers ?? [];
      setState({ layers: (landscapeOn() ? layers.filter((k) => k !== LANDSCAPE_TOGGLE.key) : [...layers, LANDSCAPE_TOGGLE.key]).sort() });
    };
    toolbar.el.querySelector('.tg-people')!.before(b);
  }
  // On a phone the toggles fold away behind a button, with the world's name and the way to how much of it is known.
  const menu = document.createElement('button');
  menu.className = 'menu-toggle';
  menu.setAttribute('aria-expanded', 'false');
  menu.setAttribute('aria-label', 'Layers and options');
  menu.title = 'Layers and options';
  menu.innerHTML = '<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><path class="bars" d="M3 5.5h14M3 10h14M3 14.5h14"/><path class="cross" d="M5 5l10 10M15 5 5 15"/></svg>';
  const about = brand.cloneNode(true) as HTMLElement;
  about.className = 'menu-about';
  toolbar.el.prepend(about);
  const openMenu = (open: boolean) => {
    top.classList.toggle('menu-open', open);
    menu.setAttribute('aria-expanded', String(open));
  };
  menu.onclick = () => openMenu(!top.classList.contains('menu-open'));
  top.append(brand, search.el, menu, toolbar.el);
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
  timebar.setKeyframes([...new Set([...ts.fields.flatMap((f) => f.keyframesMa), ...(ts.ice?.keyframesMa ?? [])])].map(fromMa));
  timebar.setRecords(build.search.entities.filter((e) => e.kind !== 'plate' && !cityKind(e.kind) && !e.bulk));
  timebar.setScenario(scenario());
  timebar.setStates(stateBands(scenario()));
  root.appendChild(timebar.el);

  const planet = new PlanetPanel(build.series.series, earth?.label);
  planet.onOpen = (id) => showSeries(id);
  planet.onRecord = (id) => setState({ sel: id });
  stage.appendChild(planet.el);
  // The legend is over the markers, as the planet's panel is.
  stage.appendChild(people.el);
  stage.appendChild(landscapeLegend);
  const notice = document.createElement('div');
  notice.className = 'notice';
  notice.hidden = true;
  stage.appendChild(notice);
  // A link keeps the build it was made in, which this viewer may have outgrown: say so, and offer the newest.
  if (newest && newest !== build.id) {
    const older = document.createElement('div');
    older.className = 'older-build';
    const go = document.createElement('a');
    go.href = '#';
    go.textContent = 'Open this view in the newest build';
    go.onclick = (e) => {
      e.preventDefault();
      location.search = toSearch(newest, state);
    };
    older.append(`This link is to an older build, ${build.id}, and this viewer may not draw all of it. `, go);
    stage.appendChild(older);
  }

  // State.
  let dirty = true;
  // The view is drawn again whenever it changes size: with the window, and on a phone when a panel takes room from it.
  new ResizeObserver(() => (dirty = true)).observe(stage);
  let urlTimer = 0;
  let playing = false;
  let lastFrame = performance.now();
  let shownRecord: string | null = null;

  /** Is a time one the site is drawn for? */
  const siteOpen = (t: number) => !!site && t >= site.span[0] && t <= site.span[1];
  /** How far a point on the globe is from a site, in metres. */
  function distanceFrom(s: SiteInfo, lat: number, lon: number): number {
    const dLat = (lat - s.origin.lat) * RAD;
    const dLon = (lon - s.origin.lon) * RAD;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat * RAD) * Math.cos(s.origin.lat * RAD) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  const siteDistance = (lat: number, lon: number) => (site ? distanceFrom(site, lat, lon) : Infinity);
  /** The site a view is at. */
  function siteFor(t: number, cam: ViewState['cam']): SiteInfo | undefined {
    const within = (list: SiteInfo[], reach: number) => list.map((s) => ({ s, d: distanceFrom(s, cam.lat, cam.lon) })).filter((x) => x.d < reach).sort((a, b) => a.d - b.d)[0]?.s;
    const open = sites.filter((s) => t >= s.span[0] && t <= s.span[1]);
    const near = within(open, 2.2e6);
    const range = (cam.dist - 1) * EARTH_RADIUS;
    // A city, or a place with its own scene that the camera is right over, is that place. Otherwise, near the
    // ground, the scene of wherever the camera is, once there is one.
    const atPlace = !!near && (near.kind === 'city' || distanceFrom(near, cam.lat, cam.lon) < 15e3 || range > LIFE_TOP * 1.4);
    if (atPlace) return near;
    if (lifeSite && t >= lifeSite.span[0] && t <= lifeSite.span[1] && range < LIFE_TOP * 1.4) return lifeSite;
    return near ?? within(sites, 1.5e6) ?? open[0] ?? sites[0];
  }
  function atSite(t: number, cam: ViewState['cam']): void {
    site = siteFor(t, cam);
    city = site ? scenes.get(site.id) ?? null : null;
  }
  /** Is this somewhere a scene can be made? Not by a city, which has its own way down. */
  function canDrawLife(t: number, cam: ViewState['cam']): boolean {
    if (!lifeAtlas) return false;
    if (sites.some((s) => s.kind === 'city' && t >= s.span[0] && t <= s.span[1] && distanceFrom(s, cam.lat, cam.lon) < 1.4e6)) return false;
    return lifeAtlas.canDraw(t, cam.lat, cam.lon);
  }
  /** How close to the Earth a view may come here: to the street at the site, nowhere near it elsewhere. */
  function lowestDist(cam: ViewState['cam'], t: number): number {
    if (canDrawLife(t, cam)) return 1 + 2 / EARTH_RADIUS;
    if (!siteOpen(t)) return MIN_DIST;
    const d = siteDistance(cam.lat, cam.lon);
    if (d > 1.4e6) return MIN_DIST;
    if (d < 7e4) return 1 + 2 / EARTH_RADIUS;
    return 1 + (((MIN_DIST - 1) * EARTH_RADIUS) * ((d - 7e4) / 1.33e6) ** 1.2) / EARTH_RADIUS + 3e3 / EARTH_RADIUS;
  }

  function setState(p: Partial<ViewState>): void {
    const next = quantize({ ...state, ...p });
    next.t = Math.max(dataRange[0], Math.min(dataRange[1], next.t));
    atSite(next.t, next.cam);
    // A time the site is not drawn for takes the camera back up to the globe.
    if (next.cam.dist < MIN_DIST && !siteOpen(next.t) && !canDrawLife(next.t, next.cam)) next.cam = { lat: next.cam.lat, lon: next.cam.lon, dist: MIN_DIST };
    const selChanged = next.sel !== state.sel;
    const altsChanged = JSON.stringify([next.alt, next.picks]) !== JSON.stringify([state.alt, state.picks]);
    state = next;
    if (altsChanged) {
      timebar.setScenario(scenario());
      timebar.setStates(stateBands(scenario()));
      for (const scene of scenes.values()) scene.setScenario(scenario());
    }
    dirty = true;
    clearTimeout(urlTimer);
    urlTimer = window.setTimeout(() => history.replaceState(null, '', toSearch(build.id, state)), 120);
    if (selChanged || altsChanged) void showSelection();
    if (state.tree || taxonKind(state.sel)) wantTree();
    treePanel.el.hidden = !state.tree;
  }

  async function showSelection(): Promise<void> {
    const id = state.sel;
    if (!id) {
      shownRecord = null;
      inspect.hide();
      return;
    }
    const [r] = await Promise.all([loadRecord(build, id), features.load([id]), scenarioKey(scenario()) ? features.wantVariants() : undefined, wantWhere()]);
    if (state.sel !== id) return;
    const f = features.get(id);
    shownRecord = id;
    const inside = here?.entity === id ? { ...here.info, source: r.sources[here.source] } : undefined;
    inspect.showEntity(r, scenario(), f ? timeFor(f, scenario()) : recordTime(r, scenario()), inside, organismInfo(id));
  }

  /** Where to go to see each taxon: small, and only wanted once a record is open. */
  let lifeWhere: Record<string, AtlasWhere> | null = null;
  let whereLoading: Promise<void> | null = null;
  function wantWhere(): Promise<void> | undefined {
    if (!build.atlas || lifeWhere) return undefined;
    whereLoading ??= getJSON<Record<string, AtlasWhere>>(build.base + build.atlas.where).then((w) => {
      lifeWhere = w;
    });
    return whereLoading;
  }
  /** A taxon to show when the scene of where it lived has come. */
  let arriving: string | null = null;
  inspect.seeIt = (id) => {
    const w = lifeWhere?.[id];
    if (!w) return undefined;
    return {
      label: `See it where it lived, ${formatTime(w.t)}`,
      go: () => {
        arriving = id;
        const span = Math.max(2e6, Math.abs(w.t) * 0.4);
        setState({ t: w.t, window: clampWindow([w.t - span, w.t + span], limits) });
        flyTo({ lat: w.lat, lon: w.lon, dist: 1 + 1800 / EARTH_RADIUS, heading: 0, tilt: 60 }, 3600);
      },
    };
  };

  /** Which atlas a living scene's list is from: the sea's, where the land's has none for its place. */
  const listOf = (c: LifeScene): 'land' | 'sea' => (lifeAtlas?.fromSea(c.spec) ? 'sea' : 'land');

  /** What a living scene has of a taxon: what the records say of it there, and what was invented. */
  function organismInfo(id: string): OrganismHere | undefined {
    const c = city instanceof LifeScene ? city : [...scenes.values()].find((x): x is LifeScene => x instanceof LifeScene);
    const t = c?.taxonOf(id);
    if (!c || !t) return undefined;
    const g = c.spec.generator;
    // A genus of the sea's list rests on the sea's fossils, and is near or far by sea.
    const sea = listOf(c) === 'sea' && !!build.sea;
    const fossils = sea ? { ...c.spec.fossils, source: build.sea!.source, title: build.sea!.title } : c.spec.fossils;
    return { taxon: t, site: c.spec.site.place ? c.spec.site.label : 'this place', slice: c.spec.site.slice, stage: c.spec.site.stage, fossils, generator: `${g.generator}, version ${g.version}, seed "${g.seed}"`, ...(sea ? { sea: true } : {}) };
  }
  /** The source a taxon of a living scene is a row of: the sea's fossils, or the land's. */
  const organismSource = (o: OrganismHere | undefined) => (o?.sea ? build.sea?.sourceRecord : build.atlas?.sourceRecord);

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
    if (!cloudSpec && t.header.generators.length) {
      cloudSpec = t.header.generators.find((g) => g.generator === CLOUDS) ?? null;
      if (cloudSpec) void makeClouds(cloudSpec).catch((e) => {
        console.error(`the clouds generator failed: ${(e as Error).message}`);
        cloudsReady = true;
      });
    }
    if (!surfaceSpec && t.header.generators.length) {
      surfaceSpec = t.header.generators.find((g) => g.generator === SURFACE) ?? null;
      if (surfaceSpec) void makeSurface(surfaceSpec).catch((e) => {
        console.error(`the surface generator failed: ${(e as Error).message}`);
        surfaceReady = true;
      });
    }
    if (!genericSpec && t.header.generators.length) {
      genericSpec = t.header.generators.find((g) => g.generator === GENERIC_LAND) ?? null;
      if (genericSpec) void makeGenericLand(genericSpec).catch((e) => {
        console.error(`the generic land generator failed: ${(e as Error).message}`);
        genericReady = true;
      });
      else genericReady = true;
    }
    if (!biomeSpec && t.header.generators.length) {
      biomeSpec = t.header.generators.find((g) => g.generator === BIOME_TEXTURE) ?? null;
      if (biomeSpec) void makeBiomeTexture(biomeSpec).catch((e) => {
        console.error(`the biome texture generator failed: ${(e as Error).message}`);
        biomeTexReady = true;
      });
      else biomeTexReady = true;
    }
    if (state.sel && !shownRecord) void showSelection();
    dirty = true;
  };
  tiles.onEvict = (t) => {
    const g = gpuTiles.get(t.ref.id);
    if (g) field.removeTile(g);
    gpuTiles.delete(t.ref.id);
  };

  // The globe's generators run in a worker, as every generator in the viewer does.
  let globeWorker: Worker | null = null;
  let globeAsked = 0;
  const globeWaiting = new Map<number, { resolve: (b: Uint8Array) => void; reject: (e: Error) => void }>();
  function generate(spec: GeneratorConstraint): Promise<Uint8Array> {
    if (!globeWorker) {
      globeWorker = new Worker(new URL('./gl/globeworker.ts', import.meta.url), { type: 'module' });
      globeWorker.onmessage = (e: MessageEvent<FromGlobeWorker>) => {
        const m = e.data;
        const w = globeWaiting.get(m.id);
        globeWaiting.delete(m.id);
        if ('bytes' in m) w?.resolve(m.bytes);
        else w?.reject(new Error(m.error));
      };
    }
    const id = ++globeAsked;
    return new Promise((resolve, reject) => {
      globeWaiting.set(id, { resolve, reject });
      globeWorker!.postMessage({ id, generator: spec.generator, seed: spec.seed, params: spec.params } satisfies ToGlobeWorker);
    });
  }

  async function makeClouds(spec: GeneratorConstraint): Promise<void> {
    const p = spec.params as unknown as CloudParams;
    const density = await generate(spec);
    globe.setClouds(p.width, p.height, density);
    clouds.expected = spec.output;
    const problems = settlePrint(clouds, bytesPrint('pixels', density));
    if (problems.length) console.error(`the clouds generator's output differs from the build's: ${problems.join('; ')}`);
    cloudsReady = true;
    dirty = true;
  }

  async function makeSurface(spec: GeneratorConstraint): Promise<void> {
    const p = spec.params as unknown as SurfaceParams;
    const rgba = await generate(spec);
    globe.setPattern(p.width, p.height, rgba);
    surface.expected = spec.output;
    const problems = settlePrint(surface, bytesPrint('pixels', rgba));
    if (problems.length) console.error(`the surface generator's output differs from the build's: ${problems.join('; ')}`);
    surfaceReady = true;
    dirty = true;
  }

  async function makeBiomeTexture(spec: GeneratorConstraint): Promise<void> {
    const p = spec.params as unknown as BiomeTextureParams;
    const rgba = await generate(spec);
    globe.setBiomeTexture(p.size, rgba);
    biomeTexture.expected = spec.output;
    const problems = settlePrint(biomeTexture, bytesPrint('pixels', rgba));
    if (problems.length) console.error(`the biome texture generator's output differs from the build's: ${problems.join('; ')}`);
    biomeTexReady = true;
    dirty = true;
  }

  async function makeGenericLand(spec: GeneratorConstraint): Promise<void> {
    const p = spec.params as unknown as GenericLandParams;
    const mask = await generate(spec);
    genericMask = { mask, params: p };
    globe.setGenericLand(p.width, p.height, mask);
    genericLand.expected = spec.output;
    const problems = settlePrint(genericLand, bytesPrint('pixels', mask));
    if (problems.length) console.error(`the generic land generator's output differs from the build's: ${problems.join('; ')}`);
    genericReady = true;
    dirty = true;
  }

  /** The energy-balance model's answer for the climate where no climate model's run covers the time: its freezing threshold. */
  const freezing = build.series.series.find((x) => x.rule?.name === 'energy-balance-freeze');
  const energyBalance: ResolveWorld['climateModel'] = freezing?.points.length
    ? { span: [freezing.points[0][0], freezing.points.at(-1)![0]], freezeBelow: (t) => valueAt(freezing, t)?.value ?? null }
    : undefined;

  /** What resolve reads in the viewer: what has loaded so far (core/resolve.ts). */
  function resolveWorld(): ResolveWorld {
    const span = climates.spanMa();
    return {
      planet: build.planet,
      geography: ts.fields.map((f) => ({ title: f.title, mode: f.mode, coverage: f.coverage })),
      climate: span ? [fromMa(span[0]), fromMa(span[1])] : undefined,
      climateModel: energyBalance,
      ice: ts.ice?.coverage,
      people: people.file ? [people.file.steps[0], people.file.steps.at(-1)!] : undefined,
      landscape: landscape?.resolver(),
      polities: polities.file?.rows.length ? [Math.min(...polities.file.rows.map((r) => r.from)), Math.max(...polities.file.rows.map((r) => r.to))] : undefined,
      polity: polities.file ? (lat, lon) => polities.at(lon, lat)?.name : undefined,
      genericLand: genericMask ? (lat, lon) => genericLandAt(genericMask!.mask, genericMask!.params, lat, lon) : undefined,
      water: ts.rivers && rivers
        ? {
            observed: ts.rivers.observed ? { span: ts.rivers.observed.span, at: (lat, lon) => rivers.seenAt(lat, lon) } : undefined,
            model: ts.rivers.sets.map((x) => x.span),
          }
        : undefined,
    };
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
      q = plateIds.map((id) => (id === 0 ? ([1, 0, 0, 0] as Quat) : build.plates.total(id, ageMa)));
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
  /** the climate's mix between the keyframes drawn, while the land is painted from it */
  let frameClimateMix: number | null = null;
  /** which climate the land is painted from, while it is */
  let frameClimate: ClimateAt | null = null;
  /** the keyframes of the ice sheets drawn and the mix between them, and the age they are moved to, where a field has them */
  let frameIce: { younger: number; older: number; mix: number; ageMa: number } | null = null;
  /** where people lived was drawn in the frame */
  let peopleDrawn = false;


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
    maintainLife();
    arriveIfReady();
    lookIfDown();
    const made = site === lifeSite && !!lifeSite;
    const top = made ? LIFE_TOP : CITY_TOP;
    const solidAt = made ? LIFE_SOLID : CITY_SOLID;
    const wantsCity = !!site && siteOpen(state.t) && range < top * 1.4 && siteDistance(state.cam.lat, state.cam.lon) < 1.6e6;
    // Loaded before it is needed: as soon as the way down is on offer.
    if (site && !made && siteOpen(state.t) && state.cam.dist < 2.2 && siteDistance(state.cam.lat, state.cam.lon) < 2e6 && !city && !loadingScenes.has(site.id)) void loadScene(site);
    const inCity = wantsCity && !!city?.ready && range < top;
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
      const c = fi.mode === 'elevation' ? climates.at(age) : null;
      const key = `${state.t}|${fi.id}|${drawn.map((d) => d.id).join(',')}|${c ? `${c.k0.key},${c.k1.key}` : ''}`;
      if (key !== cubeKey && drawn.length) {
        const now = totalsAt(age);
        field.render(k0, k1, deltas(now, totalsAt(k0)), deltas(now, totalsAt(k1)), drawn);
        // Each keyframe of the climate moves from the coordinates its nodes are on: its own age's, or today's.
        if (c) field.renderClimate(c.k0.key, c.k1.key, deltas(now, totalsAt(c.k0.frameMa)), deltas(now, totalsAt(c.k1.frameMa)));
        cubeKey = key;
      }
    } else cubeKey = `${state.t}|none`;
    const climateNow = fi?.mode === 'elevation' ? climates.at(age) : null;
    frameClimateMix = climateNow?.mix ?? null;
    frameClimate = climateNow;
    frameMix = mix;
    frameField = fi;
    const look = lookAt(build.planet, state.t, scenario());
    // Where a field has the ice sheets, they replace any claimed latitude of ice.
    const iceCovers = !!ts.ice && fi?.mode === 'elevation' && state.t >= ts.ice.coverage[0] && state.t <= ts.ice.coverage[1];
    if (iceCovers) {
      look.iceReach = 90;
      look.ice = null;
    }
    const iceNow = iceCovers && iceFile ? iceKeysAt(iceFile.ages, age) : null;
    frameIce = iceNow ? { ...iceNow, ageMa: age } : null;
    if (iceNow) {
      const { header } = iceFile!;
      const drawn = iceScenario(header, state.alt);
      const a = iceFrame(header, drawn, iceNow.younger);
      const b = iceFrame(header, drawn, iceNow.older);
      // The plates move about 50 m in 500 years, so it is not worth moving the ice for every time shown.
      const key = `${a.margin}|${b.margin}|${Math.round(age * 2e3)}`;
      if (key !== iceKey) {
        field.renderIce(a.margin, b.margin, deltas(totalsAt(age), totalsAt(0)));
        iceKey = key;
      }
    }
    frameLook = look;
    const why = (site && failedScenes.get(site.id)) || (!look.formed ? beforeWhy() : fi ? '' : unknownWhy(state.t));
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
    if (state.people) {
      wantPeople();
      if (people.update(state.t)) globe.setPeople(people.nx, people.ny, people.levels);
    }
    peopleDrawn = !!state.people && people.holds(state.t) && fi?.mode === 'elevation' && look.formed;
    const anthromesDrawn = landscapeOn() && fi?.mode === 'elevation' && look.formed && drawLandscape(state.t);
    landscapeLegend.hidden = !anthromesDrawn || !cityBar.hidden;
    if (!globeHidden) globe.render(
      {
        viewProj: camera.viewProj,
        invViewProj: camera.invViewProj,
        eye,
        sun,
        mix,
        evidence: state.evidence ? 1 : 0,
        coast: coastOf(fi, state.t),
        mode: !fi ? 2 : fi.mode === 'blocks' ? 1 : 0,
        res: fi?.res_deg ?? 1,
        look: globeLook(look, (surfaceSpec?.params as unknown as SurfaceParams | undefined)?.draw, coverAt(build.planet, state.t, scenario())),
        showClouds: state.clouds && cloudsReady,
        territory: { on: showTerritory, colors: TERRITORY_COLORS, selected: territory.channelOf(state.sel) },
        climate: climateNow && climateRule ? { mix: climateNow.mix, rule: climateRule } : undefined,
        ice: iceNow ? { mix: iceNow.mix } : undefined,
        people: peopleDrawn,
        anthromes: anthromesDrawn,
        drift: cloudDrift,
      },
      w,
      h,
    );
    frameView = null;
    if (inCity) {
      // A scene of the sea lets the eye down through its surface, to near its floor.
      const v = localView(state.cam, site!.origin, city!.ground, stage.clientWidth, stage.clientHeight, city instanceof LifeScene && city.sea ? 0 : undefined);
      // The scene's own frame, its pixel size in device pixels.
      v.width = stage.clientWidth;
      v.height = stage.clientHeight;
      frameView = v;
      const t0 = 1 - Math.max(0, Math.min(1, (range - solidAt) / (top - solidAt)));
      const alpha = t0 * t0 * (3 - 2 * t0);
      city!.select(state.sel);
      city!.render(v, sunAt(state.hour, site!.origin.lat, city instanceof LifeScene ? city.declination : undefined), state.t, state.evidence, alpha, globeHidden, w, h);
      const labelKey = `${site!.id}|${city instanceof LifeScene ? city.labelSerial : 0}`;
      if (labelledSite !== labelKey) {
        labels.setStructures(city!.named, city!.tops, site!.label, (s) => s.label);
        labelledSite = labelKey;
      }
      // Under the sea a name is given only to what the water lets one see.
      const seen = city instanceof LifeScene && city.sea ? (x: number, y: number, z: number) => underSea(v.eye, [x, y, z]) < SEEN_THROUGH_WATER : undefined;
      labels.update(v, city!.ground, city!.skyline, state.t, state.sel, seen);
    }
    labels.el.hidden = !inCity || range > 2.2e4;
    planet.el.hidden = inCity && range < 6e4;
    credits.classList.toggle('in-city', inCity && range < 6e4);
    cityBar.hidden = !inCity || range > CITY_SOLID;
    people.el.hidden = !state.people || !people.file || !cityBar.hidden;
    if (state.people) people.legend(state.t);
    canvas.classList.toggle('in-city', inCity);
    if (inCity) cityBar.querySelector<HTMLInputElement>('input')!.value = String(state.hour);
    // A scene whose climate is known at its heights has a month.
    const monthLabel = cityBar.querySelector<HTMLLabelElement>('.life-month')!;
    monthLabel.hidden = !(inCity && city instanceof LifeScene && city.spec.climate);
    if (!monthLabel.hidden) {
      const sel = monthLabel.querySelector('select')!;
      const want = state.month ? String(state.month) : '';
      if (sel.value !== want) sel.value = want;
      sel.options[0].textContent = `warmest (${MONTH_NAMES[warmestMonth((city as LifeScene).spec.climate!.months) - 1]})`;
    }
    // What lives here, and how sure that is, where a scene is of a place with no formation of its own.
    const showHere = inCity && city instanceof LifeScene && !city.spec.site.place;
    lifeHere.hidden = !showHere;
    lifeGo.hidden = !showHere || !(city as LifeScene).spec.taxa.length;
    if (showHere) {
      const taxa = (city as LifeScene).spec.taxa;
      const n = (tier: string) => taxa.filter((x) => x.tier === tier).length;
      // In the sea as on land; where none of what lived in a sea can be drawn yet, it says so.
      const life = taxa.length ? `${n('here')} recorded here, ${n('region')} nearby, ${n('standin')} stand-ins` : (city as LifeScene).sea ? 'Nothing of the sea’s life can be drawn here yet' : 'Nothing recorded here';
      // And who lived here, where the scene has people.
      const folk = (city as LifeScene).people;
      const words = folk ? `${life} · ${peopleWords(folk)}` : life;
      if (lifeHere.textContent !== words) lifeHere.textContent = words;
    }
    const enter = !!site && !made && !inCity && state.cam.dist < 2.2 && siteDistance(state.cam.lat, state.cam.lon) < 1.5e6;
    cityEnter.hidden = !enter;
    if (enter) cityEnter.textContent = `Fly down into ${site!.label}, ${formatTime(site!.slice)}`;
    if (inCity && site!.kind === 'city') {
      const slice = site!.slice;
      const why = state.t < -200 || state.t > 700 ? `${site!.label}'s ordinary housing is generated for ${formatTime(slice)}; what stands here at this date is only what the records and the map date to it.` : '';
      if (why && notice.textContent !== why) notice.textContent = why;
      notice.hidden = !why;
    }

    lightGroup();
    treePanel.update({ t: state.t, window: state.window, scenario: scenario(), selected: state.sel });
    const nowTotals = new Map<number, Quat>();
    const plateNow = (plate: number) => {
      let q = nowTotals.get(plate);
      if (!q) {
        q = build.model.total(plate, age);
        nowTotals.set(plate, q);
      }
      return q;
    };
    fossils.el.hidden = inCity && range < 1.2e5;
    if (!fossils.el.hidden) fossils.update(camera, state.t, stage.clientWidth, stage.clientHeight, plateNow, (plate) => !!fi && build.model.reaches(plate, age));
    const hide = inCity && range < 1.2e5;
    if (hide) {
      present.el.hidden = hazards.el.hidden = polities.el.hidden = true;
      for (const fl of fieldLayers) fl.el.hidden = true;
    }
    else {
      if (state.t < PRESENT_YEAR) wantPolities();
      // Over the people drawn, states are their outlines only.
      polities.update(camera, state.t, state.cam.dist, stage.clientWidth, stage.clientHeight, !peopleDrawn);
      for (const fl of fieldLayers) fl.update(camera, fieldOn(fl), state.t, state.cam.dist, stage.clientWidth, stage.clientHeight);
      present.update(camera, state.t, state.cam.dist, stage.clientWidth, stage.clientHeight);
      hazards.update(camera, state.t, Math.max(timebar.yearsPerPixels(state.t, 8), 0.5), stage.clientWidth, stage.clientHeight);
    }
    // Carried to the age the land is drawn at.
    riversLayer?.update(camera, riversOn() && !hide, state.t, age, state.cam.dist, stage.clientWidth, stage.clientHeight);
    if (scenarioKey(scenario())) features.wantVariants();
    const onGlobe = features.update({ t: state.t, halo: halo(state.t), ...camera.reach(), rotation: plateNow, placed: (plate) => !!fi && build.model.reaches(plate, age) }, litMarkers, state.sel);
    markers.el.hidden = inCity && range < 1.2e5;
    markers.update(onGlobe, camera, {
      t: state.t,
      halo: halo(state.t),
      evidence: state.evidence,
      scenario: scenario(),
      selected: state.sel,
      lit: litMarkers,
      closest: camera.reach().footprint === 0,
      plateRotation: plateNow,
      // Where no field covers the time, or the plate model does not reach, nothing is placed.
      placed: (plate) => !!fi && build.model.reaches(plate, age),
    });
    territory.el.hidden = !showTerritory;
    if (showTerritory) territory.place(camera, state.t, scenario(), state.sel);
    timebar.set(state.t, state.window, playing);
    planet.update(state.t, look, state.alt);
    toolbar.set({ evidence: state.evidence, clouds: state.clouds, alt: state.alt, tree: !!state.tree, layers: state.layers ?? [], people: !!state.people });
    // The folded toggles' button lights while any of them is on, so that what is drawn can be undone from it.
    menu.classList.toggle('lit', state.evidence || !state.clouds || !!state.tree || !!state.layers?.length || !!state.people || state.alt.length > 0);
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
    if (tiles.busy || features.busy) dirty = true;
  }

  // Globe interaction, and near the ground, a map's: drag the ground, turn with the right button
  // or shift, and scroll towards what the pointer is on. On a touch screen two fingers pinch towards what is between
  // them and carry the view as one finger does; near the ground they also twist to turn, or go up or down together to tilt.
  let drag: { x: number; y: number; cam: ViewState['cam']; moved: boolean; turn: boolean; slop: number } | null = null;
  /** the pointers down on the globe, where each is now */
  const pointers = new Map<number, { x: number; y: number }>();
  /** Two fingers on the globe: where they were when what they do was last applied, and what that is, once they have moved enough to say. */
  let pinch: { at: { x: number; y: number }[]; gesture: 'pinch' | 'tilt' | null } | null = null;
  /** The camera moved as a drag of (dx, dy) pixels moves it: near the ground the ground follows the pointer, and higher up the globe turns. */
  function dragged(cam: ViewState['cam'], dx: number, dy: number): ViewState['cam'] {
    const range = (cam.dist - 1) * EARTH_RADIUS;
    if (frameView && range < 6e5) {
      // The ground follows the pointer.
      const v = frameView;
      const tilt = ((cam.tilt ?? 0) * Math.PI) / 180;
      const k = (range * 2 * Math.tan(v.fov / 2)) / v.height;
      const along = (dy * k) / Math.max(0.3, Math.cos(Math.min(tilt, 1.2)));
      const h = ((cam.heading ?? 0) * Math.PI) / 180;
      const mx = -dx * k * Math.cos(h) + along * Math.sin(h);
      const my = dx * k * Math.sin(h) + along * Math.cos(h);
      const [x, y] = toLocal(site!.origin, cam.lat, cam.lon);
      const [lat, lon] = fromLocal(site!.origin, x + mx, y + my);
      return { ...cam, lat, lon };
    }
    const k = (0.22 * (cam.dist - 1)) / 2.3;
    return { ...cam, lat: cam.lat + dy * k, lon: cam.lon - dx * k };
  }
  /** Two fingers: both up or both down together tilt the view near the ground; anything else pinches, and carries the view with them. */
  function twoFingers(g: NonNullable<typeof pinch>): void {
    const [a0, b0] = g.at;
    const [a, b] = [...pointers.values()];
    if (!g.gesture) {
      const moves = [[a.x - a0.x, a.y - a0.y], [b.x - b0.x, b.y - b0.y]];
      const moved = moves.map(([x, y]) => Math.hypot(x, y));
      // Each finger's move comes on its own: it is not yet told until both have moved, or one has gone some way alone.
      if (Math.max(...moved) < 10 || (Math.min(...moved) < 4 && Math.max(...moved) < 24)) return;
      const together = moves.every(([x, y]) => Math.abs(y) > 2 * Math.abs(x)) && moves[0][1] * moves[1][1] > 0;
      g.gesture = frameView && together ? 'tilt' : 'pinch';
    }
    g.at = [{ ...a }, { ...b }];
    const mid0 = [(a0.x + b0.x) / 2, (a0.y + b0.y) / 2];
    const mid = [(a.x + b.x) / 2, (a.y + b.y) / 2];
    if (g.gesture === 'tilt') {
      // Up tilts towards the horizon, as on a map.
      const tilt = Math.max(0, Math.min(112, (state.cam.tilt ?? 0) - (mid[1] - mid0[1]) * 0.22));
      return setState({ cam: { ...state.cam, tilt } });
    }
    // Spreading the fingers comes nearer as a turn of the wheel does, towards the point between them.
    const span0 = Math.hypot(b0.x - a0.x, b0.y - a0.y);
    const span = Math.hypot(b.x - a.x, b.y - a.y);
    const box = canvas.getBoundingClientRect();
    if (span0 > 0 && span > 0 && Math.abs(span - span0) > 0.01) zoomBy(-Math.log(span / span0) / 0.0012, mid[0] - box.left, mid[1] - box.top);
    let cam = dragged(state.cam, mid[0] - mid0[0], mid[1] - mid0[1]);
    if (frameView) {
      // Near the ground the view turns with a twist, so that what is under the fingers turns with them.
      const turn = ((((Math.atan2(b.y - a.y, b.x - a.x) - Math.atan2(b0.y - a0.y, b0.x - a0.x)) * 180) / Math.PI + 540) % 360) - 180;
      cam = { ...cam, heading: (cam.heading ?? 0) - turn };
    }
    setState({ cam });
  }
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    stopFlight();
    openMenu(false);
    // The first pointer down starts afresh, whatever was missed of the last gesture.
    if (e.isPrimary) {
      pointers.clear();
      pinch = null;
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      // A second finger: the two take over from the first.
      drag = null;
      pinch = { at: [...pointers.values()].map((p) => ({ ...p })), gesture: null };
      return;
    }
    if (pointers.size > 2) return;
    // A finger wavers more than a mouse does before it means to move.
    drag = { x: e.clientX, y: e.clientY, cam: { ...state.cam }, moved: false, turn: e.button === 2 || e.shiftKey || e.altKey, slop: e.pointerType === 'mouse' ? 3 : 10 };
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX;
    p.y = e.clientY;
    if (pinch) return twoFingers(pinch);
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > drag.slop) drag.moved = true;
    // Until a finger has gone past its slop it may yet be a tap, and the view holds still under it.
    if (!drag.moved && e.pointerType !== 'mouse') return;
    if (frameView && drag.turn) {
      setState({ cam: { ...drag.cam, heading: (drag.cam.heading ?? 0) + dx * 0.28, tilt: Math.max(0, Math.min(112, (drag.cam.tilt ?? 0) + dy * 0.22)) } });
      return;
    }
    setState({ cam: dragged(drag.cam, dx, dy) });
  });
  /**
   * On a touch screen the names and markers over the view let fingers through to it (style.css), so that two fingers turn
   * and pinch wherever they fall; a tap opens the one it falls on or nearest, within a fingertip's reach.
   */
  function tappedOver(x: number, y: number): HTMLElement | null {
    let best: HTMLElement | null = null;
    let reach = 12;
    for (const el of stage.querySelectorAll<HTMLElement>('.marker, .city-label')) {
      if (el.style.display === 'none' || el.closest('[hidden]')) continue;
      for (const part of el.classList.contains('marker') ? el.querySelectorAll<HTMLElement>('.dot, .label') : [el]) {
        const r = part.getBoundingClientRect();
        if (!r.width) continue;
        const d = Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom));
        if (d < reach) [best, reach] = [el, d];
      }
    }
    return best;
  }
  /** A pointer lifted, or the browser took it away: a tap picks what is under it, and a finger left after two carries on. */
  const lift = (e: PointerEvent) => {
    if (!pointers.delete(e.pointerId)) return;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    if (pinch) {
      if (pointers.size >= 2) {
        pinch = { at: [...pointers.values()].slice(0, 2).map((p) => ({ ...p })), gesture: pinch.gesture };
        return;
      }
      pinch = null;
      // It carries on from where it is, and picks nothing when it lifts.
      const [rest] = [...pointers.values()];
      drag = rest ? { x: rest.x, y: rest.y, cam: { ...state.cam }, moved: true, turn: false, slop: 10 } : null;
      return;
    }
    const d = drag;
    drag = null;
    if (!d || d.moved || e.type !== 'pointerup') return;
    const over = e.pointerType === 'mouse' ? null : tappedOver(e.clientX, e.clientY);
    if (over) over.click();
    else pickAt(e.offsetX, e.offsetY);
  };
  canvas.addEventListener('pointerup', lift);
  canvas.addEventListener('pointercancel', lift);
  canvas.addEventListener('lostpointercapture', lift);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    stopFlight();
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
      } else if (deltaY < 0 && !canDrawLife(state.t, cam)) {
        // Coming down from orbit, drift towards the city.
        const k = Math.min(1, (before - after) / Math.max(before, 1)) * 0.9;
        lat += (site.origin.lat - lat) * k;
        lon += (site.origin.lon - lon) * k;
      }
    }
    // Anywhere else, towards what the pointer is on.
    if (!frameView && deltaY < 0 && dist < MIN_DIST * 1.4 && canDrawLife(state.t, cam)) {
      const hit = camera.pick(sx, sy);
      if (hit) {
        const k = Math.min(1, (before - after) / Math.max(before, 1));
        lat += (hit.lat - lat) * k;
        let dLon = hit.lon - lon;
        if (dLon > 180) dLon -= 360;
        if (dLon < -180) dLon += 360;
        lon += dLon * k;
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
  /** In a scene of the sea, "Go and see" goes on to the biggest of what is near once it is down: when it was asked, or 0 */
  let seaLook = 0;
  /** and the frames drawn since its flight came down */
  let seaDown = 0;

  function flyTo(to: ViewState['cam'], ms = 3600): void {
    // A link is the place it names: tests and shared views arrive at once.
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return setState({ cam: to });
    flight = { from: { ...state.cam, heading: state.cam.heading ?? 0, tilt: state.cam.tilt ?? 0 }, to: { ...to, heading: to.heading ?? 0, tilt: to.tilt ?? 0 }, t0: performance.now(), ms };
    dirty = true;
  }

  /** The reader has taken the controls: nothing carries on without them. */
  function stopFlight(): void {
    flight = null;
    arriving = null;
    seaLook = 0;
  }

  /** Whether a view near the ground has a scene still to come. A site's is set going; a scene of anywhere is maintainLife's. */
  function sceneComing(to: ViewState['cam']): boolean {
    const t = state.t;
    const s = siteFor(t, to);
    if (s && s !== lifeSite && t >= s.span[0] && t <= s.span[1] && (s.kind === 'city' || distanceFrom(s, to.lat, to.lon) < 15e3)) {
      if (failedScenes.has(s.id)) return false;
      if (!scenes.get(s.id) && !loadingScenes.has(s.id)) void loadScene(s);
      return !scenes.get(s.id)?.ready;
    }
    if (!canDrawLife(t, to)) return false;
    const key = lifeKeyAt(t, to);
    return !lifeEmpty.has(key) && !(lifeSite?.id === key && scenes.get(key)?.ready);
  }

  function stepFlight(now: number): void {
    const f = flight!;
    let u = Math.min(1, (now - f.t0) / f.ms);
    // A flight into a scene waits above it until the scene is ready.
    if (u > 0.3 && f.to.dist < MIN_DIST && sceneComing(f.to)) {
      u = 0.3;
      f.t0 = now - u * f.ms;
    }
    const e = u * u * (3 - 2 * u);
    // The place arrives before the height does, so the descent ends over the city.
    const g = Math.min(1, e * 1.5);
    const a0 = Math.log(f.from.dist - 1);
    const a1 = Math.log(f.to.dist - 1);
    // A long way is flown high, whatever the heights at its ends, and the short way round.
    const dLon = ((f.to.lon - f.from.lon + 540) % 360) - 180;
    const dLat = f.to.lat - f.from.lat;
    const reach = Math.hypot(dLat, dLon * Math.cos(((f.from.lat + f.to.lat) / 2) * RAD)) * RAD;
    const top = reach > 0.03 ? Math.max(Math.log(MIN_DIST - 1), Math.log(reach * 0.5)) : -Infinity;
    const smooth = (x: number) => {
      const c = Math.max(0, Math.min(1, x));
      return c * c * (3 - 2 * c);
    };
    // Up, across, and down over the place: it comes down once it is there.
    const height = top > Math.max(a0, a1) ? a0 + (top - a0) * smooth(e / 0.15) + (a1 - top) * smooth((e - 2 / 3) * 3) : a0 + (a1 - a0) * e;
    let dh = ((f.to.heading! - f.from.heading! + 540) % 360) - 180;
    if (Math.abs(dh) < 1e-6) dh = 0;
    setState({
      cam: {
        lat: f.from.lat + dLat * g,
        lon: f.from.lon + dLon * g,
        dist: 1 + Math.exp(height),
        heading: f.from.heading! + dh * e,
        tilt: f.from.tilt! + (f.to.tilt! - f.from.tilt!) * e,
      },
    });
    if (u >= 1) flight = null;
  }

  async function loadScene(s: SiteInfo): Promise<void> {
    if (failedScenes.has(s.id)) return;
    loadingScenes.add(s.id);
    try {
      const fast = state.quality === 'fast';
      const scene = s.kind === 'life' ? await (async () => {
        const f = await getJSON<SceneFileV2>(build.base + s.file);
        if (f.format !== 'lightworld-scene-file@2') throw new Error(`its file is in a format this viewer does not read (${f.format ?? 'none'}): the build is older than the viewer`);
        return new LifeScene(gl!, f.spec, f.print, { fast });
      })() : new CityScene(gl!, build, s.file, { fast });
      scene.onChange = () => (dirty = true);
      await scene.load();
      scenes.set(s.id, scene);
      atSite(state.t, state.cam);
      scene.setScenario(scenario());
    } catch (err) {
      // The globe still works without the scene.
      console.error(`${s.id}: ${err instanceof Error ? err.message : String(err)}`.slice(0, 900));
      failedScenes.set(s.id, `${s.label} could not be drawn: ${err instanceof Error ? err.message.split('\n')[0] : err}`);
    }
    loadingScenes.delete(s.id);
    dirty = true;
  }

  /** The key of the scene a place and time would have. */
  const lifeKeyAt = (t: number, at: { lat: number; lon: number }): string => {
    const { lat, lon } = latticeOf(at.lat, at.lon);
    // A month is a different scene: its snow and its sun.
    // And in the human landscape's span, a step of the anthromes is a different scene: its people.
    return `${lifeAtlas?.binAt(t)?.from}|${lat.toFixed(2)}|${lon.toFixed(2)}|${state.month ?? ''}|${landscape?.stepAt(t) ?? ''}`;
  };

  /** The scene of wherever the camera is, or is flying down to: made once it has come to rest over a new place, and shown once it is ready. */
  function maintainLife(): void {
    if (!lifeAtlas || !gl) return;
    // The stage's lists have come, and say there is no land here: back up, as for any time nothing is drawn for.
    if (state.cam.dist < MIN_DIST && !siteOpen(state.t) && !canDrawLife(state.t, state.cam)) {
      setState({ cam: { lat: state.cam.lat, lon: state.cam.lon, dist: MIN_DIST } });
      return;
    }
    const cam = flight && flight.to.dist < MIN_DIST ? flight.to : state.cam;
    const range = (cam.dist - 1) * EARTH_RADIUS;
    if (range > LIFE_TOP * 1.4 || !canDrawLife(state.t, cam)) return;
    // A place that has its own scene, and the camera right over it, is that place.
    const there = cam === state.cam ? site : siteFor(state.t, cam);
    if (there && there !== lifeSite && there.kind === 'life' && distanceFrom(there, cam.lat, cam.lon) < 15e3) return;
    const key = lifeKeyAt(state.t, cam);
    if (lifeEmpty.has(key) || !climateData || !climateRule) return;
    const now = performance.now();
    if (key !== lifeKey) {
      lifeKey = key;
      lifeRest = now;
    }
    const inSpan = !!lifeSite && state.t >= lifeSite.span[0] && state.t <= lifeSite.span[1];
    // Near the ground, the scene is always this place's; higher up, it can be some way off.
    const off = lifeSite ? distanceFrom(lifeSite, cam.lat, cam.lon) : Infinity;
    const close = inSpan && (lifeSite!.id === key || (range > 3e4 && off < Math.max(9e3, range * 0.5)));
    if (close || lifeLoading === key) return;
    if (lifeLoading) return;
    if (now - lifeRest < (lifeSite ? 260 : 0)) {
      dirty = true;
      return;
    }
    lifeLoading = key;
    void makeLife(key, cam.lat, cam.lon, state.t);
  }

  async function makeLife(key: string, lat: number, lon: number, t: number): Promise<void> {
    try {
      const spec = await lifeAtlas!.spec(lat, lon, t, scenario(), state.month);
      if (!spec) {
        lifeEmpty.add(key);
        return;
      }
      // Its people, where the human landscape reaches it and it is a scene of the land.
      if (landscape && !lifeAtlas!.fromSea(spec)) {
        const p = await landscape.peopleFor(spec.site.origin.lat, spec.site.origin.lon, t).catch((err) => {
          console.error(`the people of ${key}: ${err instanceof Error ? err.message : String(err)}`);
          return undefined;
        });
        if (p) spec.people = p;
      }
      const scene = new LifeScene(gl!, spec, null, { fast: state.quality === 'fast' });
      scene.onChange = () => (dirty = true);
      await scene.load();
      const previous = lifeSite;
      lifeSite = { kind: 'life', id: key, label: spec.site.stage ?? 'this place', file: '', origin: spec.site.origin, span: spec.site.span, slice: spec.site.slice, near: spec.site.span, window: spec.site.span, view: { x: scene.focus[0], y: scene.focus[1], range: 74, heading: 0, tilt: 81 } };
      scenes.set(key, scene);
      if (previous) {
        const old = scenes.get(previous.id);
        scenes.delete(previous.id);
        if (old instanceof LifeScene) old.dispose();
      }
      atSite(state.t, state.cam);
      scene.setScenario(scenario());
    } catch (err) {
      console.error(`the scene of ${key}: ${err instanceof Error ? err.message : String(err)}`.slice(0, 900));
      lifeEmpty.add(key);
    } finally {
      lifeLoading = null;
      dirty = true;
    }
  }

  /** The way into a site, as its record says. */
  const arrivalCam = (s: SiteInfo): ViewState['cam'] => {
    const [lat, lon] = fromLocal(s.origin, s.view.x, s.view.y);
    return { lat, lon, dist: 1 + s.view.range / EARTH_RADIUS, heading: s.view.heading, tilt: s.view.tilt };
  };

  function enterSite(s: SiteInfo | undefined = site): void {
    if (!s) return;
    if (!scenes.get(s.id) && !loadingScenes.has(s.id)) void loadScene(s);
    const inSlice = state.t >= s.near[0] && state.t <= s.near[1];
    setState({ t: inSlice ? state.t : s.slice, window: inSlice ? state.window : clampWindow(s.window, limits) });
    flyTo(arrivalCam(s), 5200);
  }
  cityEnter.onclick = () => enterSite();
  cityBar.querySelector<HTMLInputElement>('input')!.oninput = (e) => setState({ hour: Number((e.target as HTMLInputElement).value) });
  cityBar.querySelector<HTMLSelectElement>('.life-month select')!.onchange = (e) => setState({ month: Number((e.target as HTMLSelectElement).value) || undefined });
  cityBar.querySelector<HTMLButtonElement>('.to-globe')!.onclick = () => flyTo({ lat: state.cam.lat, lon: state.cam.lon, dist: 2.6 }, 4200);
  // A title is never seen on a touch screen: the help opens on a tap, in the words for the screen it is on.
  const cityHelp = cityBar.querySelector<HTMLButtonElement>('.city-help')!;
  const cityTips = cityBar.querySelector<HTMLElement>('.city-tips')!;
  cityHelp.onclick = () => {
    cityTips.textContent = matchMedia('(pointer: coarse)').matches ? TOUCH_HELP : MOUSE_HELP;
    cityTips.hidden = !cityTips.hidden;
    cityHelp.setAttribute('aria-expanded', String(!cityTips.hidden));
  };
  const lifeGo = cityBar.querySelector<HTMLButtonElement>('.life-go')!;
  lifeGo.onclick = () => {
    if (!(city instanceof LifeScene) || !site) return;
    if (city.sea && lookUnderSea(city)) return;
    const [lat, lon] = fromLocal(site.origin, city.focus[0], city.focus[1]);
    const heading = ((Math.atan2(city.toRiver[0], city.toRiver[1]) * 180) / Math.PI + 17 + 360) % 360;
    flyTo({ lat, lon, dist: 1 + 74 / EARTH_RADIUS, heading: Math.round(heading), tilt: 81 }, 1800);
    // In the sea, once down there and what is near has names, on to the biggest of it.
    seaLook = city.sea ? performance.now() : 0;
  };
  /**
   * In a scene of the sea, where the water lets one see only so far: to a few lengths from the biggest of what is about
   * the arrival, a little above it and looking at it. False if nothing about the arrival has a name yet.
   */
  function lookUnderSea(c: LifeScene): boolean {
    const [fx, fy] = c.focus;
    // About the arrival: where the generator sets something of each. The biggest of it, and of those the nearest.
    const reach = (c.spec.generator.params as unknown as LivingParams).animals.near_radius * 1.5;
    const length = (i: number) => c.taxonOf(c.named[i].id)?.length ?? 0;
    const from = (i: number) => Math.hypot(c.named[i].at[0] - fx, c.named[i].at[1] - fy);
    let best = -1;
    for (let i = 0; i < c.named.length; i++) {
      if (from(i) > reach) continue;
      if (best < 0 || length(i) > length(best) || (length(i) === length(best) && from(i) < from(best))) best = i;
    }
    if (best < 0 || !site) return false;
    const s = c.named[best];
    const mid = (s.base + c.tops[best]) / 2;
    const dx = s.at[0] - fx;
    const dy = s.at[1] - fy;
    const l = Math.hypot(dx, dy);
    const [ux, uy] = l > 1 ? [dx / l, dy / l] : c.toRiver;
    // Some five lengths off: near enough to see it through the water, and a small one from as near as the eye may come.
    const back = Math.max(1, Math.min(14, 5 * (length(best) || 2)));
    const ex = s.at[0] - ux * back;
    const ey = s.at[1] - uy * back;
    const aim = lookThrough([ex, ey, Math.min(-1, Math.max(mid + 1.2, c.ground.at(ex, ey) + EYE_HEIGHT))], [s.at[0], s.at[1], mid], c.ground);
    if (!aim) return false;
    const [lat, lon] = fromLocal(site.origin, aim.target[0], aim.target[1]);
    flyTo({ lat, lon, dist: 1 + aim.range / EARTH_RADIUS, heading: aim.heading, tilt: aim.tilt }, 1800);
    return true;
  }
  /** Once a flight to the arrival in the sea has come down and the scene there has settled, on to the biggest of what is near. */
  function lookIfDown(): void {
    if (!seaLook) return;
    if (flight) {
      seaDown = 0;
      return;
    }
    // Not for ever: a scene that does not settle is left as it is.
    if (!(city instanceof LifeScene) || !city.sea || performance.now() - seaLook > 30000) {
      seaLook = 0;
      return;
    }
    // Only once the scene has been drawn from where the flight came down can what is near there have names. Until
    // then, draw again: a still scene asks for no frames, and without them this would wait, and the view with it,
    // for ever.
    if (seaDown++ < 1 || !city.settled) {
      dirty = true;
      return;
    }
    seaLook = 0;
    lookUnderSea(city);
  }
  /** Down to where something of each is standing, once the scene of the place a taxon was asked for has come. */
  function arriveIfReady(): void {
    if (!arriving || flight) return;
    // There may be nothing to go to: no scene can be made here.
    if (!canDrawLife(state.t, state.cam) && !(site?.kind === 'life' && siteOpen(state.t))) {
      arriving = null;
      return;
    }
    if (lifeEmpty.has(lifeKeyAt(state.t, state.cam))) {
      arriving = null;
      return;
    }
    if (!(city instanceof LifeScene) || !city.ready || !site || site.kind !== 'life') return;
    if (distanceFrom(site, state.cam.lat, state.cam.lon) > 15e3) return;
    const id = arriving;
    arriving = null;
    const taxon = city.taxonOf(id);
    lifeGo.click();
    if (taxon) setState({ sel: id });
  }
  const lifeHere = cityBar.querySelector<HTMLButtonElement>('.life-here')!;
  lifeHere.onclick = () => {
    if (!(city instanceof LifeScene)) return;
    setState({ sel: null });
    shownRecord = null;
    const sea = listOf(city) === 'sea';
    inspect.showLifeHere(city.spec, sea ? build.sea?.description : build.atlas?.description, { list: sea ? 'sea' : 'land', sea: city.sea });
  };

  /** Fly to a structure of the city, looking at its front, at a time it stands. */
  function flyToStructure(home: SiteInfo, s: CityStructure): void {
    const a = s.time.start.best ?? -Infinity;
    const b = s.time.end.best ?? Infinity;
    const t = state.t >= a && state.t <= b ? state.t : home.slice >= a && home.slice <= b ? home.slice : Math.max(a, Math.min(b, state.t));
    const [lat, lon] = fromLocal(home.origin, s.at[0], s.at[1]);
    let extent = 60;
    for (const r of s.rings) for (let i = 0; i < r.length; i += 2) extent = Math.max(extent, Math.hypot(r[i] - s.at[0], r[i + 1] - s.at[1]));
    const range = Math.max(90, Math.min(1800, extent * 2.6));
    setState({ t, sel: s.id, window: t >= state.window[0] && t <= state.window[1] && state.window[1] - state.window[0] < 5000 ? state.window : clampWindow(home.window, limits) });
    flyTo({ lat, lon, dist: 1 + range / EARTH_RADIUS, heading: state.cam.dist < 1.01 ? state.cam.heading : 330, tilt: 62 }, state.cam.dist < 1.001 ? 1800 : 4600);
  }

  /** Clicks so far, so that what a click fetches is shown only if no other click came after it. */
  let clicks = 0;
  function pickAt(x: number, y: number): void {
    const click = ++clicks;
    if (frameView && city && (state.cam.dist - 1) * EARTH_RADIUS < 6e4) {
      const dpr = canvas.width / stage.clientWidth;
      const px = Math.round(x * dpr);
      const py = canvas.height - 1 - Math.round(y * dpr);
      dirty = true;
      here = null;
      if (city instanceof LifeScene) {
        const found = city.pick(px, py);
        if (found.taxon) {
          const t = found.taxon;
          // A taxon with a record opens it; one that is only a row of the database says what the row says.
          if (!t.id.startsWith('txn:')) return setState({ sel: t.id });
          setState({ sel: null });
          shownRecord = null;
          const info = organismInfo(t.id)!;
          return inspect.showOrganism(t, info, organismSource(info));
        }
        // A house the settlement generator drew: what it rests on, and what of it is invented.
        if (found.house !== undefined && city.people && city.spec.people) {
          setState({ sel: null });
          shownRecord = null;
          const pp = city.people;
          const f = pp.forms[found.house];
          const sp = city.spec.people;
          const gen = sp.generator;
          const life = sp.lifeway;
          const k = anthromeOf(sp.classes, life.anthrome);
          const cities = pp.settlements.filter((x) => x.city).map((x) => `${x.city} (about ${x.people.toLocaleString('en-US')} people)`);
          // Where houses of this form stand in the scene: the lists' cities first, then the settlements of each way of life.
          const mine = pp.settlements.filter((x) => x.form === found.house);
          const counts = new Map<Pattern, number>();
          for (const x of mine) if (!x.city) counts.set(x.pattern as Pattern, (counts.get(x.pattern as Pattern) ?? 0) + 1);
          const where = [
            ...mine.filter((x) => x.city).sort((a, b) => b.people - a.people).map((x) => `${x.city}, a city of the lists, of about ${x.people.toLocaleString('en-US')} people then`),
            ...[...counts].sort((a, b) => b[1] - a[1]).map(([p, c]) => `${c.toLocaleString('en-US')} ${SETTLEMENT_WORDS[p][c === 1 ? 0 : 1]}`),
          ];
          const form =
            f.from === 'tradition'
              ? `Its form follows the world's records of the building tradition ${f.label}: ${specText(f.spec)}. What they do not say, the generator's proportions fill in.`
              : `No building tradition is recorded for this region and time, so this is a generic house for the way of life and the climate: ${specText(f.spec)}. It is a placeholder, and says so.`;
          const text = `${where.length ? `Houses of this form stand in ${where.join('; ')}. ` : ''}${form} At the scene's middle, at ${formatTime(sp.t)}: ${PATTERN_LABEL[life.pattern].toLowerCase()}, ${k ? `${k.label.toLowerCase()} as the anthromes of HYDE have it at their step ${stepName(sp.step)}` : 'as the anthromes have it'}. ${life.why}${life.disagrees ? ` ${life.disagrees}` : ''} The scene draws ${pp.houses.toLocaleString('en-US')} houses for about ${pp.drawn.toLocaleString('en-US')} people; HYDE puts about ${pp.expected.toLocaleString('en-US')} in the land it covers${cities.length ? `, and the lists of cities add ${cities.join(', ')}` : ''}.`;
          const why = `${gen.generator}, version ${gen.version}: nobody recorded this house. How many houses there are follows HYDE's people through the anthromes, and the lists of cities where they name one; what way of life, the anthromes and the region's archaeologists; where each house stands and which way it faces is invented, keyed by the world's 5′ cells.`;
          return inspect.showGenerated(f.label, 'Generated house', text, why);
        }
        setState({ sel: null });
        shownRecord = null;
        const b = city.spec.biome;
        const g = city.spec.generator;
        const made = `${g.generator}, version ${g.version}, seed "${g.seed}"`;
        if (city.sea) {
          // In a scene of the sea: its floor, or a shore above the water.
          const hit = groundHit(frameView, rayOf(frameView, x, y), city.ground);
          if (!hit || hit[2] < 0) return inspect.showGenerated('The sea floor here', 'Generated ground', `The floor of a sea, drawn for this place and time under the sea of the time. Its depth is the elevation field's; its sand, mud and ripples are invented, and so is the look of the water over it: how far one sees through it, its colour, and how the daylight falls with depth.`, `${made}: nothing of this floor was recorded. Only its depth comes from the world, from the elevation field, between the field's points.`);
          return inspect.showGenerated('The shore here', 'Generated ground', `Land at the edge of a sea, drawn for this place and time. Its height is the elevation field's, and how its shore wanders is invented. Where the climate field reads the land at ${b.ageMa} Ma, it is ${b.label.toLowerCase()}, and the transitions allow forest over ${Math.round(b.cover.forests * 100)}% of it and grass over ${Math.round(b.cover.grasses * 100)}%.`, `${made}: no stretch of this shore was recorded. Only the land comes from the world, from the elevation field.`);
        }
        const where = city.spec.site.place ? `drawn where ${site!.label} stood` : 'drawn for this place and time';
        return inspect.showGenerated(city.spec.site.place ? 'The floodplain' : 'The land here', 'Generated ground', `A land ${where}. Its rivers, ponds and glades are invented, so that what lived here has somewhere to stand. Where the climate field reads the land at ${b.ageMa} Ma, it is ${b.label.toLowerCase()}, and the transitions allow forest over ${Math.round(b.cover.forests * 100)}% of it and grass over ${Math.round(b.cover.grasses * 100)}%.`, `${made}: no bend of this river was recorded. Only the land it lies in comes from the world, from the elevation field beyond its edge.`);
      }
      const found = city!.pick(px, py);
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
    const row = hazards.pick(x, y);
    if (row) {
      setState({ sel: null });
      shownRecord = null;
      return inspect.showRow(row.name, HAZARD_WORDS[row.kind], [`${row.when}`, ...(row.size !== undefined ? [`${HAZARD_SIZE[row.kind]} ${row.size}`] : []), ...(row.deaths !== undefined ? [`${row.deaths.toLocaleString('en-US')} deaths, as the database counts them`] : [])], hazards.file!.sourceRecord, hazards.file!.description, rowInfo(row));
    }
    for (const fl of fieldLayers) {
      const r = fl.pick(x, y);
      if (!r) continue;
      setState({ sel: null });
      shownRecord = null;
      return inspect.showRow(r.label ?? fl.info.title, fl.info.style.describe, r.says, fl.info.sourceRecord, fl.info.description, rowInfo(r));
    }
    const town = present.pick(x, y);
    if (town) {
      setState({ sel: null });
      shownRecord = null;
      return inspect.showRow(town.name, town.capital ? 'Capital city, today' : 'City, today', [town.country, `About ${town.pop.toLocaleString('en-US')} people, as the map gives it`], present.file!.placesSourceRecord, present.file!.description);
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
    if (!fi) return inspect.showUnknown(state.t, unknownWhy(state.t), stateOf(frameLook), resolveLayer(resolveWorld(), 'geography', hit.lat, hit.lon, state.t, scenario()));
    const [e0, e1, p0] = field.sample(hit.point);
    // On today's ground, the height above the sea of the time.
    const level = seaLevelOf(fi, state.t);
    const elevation = e0 + (e1 - e0) * frameMix - level;
    const plate = build.frames.plateIndex[Math.round(p0)] || null;
    // How people lived here: fetched for the place, then the panel is shown again with it.
    const asked = { t: state.t, lat: hit.lat, lon: hit.lon };
    if (landscape && elevation >= 0 && fi.mode === 'elevation') {
      void landscapeHere(hit.lat, hit.lon, state.t).then((lh) => {
        if (!lh || click !== clicks || here !== null || state.t !== asked.t || state.sel) return;
        showTerrainAt(lh);
      });
    }
    const showTerrainAt = (lh?: LandscapeHere) => inspect.showTerrain({
      mode: fi.mode,
      lat: hit.lat,
      lon: hit.lon,
      elevation,
      plate: plate ? build.plates.of(plate).plate : null,
      plateLabel: plate ? build.plates.label(plate) : undefined,
      keyframes: frameKeys,
      mix: frameMix,
      t: state.t,
      source: fi.sourceRecord,
      fieldTitle: fi.title,
      fieldDescription: fi.description,
      fieldSpread: fi.spread,
      coastline: fi.coastline?.title,
      datum: fi.datum,
      seaLevel: fi.coastline?.seaLevel ? { m: level, title: build.series.series.find((x) => x.id === fi.coastline!.seaLevel)?.title ?? fi.coastline.seaLevel } : undefined,
      state: stateOf(frameLook),
      biome: biomeHere(hit.point),
      polity: polityHere(hit.lon, hit.lat),
      ice: iceHere(hit.point, plate),
      people: peopleDrawn ? people.here(hit.lon, hit.lat, state.t) : undefined,
      ...(lh ? { landscape: lh } : {}),
    });
    showTerrainAt();
  }

  /** How people lived at a place and time, for the terrain panel: the human landscape's word, with its sources' names. */
  async function landscapeHere(lat: number, lon: number, t: number): Promise<LandscapeHere | undefined> {
    const place = await landscape!.placeAt(lat, lon, t);
    if (!place) return undefined;
    const ix = landscape!.index;
    const k = anthromeOf(ix.classes, place.anthrome);
    const listTitle = (field: string) => landscape!.cities.lists.find((l) => l.field === field)?.title.replace(/,.*$/, '') ?? field;
    const a = place.region?.assessment?.a;
    const regionUses = a ? USES.map((u, i) => `${USE_LABEL[u]} ${LEVEL_WORDS[a.use[i][0]].toLowerCase()}${a.use[i][1] !== a.use[i][3] ? ` (answers from ${LEVEL_WORDS[a.use[i][1]].toLowerCase()} to ${LEVEL_WORDS[a.use[i][3]].toLowerCase()})` : ''}`).concat([`dense urban centres ${a.urban === 1 ? 'present' : 'absent'}`]) : undefined;
    return {
      place,
      className: k?.label ?? 'Unclassed',
      title: ix.title,
      ...(place.density !== undefined ? { density: place.density } : {}),
      ...(regionUses ? { regionUses } : {}),
      cities: place.cities.map((c) => ({ name: c.city.name, people: c.people, km: c.km, list: listTitle(c.city.field), also: c.also.map((x) => ({ people: x.people, list: listTitle(x.city.field) })) })),
      ...(place.tradition ? { tradition: { id: place.tradition.id, label: place.tradition.label, dwelling: specText(place.tradition.dwelling) } } : {}),
    };
  }

  /** What the ice-sheet field gives at a point of the globe at the time shown, if it has any ice near. */
  function iceHere(point: V3, plate: number | null): IceHere | undefined {
    if (!frameIce || !iceFile || !ts.ice) return undefined;
    const { header, arrays } = iceFile;
    const { younger, older, mix, ageMa } = frameIce;
    // Back to today's coordinates, the ones the keyframes are on.
    const q = plate ? mul(build.model.total(plate, ageMa), conj(build.model.total(plate, 0))) : ([1, 0, 0, 0] as Quat);
    const [lat, lon] = toLatLon(rotate(conj(q), point));
    const thick = (k: IceKeyframe) => decodeThickness(sampleGrid(header.grid, arrays[k.thickness], lat, lon));
    const read = (scenario: IceScenario) => {
      const a = iceFrame(header, scenario, younger);
      const b = iceFrame(header, scenario, older);
      const marginKm = decodeMargin(sampleGrid(header.grid, arrays[a.margin], lat, lon)) * (1 - mix) + decodeMargin(sampleGrid(header.grid, arrays[b.margin], lat, lon)) * mix;
      return { a: thick(a), b: thick(b), thickness: thick(a) * (1 - mix) + thick(b) * mix, drawn: marginKm > 0 };
    };
    const shown = iceScenario(header, state.alt);
    const here = read(shown);
    // The scenarios are told apart only where the field keeps them apart.
    const differ = header.scenarios.slice(1).some((s) => s.keyframes.some((k) => k.ageMa === younger || k.ageMa === older));
    const others = differ ? header.scenarios.filter((s) => s !== shown).map((s) => ({ id: s.id, title: s.title, ...read(s) })) : [];
    if (!here.drawn && here.a < header.marginM && here.b < header.marginM && !others.some((x) => x.drawn)) return undefined;
    return {
      title: ts.ice.title,
      drawn: here.drawn,
      thickness: here.thickness,
      marginM: header.marginM,
      at: younger === older ? [{ ageMa: younger, thickness: here.a }] : [{ ageMa: younger, thickness: here.a }, { ageMa: older, thickness: here.b }],
      scenario: differ ? { id: shown.id, title: shown.title } : undefined,
      others: others.map((x) => ({ id: x.id, title: x.title, thickness: x.thickness, drawn: x.drawn })),
      uncertainty: ts.ice.uncertainty,
      held: state.t > PRESENT_YEAR ? ts.ice.projection?.note : undefined,
      source: ts.ice.sourceRecord,
    };
  }

  /** Which state held a point of the globe at the time shown, as the borders dataset draws it. */
  function polityHere(lon: number, lat: number): TerrainInfo['polity'] {
    const r = polities.at(lon, lat);
    if (!r || !polities.file) return undefined;
    return { name: r.name, from: r.from, to: r.to, area: r.area, wikipedia: r.wikipedia, source: polities.file.sourceRecord, row: rowInfo(r) };
  }

  /** What covers the land at a point of the globe, at the time shown, if the climate field reaches it. */
  function biomeHere(point: V3): BiomeHere | undefined {
    const info = ts.climate;
    if (frameClimateMix === null || !climateRule || !info) return undefined;
    const v = field.sampleClimate(point, frameClimateMix);
    if (!v) return undefined;
    const climate = climateClass(decodeNode(v), climateRule);
    const covers = (build.planet.covers ?? []).map((st) => {
      const [a, b] = spanOf(st, scenario());
      return { id: st.subject, label: st.label, kind: st.values.cover?.[0]?.value, a, b };
    });
    // Reef builders are the sea's: what is on land is what the land's cover follows.
    const land = covers.filter((c) => c.kind !== 'reefs').sort((x, y) => x.a - y.a);
    // The finer climate of the recent past, where it is the one drawn.
    const finer = ts.climates?.find((c) => c.field === frameClimate?.field);
    return {
      climate,
      label: CLIMATE_LABEL[climate],
      cover: coverAt(build.planet, state.t, scenario()),
      sheets: !!frameIce,
      title: finer?.title ?? info.title,
      transitions: land.filter((c) => c.a <= state.t),
      next: land.find((c) => c.a > state.t),
      rule: info.biomeDescription ?? info.biomeTitle,
      ruleSource: finer?.sourceRecord ?? info.sourceRecord,
    };
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
    if (t < oldest) return `Geography unknown: the oldest plate model reaches back to ${formatTime(oldest)}.`;
    if (t > furthest) return `Geography unknown: today's map is held only to ${formatTime(furthest)}, and nothing models it after.`;
    return '';
  }

  function showSeries(id: string): void {
    const s = build.series.series.find((x) => x.id === id);
    if (!s) return;
    setState({ sel: null });
    shownRecord = null;
    inspect.showSeries(s, state.t, valueAt(s, state.t, state.alt));
  }

  /** How long an instant stays visible around its time: a dozen pixels of the time control. */
  function halo(t: number): number {
    return Math.max(timebar.yearsPerPixels(t, 12), 1e-3);
  }

  treePanel.onSelect = (id) => goTo(id);
  treePanel.onClose = () => setState({ tree: false });
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
    // Its marker may be somewhere the view has not asked for: fetch it, then go.
    if (features.has(id) && (!features.get(id) || (scenarioKey(scenario()) && !features.hasVariants))) {
      void Promise.all([features.load([id]), scenarioKey(scenario()) ? features.wantVariants() : undefined]).then(() => goTo(id));
      return;
    }
    const f = features.get(id) ?? null;
    const entry = build.search.entities.find((e) => e.id === id)!;
    const home = sites.find((s) => s.kind === 'city');
    if (entry && cityKind(entry.kind) && home) {
      const open = () => {
        const c = scenes.get(home.id) as CityScene | undefined;
        const s = c?.file.structures.find((x) => x.id === id);
        if (s) flyToStructure(home, s);
        else setState({ sel: id });
      };
      if (scenes.has(home.id)) open();
      else if (!loadingScenes.has(home.id)) void loadScene(home).then(open);
      return;
    }
    const placed = sites.find((s) => s.place === id);
    if (placed) {
      setState({ sel: id });
      return enterSite(placed);
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
    const spot = f ? placeAt(f, t, (m) => lookup(m.variants, scenario(), m.time)) : undefined;
    const loc = spot?.location;
    let cam = state.cam;
    if (loc && spot?.plate) {
      const q = build.model.total(spot.plate, ageAt);
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
      stopFlight();
      dirty = true;
      e.preventDefault();
      return;
    }
    if (e.key === 'e' || e.key === 'E') setState({ evidence: !state.evidence });
    else if (e.key === 'c' || e.key === 'C') setState({ clouds: !state.clouds });
    else if (e.key === 't' || e.key === 'T') setState({ tree: !state.tree });
    else if (e.key === 'p' || e.key === 'P') setState({ people: !state.people });
    else if (e.key === ' ') togglePlay();
    else if (e.key === 'ArrowLeft') setState({ t: timebar.stepFrom(state.t, -1 / 200) });
    else if (e.key === 'ArrowRight') setState({ t: timebar.stepFrom(state.t, 1 / 200) });
    else if (e.key === 'l' || e.key === 'L') setState({ hour: state.hour >= HOURS[1] ? HOURS[0] : state.hour + 0.4 });
    else if (e.key === '/') search.focus();
    else if (e.key === 'Escape') {
      openMenu(false);
      closePanel();
    }
    else return;
    e.preventDefault();
  });
  window.addEventListener('resize', () => (dirty = true));
  window.addEventListener('popstate', () => {
    const p = fromSearch(location.search, state);
    setState(p.state);
  });

  /** Is the view waiting on the city's scene? */
  const cityWanted = () => {
    const range = (state.cam.dist - 1) * EARTH_RADIUS;
    if (lifeLoading || arriving) return true;
    if (site && failedScenes.has(site.id)) return false;
    const made = site === lifeSite && !!lifeSite;
    // A scene is wanted here and has not come, or has not settled.
    if (!made && lifeAtlas && range < LIFE_TOP * 1.4 && canDrawLife(state.t, state.cam) && !(site && distanceFrom(site, state.cam.lat, state.cam.lon) < 15e3)) {
      if (!lifeEmpty.has(lifeKeyAt(state.t, state.cam))) return true;
    }
    return !!site && siteOpen(state.t) && range < (made ? LIFE_TOP : CITY_TOP) * 1.4 && siteDistance(state.cam.lat, state.cam.lon) < 1.6e6 && !(city?.settled && city.plan.actual);
  };
  /** What the view is still waiting on before it is idle, by name: nothing, once it is. */
  const waiting = (): string[] => {
    const w: [string, boolean][] = [
      ['tiles', tiles.busy], ['features', features.busy], ['frame', dirty], ['layers', !layersReady],
      ['polities', !politiesReady && !!politiesLoading], ['field layers', fieldLayers.some((fl) => fl.busy)], ['rivers', !!rivers?.busy],
      ['people', !!state.people && !people.file && !!ts.files.people], ['clouds', !cloudsReady], ['surface', !surfaceReady],
      ['biome texture', !biomeTexReady], ['generic land', !genericReady], ['climate', !climateReady || climates.busy], ['ice', !iceReady],
      ['territory', !territoryReady], ['tree', !!treeLoading], ['cube', !cubeKey.startsWith(`${state.t}|`)],
      ['selection', !!state.sel && shownRecord !== state.sel], ['flight', !!flight || !!seaLook], ['city', cityWanted()],
      ['landscape', landscapeOn() && (!landscape!.index || (landscapeLoading && !landscape!.globe))],
    ];
    return w.filter(([, x]) => x).map(([n]) => n);
  };
  history.replaceState(null, '', toSearch(build.id, state));
  window.__wikiworldmodel = {
    build: build.id,
    idle: () => waiting().length === 0,
    waiting,
    state: () => state,
    url: () => toSearch(build.id, state),
    requests: fetchLog,
    clouds,
    surface,
    biomeTexture,
    tree: () => (treeFile ? { rows: treePanel.shownRows(), litRows: fossils.count, litMarkers: [...(litMarkers ?? [])] } : null),
    biomeAt: (lat, lon) => {
      if (frameClimateMix === null || !climateRule) return null;
      const la = lat * RAD;
      const lo = lon * RAD;
      const v = field.sampleClimate([Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)], frameClimateMix);
      return v ? { climate: climateClass(decodeNode(v), climateRule), cover: coverAt(build.planet, state.t, scenario()) } : null;
    },
    climateAt: (lat, lon) => {
      if (frameClimateMix === null) return null;
      const la = lat * RAD;
      const lo = lon * RAD;
      const v = field.sampleClimate([Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)], frameClimateMix);
      return v ? decodeNode(v) : null;
    },
    climateField: () => frameClimate?.field ?? null,
    groundAt: (lat, lon) => {
      if (!frameField || frameField.mode !== 'elevation') return null;
      const la = lat * RAD;
      const lo = lon * RAD;
      const [e0, e1] = field.sample([Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)]);
      return e0 + (e1 - e0) * frameMix - seaLevelOf(frameField, state.t);
    },
    iceAt: (lat, lon) => {
      if (!frameIce) return null;
      const v = field.sampleIce(unitVector(lat, lon));
      if (!v) return null;
      const marginKm = decodeMargin(v[0] + (v[1] - v[0]) * frameIce.mix);
      return { drawn: marginKm > 0, marginKm, thickness: decodeThickness(v[2]) * (1 - frameIce.mix) + decodeThickness(v[3]) * frameIce.mix };
    },
    layers: () => ({ present: present.stats, holds: present.holds(state.t), hazards: hazards.count, hazardPlaces: hazards.positions(), placeAt: (name: string) => present.placeAt(name), polities: polities.stats, polityAt: (lon: number, lat: number) => polities.at(lon, lat)?.name, routes: fieldLayer('field:earth/roman-roads')?.count ?? 0, languages: fieldLayer('field:earth/languages')?.count ?? 0, languageAt: (name: string) => fieldLayer('field:earth/languages')?.positionOf(name), people: { drawn: peopleDrawn, holds: people.holds(state.t), ...people.stats }, peopleAt: (lon: number, lat: number) => {
      const c = people.here(lon, lat, state.t);
      const f = people.file;
      if (!c || !f) return undefined;
      const at = camera.project([Math.cos(lat * RAD) * Math.cos(lon * RAD), Math.cos(lat * RAD) * Math.sin(lon * RAD), Math.sin(lat * RAD)]);
      return { people: c.people, land: c.land, level: c.land > 0 ? levelOf(c.people / c.land, f.scale) : 0, x: at.x, y: at.y, visible: at.visible };
    } }),
    fabric: () => (city ? city.plan : null),
    genericLand,
    resolve: (lat, lon, layer) => resolveLayer(resolveWorld(), layer, lat, lon, state.t, scenario()),
    cityStats: () => (city ? city.stats() : null),
    structureAt: (id) => {
      const s = city?.named.find((x) => x.id === id);
      return s && frameView ? projectLocal(frameView, s.at[0], s.at[1], s.base) : undefined;
    },
    settlementsAt: () => {
      if (!(city instanceof LifeScene) || !city.people || !city.ground || !frameView) return [];
      const v = frameView;
      const g = city.ground;
      return city.people.settlements.flatMap((s) => {
        const at = projectLocal(v, s.x, s.y, g.at(s.x, s.y) + 1);
        return at && at.x >= 0 && at.y >= 0 && at.x < stage.clientWidth && at.y < stage.clientHeight ? [{ pattern: s.pattern, ...(s.city ? { city: s.city } : {}), houses: s.houses, x: at.x, y: at.y }] : [];
      });
    },
    scene: () => {
      const c = city instanceof LifeScene ? city : [...scenes.values()].find((x): x is LifeScene => x instanceof LifeScene);
      if (!c) return null;
      const drawn = new Set(c.named.map((x) => x.id));
      // Where the eye is in the scene drawn, above its sea, and the ground under it.
      const eye = c === city && frameView && c.ground ? { z: frameView.eye[2], floor: c.ground.at(frameView.eye[0], frameView.eye[1]) } : null;
      return { site: c.spec.site.id, plan: c.plan, taxa: c.spec.taxa.map((t) => ({ id: t.id, label: t.label, form: t.form_label, own: t.own, tier: t.tier, km: t.km, rows: t.rows, drawn: drawn.has(t.id) })), instances: c.last.instances, triangles: c.last.triangles, meshes: c.last.meshes, groundMs: c.groundMs, stage: c.spec.site.stage, climate: c.spec.biome.climate, climateField: c.spec.biome.field, month: c.spec.climate?.month ?? null, snow: Number.isFinite(snowOf(c.spec).line) ? snowOf(c.spec).line : null, focus: c.focus, toRiver: c.toRiver, origin: c.spec.site.origin, water: c.spec.water ? { tier: c.spec.water.tier, rivers: c.spec.water.rivers.map((r) => ({ key: r.key, from: r.from })) } : null, sea: c.sea, list: listOf(c), eye, people: c.spec.people ? { asked: true, houses: c.people?.houses ?? 0, drawn: c.people?.drawn ?? 0, expected: c.people?.expected ?? 0, settlements: c.people?.settlements.length ?? 0, pattern: c.people?.lifeway.pattern, tier: c.people?.lifeway.tier, forms: c.people?.forms.map((f) => f.label) ?? [] } : null };
    },
    lifePrint: async (lat, lon, t) => {
      const spec = await lifeAtlas?.spec(lat, lon, t, {});
      if (!spec) return null;
      const scene = new LifeScene(gl!, spec, null, { fast: true });
      await scene.load();
      while (!scene.plan.actual) await new Promise((r) => setTimeout(r, 20));
      scene.dispose();
      return scene.plan.actual;
    },
    atlas: () => (build.atlas ? { bins: build.atlas.bins.length, coverage: build.atlas.coverage } : null),
    rivers: () => ({ ...(riversLayer?.last ?? { drawn: 0, lakes: 0, observed: 0, ms: 0 }), near: (lat, lon, deg) => riversLayer?.near(lat, lon, deg) ?? [], lakeAt: (lat, lon) => riversLayer?.lakeAt(lat, lon) ?? null }),
    organismPlaces: (id) => {
      if (!(city instanceof LifeScene)) return [];
      const o = city.spec.site.origin;
      return city.named.filter((x) => x.id === id).map((x) => {
        const [lat, lon] = fromLocal(o, x.at[0], x.at[1]);
        return { lat, lon, x: x.at[0], y: x.at[1] };
      });
    },
    organismsAt: (id) => {
      if (!(city instanceof LifeScene) || !frameView) return [];
      const v = frameView;
      return city.named.filter((x) => x.id === id).map((x) => projectLocal(v, x.at[0], x.at[1], x.base + 1)).filter((p): p is { x: number; y: number; depth: number } => !!p && p.x >= 0 && p.y >= 0 && p.x < stage.clientWidth && p.y < stage.clientHeight);
    },
    set: (s) => setState(s),
    driftClouds: (d) => {
      cloudDrift = d ?? undefined;
      dirty = true;
    },
  };
  atSite(state.t, state.cam);
  if (state.sel) void showSelection();
  if (state.tree || taxonKind(state.sel)) wantTree();
  treePanel.el.hidden = !state.tree;
  requestAnimationFrame(frame);
}

const root = document.getElementById('app')!;
start(root).catch((err) => {
  console.error(err);
  fail(root, err instanceof Error ? err.message : String(err));
});
