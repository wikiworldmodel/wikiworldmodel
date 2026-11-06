// Pass criteria for the ice sheets: at the Last Glacial Maximum ice covers Canada and northern Europe
// where the dataset says and not where it does not, as the globe holds it and as it draws it; ice falls
// back to what it was outside the dataset's span; it moves with its plates, at that scale; a click says
// what the dataset gives and how uncertain it is; and the dataset's two scenarios can be told apart.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeTile } from '../../../core/container.ts';
import { decodeMargin, decodeThickness, iceFrame, iceScenario, type IceHeader } from '../../../core/ice.ts';
import { conj, rotate, toLatLon, unitVector } from '../../../core/quat.ts';
import { RotationModel } from '../../../core/rotation-model.ts';
import type { SearchFile } from '../../../core/records.ts';
import type { FramesFile, Tileset } from '../../../core/tileset.ts';
import { buildFile, canvasPatch, idle, latestBuild } from './helpers.ts';

const year = (ka: number) => Math.round(1950 - ka * 1e3);
const MA = (ka: number) => ka / 1e3;
const REPO = join(import.meta.dirname, '../../..');

/** The dataset as the build wrote it: what each test holds the globe to. */
function iceFile() {
  const b = readFileSync(join(REPO, 'dist/builds', latestBuild(), 'ice.lwt'));
  const { header, arrays } = decodeTile<IceHeader>(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
  const node = (lat: number, lon: number) => (header.grid.lat0 - lat) * header.grid.nx + (((lon + 180) % 360) + 360) % 360;
  /** At a node at a keyframe: how far it is inside the margin in km, and how thick. */
  const at = (ka: number, lat: number, lon: number, alts: string[] = []) => {
    const k = iceFrame(header, iceScenario(header, alts), MA(ka));
    return { km: decodeMargin(arrays[k.margin][node(lat, lon)]), thickness: decodeThickness(arrays[k.thickness][node(lat, lon)]) };
  };
  /** The plate a node rides, as the file's index of it. */
  const plateAt = (lat: number, lon: number) => arrays[header.plate][node(lat, lon)];
  return { header, at, plateAt };
}

/** Fly to a place at a time, without clouds, and read the colour of the patch under the camera. */
async function colourAt(page: Page, lat: number, lon: number) {
  await page.evaluate((cam) => window.__wikiworldmodel!.set({ cam: { ...cam, dist: 1.5 }, clouds: false }), { lat, lon });
  await idle(page);
  return canvasPatch(page, 0.5, 0.5, 11);
}

/** A click at the middle of the globe's canvas, which is where the camera looks. */
async function clickCentre(page: Page) {
  const box = (await page.locator('canvas.globe').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

/** Ice is white and bright: its least channel is high. Nothing else on the land of the time is. */
const bright = ([r, g, b]: number[]) => Math.min(r, g, b);

test.describe('at the Last Glacial Maximum', () => {
  test('the build has the field, and the LGM falls inside it', () => {
    const ts = buildFile<Tileset>('tileset.json');
    expect(ts.files.ice).toBe('ice.lwt');
    expect(ts.ice!.keyframesMa).toHaveLength(33);
    expect(ts.ice!.keyframesMa[0]).toBe(0);
    expect(ts.ice!.keyframesMa.at(-1)).toBe(0.08);
    expect(ts.credits.map((c) => c.label).join()).toContain('PaleoMIST 1.0');
    const lgm = buildFile<SearchFile>('search.json').entities.find((e) => e.id === 'earth/ice-ages/last-glacial-maximum')!;
    expect(lgm.time.start.best!).toBeGreaterThan(ts.ice!.coverage[0]);
    expect(lgm.time.end.best!).toBeLessThan(1950);
  });

  test('what the globe holds is what the dataset says, everywhere', async ({ page }) => {
    const { at } = iceFile();
    await page.goto(`/?b=${latestBuild()}&t=${year(20)}&lat=60&lon=-90&d=2.6`);
    await idle(page);
    // Every fourth degree, leaving out nodes right at the margin: the globe's cube samples between nodes.
    const places: [number, number][] = [];
    for (let lat = -84; lat <= 84; lat += 4) for (let lon = -180; lon < 180; lon += 4) if (Math.abs(at(20, lat, lon).km) > 80) places.push([lat, lon]);
    const seen = await page.evaluate((list) => list.map(([a, o]) => window.__wikiworldmodel!.iceAt(a, o)!.drawn), places);
    const wrong = places.filter(([a, o], i) => seen[i] !== at(20, a, o).km > 0);
    expect(wrong).toEqual([]);
    expect(seen.filter(Boolean).length).toBeGreaterThan(200);
    expect(seen.filter((x) => !x).length).toBeGreaterThan(1000);
  });

  test('ice covers Canada and northern Europe where the dataset says, and not where it does not', async ({ page }) => {
    const { at } = iceFile();
    const under = {
      'Hudson Bay': [60, -85],
      'Keewatin': [63, -100],
      'Quebec': [52, -73],
      'the Great Lakes': [46, -85],
      'Stockholm': [59, 18],
      'the Gulf of Bothnia': [64, 21],
      'the Barents Sea': [73, 35],
    } as Record<string, [number, number]>;
    const beyond = {
      'the middle of Siberia': [65, 110],
      'the Yukon, ice-free in Beringia': [65, -150],
      'Kansas': [38, -98],
      'Madrid': [40, -4],
      'Ukraine': [48, 32],
      'the Sahara': [23, 10],
    } as Record<string, [number, number]>;
    for (const [lat, lon] of Object.values(under)) expect(at(20, lat, lon).km).toBeGreaterThan(100);
    for (const [lat, lon] of Object.values(beyond)) expect(at(20, lat, lon).km).toBeLessThan(-100);
    await page.goto(`/?b=${latestBuild()}&t=${year(20)}&lat=60&lon=-90&d=1.5&cl=0`);
    await idle(page);
    for (const [name, [lat, lon]] of Object.entries(under)) {
      const c = await colourAt(page, lat, lon);
      expect(bright(c), `${name} ${c}`).toBeGreaterThan(170);
    }
    for (const [name, [lat, lon]] of Object.entries(beyond)) {
      const c = await colourAt(page, lat, lon);
      expect(bright(c), `${name} ${c}`).toBeLessThan(150);
    }
  });

  test('at the LGM\'s own dates too, which are not keyframes', async ({ page }) => {
    const lgm = buildFile<SearchFile>('search.json').entities.find((e) => e.id === 'earth/ice-ages/last-glacial-maximum')!;
    const t = Math.round((lgm.time.start.best! + lgm.time.end.best!) / 2);
    await page.goto(`/?b=${latestBuild()}&t=${t}&lat=60&lon=-90&d=2.6`);
    await idle(page);
    const read = (lat: number, lon: number) => page.evaluate(([a, o]) => window.__wikiworldmodel!.iceAt(a, o), [lat, lon]);
    expect((await read(60, -85))!.drawn).toBe(true);
    expect((await read(60, -85))!.thickness).toBeGreaterThan(1000);
    expect((await read(59, 18))!.drawn).toBe(true);
    expect((await read(38, -98))!.drawn).toBe(false);
  });
});

test('the ice grows and shrinks between keyframes, its edge moving evenly from one to the next', async ({ page }) => {
  const { at } = iceFile();
  // A place the Laurentide's retreat crosses: well inside its margin at 17.5 ka, and well outside at 15 ka.
  let place: [number, number] | undefined;
  for (let a = 40; a <= 60 && !place; a++) for (let o = -110; o <= -70 && !place; o++) if (at(17.5, a, o).km > 150 && at(15, a, o).km < -150) place = [a, o];
  expect(place).toBeDefined();
  const [lat, lon] = place!;
  const read = async (ka: number) => {
    await page.evaluate((t) => window.__wikiworldmodel!.set({ t }), year(ka));
    await idle(page);
    return (await page.evaluate(([a, o]) => window.__wikiworldmodel!.iceAt(a, o), [lat, lon]))!;
  };
  await page.goto(`/?b=${latestBuild()}&t=${year(17.5)}&lat=${lat}&lon=${lon}&d=2.6`);
  await idle(page);
  const steps: { marginKm: number; drawn: boolean; thickness: number }[] = [];
  for (const ka of [17.5, 17, 16.5, 16, 15.5, 15]) steps.push(await read(ka));
  // The distance to the margin falls steadily, not at a jump at the keyframe.
  for (let i = 1; i < steps.length; i++) expect(steps[i].marginKm).toBeLessThan(steps[i - 1].marginKm + 1e-6);
  const drops = steps.slice(1).map((s, i) => steps[i].marginKm - s.marginKm);
  expect(Math.max(...drops) - Math.min(...drops)).toBeLessThan(20);
  expect(Math.abs(steps[0].marginKm - at(17.5, lat, lon).km)).toBeLessThan(16);
  expect(Math.abs(steps.at(-1)!.marginKm - at(15, lat, lon).km)).toBeLessThan(16);
});

test('outside the dataset\'s span ice falls back to what it was', async ({ page }) => {
  // Older than the dataset, nothing of it is drawn: the look is a claimed latitude, and at 85 ka there is none.
  const before = year(85);
  await page.goto(`/?b=${latestBuild()}&t=${before}&lat=60&lon=-90&d=2.6`);
  await idle(page);
  expect(await page.evaluate(() => window.__wikiworldmodel!.iceAt(60, -85))).toBeNull();
  await expect(page.locator('.planet-ice')).toBeHidden();
  // The Sturtian's claim still draws its ice to the equator.
  await page.evaluate((t) => window.__wikiworldmodel!.set({ t }), 1950 - 690e6);
  await idle(page);
  await expect(page.locator('.planet-ice')).toContainText('to the equator');
  expect(await page.evaluate(() => window.__wikiworldmodel!.iceAt(60, -85))).toBeNull();
  // Inside the span it is the field's.
  await page.evaluate((t) => window.__wikiworldmodel!.set({ t }), year(79));
  await idle(page);
  expect(await page.evaluate(() => window.__wikiworldmodel!.iceAt(60, -85))).not.toBeNull();
});

test('inside the span ice is the field\'s alone: the climate\'s own reading of ice gives way to it, and comes back outside', async ({ page }) => {
  const { at } = iceFile();
  // The north of Ellesmere Island: never thawing in the climate field, and with no sheet on it at 42.5 ka.
  const [lat, lon] = [82, -64];
  expect(at(42.5, lat, lon).km).toBeLessThan(0);
  await page.goto(`/?b=${latestBuild()}&t=${year(42.5)}&lat=${lat}&lon=${lon}&d=1.5&cl=0`);
  await idle(page);
  expect((await page.evaluate(([a, o]) => window.__wikiworldmodel!.biomeAt(a, o), [lat, lon]))!.climate).toBe('ice');
  const inside = bright(await canvasPatch(page, 0.5, 0.5, 11));
  await page.evaluate((t) => window.__wikiworldmodel!.set({ t }), year(85));
  await idle(page);
  const outside = bright(await canvasPatch(page, 0.5, 0.5, 11));
  expect(outside).toBeGreaterThan(inside + 40);
});

test('after the present the field holds today\'s ice, as the elevation holds today\'s land, and then stops', async ({ page }) => {
  const ts = buildFile<Tileset>('tileset.json');
  await page.goto(`/?b=${latestBuild()}&t=0Ma&lat=72&lon=-40&d=2.6`);
  await idle(page);
  const today = await page.evaluate(() => window.__wikiworldmodel!.iceAt(72, -40));
  expect(today!.drawn).toBe(true);
  await page.evaluate((t) => window.__wikiworldmodel!.set({ t }), 1950 + 5000);
  await idle(page);
  const held = await page.evaluate(() => window.__wikiworldmodel!.iceAt(72, -40));
  expect(held!.drawn).toBe(true);
  expect(held!.marginKm).toBeCloseTo(today!.marginKm, 0);
  await page.evaluate((t) => window.__wikiworldmodel!.set({ t }), ts.ice!.coverage[1] + 1000);
  await idle(page);
  expect(await page.evaluate(() => window.__wikiworldmodel!.iceAt(72, -40))).toBeNull();
});

test('it moves with what the plates do at that scale: a few km over the whole span, on the same plates as the land', async ({ page }) => {
  const { at, plateAt } = iceFile();
  const frames = buildFile<FramesFile>('frames.json');
  const model = new RotationModel(frames.rotations);
  // Where its plate has carried a node of today's coordinates by 80 ka, and how far that is.
  const moved = (lat: number, lon: number) => {
    const plate = frames.plateIndex[plateAt(lat, lon)];
    const [la, lo] = toLatLon(rotate(model.total(plate, 0.08), rotate(conj(model.total(plate, 0)), unitVector(lat, lon))));
    return { plate, la, lo, km: Math.hypot(la - lat, (lo - lon) * Math.cos((lat * Math.PI) / 180)) * 111.19 };
  };
  // Canada and Fennoscandia ride plates that do move, and not far: a small part of a node.
  for (const [lat, lon] of [[60, -85], [62, 18]]) {
    const m = moved(lat, lon);
    expect(m.plate).toBeGreaterThan(0);
    expect(m.km).toBeGreaterThan(0.1);
    expect(m.km).toBeLessThan(6);
  }
  // The globe at 80 ka holds the keyframe's margin at the place the plate carried the node to.
  await page.goto(`/?b=${latestBuild()}&t=${year(80)}&lat=60&lon=-85&d=2.6`);
  await idle(page);
  const node = [61, -75] as const;
  const carried = moved(node[0], node[1]);
  const seen = (await page.evaluate(([a, o]) => window.__wikiworldmodel!.iceAt(a, o), [carried.la, carried.lo]))!;
  expect(Math.abs(seen.marginKm - at(80, node[0], node[1]).km)).toBeLessThan(24);
});

test('a click says what the dataset gives and how uncertain it is', async ({ page }) => {
  await page.goto(`/?b=${latestBuild()}&t=${year(20)}&lat=60&lon=-85&d=2.2&cl=0`);
  await idle(page);
  await clickCentre(page);
  await idle(page);
  const panel = page.locator('.inspect');
  await expect(panel.locator('h2')).toHaveText('Ice sheet');
  const ice = panel.locator('.ice');
  await expect(ice.locator('h3')).toHaveText('Ice here');
  await expect(panel.locator('.kind').first()).toHaveText('Ice sheets of the last glacial cycle');
  await expect(panel).toContainText('The ground beneath it is');
  await expect(ice).toContainText(/About [\d,]+ m/);
  await expect(ice).toContainText(/Gowan \d{4} gives [\d,]+ m at 20 ka/);
  // How uncertain: no error bars, and the range the authors offer.
  await expect(ice).toContainText('no error bar');
  await expect(ice).toContainText('two scenarios');
  await expect(ice).toContainText('100 m contour');
  await expect(ice.locator('.badge.basis-reconstruction')).toBeVisible();
  await expect(ice.locator('a')).toHaveAttribute('href', 'https://doi.org/10.1594/PANGAEA.905800');
  // Under the ice the land's cover is not what it says.
  await expect(panel.locator('.biome')).toHaveCount(0);
  // Beyond the ice nothing of it is said.
  await page.evaluate(() => window.__wikiworldmodel!.set({ cam: { lat: 20, lon: 15, dist: 2.2 } }));
  await idle(page);
  await clickCentre(page);
  await idle(page);
  await expect(panel.locator('h2')).toHaveText('Land surface');
  await expect(panel.locator('.ice')).toHaveCount(0);
  await expect(panel.locator('.biome')).toBeVisible();
});

test('the planet panel sets the ice, as sea level, beside the sea-level stack', async ({ page }) => {
  await page.goto(`/?b=${latestBuild()}&t=${year(20)}&lat=60&lon=-85&d=2.6`);
  await idle(page);
  const row = page.locator('.planet-row[data-series="field:earth/ice-sheet-sea-level"]');
  await expect(row).toContainText('Ice sheets, as sea level');
  await expect(row).toContainText(/−?-?11\d m/);
  await expect(page.locator('.planet-row[data-series="field:earth/sea-level-stack"]')).toBeVisible();
  await row.click();
  await expect(page.locator('.inspect h2')).toHaveText('Ice sheets, as sea level');
  await expect(page.locator('.inspect')).toContainText('between the dataset\'s two scenarios');
});

test('its two scenarios: the alternative frees Hudson Bay of ice for a short time, and a click says so', async ({ page }) => {
  const { at, header } = iceFile();
  const alt = header.scenarios[1].alt!;
  const [lat, lon] = [58, -85];
  // The premise: at 42.5 ka the dataset has ice on the bay in one, and none in the other.
  expect(at(42.5, lat, lon).km).toBeGreaterThan(50);
  expect(at(42.5, lat, lon, [alt]).km).toBeLessThan(-50);
  await page.goto(`/?b=${latestBuild()}&t=${year(42.5)}&lat=${lat}&lon=${lon}&d=2.2&cl=0`);
  await idle(page);
  const drawn = () => page.evaluate(([a, o]) => window.__wikiworldmodel!.iceAt(a, o)!.drawn, [lat, lon]);
  expect(await drawn()).toBe(true);
  const white = bright(await canvasPatch(page, 0.5, 0.5, 11));
  await clickCentre(page);
  await idle(page);
  const ice = page.locator('.inspect .ice');
  await expect(ice).toContainText('Drawn here: ice over Hudson Bay');
  await expect(ice).toContainText('In its other scenario here, Hudson Bay ice-free');
  await expect(ice).toContainText(/ice-free[^:]*: none/);
  // Choosing the alternative draws the other, and the panel follows on the next click.
  await page.locator('.tg-alts').click();
  await page.selectOption('select[data-group="alt:laurentide-mis3"]', alt);
  await idle(page);
  expect(await drawn()).toBe(false);
  expect(bright(await canvasPatch(page, 0.5, 0.5, 11))).toBeLessThan(white - 30);
  // The ice's sea level follows it.
  const reading = page.locator('.planet-row[data-series="field:earth/ice-sheet-sea-level"] .planet-value');
  await expect(reading).toHaveText('-26.1 m');
  await page.selectOption('select[data-group="alt:laurentide-mis3"]', '');
  await idle(page);
  await expect(reading).toHaveText('-37.1 m');
  await page.selectOption('select[data-group="alt:laurentide-mis3"]', alt);
  await idle(page);
  // Away from that time the two are drawn alike.
  await page.evaluate((t) => window.__wikiworldmodel!.set({ t }), year(20));
  await idle(page);
  expect(await drawn()).toBe(true);
});

test('evidence mode marks the ice sheets as a reconstruction, not as procedural', async ({ page }) => {
  await page.goto(`/?b=${latestBuild()}&t=${year(20)}&lat=60&lon=-85&d=1.5&cl=0&ev=1`);
  await idle(page);
  // The hatching is amber, as over the rest of the field: more red than blue. Procedural ice would hatch magenta.
  const sample = await page.evaluate(() => {
    const src = document.querySelector('canvas.globe') as HTMLCanvasElement;
    const c = document.createElement('canvas');
    c.width = src.width;
    c.height = src.height;
    const g = c.getContext('2d')!;
    g.drawImage(src, 0, 0);
    const d = g.getImageData(Math.round(src.width / 2) - 8, Math.round(src.height / 2) - 8, 16, 16).data;
    let greenOverMagenta = 0;
    for (let i = 0; i < d.length; i += 4) greenOverMagenta += d[i + 1] - d[i + 2];
    return greenOverMagenta / (d.length / 4);
  });
  // Amber raises green over blue; magenta would push it below.
  expect(sample).toBeGreaterThan(-5);
});
