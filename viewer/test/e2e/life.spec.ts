// Pass criteria for living scenes: a link lands in one and the browser makes what the build recorded, within the
// tolerance of core/fingerprint.ts; the
// way down from the globe; a scene of any place on land, from what is fetched; what a click says is recorded,
// inferred and generated; generated life shows in evidence mode; the time each is drawn for; and the way down into
// a scene of the sea, below its surface.
import { expect, test } from '@playwright/test';
import { atlasHasLand, seaList, type AtlasBin, type AtlasIndex, type SeaBin, type SeaIndex } from '../../../core/atlas.ts';
import { fingerprintProblems, type Fingerprint } from '../../../core/fingerprint.ts';
import type { SceneFileV2 } from '../../../core/scene.ts';
import type { SiteInfo, Tileset } from '../../../core/tileset.ts';
import { FAST_BUDGET } from '../../../world/generators/life/stream.ts';
import { buildFile, canvasPng, idle, latestBuild, settledUrl } from './helpers.ts';

// A short window, which has the time control of a phone on its side: the view is 640 × 226, as these tests were written
// for. A taller view of the Hell Creek passes the fast budget's cap on what it draws, and what it draws under the cap
// depends on how it was streamed in, so that two loads of one link may not give the same pixels.
const small = { viewport: { width: 640, height: 345 } };
const FAST = 'quality=fast';
const site = () => buildFile<Tileset>('tileset.json').sites!.find((s) => s.kind === 'life') as SiteInfo;
const RAD = Math.PI / 180;
const place = (s: SiteInfo, x: number, y: number) => ({ lat: s.origin.lat + y / 6371000 / RAD, lon: s.origin.lon + x / (6371000 * Math.cos(s.origin.lat * RAD)) / RAD });
const arrival = (s: SiteInfo, metres = s.view.range) => {
  const { lat, lon } = place(s, s.view.x, s.view.y);
  return `t=${s.slice}&lat=${lat}&lon=${lon}&d=${1 + metres / 6371000}&h=${s.view.heading}&v=${s.view.tilt}`;
};
const witnesses = () => buildFile<{ lat: number; lon: number; t: number; print: Fingerprint; taxa: number }[]>('life/witness.json');
const atlas = () => buildFile<AtlasIndex>('life/atlas.json');
const seaAtlas = () => buildFile<SeaIndex>('life/sea.json');
const lowOver = (lat: number, lon: number, t: number, metres = 200) => `t=${t}&lat=${lat}&lon=${lon}&d=${1 + metres / 6371000}&h=30&v=75`;

test.describe('the Hell Creek', () => {
  test.use(small);

  test('a link lands in it, and the browser makes what the build recorded, within the tolerance', async ({ page, context }) => {
    const s = site();
    await page.goto(`/?b=${latestBuild()}&${arrival(s)}&${FAST}`);
    await idle(page);
    const scene = await page.evaluate(() => window.__wikiworldmodel!.scene());
    expect(scene).not.toBeNull();
    expect(scene!.plan.actual).not.toBeNull();
    expect(scene!.plan.problems).toEqual([]);
    const file = buildFile<SceneFileV2>(s.file);
    expect(scene!.plan.expected).toEqual(file.print);
    expect(scene!.instances).toBeGreaterThan(50);
    // Every taxon it draws is in the build's list.
    expect(scene!.taxa.map((t) => t.id).sort()).toEqual(file.spec.taxa.map((t) => t.id).sort());
    const stats = await page.evaluate(() => window.__wikiworldmodel!.cityStats());
    expect(stats!.coarse).toBeGreaterThan(5);
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
    const state = await page.evaluate(() => window.__wikiworldmodel!.state());
    expect((state.cam.dist - 1) * 6371000).toBeLessThan(s.view.range * 3);
    await expect(page.locator('.city-enter')).toBeHidden();
    expect((await page.evaluate(() => window.__wikiworldmodel!.scene()))!.site).toBe(s.id);
  });

  test('the record of the place flies down too, from anywhere and any time', async ({ page }) => {
    const s = site();
    await page.goto(`/?b=${latestBuild()}&${FAST}`);
    await idle(page);
    await page.locator('.search input').fill('Hell Creek ecosystem');
    await page.locator('.search input').press('Enter');
    await idle(page);
    const state = await page.evaluate(() => window.__wikiworldmodel!.state());
    expect(state.sel).toBe(s.place);
    expect(state.t).toBe(s.slice);
    expect((state.cam.dist - 1) * 6371000).toBeLessThan(s.view.range * 3);
  });

  test('a click on an animal opens its taxon, and says what is recorded and what was generated', async ({ page }) => {
    const s = site();
    await page.goto(`/?b=${latestBuild()}&${arrival(s)}&${FAST}`);
    await idle(page);
    const file = buildFile<SceneFileV2>(s.file);
    const big = file.spec.taxa.filter((t) => (t.length ?? 0) > 5).map((t) => t.id);
    // Look down on the nearest big group, and click where it stands.
    const found = await page.evaluate((ids) => {
      for (const id of ids) {
        const p = window.__wikiworldmodel!.organismPlaces(id)[0];
        if (p) return { id, ...p };
      }
      return null;
    }, big);
    expect(found).not.toBeNull();
    await page.evaluate((f) => window.__wikiworldmodel!.set({ cam: { lat: f.lat, lon: f.lon, dist: 1 + 40 / 6371000, heading: 0, tilt: 0 } }), found!);
    await idle(page);
    const spot = (await page.evaluate((id) => window.__wikiworldmodel!.structureAt(id), found!.id))!;
    await page.mouse.click(spot.x, spot.y);
    await idle(page);
    const state = await page.evaluate(() => window.__wikiworldmodel!.state());
    expect(file.spec.taxa.some((t) => t.id === state.sel)).toBe(true);
    const panel = page.locator('.inspect');
    await expect(panel.locator('.organism')).toContainText('Recorded:');
    await expect(panel.locator('.organism')).toContainText('occurrence');
    await expect(panel.locator('.organism')).toContainText('The Paleobiology Database');
    await expect(panel.locator('.organism')).toContainText('Its body:');
    await expect(panel.locator('.organism')).toContainText('Generated:');
    await expect(panel.locator('.organism')).toContainText('where each stands');
    await expect(panel.locator('.organism')).toContainText(`gen:life/scene, version ${file.spec.generator.version}`);
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

  test('names what can be seen, and a time before any scene lifts the camera back to the globe', async ({ page }) => {
    const s = site();
    await page.goto(`/?b=${latestBuild()}&${arrival(s)}&${FAST}`);
    await idle(page);
    await expect(page.locator('.city-label:visible').first()).toBeVisible();
    const before = await page.evaluate(() => window.__wikiworldmodel!.state());
    expect((before.cam.dist - 1) * 6371).toBeLessThan(5);
    // Before there was any land life the atlas knows of.
    await page.evaluate((t) => window.__wikiworldmodel!.set({ t }), atlas().bins[0].from - 2e8);
    await idle(page);
    const after = await page.evaluate(() => window.__wikiworldmodel!.state());
    expect((after.cam.dist - 1) * 6371).toBeGreaterThan(50);
    await expect(page.locator('.city-label:visible')).toHaveCount(0);
  });

  test('Rome and the Hell Creek are both there, each at its own time', async ({ page }) => {
    const s = site();
    await page.goto(`/?b=${latestBuild()}&${arrival(s)}&${FAST}`);
    await idle(page);
    expect((await page.evaluate(() => window.__wikiworldmodel!.scene()))!.site).toBe(s.id);
    // Off to Rome, in its own time.
    await page.goto(`/?b=${latestBuild()}&t=315&lat=41.9&lon=12.49&d=1.4&${FAST}`);
    await idle(page);
    await expect(page.locator('.city-enter')).toHaveText('Fly down into Rome, 315 CE');
    expect(await page.evaluate(() => window.__wikiworldmodel!.scene())).toBeNull();
    const fabric = await page.evaluate(() => window.__wikiworldmodel!.fabric());
    expect(fabric!.actual).not.toBeNull();
    expect(fabric!.problems).toEqual([]);
  });
});

test.describe('anywhere else', () => {
  test.use(small);

  test('a place on land makes its scene, from nothing stored of it, and within its budget', async ({ page }) => {
    const w = witnesses()[0];
    await page.goto(`/?b=${latestBuild()}&${lowOver(w.lat, w.lon, w.t)}&${FAST}`);
    await idle(page);
    const scene = (await page.evaluate(() => window.__wikiworldmodel!.scene()))!;
    expect(scene).not.toBeNull();
    expect(scene.taxa.length).toBeGreaterThan(0);
    expect(scene.instances).toBeGreaterThan(0);
    expect(scene.instances).toBeLessThanOrEqual(FAST_BUDGET.instances);
    expect(scene.triangles).toBeLessThanOrEqual(FAST_BUDGET.triangles);
    // What it fetched for this: the stage's lists, the forms and the land's tiles, and no ground of its own.
    const urls = await page.evaluate(() => window.__wikiworldmodel!.requests);
    expect(urls.some((u) => /life\/bins\/\d+\.json/.test(u))).toBe(true);
    expect(urls.some((u) => u.includes('life/forms.json'))).toBe(true);
    expect(urls.some((u) => /ground-\d\.bin/.test(u))).toBe(false);
    const lists = urls.filter((u) => u.includes('life/bins/'));
    expect(lists.length).toBe(1);
    // And all of what is new for it is small, before the wire compresses it.
    let bytes = 0;
    for (const u of urls.filter((x) => x.includes('/life/'))) bytes += (await (await page.request.get(u)).body()).length;
    expect(bytes).toBeLessThan(6e6);
  });

  test('a browser makes the same scene as the build does of the same place, within the tolerance', async ({ page }) => {
    await page.goto(`/?b=${latestBuild()}&${FAST}`);
    await idle(page);
    for (const w of witnesses()) {
      const made = await page.evaluate((x) => window.__wikiworldmodel!.lifePrint(x.lat, x.lon, x.t), w);
      expect(made, `${w.lat}, ${w.lon} at ${w.t}`).not.toBeNull();
      expect(fingerprintProblems(w.print, made!), `${w.lat}, ${w.lon} at ${w.t}`).toEqual([]);
    }
  });

  test('the same place and time is the same scene, reached however', async ({ page, context }) => {
    const w = witnesses()[1];
    const url = `/?b=${latestBuild()}&${lowOver(w.lat, w.lon, w.t)}&${FAST}`;
    await page.goto(url);
    await idle(page);
    const pixels = await canvasPng(page);
    const other = await context.newPage();
    await other.goto(url);
    await idle(other);
    expect((await canvasPng(other)).equals(pixels)).toBe(true);
  });

  test('a click says what is recorded, what is inferred, whose form it is and what was generated', async ({ page }) => {
    const w = witnesses()[0];
    await page.goto(`/?b=${latestBuild()}&${lowOver(w.lat, w.lon, w.t, 300)}&${FAST}`);
    await idle(page);
    const scene = (await page.evaluate(() => window.__wikiworldmodel!.scene()))!;
    // Down to where something of each stands, and then over the nearest group to it, staying in the same place's scene.
    const [fx, fy] = scene.focus;
    const toLatLon = (x: number, y: number) => ({ lat: scene.origin.lat + y / 6371000 / RAD, lon: scene.origin.lon + x / (6371000 * Math.cos(scene.origin.lat * RAD)) / RAD });
    await page.evaluate((c) => window.__wikiworldmodel!.set({ cam: { lat: c.lat, lon: c.lon, dist: 1 + 200 / 6371000, heading: 0, tilt: 0 } }), toLatLon(fx, fy));
    await idle(page);
    const found = await page.evaluate(([ids, x, y]) => {
      let best: { id: string; lat: number; lon: number; d: number } | null = null;
      for (const id of ids as string[]) {
        for (const p of window.__wikiworldmodel!.organismPlaces(id)) {
          const d = Math.hypot(p.x - (x as number), p.y - (y as number));
          if (!best || d < best.d) best = { id, lat: p.lat, lon: p.lon, d };
        }
      }
      return best;
    }, [scene.taxa.map((t) => t.id), fx, fy] as const);
    expect(found, `${scene.taxa.length} taxa`).not.toBeNull();
    await page.evaluate((f) => window.__wikiworldmodel!.set({ cam: { lat: f.lat, lon: f.lon, dist: 1 + 30 / 6371000, heading: 0, tilt: 0 } }), found!);
    await idle(page);
    const spot = await page.evaluate((id) => window.__wikiworldmodel!.organismsAt(id).sort((a, b) => a.depth - b.depth)[0], found!.id);
    await page.mouse.click(spot?.x ?? 320, spot?.y ?? 190);
    await idle(page);
    const panel = page.locator('.inspect');
    await expect(panel).toContainText('Generated');
    const text = (await panel.textContent()) ?? '';
    if (text.includes('where each stands')) {
      expect(text).toMatch(/Recorded here|Inferred|A stand-in|Recorded:/);
      expect(text).toMatch(/Its body:/);
    }
  });

  test('says what lived here, in tiers, from the bar', async ({ page }) => {
    const w = witnesses()[0];
    await page.goto(`/?b=${latestBuild()}&${lowOver(w.lat, w.lon, w.t)}&${FAST}`);
    await idle(page);
    const button = page.locator('.life-here');
    await expect(button).toBeVisible();
    await expect(button).toContainText('recorded here');
    await button.click();
    const panel = page.locator('.inspect');
    await expect(panel).toContainText('What lived here');
    await expect(panel).toContainText('placed by a generator');
    await expect(panel).toContainText(/Recorded here|Recorded in the region|Stand-ins/);
  });

  test('a record of a taxon offers to go and see it where it lived, and goes', async ({ page }) => {
    await page.goto(`/?b=${latestBuild()}&sel=life/taxa/triceratops&${FAST}`);
    await idle(page);
    const see = page.locator('.see-it');
    await expect(see).toContainText('See it where it lived');
    await see.click();
    await idle(page);
    const state = await page.evaluate(() => window.__wikiworldmodel!.state());
    expect((state.cam.dist - 1) * 6371000).toBeLessThan(500);
    const scene = (await page.evaluate(() => window.__wikiworldmodel!.scene()))!;
    expect(scene.stage).toBe('Maastrichtian');
    expect(scene.taxa.some((t) => t.id === 'life/taxa/triceratops')).toBe(true);
    expect(state.sel).toBe('life/taxa/triceratops');
    // And on from the ground there to another place and time, without being left over the sea.
    await page.evaluate(() => window.__wikiworldmodel!.set({ sel: 'life/taxa/mammuthus-primigenius' }));
    await idle(page);
    await see.click();
    await idle(page);
    const next = await page.evaluate(() => window.__wikiworldmodel!.state());
    expect((next.cam.dist - 1) * 6371000).toBeLessThan(500);
    const there = (await page.evaluate(() => window.__wikiworldmodel!.scene()))!;
    expect(there.stage).not.toBe('Maastrichtian');
    expect(there.taxa.some((t) => t.id === 'life/taxa/mammuthus-primigenius')).toBe(true);
    expect(next.sel).toBe('life/taxa/mammuthus-primigenius');
  });

  test('a click on the ground says it is generated', async ({ page }) => {
    const w = witnesses()[0];
    await page.goto(`/?b=${latestBuild()}&${lowOver(w.lat, w.lon, w.t, 800)}&${FAST}&h=0&v=0`);
    await idle(page);
    await page.mouse.click(320, 120);
    await idle(page);
    const text = (await page.locator('.inspect').textContent()) ?? '';
    expect(text).toMatch(/generated|Generated/);
  });

  test('over the sea, where its atlas has a list, the way goes down into a scene of the sea, to near its floor', async ({ page }) => {
    // The sea over the Paris Basin in the Thanetian, a shelf a few tens of metres deep: no land of the land's list, and
    // a list of the sea's.
    const [lat, lon] = [48, 2];
    const ref = seaAtlas().bins.find((b) => b.name === 'Thanetian')!;
    const land = atlas().bins.find((b) => b.from === ref.from)!;
    expect(atlasHasLand(buildFile<AtlasBin>(land.file), atlas().grid, lat, lon)).toBe(false);
    expect(seaList(buildFile<SeaBin>(ref.file), seaAtlas().grid, lat, lon)).toBeDefined();
    await page.goto(`/?b=${latestBuild()}&${lowOver(lat, lon, ref.slice, 600)}&${FAST}`);
    await idle(page);
    const scene = (await page.evaluate(() => window.__wikiworldmodel!.scene()))!;
    expect(scene.sea).toBe(true);
    expect(scene.list).toBe('sea');
    // The bar says what lived here, as on land; or, where nothing of it can be drawn yet, says so.
    const here = page.locator('.life-here');
    if (scene.taxa.length) await expect(here).toContainText('recorded here');
    else await expect(here).toHaveText('Nothing of the sea’s life can be drawn here yet');
    await expect(page.locator('.life-go')).toBeVisible({ visible: scene.taxa.length > 0 });
    // As low as the camera goes: under the surface, and a little over the floor.
    await page.evaluate((c) => window.__wikiworldmodel!.set({ cam: { lat: c.lat, lon: c.lon, dist: 1 + 2 / 6371000, heading: 30, tilt: 80 } }), { lat, lon });
    await idle(page);
    const eye = (await page.evaluate(() => window.__wikiworldmodel!.scene()))!.eye!;
    expect(eye.z).toBeLessThan(0);
    expect(eye.z - eye.floor).toBeGreaterThan(1.5);
    expect(eye.z - eye.floor).toBeLessThan(3);
    // Going to see takes a visitor down to what lives here, under the surface.
    if (scene.taxa.length) {
      await page.evaluate((c) => window.__wikiworldmodel!.set({ cam: { lat: c.lat, lon: c.lon, dist: 1 + 600 / 6371000, heading: 30, tilt: 75 } }), { lat, lon });
      await idle(page);
      await page.locator('.life-go').click();
      await idle(page);
      const there = (await page.evaluate(() => window.__wikiworldmodel!.scene()))!;
      expect(there.site).toBe(scene.site);
      expect(there.eye!.z).toBeLessThan(0);
      expect(there.eye!.z).toBeGreaterThan(there.eye!.floor);
    }
  });

  test('where neither atlas has a list, there is still no way down', async ({ page }) => {
    // Every patch of every stage has a list of the land's or of the sea's: so the middle of the Pacific before the first
    // stage of either.
    const t = Math.min(atlas().bins[0].from, seaAtlas().bins[0].from) - 2e7;
    await page.goto(`/?b=${latestBuild()}&t=${t}&lat=0&lon=-160&d=1.4&${FAST}`);
    await idle(page);
    await page.evaluate(() => window.__wikiworldmodel!.set({ cam: { lat: 0, lon: -160, dist: 1 + 200 / 6371000 } }));
    await idle(page);
    const state = await page.evaluate(() => window.__wikiworldmodel!.state());
    expect((state.cam.dist - 1) * 6371).toBeGreaterThan(50);
    expect(await page.evaluate(() => window.__wikiworldmodel!.scene())).toBeNull();
  });

  test('a scene by a river Landsat saw draws that river, and arrives beside it', async ({ page }) => {
    // The Mississippi near Greenville, today.
    await page.goto(`/?b=${latestBuild()}&${lowOver(33.4, -91.1, 1950, 1500)}&${FAST}`);
    await idle(page);
    await expect.poll(async () => (await page.evaluate(() => window.__wikiworldmodel!.scene()))?.water?.tier, { timeout: 60_000 }).toBe('evidence');
    const scene = (await page.evaluate(() => window.__wikiworldmodel!.scene()))!;
    expect(scene.water!.rivers.some((r) => r.from === 'observed')).toBe(true);
    // A visitor arrives at a real place, facing a river.
    for (const v of [...scene.focus, ...scene.toRiver]) expect(Number.isFinite(v)).toBe(true);
    expect(Math.hypot(...scene.toRiver)).toBeCloseTo(1, 2);
  });

  test('a scene reads the finest climate of its time, and draws its month: snow low in January, high in July', async ({ page }) => {
    // The Cascades, today, east of Mount Rainier. (Not the Alps: no wild scene is drawn within reach of Rome's.)
    await page.goto(`/?b=${latestBuild()}&${lowOver(47.0, -121.5, 1950, 6000)}&mo=1&${FAST}`);
    await idle(page);
    await expect.poll(async () => (await page.evaluate(() => window.__wikiworldmodel!.scene()))?.month, { timeout: 60_000 }).toBe(1);
    const jan = (await page.evaluate(() => window.__wikiworldmodel!.scene()))!;
    expect(jan.climateField).toBe('field:earth/climate-late-quaternary');
    await expect(page.locator('.life-month')).toBeVisible();
    await page.locator('.life-month select').selectOption('7');
    await expect.poll(async () => (await page.evaluate(() => window.__wikiworldmodel!.scene()))?.month, { timeout: 60_000 }).toBe(7);
    const jul = (await page.evaluate(() => window.__wikiworldmodel!.scene()))!;
    expect(page.url()).toContain('mo=7');
    expect(jan.snow).not.toBeNull();
    expect(jul.snow === null || jul.snow > jan.snow! + 1000).toBe(true);
  });
});
