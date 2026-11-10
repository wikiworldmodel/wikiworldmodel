// The landing page's timelapse (site/timelapse.yaml), drawn by the viewer: every frame of the globe
// at its time and place, captured from the canvas in a browser on this machine's GPU.
//
//   npx tsx tools/site/timelapse.ts frames site/timelapse.yaml <out dir> [--url http://localhost:5173/] [--scale 1] [--from 9 --to 13]
//   npx tsx tools/site/timelapse.ts stills <views.json> <out dir> [--url …] [--scale 1]
//
// `frames` reads every time in the shot list from the latest build, and writes the frames as
// <out>/frames/00000.png and on; the captions as <out>/captions.json, for the page, and as
// <out>/captions.ass, to burn into a copy to look at; and the age at each frame, <out>/ages.json.
// --from and --to draw only the frames between those seconds. A copy to look at:
//
//   ffmpeg -framerate 30 -i <out>/frames/%05d.png -vf ass=<out>/captions.ass -c:v libx264 \
//     -preset slow -crf 20 -pix_fmt yuv420p -movflags +faststart review.mp4
//
// `stills` draws a list of views, one PNG each: { name, ma or t, lat, lon, d, h?, v?, hour?, clouds? },
// the age in Ma or the astronomical year, and the camera as the viewer's links give it.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { parse } from 'yaml';
import { EARTH_RADIUS, fromLocal } from '../../core/city.ts';
import { formatTime, historical, PRESENT_YEAR } from '../../core/time.ts';
import type { CameraState } from '../../viewer/src/camera.ts';
import type { CloudDrift } from '../../viewer/src/gl/globe.ts';

const REPO = join(import.meta.dirname, '../..');
const BUILDS = join(REPO, 'dist/builds');
const latestBuild = (): string => JSON.parse(readFileSync(join(BUILDS, 'index.json'), 'utf8')).latest;
const yearOfMa = (ma: number): number => PRESENT_YEAR - ma * 1e6;
const maOfYear = (year: number): number => (PRESENT_YEAR - year) / 1e6;

function option(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

// ── The world, as the build has it ──────────────────────────────────────────────────────────────

interface Span {
  /** in astronomical years */
  start: number;
  end: number;
  label: string;
}

interface SourceRecord {
  authors?: string[];
  published?: number;
  citation?: string;
}

/** "Scotese 2016", "Scotese & Wright 2018", "Cao et al. 2024". */
function shortCite(s: SourceRecord | undefined): string {
  const names = (s?.authors ?? []).map((a) => a.split(',')[0].trim());
  const who = names.length === 0 ? (s?.citation ?? '').split(' (')[0] : names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} & ${names[1]}` : `${names[0]} et al.`;
  return s?.published ? `${who} ${s.published}` : who;
}

/** A place the viewer draws a scene of near the ground, such as a city, as the build gives it. */
interface Site {
  id: string;
  label: string;
  origin: { lat: number; lon: number };
  /** the time its scene describes, in astronomical years */
  slice: number;
  /** where its "Fly down into" button arrives: so many metres east and north of the origin, looking at it from a range */
  view: { x: number; y: number; range: number; heading: number; tilt: number };
}

/** What a build says of records, phases of them, fields and sites: their spans in time, and their labels. */
class World {
  private dir: string;
  private fields: { id: string; title: string; coverage: [number, number]; sourceRecord?: SourceRecord }[];
  private sites: Site[];

  constructor(readonly build: string) {
    this.dir = join(BUILDS, build);
    const tileset = JSON.parse(readFileSync(join(this.dir, 'tileset.json'), 'utf8'));
    this.fields = tileset.fields;
    this.sites = tileset.sites ?? [];
  }

  site(id: string): Site {
    const s = this.sites.find((x) => x.id === id);
    if (!s) throw new Error(`${id}: no such site in build ${this.build}`);
    return s;
  }

  /** A record (earth/events/…), a phase of one (space/bodies/earth@oceans), or a field (field:…), whose span is its coverage. */
  span(ref: string): Span {
    if (ref.startsWith('field:')) {
      const f = this.fields.find((x) => x.id === ref);
      if (!f) throw new Error(`${ref}: no such field in build ${this.build}`);
      return { start: f.coverage[0], end: f.coverage[1], label: `${f.title} (${shortCite(f.sourceRecord)})` };
    }
    const [id, phase] = ref.split('@');
    type Timed = { id?: string; label: string; time?: { start: { best: number | null }; end: { best: number | null } } };
    let r: Timed & { phases?: Timed[] };
    try {
      r = JSON.parse(readFileSync(join(this.dir, 'records', `${id}.json`), 'utf8'));
    } catch {
      throw new Error(`${ref}: no record ${id} in build ${this.build}`);
    }
    const it = phase ? r.phases?.find((p) => p.id === phase) : r;
    if (!it) throw new Error(`${ref}: ${id} has no phase ${phase}`);
    if (!it.time) throw new Error(`${ref}: the build gives it no time`);
    // An open end: a city that still stands, a period still running.
    return { start: it.time.start.best ?? -Infinity, end: it.time.end.best ?? Infinity, label: it.label };
  }
}

// ── The shot list ───────────────────────────────────────────────────────────────────────────────

interface Beat {
  at: number;
  start?: string;
  end?: string;
  /** in Ma */
  age?: number;
  /** a site: the time its scene describes */
  scene?: string;
  /** seconds to hold time still here while the world just before dissolves into the world just after */
  dissolve?: number;
  /** leave out the time from here to the next beat: the one dissolves into the other over the seconds between */
  skip?: boolean;
}

interface CameraBeat {
  at: number;
  lat?: number;
  lon?: number;
  d?: number;
  /** heading and tilt in degrees, as the viewer's links give them (h=, v=): none looks straight down, north up */
  h?: number;
  v?: number;
  /** a site: the view its "Fly down into" button arrives at, in place of the rest */
  arrive?: string;
}

interface Caption {
  from: number;
  to: number;
  label?: string;
  note?: string;
}

interface Shot {
  fps: number;
  time: Beat[];
  camera: CameraBeat[];
  /** degrees a second, or false for no clouds */
  clouds?: CloudDrift | false;
  /** the hour a city is lit by, if not the viewer's */
  hour?: number;
  captions?: Caption[];
}

function yearOf(world: World, b: Beat): number {
  const given = [b.start, b.end, b.age, b.scene].filter((x) => x !== undefined).length;
  if (given !== 1) throw new Error(`the beat at ${b.at} s needs one of start, end, age or scene`);
  const y = b.start ? world.span(b.start).start : b.end ? world.span(b.end).end : b.scene ? world.site(b.scene).slice : yearOfMa(b.age!);
  if (!Number.isFinite(y)) throw new Error(`the beat at ${b.at} s: ${b.start ?? b.end} has no ${b.start ? 'start' : 'end'}`);
  return y;
}

type Camera = Required<Omit<CameraBeat, 'arrive'>>;

function cameraOf(world: World, c: CameraBeat): Camera {
  if (c.arrive) {
    const s = world.site(c.arrive);
    const [lat, lon] = fromLocal(s.origin, s.view.x, s.view.y);
    return { at: c.at, lat, lon, d: 1 + s.view.range / EARTH_RADIUS, h: s.view.heading, v: s.view.tilt };
  }
  if (c.lat === undefined || c.lon === undefined || c.d === undefined) throw new Error(`the camera at ${c.at} s needs lat, lon and d, or a site to arrive at`);
  return { at: c.at, lat: c.lat, lon: c.lon, d: c.d, h: c.h ?? 0, v: c.v ?? 0 };
}

/**
 * A monotone cubic through points (Fritsch–Carlson): smooth, and never past a point it passes
 * through, so time never runs backwards and a hold (two equal values) holds still.
 */
function monotone(xs: number[], ys: number[]): (x: number) => number {
  const n = xs.length;
  const d = xs.slice(0, -1).map((x, i) => (ys[i + 1] - ys[i]) / (xs[i + 1] - x));
  const m = ys.map((_, i) => (i === 0 ? d[0] : i === n - 1 ? d[n - 2] : d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2));
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      m[i] = (3 / Math.sqrt(s)) * a * d[i];
      m[i + 1] = (3 / Math.sqrt(s)) * b * d[i];
    }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

/** How far into the past to measure the logarithm of the age from, in Ma, so that the present has one. */
const LOG_FLOOR = 0.005;

interface Frame {
  s: number;
  /** the time shown, in astronomical years */
  year: number;
  cam: CameraState;
  drift?: CloudDrift;
  /** within a dissolve: the world just before and just after the change, and how far from the one to the other */
  across?: { before: number; after: number; w: number };
}

/** Every frame of a shot: its time, its camera, its clouds, and whether it dissolves. */
function plan(shot: Shot, world: World): Frame[] {
  const years = shot.time.map((b) => yearOf(world, b));
  const logAge = (y: number) => Math.log(maOfYear(y) + LOG_FLOOR);
  // The curve runs through the logarithm of the age at each beat. Across a skip it holds still, and the
  // ages after it are the curve's less what the skip leaves out.
  const knots: { s: number; v: number; year: number }[] = [];
  const holds: { from: number; to: number; before: number; after: number }[] = [];
  const shifts: { from: number; by: number }[] = [];
  let shift = 0;
  for (const [i, b] of shot.time.entries()) {
    const y = years[i];
    const prev = shot.time[i - 1];
    if (prev && y < years[i - 1]) throw new Error(`time runs backwards between ${prev.at} s (${maOfYear(years[i - 1])} Ma) and ${b.at} s (${maOfYear(y)} Ma)`);
    if (b.skip && b.dissolve) throw new Error(`the beat at ${b.at} s both skips and dissolves`);
    if (prev?.skip) {
      shift += logAge(years[i - 1]) - logAge(y);
      shifts.push({ from: b.at, by: shift });
      holds.push({ from: prev.at, to: b.at, before: years[i - 1] - 1, after: y + 1 });
    }
    knots.push({ s: b.at, v: logAge(y) + shift, year: y });
    if (b.dissolve) {
      knots.push({ s: b.at + b.dissolve, v: logAge(y) + shift, year: y });
      holds.push({ from: b.at, to: b.at + b.dissolve, before: y - 1, after: y + 1 });
    }
  }
  if (shot.time.at(-1)?.skip) throw new Error('the last time beat skips to nothing');
  for (let i = 1; i < knots.length; i++) {
    if (knots[i].s <= knots[i - 1].s) throw new Error(`the time beats at ${knots[i - 1].s} s and ${knots[i].s} s overlap: a dissolve runs into the next beat`);
  }
  const curve = monotone(knots.map((k) => k.s), knots.map((k) => k.v));

  // The camera: the distance from the ground on a logarithm, so a fall from orbit to the street is as even
  // in its scale as a turn; a heading turns the short way round, and so does the way to a site.
  const cams = shot.camera.map((c) => cameraOf(world, c));
  for (let i = 1; i < cams.length; i++) {
    cams[i].h += 360 * Math.round((cams[i - 1].h - cams[i].h) / 360);
    if (shot.camera[i].arrive) cams[i].lon += 360 * Math.round((cams[i - 1].lon - cams[i].lon) / 360);
  }
  const cs = cams.map((c) => c.at);
  const along = (k: keyof Camera) => monotone(cs, cams.map((c) => c[k]));
  const [lat, lon, heading, tilt] = [along('lat'), along('lon'), along('h'), along('v')];
  const height = monotone(cs, cams.map((c) => Math.log(c.d - 1)));

  const end = Math.max(knots.at(-1)!.s, cs.at(-1)!);
  const n = Math.round(end * shot.fps) + 1;
  const ease = (x: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, x)));
  const frames: Frame[] = [];
  for (let i = 0; i < n; i++) {
    const s = i / shot.fps;
    // Where time holds still, the beat's own year, rather than the curve's round trip through a logarithm.
    const still = knots.findIndex((k, j) => j + 1 < knots.length && k.s <= s && s <= knots[j + 1].s && Math.abs(k.v - knots[j + 1].v) < 1e-12);
    const by = shifts.filter((x) => x.from <= s).at(-1)?.by ?? 0;
    let year = still >= 0 ? knots[still].year : yearOfMa(Math.max(0, Math.exp(curve(s) - by) - LOG_FLOOR));
    let across: Frame['across'];
    for (const h of holds) {
      // Near a change, time is all but still: keep each side's frames on their own side of it.
      if (s < h.from) year = Math.min(year, h.before);
      else if (s > h.to) year = Math.max(year, h.after);
      else {
        const w = ease((s - h.from) / (h.to - h.from));
        across = { before: h.before, after: h.after, w };
        year = w < 0.5 ? h.before : h.after;
      }
    }
    // The clouds come to where the viewer has them at the last frame, so that the viewer takes over from it.
    const c = shot.clouds;
    const ago = (n - 1) / shot.fps - s;
    const drift = c ? { tropics: -c.tropics * ago, beyond: -c.beyond * ago, between: c.between } : undefined;
    const cam: CameraState = { lat: lat(s), lon: lon(s), dist: 1 + Math.exp(height(s)), heading: heading(s), tilt: tilt(s) };
    frames.push({ s, year, cam, drift, across });
  }
  return frames;
}

// ── Captions ────────────────────────────────────────────────────────────────────────────────────

/** An age as the captions give it: "4,537 Ma", "66.0 Ma", "2.72 Ma", "19.5 ka"; in the last ten thousand years, the year, as the viewer gives it: "753 BCE", "315 CE". */
function ageLabel(year: number): string {
  if (historical(year)) return year >= PRESENT_YEAR ? 'today' : formatTime(year);
  const ma = maOfYear(year);
  if (ma >= 100) return `${Math.round(ma).toLocaleString('en-US')} Ma`;
  if (ma >= 10) return `${ma.toFixed(1)} Ma`;
  if (ma >= 1) return `${ma.toFixed(2)} Ma`;
  const ka = ma * 1000;
  if (ka >= 100) return `${Math.round(ka)} ka`;
  if (ka >= 1) return `${ka.toFixed(1)} ka`;
  const yr = Math.round(ma * 1e6);
  return yr <= 0 ? 'today' : `${yr.toLocaleString('en-US')} years ago`;
}

interface CaptionOut {
  from: number;
  to: number;
  text: string;
  ref?: string;
}

/** How long a caption may be on screen before its record's span begins or after it ends, in seconds; after an instant, long enough to read it by. */
const CAPTION_SLACK = 0.5;
const CAPTION_AFTER_INSTANT = 1.2;

/** Each caption's words, after checking that it is shown while the time shown is within its record's span, give or take the slack. */
function captionsOf(shot: Shot, world: World, frames: Frame[]): CaptionOut[] {
  return (shot.captions ?? []).map((c) => {
    const parts: string[] = [];
    if (c.label) {
      const sp = world.span(c.label);
      // When the video comes to the span and when it leaves it; time never runs backwards.
      const inside = frames.filter((f) => f.year >= sp.start - 1 && f.year <= sp.end + 1);
      const enters = inside[0]?.s ?? frames.find((f) => f.year > sp.end)?.s;
      const leaves = inside.at(-1)?.s ?? enters;
      if (enters === undefined || leaves === undefined) console.warn(`caption ${c.label}: the video never comes to its time, ${ageLabel(sp.start)}`);
      else if (c.from < enters - CAPTION_SLACK || c.to > leaves + (sp.start === sp.end ? CAPTION_AFTER_INSTANT : CAPTION_SLACK)) {
        console.warn(`caption ${c.label} (${c.from}–${c.to} s): the video is within its span, ${ageLabel(sp.start)} to ${ageLabel(sp.end)}, from ${enters.toFixed(2)} s to ${leaves.toFixed(2)} s`);
      }
      parts.push(sp.label);
    }
    if (c.note) parts.push(c.note);
    return { from: c.from, to: c.to, text: parts.join(' · '), ref: c.label };
  });
}

/** The captions over the frames, in Advanced SubStation Alpha, to burn into a copy to look at: the age, what is shown, and the second. */
function ass(frames: Frame[], captions: CaptionOut[], fps: number, width: number, height: number): string {
  const time = (s: number) => {
    const cs = Math.floor(s * 100 + 1e-6);
    const pad = (x: number) => String(x).padStart(2, '0');
    return `${Math.floor(cs / 360000)}:${pad(Math.floor(cs / 6000) % 60)}:${pad(Math.floor(cs / 100) % 60)}.${pad(cs % 100)}`;
  };
  const px = (x: number) => Math.round((x * height) / 606);
  const style = (name: string, size: number, colour: string, align: number, margin: number) =>
    `Style: ${name},Helvetica Neue,${px(size)},${colour},${colour},&H96000000,&H00000000,0,0,0,0,100,100,0,0,1,${px(1.2)},0,${align},${px(34)},${px(28)},${px(margin)},1`;
  const lines: string[] = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    style('Age', 30, '&H00FFFFFF', 1, 58),
    style('Caption', 19, '&H00F2ECE6', 1, 30),
    style('Clock', 14, '&H40FFFFFF', 9, 18),
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  // One event for each run of frames that say the same.
  const runs = (style: string, text: (f: Frame) => string) => {
    let from = 0;
    for (let i = 1; i <= frames.length; i++) {
      if (i < frames.length && text(frames[i]) === text(frames[from])) continue;
      lines.push(`Dialogue: 0,${time(from / fps)},${time(i / fps)},${style},,0,0,0,,${text(frames[from])}`);
      from = i;
    }
  };
  runs('Age', (f) => ageLabel(f.year));
  runs('Clock', (f) => `${f.s.toFixed(1)} s`);
  for (const c of captions) lines.push(`Dialogue: 0,${time(c.from)},${time(c.to)},Caption,,0,0,0,,${c.text}`);
  return lines.join('\n') + '\n';
}

// ── Drawing ─────────────────────────────────────────────────────────────────────────────────────

/** Wait until the viewer has loaded what the view needs and drawn it, twice in a row (as the browser tests do). */
async function idle(page: Page): Promise<void> {
  for (let i = 0; i < 2; i++) {
    try {
      await page.waitForFunction(() => window.__wikiworldmodel?.idle(), null, { polling: 'raf', timeout: 100_000 });
    } catch (e) {
      const waiting = await page.evaluate(() => window.__wikiworldmodel?.waiting() ?? ['the page']).catch(() => ['the page']);
      throw new Error(`the view did not settle: still waiting on ${waiting.join(', ')}`, { cause: e });
    }
    if (i === 0) await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  }
}

const png = (url: string): Buffer => Buffer.from(url.split(',')[1], 'base64');

async function canvasPng(page: Page): Promise<Buffer> {
  return png(await page.evaluate(() => (document.querySelector('canvas.globe') as HTMLCanvasElement).toDataURL('image/png')));
}

/** Lay the globe's canvas over a 2D canvas of the same size, at an opacity: at 1 it starts afresh. With `done`, what the 2D canvas has, as a PNG. */
async function layer(page: Page, alpha: number, done: boolean): Promise<Buffer | null> {
  const url = await page.evaluate(
    ({ alpha, done }) => {
      const g = document.querySelector('canvas.globe') as HTMLCanvasElement;
      const w = window as unknown as { __mix?: HTMLCanvasElement };
      const c = (w.__mix ??= document.createElement('canvas'));
      if (alpha === 1) {
        c.width = g.width;
        c.height = g.height;
      }
      const x = c.getContext('2d')!;
      x.globalAlpha = alpha;
      x.drawImage(g, 0, 0);
      return done ? c.toDataURL('image/png') : null;
    },
    { alpha, done },
  );
  return url ? png(url) : null;
}

async function open(url: string, scale: number, first: { ma: number; lat: number; lon: number; d: number }): Promise<{ page: Page; close: () => Promise<void> }> {
  // The GPU, not SwiftShader: this is for looking at, not for golden images.
  const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: scale });
  page.on('console', (m) => m.type() === 'error' && console.error(`[page] ${m.text()}`));
  await page.goto(`${url}?b=${latestBuild()}&t=${first.ma}Ma&lat=${first.lat}&lon=${first.lon}&d=${first.d}`);
  await idle(page);
  return { page, close: () => browser.close() };
}

async function show(page: Page, year: number, f: Frame, clouds: boolean, hour?: number): Promise<void> {
  await page.evaluate(
    ({ t, cam, clouds, drift, hour }) => {
      const h = window.__wikiworldmodel!;
      h.set(hour === undefined ? { t, cam, clouds } : { t, cam, clouds, hour });
      h.driftClouds(drift ?? null);
    },
    { t: year, cam: f.cam, clouds, drift: f.drift, hour },
  );
  await idle(page);
}

async function frames(shotFile: string, out: string): Promise<void> {
  const shot = parse(readFileSync(shotFile, 'utf8')) as Shot;
  const world = new World(latestBuild());
  const all = plan(shot, world);
  const captions = captionsOf(shot, world, all);
  const from = Number(option('from') ?? 0);
  const to = Number(option('to') ?? Infinity);
  mkdirSync(join(out, 'frames'), { recursive: true });
  const f0 = all[0];
  const { page, close } = await open(option('url') ?? 'http://localhost:5173/', Number(option('scale') ?? 1), { ma: maOfYear(f0.year), lat: f0.cam.lat, lon: f0.cam.lon, d: f0.cam.dist });
  const size = await page.evaluate(() => {
    const g = document.querySelector('canvas.globe') as HTMLCanvasElement;
    return { width: g.width, height: g.height };
  });
  const clouds = shot.clouds !== false;
  const t0 = performance.now();
  let drawn = 0;
  try {
    for (const [i, f] of all.entries()) {
      if (f.s < from || f.s > to) continue;
      let image: Buffer;
      if (f.across && f.across.w > 0 && f.across.w < 1) {
        await show(page, f.across.before, f, clouds, shot.hour);
        await layer(page, 1, false);
        await show(page, f.across.after, f, clouds, shot.hour);
        image = (await layer(page, f.across.w, true))!;
      } else {
        await show(page, f.across ? (f.across.w < 1 ? f.across.before : f.across.after) : f.year, f, clouds, shot.hour);
        image = await canvasPng(page);
      }
      writeFileSync(join(out, 'frames', `${String(i).padStart(5, '0')}.png`), image);
      if (++drawn % 60 === 0) console.log(`frame ${i}/${all.length}: ${ageLabel(f.year)}, ${Math.round((performance.now() - t0) / 1000)} s`);
    }
  } finally {
    await close();
  }
  writeFileSync(join(out, 'captions.json'), JSON.stringify(captions, null, 1) + '\n');
  writeFileSync(join(out, 'captions.ass'), ass(all, captions, shot.fps, size.width, size.height));
  writeFileSync(join(out, 'ages.json'), JSON.stringify({ build: world.build, fps: shot.fps, ma: all.map((f) => Number(maOfYear(f.year).toPrecision(9))) }) + '\n');
  console.log(`${drawn} frames of ${all.length}, ${size.width} × ${size.height}, in ${Math.round((performance.now() - t0) / 1000)} s, from build ${world.build}`);
}

interface View {
  name: string;
  /** the age in Ma, or the astronomical year */
  ma?: number;
  t?: number;
  lat: number;
  lon: number;
  d: number;
  h?: number;
  v?: number;
  hour?: number;
  clouds?: boolean;
}

async function stills(viewsFile: string, out: string): Promise<void> {
  const views = JSON.parse(readFileSync(viewsFile, 'utf8')) as View[];
  const yearOfView = (v: View) => v.t ?? yearOfMa(v.ma!);
  mkdirSync(out, { recursive: true });
  const { page, close } = await open(option('url') ?? 'http://localhost:5173/', Number(option('scale') ?? 1), { ...views[0], ma: maOfYear(yearOfView(views[0])) });
  try {
    for (const v of views) {
      const t0 = performance.now();
      const cam: CameraState = { lat: v.lat, lon: v.lon, dist: v.d, heading: v.h, tilt: v.v };
      await page.evaluate((s) => window.__wikiworldmodel!.set(s), { t: yearOfView(v), cam, clouds: v.clouds ?? true, ...(v.hour === undefined ? {} : { hour: v.hour }) });
      await idle(page);
      writeFileSync(join(out, `${v.name}.png`), await canvasPng(page));
      console.log(`${v.name}: ${ageLabel(yearOfView(v))}, ${Math.round(performance.now() - t0)} ms`);
    }
  } finally {
    await close();
  }
}

const [command, ...args] = process.argv.slice(2);
if (command === 'frames') await frames(args[0], args[1]);
else if (command === 'stills') await stills(args[0], args[1]);
else {
  console.error('usage: timelapse.ts frames <shot list> <out dir> [--url …] [--scale 1] [--from s --to s] | stills <views.json> <out dir> [--url …] [--scale 1]');
  process.exit(1);
}
