// Pass criteria for what the globe now draws in the recent past and the deep one: the coast of each time on today's
// ground, at the sea level of the time (the land bridges at the Last Glacial Maximum, and the hollows below sea level
// that the ocean does not reach kept dry); the land painted from the climate of the last 120,000 years where it covers
// the time, fetched a span at a time; the continents of 1.8 Ga, moved with their own plate model; and the rivers and
// lakes of the time shown, when asked for, crossing the shelves the sea left dry.
import { expect, test, type Page } from '@playwright/test';
import type { SearchFile } from '../../../core/records.ts';
import type { Tileset } from '../../../core/tileset.ts';
import { buildFile, idle, latestBuild } from './helpers.ts';

const year = (ka: number) => Math.round(1950 - ka * 1e3);

test.describe('the coast of the glacial cycles', () => {
  test('joins the land bridges at the Last Glacial Maximum, and parts them today', async ({ page }) => {
    const lgm = buildFile<SearchFile>('search.json').entities.find((e) => e.id === 'earth/ice-ages/last-glacial-maximum')!;
    const t = Math.round((lgm.time.start.best! + lgm.time.end.best!) / 2);
    const bridges: Record<string, [number, number]> = { 'the Bering Strait': [65.9, -169], 'the Dogger Bank': [54.7, 2.5], 'the Java Sea': [-5, 110], 'the Torres Strait': [-10, 142.5] };
    const ground = (lat: number, lon: number) => page.evaluate(([a, o]) => window.__wikiworldmodel!.groundAt(a, o), [lat, lon]);
    for (const [when, dry] of [[t, true], [1950, false]] as const) {
      await page.goto(`/?b=${latestBuild()}&t=${when}&lat=20&lon=150&d=3`);
      await idle(page);
      for (const [name, [lat, lon]] of Object.entries(bridges)) {
        const z = (await ground(lat, lon))!;
        expect(z, `${name} at ${when}`).not.toBeNull();
        expect(z > 0, `${name} at ${when}: ${z} m`).toBe(dry);
      }
    }
  });

  test('keeps the hollows below sea level that the ocean does not reach dry, and today\'s lakes wet', async ({ page }) => {
    await page.goto(`/?b=${latestBuild()}&t=1950&lat=35&lon=40&d=2.6`);
    await idle(page);
    const ground = (lat: number, lon: number) => page.evaluate(([a, o]) => window.__wikiworldmodel!.groundAt(a, o)!, [lat, lon]);
    expect(await ground(29.5, 27), 'the Qattara Depression').toBeGreaterThan(0);
    expect(await ground(32.3, 35.55), 'the Jordan valley').toBeGreaterThan(0);
    expect(await ground(42, 51), 'the Caspian Sea').toBeLessThan(0);
    expect(await ground(43, 34), 'the Black Sea').toBeLessThan(0);
  });
});

test.describe('the climate of the last 120,000 years', () => {
  test('paints the land where it covers the time, from the file of its span, and the deep past\'s runs before it', async ({ page }) => {
    const ts = buildFile<Tileset>('tileset.json');
    const recent = ts.climates![0];
    expect(recent.field).toBe('field:earth/climate-late-quaternary');
    expect(recent.chunks.length).toBeGreaterThan(1);
    // At the Last Glacial Maximum: the file holding 21 ka, and no other of its files.
    await page.goto(`/?b=${latestBuild()}&t=${year(21)}&lat=50&lon=10&d=2.6`);
    await idle(page);
    expect(await page.evaluate(() => window.__wikiworldmodel!.climateField())).toBe(recent.field);
    const holding = recent.chunks.filter((c) => Math.min(...c.keyframesMa) <= 0.021 && 0.021 <= Math.max(...c.keyframesMa)).map((c) => c.file);
    const fetched = (await page.evaluate(() => window.__wikiworldmodel!.requests)).filter((u) => u.includes('/climate/'));
    expect(fetched.length).toBe(1);
    expect(holding.some((f) => fetched[0].endsWith(f))).toBe(true);
    // Central Europe at the LGM is colder in its coldest month than today, by the same field.
    const cold = (await page.evaluate(() => window.__wikiworldmodel!.climateAt(50, 10)))!.cold;
    await page.evaluate(() => window.__wikiworldmodel!.set({ t: 1950 }));
    await idle(page);
    expect(await page.evaluate(() => window.__wikiworldmodel!.climateField())).toBe(recent.field);
    expect((await page.evaluate(() => window.__wikiworldmodel!.climateAt(50, 10)))!.cold).toBeGreaterThan(cold + 5);
    // Before its span, the deep past's runs.
    await page.evaluate(() => window.__wikiworldmodel!.set({ t: 1950 - 3e6 }));
    await idle(page);
    expect(await page.evaluate(() => window.__wikiworldmodel!.climateField())).toBe(ts.climate!.field);
  });
});

test.describe('rivers', () => {
  const rivers = (page: Page) => page.evaluate(() => {
    const r = window.__wikiworldmodel!.rivers();
    return { set: r.set, ageMa: r.ageMa, drawn: r.drawn, lakes: r.lakes, observed: r.observed, ms: r.ms };
  });
  const near = (page: Page, lat: number, lon: number, deg: number) => page.evaluate(([a, o, r]) => window.__wikiworldmodel!.rivers().near(a, o, r), [lat, lon, deg]);

  test('are drawn when asked for, the great ones from far off, and the Amazon runs to its estuary', async ({ page }) => {
    await page.goto(`/?b=${latestBuild()}&t=1950&lat=-8&lon=-56&d=1.6`);
    await idle(page);
    expect((await rivers(page)).drawn).toBe(0);
    await page.locator('.tg-rv').click();
    await idle(page);
    await page.waitForFunction(() => window.__wikiworldmodel!.url().includes('ly=rv'));
    const regional = await rivers(page);
    expect(regional.set).toBe(buildFile<Tileset>('tileset.json').rivers!.sets.find((s) => s.span[0] <= 1950 && 1950 < s.span[1])!.network);
    expect(regional.ageMa).toBe(0);
    expect(regional.drawn).toBeGreaterThan(300);
    // The model hands the Amazon to the sea where its bed in the relief's grid drops below the sea's level, by the mouth
    // of the Xingu: about 3° up from where it meets the Atlantic, near 0° and 50° W.
    const amazon = (await near(page, 0, -50, 3.5)).filter((r) => r.q > 1e5);
    expect(amazon.length).toBeGreaterThan(0);
    // From further out, only the greater ones.
    await page.evaluate(() => window.__wikiworldmodel!.set({ cam: { lat: -8, lon: -56, dist: 3.3 } }));
    await idle(page);
    const far = await rivers(page);
    expect(far.drawn).toBeGreaterThan(0);
    expect(far.drawn).toBeLessThan(regional.drawn);
    // Close by, the rivers Landsat saw too.
    expect(far.observed).toBe(0);
    await page.evaluate(() => window.__wikiworldmodel!.set({ cam: { lat: -2.5, lon: -55, dist: 1.12 } }));
    await idle(page);
    expect((await rivers(page)).observed).toBeGreaterThan(20);
  });

  test('cross the Sunda shelf at the Last Glacial Maximum, where the sea is today', async ({ page }) => {
    const lgm = buildFile<SearchFile>('search.json').entities.find((e) => e.id === 'earth/ice-ages/last-glacial-maximum')!;
    const t = Math.round((lgm.time.start.best! + lgm.time.end.best!) / 2);
    const shelf = async () => (await near(page, 5, 107, 3)).flatMap((r) => r.nodes).filter((n) => n.lat >= 4 && n.lat <= 6 && n.lon >= 105 && n.lon <= 109 && n.z < 0);
    await page.goto(`/?b=${latestBuild()}&t=${t}&lat=5&lon=107&d=1.6&ly=rv`);
    await idle(page);
    expect((await rivers(page)).ageMa).toBeGreaterThan(0.015);
    expect((await shelf()).length).toBeGreaterThan(0);
    // Today the sea covers it, and the rivers end at the coast.
    await page.evaluate(() => window.__wikiworldmodel!.set({ t: 1950 }));
    await idle(page);
    expect((await rivers(page)).drawn).toBeGreaterThan(0);
    expect(await shelf()).toEqual([]);
  });

  test('fill the Caspian as a lake today, below the sea and spilling nowhere', async ({ page }) => {
    await page.goto(`/?b=${latestBuild()}&t=1950&lat=42&lon=50&d=2&ly=rv`);
    await idle(page);
    expect((await rivers(page)).lakes).toBeGreaterThan(0);
    const caspian = await page.evaluate(() => window.__wikiworldmodel!.rivers().lakeAt(42, 51));
    expect(caspian).not.toBeNull();
    expect(caspian!.spills).toBe(false);
    expect(caspian!.level).toBeLessThan(0);
    // The Black Sea is the sea's.
    expect(await page.evaluate(() => window.__wikiworldmodel!.rivers().lakeAt(43, 34))).toBeNull();
  });
});

test('draws the continents of 1.8 Ga, on the plates of their own model', async ({ page }) => {
  const ts = buildFile<Tileset>('tileset.json');
  const deep = ts.fields.find((f) => f.id === 'field:earth/continental-blocks-deep')!;
  expect(deep.coverage[0]).toBeLessThan(1950 - 1.79e9);
  await page.goto(`/?b=${latestBuild()}&t=${Math.round(1950 - 1.5e9)}&lat=0&lon=0&d=3.3`);
  await idle(page);
  const geography = await page.evaluate(() => window.__wikiworldmodel!.resolve(0, 0, 'geography'));
  expect(geography.tier).toBe('model');
  expect(geography.why).toContain(deep.title);
});
