// Pass criteria for the human landscape in the browser (docs/slices/ELEVENTH-SLICE.md): the globe's picture of the
// anthromes under its toggle, with a legend; a scene of land in the anthromes' span has its people, a delta a few metres
// above the sea among them; a city of the lists is named, and drawn in its region's houses; a click on a house says what it
// rests on; and the people layer of `resolve` answers in a tier, as the build's does.
import { expect, test, type Page } from '@playwright/test';
import { traditionAt } from '../../../core/dwelling.ts';
import type { LandscapeIndex, TraditionsFile } from '../../../core/landscape.ts';
import { buildFile, idle, latestBuild, settledUrl } from './helpers.ts';

const FAST = 'quality=fast';
const low = (lat: number, lon: number, t: number, metres: number) => `t=${t}&lat=${lat}&lon=${lon}&d=${1 + metres / 6371000}&h=40&v=70&${FAST}`;
const scene = (page: Page) => page.evaluate(() => window.__wikiworldmodel!.scene());
/** The building tradition the world records for Uruk's region, ArchaeoGLOBE's 59, in 3000 BCE, by its name. */
const uruksTradition = () => {
  const index = buildFile<LandscapeIndex>('people/landscape.json');
  const t = traditionAt(buildFile<TraditionsFile>(index.traditions).traditions, 59, -2999);
  expect(t).toBeTruthy();
  return t!.label;
};

test.describe('the human landscape', () => {
  test('Settlement paints the anthromes of the time, with a legend of the classes present, and stays in the link', async ({ page }) => {
    await page.goto(`/?b=${latestBuild()}&t=-1999&lat=30&lon=40&d=2.6&ly=landscape`);
    await idle(page);
    const legend = page.locator('.landscape-legend');
    await expect(legend).toBeVisible();
    // The step nearest, named as HYDE names it, and classes of the farmed land of its time.
    await expect(legend).toContainText('2,000 BC');
    await expect(legend).toContainText('Irrigated villages');
    expect(await settledUrl(page)).toContain('ly=landscape');
    await page.locator('.tg-landscape').click();
    await idle(page);
    await expect(legend).toBeHidden();
    expect(await settledUrl(page)).not.toContain('landscape');
  });

  test('a click on a house of a city says what it rests on, and what of it is invented', async ({ page }) => {
    test.setTimeout(300_000);
    // From above the city, at the full size of the page, so that the panel leaves the scene to click in.
    await page.goto(`/?b=${latestBuild()}&t=-2999&lat=31.32&lon=45.64&d=${1 + 400 / 6371000}&h=40&v=20&${FAST}`);
    await idle(page);
    const uruk = (await page.evaluate(() => window.__wikiworldmodel!.settlementsAt())).find((x) => x.city === 'Uruk');
    expect(uruk).toBeTruthy();
    // Its middle is a lane between lots: a ring of clicks around it, until one falls on a house.
    const panel = page.locator('.inspect');
    let hit = false;
    for (const r of [8, 14, 20, 28]) {
      for (let k = 0; k < 8 && !hit; k++) {
        await page.mouse.click(uruk!.x + r * Math.cos((k * Math.PI) / 4), uruk!.y + r * Math.sin((k * Math.PI) / 4));
        await idle(page);
        hit = (await panel.isVisible()) && ((await panel.textContent()) ?? '').includes('Generated house');
      }
      if (hit) break;
    }
    expect(hit).toBe(true);
    await expect(panel.locator('h2')).toHaveText(uruksTradition());
    await expect(panel).toContainText('Uruk, a city of the lists');
    await expect(panel).toContainText('nobody recorded this house');
  });

  test.describe('in a scene', () => {
    test.use({ viewport: { width: 640, height: 380 } });

    test('a delta a few metres above the sea has its villages, with the people the world puts there', async ({ page }) => {
      await page.goto(`/?b=${latestBuild()}&${low(30.8, 31.0, -1499, 900)}`);
      await idle(page);
      const s = await scene(page);
      expect(s!.list).toBe('land');
      const p = s!.people!;
      expect(p).toBeTruthy();
      expect(p.expected).toBeGreaterThan(10000);
      expect(p.houses).toBeGreaterThan(1000);
      // The people drawn are the people HYDE puts in the land the scene covers, within a tenth.
      expect(Math.abs(p.drawn - p.expected) / p.expected).toBeLessThan(0.1);
      expect(p.pattern).toBe('villages');
      await expect(page.locator('.life-here')).toContainText('Farming villages');
      const r = await page.evaluate(() => window.__wikiworldmodel!.resolve(30.8, 31.0, 'people'));
      expect(r).toMatchObject({ tier: 'evidence', value: 'villages' });
    });

    test("a city of the lists is named, and drawn in its region's houses", async ({ page }) => {
      await page.goto(`/?b=${latestBuild()}&${low(31.32, 45.64, -2999, 2500)}`);
      await idle(page);
      await expect(page.locator('.life-here')).toContainText('Uruk');
      const r = await page.evaluate(() => window.__wikiworldmodel!.resolve(31.32, 45.64, 'people'));
      expect(r).toMatchObject({ tier: 'evidence', value: 'Uruk' });
      expect((await scene(page))!.people!.forms).toContain(uruksTradition());
    });

    test('before the anthromes begin, a scene has no people', async ({ page }) => {
      await page.goto(`/?b=${latestBuild()}&${low(30.8, 31.0, -14000, 900)}`);
      await idle(page);
      const s = await scene(page);
      expect(s?.people ?? null).toBeNull();
      await expect(page.locator('.life-here')).not.toContainText('houses');
    });
  });
});
