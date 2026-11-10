// Pass criteria for the city: a link lands in it and the browser's generated fabric matches the
// build's within the tolerance of core/fingerprint.ts; the wheel comes down from the globe without a seam; what stands depends on
// the time shown; a click opens a monument's record, or says a house is the generator's; and deep
// time lifts the camera off a ground that isn't there yet; and on a touch screen, two fingers turn, tilt and come nearer.
// The views it is drawn in are checked in city-views.spec.ts.
import { expect, test } from '@playwright/test';
import { canvasPng, idle, latestBuild, line, settledUrl, touch } from './helpers.ts';

// The city's passes are slow in software: a smaller picture, drawn the fast way (no shadows,
// occlusion, bloom or multisampling, coarse meshes only), keeps the behaviour tests short. The
// behaviour is the same either way.
const small = { viewport: { width: 640, height: 380 } };
const FAST = 'quality=fast';

const OVERVIEW = 't=315.5&lat=41.8915&lon=12.49&d=1.000235&h=302&v=66';

/** A view looking down at a structure, from `metres` above. */
const over = (lat: number, lon: number, metres: number, t = 315.5) => `t=${t}&lat=${lat}&lon=${lon}&d=${1 + metres / 6371000}&h=0&v=0`;

/** Whether a structure's label is showing. */
const labelled = (page: import('@playwright/test').Page, id: string) => page.evaluate((id) => {
  const el = document.querySelector<HTMLElement>(`.city-label[data-entity="${id}"]`);
  return !!el && el.style.display !== 'none';
}, id);

test.describe('in the city', () => {
  test.use(small);

  test('a link lands in the city, and the browser makes the fabric the build recorded, within the tolerance', async ({ page, context }) => {
    await page.goto(`/?b=${latestBuild()}&${OVERVIEW}&${FAST}`);
    await idle(page);
    const fabric = await page.evaluate(() => window.__wikiworldmodel!.fabric());
    expect(fabric!.actual).not.toBeNull();
    expect(fabric!.problems).toEqual([]);
    const stats = await page.evaluate(() => window.__wikiworldmodel!.cityStats());
    expect(stats!.cells).toBeGreaterThan(100);
    expect(stats!.coarse).toBeGreaterThan(50);
    // A step on the ground, an hour later: all of it stays in the link.
    await page.evaluate(() => window.__wikiworldmodel!.set({ hour: 11 }));
    await idle(page);
    const url = await settledUrl(page);
    expect(url).toContain('hour=11');
    expect(url).toContain(FAST);
    expect(url).toContain('h=302');
    expect(url).toContain('v=66');
    const state = await page.evaluate(() => window.__wikiworldmodel!.state());
    const pixels = await canvasPng(page);
    const other = await context.newPage();
    await other.goto(url);
    await idle(other);
    expect(await other.evaluate(() => window.__wikiworldmodel!.state())).toEqual(state);
    expect((await canvasPng(other)).equals(pixels)).toBe(true);
  });

  test('the wheel comes down from the globe into the city, and back', async ({ page }) => {
    await page.goto(`/?b=${latestBuild()}&t=315&lat=41.9&lon=12.49&d=1.4&${FAST}`);
    await idle(page);
    await expect(page.locator('.city-enter')).toHaveText('Fly down into Rome, 315 CE');
    const height = async () => ((await page.evaluate(() => window.__wikiworldmodel!.state())).cam.dist - 1) * 6371;
    await page.mouse.move(320, 190);
    const heights: number[] = [await height()];
    for (let i = 0; i < 14; i++) {
      await page.mouse.wheel(0, -1000);
      await page.waitForTimeout(120);
      heights.push(await height());
    }
    for (let i = 1; i < heights.length; i++) expect(heights[i]).toBeLessThanOrEqual(heights[i - 1] + 1e-6);
    const low = heights[heights.length - 1];
    expect(low).toBeLessThan(600);
    await idle(page);
    expect(await page.evaluate(() => window.__wikiworldmodel!.cityStats()))!.not.toBeNull();
    for (let i = 0; i < 14; i++) {
      await page.mouse.wheel(0, 1000);
      await page.waitForTimeout(60);
    }
    expect(await height()).toBeGreaterThan(low);
  });

  test('the button flies down, and the city is ready when it arrives', async ({ page }) => {
    await page.goto(`/?b=${latestBuild()}&t=315&lat=41.9&lon=12.49&d=1.4&${FAST}`);
    await idle(page);
    await page.locator('.city-enter').click();
    await idle(page);
    const state = await page.evaluate(() => window.__wikiworldmodel!.state());
    expect((state.cam.dist - 1) * 6371000).toBeLessThan(3000);
    const stats = await page.evaluate(() => window.__wikiworldmodel!.cityStats());
    expect(stats!.coarse).toBeGreaterThan(50);
    await expect(page.locator('.city-enter')).toBeHidden();
  });

  test('what stands depends on the time: Constantine’s arch is not there before it was built', async ({ page }) => {
    const arch = 'rome/arch-of-constantine';
    const at = over(41.88975, 12.4906, 90);
    await page.goto(`/?b=${latestBuild()}&${at}&${FAST}`);
    await idle(page);
    expect(await labelled(page, arch)).toBe(true);
    // A click where it stands opens it.
    const spot = (await page.evaluate((id) => window.__wikiworldmodel!.structureAt(id), arch))!;
    await page.mouse.click(spot.x, spot.y);
    await idle(page);
    expect((await page.evaluate(() => window.__wikiworldmodel!.state())).sel).toBe(arch);
    await expect(page.locator('.inspect h2')).toContainText('Arch of Constantine');
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.__wikiworldmodel!.set({ sel: null, t: 290 }));
    await idle(page);
    expect(await labelled(page, arch)).toBe(false);
    await page.mouse.click(spot.x, spot.y);
    await idle(page);
    expect((await page.evaluate(() => window.__wikiworldmodel!.state())).sel).not.toBe(arch);
  });

  test('a click on an ordinary house says the generator placed it, and that nothing is known of it', async ({ page }) => {
    // The Subura, in the thick of the housing: look straight down, and try until a house is hit.
    await page.goto(`/?b=${latestBuild()}&${over(41.8957, 12.4955, 120)}&${FAST}`);
    await idle(page);
    const panel = page.locator('.inspect');
    let found = false;
    for (const [x, y] of [[320, 190], [260, 150], [380, 230], [260, 230], [380, 150], [320, 110], [320, 270], [200, 190], [440, 190]]) {
      await page.mouse.click(x, y);
      await idle(page);
      if ((await panel.isVisible()) && /building/i.test((await panel.locator('.kind').textContent()) ?? '')) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
    await expect(panel.locator('.badge.basis-procedural')).toBeVisible();
    await expect(panel).toContainText('Nothing is known of this building');
    expect((await page.evaluate(() => window.__wikiworldmodel!.state())).sel).toBe(null);
  });

  test('a time with no ground lifts the camera off the place', async ({ page }) => {
    await page.goto(`/?b=${latestBuild()}&${OVERVIEW}&${FAST}`);
    await idle(page);
    // Before any scene of any place: a billion years ago there is no land the atlas knows of.
    await page.evaluate(() => window.__wikiworldmodel!.set({ t: Math.round(1950 - 1e9) }));
    await idle(page);
    const state = await page.evaluate(() => window.__wikiworldmodel!.state());
    expect((state.cam.dist - 1) * 6371).toBeGreaterThan(50);
    await expect(page.locator('.city-label:visible')).toHaveCount(0);
    // Coming back in time does not drop the camera back into the streets.
    await page.evaluate(() => window.__wikiworldmodel!.set({ t: 315.5 }));
    await idle(page);
    const back = await page.evaluate(() => window.__wikiworldmodel!.state());
    expect(back.cam.dist).toBe(state.cam.dist);
  });

  test('evidence mode tints what is generated apart from what is recorded', async ({ page }) => {
    await page.goto(`/?b=${latestBuild()}&${OVERVIEW}&${FAST}`);
    await idle(page);
    const plain = await canvasPng(page);
    await page.keyboard.press('e');
    await idle(page);
    expect((await canvasPng(page)).equals(plain)).toBe(false);
    await page.keyboard.press('e');
    await idle(page);
    expect((await canvasPng(page)).equals(plain)).toBe(true);
  });
});

test.describe('names', () => {
  test.use(small);

  test('a street names what can be seen from it, and not what lies behind the buildings', async ({ page }) => {
    await page.goto(`/?b=${latestBuild()}&t=315.5&lat=41.89236&lon=12.48565&d=1.0000004&h=118&v=92&${FAST}`);
    await idle(page);
    expect(await labelled(page, 'rome/temple-of-antoninus-and-faustina')).toBe(true);
    expect(await labelled(page, 'rome/baths-of-trajan')).toBe(false);
    expect(await labelled(page, 'rome/colosseum')).toBe(false);
    // From above, it is named again.
    await page.goto(`/?b=${latestBuild()}&${over(41.8902, 12.4922, 400)}&${FAST}`);
    await idle(page);
    expect(await labelled(page, 'rome/colosseum')).toBe(true);
  });
});

test.describe('on a touch screen', () => {
  test.use({ ...small, hasTouch: true });

  test('two fingers twist the view round, go up together to tilt it, and spread to come nearer', async ({ page }) => {
    await page.goto(`/?b=${latestBuild()}&${OVERVIEW}&${FAST}`);
    await idle(page);
    const cam = async () => (await page.evaluate(() => window.__wikiworldmodel!.state())).cam;
    const c0 = await cam();
    // An eighth of a turn, clockwise on the screen, clear of the city's bar: what is under the fingers turns with them, so
    // the view turns the other way.
    const round = (side: number) => Array.from({ length: 9 }, (_, i) => [260 + side * 50 * Math.cos((i / 8) * (Math.PI / 4)), 150 + side * 50 * Math.sin((i / 8) * (Math.PI / 4))] as [number, number]);
    await touch(page, [round(-1), round(1)]);
    const c1 = await cam();
    expect((((c0.heading! - c1.heading! + 540) % 360) - 180)).toBeCloseTo(45, 0);
    expect(c1.tilt).toBe(c0.tilt);
    // Both up together tilts it towards the horizon, and nothing else.
    await touch(page, [line([200, 200], [200, 120]), line([320, 200], [320, 120])]);
    const c2 = await cam();
    expect(c2.tilt!).toBeGreaterThan(c1.tilt! + 10);
    expect(c2.heading).toBe(c1.heading);
    expect(c2.dist).toBe(c1.dist);
    // Spread apart, they come nearer the ground.
    await touch(page, [line([240, 150], [160, 150]), line([280, 150], [360, 150])]);
    expect((await cam()).dist).toBeLessThan(c2.dist);
  });
});
