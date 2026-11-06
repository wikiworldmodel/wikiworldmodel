// Pass criteria for the biomes: no vegetation before the land-plants claim, on the globe and in its
// panel; the land's colours change with what the transitions allow; and a border between climates
// moves with the plates, as the land under it does.
import { expect, test } from '@playwright/test';
import type { PlanetFile } from '../../../core/planet.ts';
import { RotationModel } from '../../../core/rotation-model.ts';
import { conj, rotate, toLatLon, unitVector } from '../../../core/quat.ts';
import type { FramesFile, Tileset } from '../../../core/tileset.ts';
import { buildFile, canvasPatch, idle, latestBuild } from './helpers.ts';

const year = (ma: number) => Math.round(1950 - ma * 1e6);
/** Where the middle of Africa stood at an age, on the globe's coordinates at that time. */
function onAfrica(ageMa: number): [number, number] {
  const model = new RotationModel(buildFile<FramesFile>('frames.json').rotations);
  const [lat, lon] = toLatLon(rotate(model.total(701, ageMa), rotate(conj(model.total(701, 0)), unitVector(2, 22))));
  return [lat, lon];
}
const startOf = (cover: string) => buildFile<PlanetFile>('planet.json').covers!.find((c) => c.values.cover?.some((v) => v.value === cover))!.time.start.best!;

test('a build with biomes hands the globe its climate, and generates the texture the build recorded, within the tolerance', async ({ page }) => {
  const ts = buildFile<Tileset>('tileset.json');
  expect(ts.files.climate).toBeTruthy();
  await page.goto(`/?b=${latestBuild()}&t=${year(100)}&lat=30&lon=0&d=3`);
  await idle(page);
  const made = await page.evaluate(() => window.__wikiworldmodel!.biomeTexture);
  expect(made.expected?.pixels?.n).toBeGreaterThan(0);
  expect(made.actual).not.toBeNull();
  expect(made.problems).toEqual([]);
});

test('no vegetation before the land-plants claim: not in what the globe is told, nor in what the panel says', async ({ page }) => {
  const plants = startOf('land-plants');
  const before = Math.round(plants - 2e7);
  await page.goto(`/?b=${latestBuild()}&t=${before}&lat=-30&lon=20&d=2.6`);
  await idle(page);
  const here = await page.evaluate(() => window.__wikiworldmodel!.biomeAt(-30, 20));
  expect(here).not.toBeNull();
  expect(here!.cover.plants).toBe(0);
  expect(here!.cover.forests).toBe(0);
  expect(here!.cover.grasses).toBe(0);
  // After them, and after the forests, the same call says otherwise.
  await page.evaluate((t) => window.__wikiworldmodel!.set({ t }), startOf('forests') + 1e8);
  await idle(page);
  const later = await page.evaluate(() => window.__wikiworldmodel!.biomeAt(-30, 20));
  expect(later!.cover.plants).toBe(1);
  expect(later!.cover.forests).toBe(1);
});

test('a click on the land says what covers it, and which transitions it rests on', async ({ page }) => {
  const [lat, lon] = onAfrica(100);
  await page.goto(`/?b=${latestBuild()}&t=${year(100)}&lat=${lat}&lon=${lon}&d=2.2`);
  await idle(page);
  const panel = page.locator('.inspect');
  await page.mouse.click(640, (760 - 90) / 2);
  await idle(page);
  await expect(panel.locator('h2')).toHaveText('Land surface');
  await expect(panel.locator('.biome h3')).toHaveText('Covered with');
  await expect(panel.locator('.biome .badge.basis-procedural')).toBeVisible();
  await expect(panel.locator('.biome')).toContainText('First land plants');
  await expect(panel.locator('.biome')).toContainText('Not yet');
  await expect(panel.locator('.biome')).toContainText('grasslands');
  await panel.locator('.biome a.open', { hasText: 'First land plants' }).click();
  await idle(page);
  expect((await page.evaluate(() => window.__wikiworldmodel!.state())).sel).toBe('life/transitions/land-plants');
});

test('the land greens as the transitions allow: the same land, before and after', async ({ page }) => {
  const plants = startOf('land-plants');
  const colourAt = async (t: number) => {
    const [lat, lon] = onAfrica((1950 - t) / 1e6);
    await page.goto(`/?b=${latestBuild()}&t=${t}&lat=${lat}&lon=${lon}&d=1.8`);
    await idle(page);
    await page.evaluate(() => window.__wikiworldmodel!.set({ clouds: false }));
    await idle(page);
    const [r, g, b] = await canvasPatch(page, 0.5, 0.44, 15);
    return g - (r + b) / 2;
  };
  const bare = await colourAt(Math.round(plants - 1e7));
  const planted = await colourAt(Math.round(plants + 1.6e8));
  expect(planted).toBeGreaterThan(bare + 3);
});

test('a climate’s border moves with the plates', async ({ page }) => {
  // A spot in the middle of India, the fastest of the plates at this time, against the same spot of the globe.
  const frames = buildFile<FramesFile>('frames.json');
  const model = new RotationModel(frames.rotations);
  const place = (age: number) => toLatLon(rotate(model.total(501, age), rotate(conj(model.total(501, 0)), unitVector(21, 78))));
  const [a, b] = [52, 58];
  const [lat0, lon0] = place(a);
  const [lat1, lon1] = place(b);
  await page.goto(`/?b=${latestBuild()}&t=${year(a)}&lat=${lat0}&lon=${lon0}&d=2.4`);
  await idle(page);
  const onPlate0 = await page.evaluate(([x, y]) => window.__wikiworldmodel!.climateAt(x, y), [lat0, lon0]);
  await page.evaluate((t) => window.__wikiworldmodel!.set({ t }), year(b));
  await idle(page);
  const onPlate1 = await page.evaluate(([x, y]) => window.__wikiworldmodel!.climateAt(x, y), [lat1, lon1]);
  const sameSpot1 = await page.evaluate(([x, y]) => window.__wikiworldmodel!.climateAt(x, y), [lat0, lon0]);
  expect(onPlate0).not.toBeNull();
  expect(onPlate1).not.toBeNull();
  expect(sameSpot1).not.toBeNull();
  // Carried with the plate, the climate is much the same; between the two the plate moved far enough that the spot it left is not.
  const dist = (p: { hot: number; cold: number }, q: { hot: number; cold: number }) => Math.abs(p.hot - q.hot) + Math.abs(p.cold - q.cold);
  expect(Math.abs(lat1 - lat0) + Math.abs(lon1 - lon0)).toBeGreaterThan(5);
  expect(dist(onPlate0!, onPlate1!)).toBeLessThan(dist(onPlate0!, sameSpot1!) + 1e-6);
});
