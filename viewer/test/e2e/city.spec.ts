// Pass criteria for the city: a link lands in it and the browser's generated fabric matches the
// build's to the byte; the wheel comes down from the globe without a seam; what stands depends on
// the time shown; a click opens a monument's record, or says a house is the generator's; deep time
// lifts the camera off a ground that isn't there yet; and three views stay as they are.
import { expect, test } from '@playwright/test';
import { canvasPng, idle, latestBuild, settledUrl } from './helpers.ts';

// The city's passes are slow in software: a smaller picture keeps the behaviour tests short.
const small = { viewport: { width: 640, height: 380 } };

const OVERVIEW = 't=315.5&lat=41.8915&lon=12.49&d=1.000235&h=302&v=66';
const COLOSSEUM = 't=315.5&lat=41.8902&lon=12.4922&d=1.000029&h=130&v=72';
const FORUM = 't=315.5&lat=41.89185&lon=12.48665&d=1.00004&h=300&v=72';
const PANTHEON = 't=315.5&lat=41.8990&lon=12.4768&d=1.000011&h=178&v=88';
const SUNSET = 't=315.5&lat=41.8915&lon=12.49&d=1.00012&h=280&v=72&hour=18.2';

/** A view looking down at a structure, from `metres` above. */
const over = (lat: number, lon: number, metres: number, t = 315.5) => `t=${t}&lat=${lat}&lon=${lon}&d=${1 + metres / 6371000}&h=0&v=0`;

/** Whether a structure's label is showing. */
const labelled = (page: import('@playwright/test').Page, id: string) => page.evaluate((id) => {
  const el = document.querySelector<HTMLElement>(`.city-label[data-entity="${id}"]`);
  return !!el && el.style.display !== 'none';
}, id);

test.describe('in the city', () => {
  test.use(small);

  test('a link lands in the city, and the browser makes the fabric the build recorded, to the byte', async ({ page, context }) => {
    await page.goto(`/?b=${latestBuild()}&${OVERVIEW}`);
    await idle(page);
    const fabric = await page.evaluate(() => window.__lightworld!.fabric());
    expect(fabric!.actual).toBe(fabric!.expected);
    const stats = await page.evaluate(() => window.__lightworld!.cityStats());
    expect(stats!.cells).toBeGreaterThan(100);
    expect(stats!.coarse).toBeGreaterThan(50);
    // A step on the ground, an hour later: all of it stays in the link.
    await page.evaluate(() => window.__lightworld!.set({ hour: 11 }));
    await idle(page);
    const url = await settledUrl(page);
    expect(url).toContain('hour=11');
    expect(url).toContain('h=302');
    expect(url).toContain('v=66');
    const state = await page.evaluate(() => window.__lightworld!.state());
    const pixels = await canvasPng(page);
    const other = await context.newPage();
    await other.goto(url);
    await idle(other);
    expect(await other.evaluate(() => window.__lightworld!.state())).toEqual(state);
    expect((await canvasPng(other)).equals(pixels)).toBe(true);
  });

  test('the wheel comes down from the globe into the city, and back', async ({ page }) => {
    await page.goto(`/?b=${latestBuild()}&t=315&lat=41.9&lon=12.49&d=1.4`);
    await idle(page);
    await expect(page.locator('.city-enter')).toHaveText('Fly down into Rome, 315 CE');
    const height = async () => ((await page.evaluate(() => window.__lightworld!.state())).cam.dist - 1) * 6371;
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
    expect(await page.evaluate(() => window.__lightworld!.cityStats()))!.not.toBeNull();
    for (let i = 0; i < 14; i++) {
      await page.mouse.wheel(0, 1000);
      await page.waitForTimeout(60);
    }
    expect(await height()).toBeGreaterThan(low);
  });

  test('the button flies down, and the city is ready when it arrives', async ({ page }) => {
    await page.goto(`/?b=${latestBuild()}&t=315&lat=41.9&lon=12.49&d=1.4`);
    await idle(page);
    await page.locator('.city-enter').click();
    await idle(page);
    const state = await page.evaluate(() => window.__lightworld!.state());
    expect((state.cam.dist - 1) * 6371000).toBeLessThan(3000);
    const stats = await page.evaluate(() => window.__lightworld!.cityStats());
    expect(stats!.coarse).toBeGreaterThan(50);
    await expect(page.locator('.city-enter')).toBeHidden();
  });

  test('what stands depends on the time: Constantine’s arch is not there before it was built', async ({ page }) => {
    const arch = 'rome/arch-of-constantine';
    const at = over(41.88975, 12.4906, 90);
    await page.goto(`/?b=${latestBuild()}&${at}`);
    await idle(page);
    expect(await labelled(page, arch)).toBe(true);
    // A click where it stands opens it.
    const spot = (await page.evaluate((id) => window.__lightworld!.structureAt(id), arch))!;
    await page.mouse.click(spot.x, spot.y);
    await idle(page);
    expect((await page.evaluate(() => window.__lightworld!.state())).sel).toBe(arch);
    await expect(page.locator('.inspect h2')).toContainText('Arch of Constantine');
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.__lightworld!.set({ sel: null, t: 290 }));
    await idle(page);
    expect(await labelled(page, arch)).toBe(false);
    await page.mouse.click(spot.x, spot.y);
    await idle(page);
    expect((await page.evaluate(() => window.__lightworld!.state())).sel).not.toBe(arch);
  });

  test('a click on an ordinary house says the generator placed it, and that nothing is known of it', async ({ page }) => {
    // The Subura, in the thick of the housing: look straight down, and try until a house is hit.
    await page.goto(`/?b=${latestBuild()}&${over(41.8957, 12.4955, 120)}`);
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
    expect((await page.evaluate(() => window.__lightworld!.state())).sel).toBe(null);
  });

  test('deep time lifts the camera off a ground that is not there yet', async ({ page }) => {
    await page.goto(`/?b=${latestBuild()}&${OVERVIEW}`);
    await idle(page);
    await page.evaluate(() => window.__lightworld!.set({ t: Math.round(1950 - 66e6) }));
    await idle(page);
    const state = await page.evaluate(() => window.__lightworld!.state());
    expect((state.cam.dist - 1) * 6371).toBeGreaterThan(50);
    await expect(page.locator('.city-label:visible')).toHaveCount(0);
    // Coming back in time does not drop the camera back into the streets.
    await page.evaluate(() => window.__lightworld!.set({ t: 315.5 }));
    await idle(page);
    const back = await page.evaluate(() => window.__lightworld!.state());
    expect(back.cam.dist).toBe(state.cam.dist);
  });

  test('evidence mode tints what is generated apart from what is recorded', async ({ page }) => {
    await page.goto(`/?b=${latestBuild()}&${OVERVIEW}`);
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
    await page.goto(`/?b=${latestBuild()}&t=315.5&lat=41.89236&lon=12.48565&d=1.0000004&h=118&v=92`);
    await idle(page);
    expect(await labelled(page, 'rome/temple-of-antoninus-and-faustina')).toBe(true);
    expect(await labelled(page, 'rome/baths-of-trajan')).toBe(false);
    expect(await labelled(page, 'rome/colosseum')).toBe(false);
    // From above, it is named again.
    await page.goto(`/?b=${latestBuild()}&${over(41.8902, 12.4922, 400)}`);
    await idle(page);
    expect(await labelled(page, 'rome/colosseum')).toBe(true);
  });
});

test.describe('views', () => {
  for (const v of [
    { name: 'rome-overview', query: OVERVIEW },
    { name: 'rome-colosseum', query: COLOSSEUM },
    { name: 'rome-forum', query: FORUM },
    { name: 'rome-pantheon', query: PANTHEON },
    { name: 'rome-sunset', query: `${SUNSET}` },
  ]) {
    test(`renders ${v.name} as before`, async ({ page }) => {
      await page.goto(`/?b=${latestBuild()}&${v.query}`);
      await idle(page);
      expect(await canvasPng(page)).toMatchSnapshot(`${v.name}.png`, { maxDiffPixelRatio: 0.002 });
    });
  }
});
