// Pass criteria for the living scene: a link lands in it and the browser makes the plan and the
// mesh the build recorded, to the byte; the way down from the globe; what a click says is recorded
// and what generated; generated life shows in evidence mode; and the time it is drawn for.
import { expect, test } from '@playwright/test';
import type { SceneFile } from '../../../core/scene.ts';
import type { SiteInfo, Tileset } from '../../../core/tileset.ts';
import { buildFile, canvasPng, idle, latestBuild, settledUrl } from './helpers.ts';

const small = { viewport: { width: 640, height: 380 } };
const FAST = 'quality=fast';
const site = () => buildFile<Tileset>('tileset.json').sites!.find((s) => s.kind === 'life') as SiteInfo;
const RAD = Math.PI / 180;
const place = (s: SiteInfo, x: number, y: number) => ({ lat: s.origin.lat + y / 6371000 / RAD, lon: s.origin.lon + x / (6371000 * Math.cos(s.origin.lat * RAD)) / RAD });
const arrival = (s: SiteInfo, metres = s.view.range) => {
  const { lat, lon } = place(s, s.view.x, s.view.y);
  return `t=${s.slice}&lat=${lat}&lon=${lon}&d=${1 + metres / 6371000}&h=${s.view.heading}&v=${s.view.tilt}`;
};

test.describe('the Hell Creek', () => {
  test.use(small);

  test('a link lands in it, and the browser makes the plan and the mesh the build recorded, to the byte', async ({ page, context }) => {
    const s = site();
    await page.goto(`/?b=${latestBuild()}&${arrival(s)}&${FAST}`);
    await idle(page);
    const scene = await page.evaluate(() => window.__lightworld!.scene());
    expect(scene).not.toBeNull();
    expect(scene!.plan.actual).toBe(scene!.plan.expected);
    expect(scene!.cell.actual).toBe(scene!.cell.expected);
    const file = buildFile<SceneFile>(s.file);
    expect(scene!.plan.expected).toBe(file.generator.outputSha256);
    expect(scene!.cell.expected).toBe(file.generator.cell.sha256);
    expect(scene!.organisms).toBeGreaterThan(10000);
    // Every taxon it draws is in the build's list, at least once.
    expect(scene!.taxa.map((t) => t.id).sort()).toEqual(file.taxa.map((t) => t.id).sort());
    for (const t of scene!.taxa) expect(t.count, t.id).toBeGreaterThan(0);
    const stats = await page.evaluate(() => window.__lightworld!.cityStats());
    expect(stats!.coarse).toBeGreaterThan(50);
    // All of it stays in the link, to the pixel.
    const url = await settledUrl(page);
    const pixels = await canvasPng(page);
    const other = await context.newPage();
    await other.goto(url);
    await idle(other);
    expect((await canvasPng(other)).equals(pixels)).toBe(true);
  });

  test('the way down: offered when near at the time it is drawn for, flying there, and ready when it arrives', async ({ page }) => {
    const s = site();
    await page.goto(`/?b=${latestBuild()}&t=${s.slice}&lat=${s.origin.lat}&lon=${s.origin.lon}&d=1.6&${FAST}`);
    await idle(page);
    await expect(page.locator('.city-enter')).toHaveText('Fly down into the Hell Creek, 66.5 Ma');
    await page.locator('.city-enter').click();
    await idle(page);
    const state = await page.evaluate(() => window.__lightworld!.state());
    expect((state.cam.dist - 1) * 6371000).toBeLessThan(s.view.range * 3);
    await expect(page.locator('.city-enter')).toBeHidden();
    expect((await page.evaluate(() => window.__lightworld!.cityStats()))!.coarse).toBeGreaterThan(50);
  });

  test('the record of the place flies down too, from anywhere and any time', async ({ page }) => {
    const s = site();
    await page.goto(`/?b=${latestBuild()}&${FAST}`);
    await idle(page);
    await page.locator('.search input').fill('Hell Creek ecosystem');
    await page.locator('.search input').press('Enter');
    await idle(page);
    const state = await page.evaluate(() => window.__lightworld!.state());
    expect(state.sel).toBe(s.place);
    expect(state.t).toBe(s.slice);
    expect((state.cam.dist - 1) * 6371000).toBeLessThan(s.view.range * 3);
  });

  test('a click on an animal opens its taxon, and says what is recorded and what was generated', async ({ page }) => {
    const s = site();
    await page.goto(`/?b=${latestBuild()}&${arrival(s)}&${FAST}`);
    await idle(page);
    const file = buildFile<SceneFile>(s.file);
    const big = file.taxa.filter((t) => (t.length ?? 0) > 5).map((t) => t.id);
    // Look down on the nearest big group, and click where it stands.
    const found = await page.evaluate((ids) => {
      for (const id of ids) {
        const p = window.__lightworld!.organismPlaces(id)[0];
        if (p) return { id, ...p };
      }
      return null;
    }, big);
    expect(found).not.toBeNull();
    await page.evaluate((f) => window.__lightworld!.set({ cam: { lat: f.lat, lon: f.lon, dist: 1 + 40 / 6371000, heading: 0, tilt: 0 } }), found!);
    await idle(page);
    const spot = (await page.evaluate((id) => window.__lightworld!.structureAt(id), found!.id))!;
    await page.mouse.click(spot.x, spot.y);
    await idle(page);
    const state = await page.evaluate(() => window.__lightworld!.state());
    expect(file.taxa.some((t) => t.id === state.sel)).toBe(true);
    const panel = page.locator('.inspect');
    await expect(panel.locator('.organism')).toContainText('Recorded:');
    await expect(panel.locator('.organism')).toContainText('occurrence');
    await expect(panel.locator('.organism')).toContainText('The Paleobiology Database');
    await expect(panel.locator('.organism')).toContainText('Generated:');
    await expect(panel.locator('.organism')).toContainText('where each stands');
    await expect(panel.locator('.organism')).toContainText('gen:life/scene, version 1');
  });

  test('a click on the ground says it is generated, and where it rests on the world', async ({ page }) => {
    const s = site();
    await page.goto(`/?b=${latestBuild()}&${arrival(s, 25)}&${FAST}`);
    await idle(page);
    // The clear ground before the eye, above the time control and to the left of the city's bar.
    await page.mouse.click(250, 190);
    await idle(page);
    const panel = page.locator('.inspect');
    await expect(panel.locator('.badge.basis-procedural')).toBeVisible();
    await expect(panel).toContainText('The floodplain');
    await expect(panel).toContainText('invented');
    await expect(panel).toContainText('climate field');
  });

  test('evidence mode shows generated life as it does generated housing', async ({ page }) => {
    const s = site();
    await page.goto(`/?b=${latestBuild()}&${arrival(s)}&${FAST}`);
    await idle(page);
    const plain = await canvasPng(page);
    await page.keyboard.press('e');
    await idle(page);
    expect((await canvasPng(page)).equals(plain)).toBe(false);
    await page.keyboard.press('e');
    await idle(page);
    expect((await canvasPng(page)).equals(plain)).toBe(true);
  });

  test('names what can be seen, and a time it is not drawn for lifts the camera back to the globe', async ({ page }) => {
    const s = site();
    await page.goto(`/?b=${latestBuild()}&${arrival(s)}&${FAST}`);
    await idle(page);
    await expect(page.locator('.city-label:visible').first()).toBeVisible();
    const before = await page.evaluate(() => window.__lightworld!.state());
    expect((before.cam.dist - 1) * 6371).toBeLessThan(5);
    // After the impact, and before the formation: there is no scene.
    await page.evaluate((t) => window.__lightworld!.set({ t }), s.span[1] + 5e6);
    await idle(page);
    const after = await page.evaluate(() => window.__lightworld!.state());
    expect((after.cam.dist - 1) * 6371).toBeGreaterThan(50);
    await expect(page.locator('.city-label:visible')).toHaveCount(0);
  });

  test('Rome and the Hell Creek are both there, each at its own time', async ({ page }) => {
    const s = site();
    await page.goto(`/?b=${latestBuild()}&${arrival(s)}&${FAST}`);
    await idle(page);
    expect((await page.evaluate(() => window.__lightworld!.scene()))!.site).toBe(s.id);
    // Off to Rome, in its own time.
    await page.goto(`/?b=${latestBuild()}&t=315&lat=41.9&lon=12.49&d=1.4&${FAST}`);
    await idle(page);
    await expect(page.locator('.city-enter')).toHaveText('Fly down into Rome, 315 CE');
    expect(await page.evaluate(() => window.__lightworld!.scene())).toBeNull();
    const fabric = await page.evaluate(() => window.__lightworld!.fabric());
    expect(fabric!.actual).toBe(fabric!.expected);
  });
});
