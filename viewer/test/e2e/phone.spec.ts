// Pass criteria for a phone: held upright, the globe fits the screen from side to side, the toggles fold behind a
// button, and a tap opens what is there in a sheet over the foot of the view, which its head makes taller and a drag down
// closes; a tap beside a marker opens it; two fingers pinch the globe nearer, wherever they fall, and the time control's
// window narrower; and on its side, the time control is thinner and a record opens in a column of its own. The gestures
// near the ground are checked in city.spec.ts.
import { expect, test, type Page } from '@playwright/test';
import { positionOf } from '../../../core/timescale.ts';
import { canvasPatch, idle, latestBuild, line, markerPositions, touch } from './helpers.ts';

const UPRIGHT = { viewport: { width: 390, height: 664 }, isMobile: true, hasTouch: true };
const ON_ITS_SIDE = { viewport: { width: 750, height: 340 }, isMobile: true, hasTouch: true };

const state = (page: Page) => page.evaluate(() => window.__wikiworldmodel!.state());

test.describe('held upright', () => {
  test.use(UPRIGHT);

  test('the globe fits the screen from side to side, as it fits a wide one from top to bottom', async ({ page }) => {
    await page.goto(`/?b=${latestBuild()}&t=0Ma&lat=12&lon=-28&d=5&cl=0`);
    await idle(page);
    // Space at both sides of the globe, and the globe between them. Seen as a wide screen sees it, the globe would run off both.
    for (const fx of [0.04, 0.96]) expect(Math.max(...(await canvasPatch(page, fx, 0.5))), `at ${fx}`).toBeLessThan(25);
    expect(Math.max(...(await canvasPatch(page, 0.5, 0.5)))).toBeGreaterThan(40);
  });

  test('the toggles fold behind a button beside the search, which lights while one of them is on', async ({ page }) => {
    await page.goto(`/?b=${latestBuild()}`);
    await idle(page);
    const menu = page.locator('.menu-toggle');
    const search = (await page.locator('.search input').boundingBox())!;
    const button = (await menu.boundingBox())!;
    // One row: the search, and the button at its right, both on the screen.
    expect(search.x).toBeGreaterThanOrEqual(0);
    expect(search.x + search.width).toBeLessThanOrEqual(button.x);
    expect(button.x + button.width).toBeLessThanOrEqual(390);
    expect(Math.abs(search.y + search.height / 2 - (button.y + button.height / 2))).toBeLessThan(2);
    await expect(page.locator('.tg-clouds')).toBeHidden();
    await expect(menu).not.toHaveClass(/lit/);
    await menu.tap();
    await expect(page.locator('.tg-clouds')).toBeVisible();
    await expect(page.locator('.menu-about')).toContainText('How much is known');
    await page.locator('.tg-clouds').tap();
    await idle(page);
    expect((await state(page)).clouds).toBe(false);
    await expect(menu).toHaveClass(/lit/);
    // A touch on the view, below them, folds them away again.
    await page.touchscreen.tap(195, 460);
    await expect(page.locator('.tg-clouds')).toBeHidden();
  });

  test('a tap opens what is there in a sheet over the foot of the view, which its head makes taller and a drag down closes', async ({ page }) => {
    await page.goto(`/?b=${latestBuild()}&t=280Ma&lat=-38&lon=-22&d=3`);
    await idle(page);
    await expect(page.locator('.credits')).toBeVisible();
    await page.touchscreen.tap(195, 250);
    const sheet = page.locator('.inspect');
    await expect(sheet).toContainText('Interpolated between');
    // Across the whole width, down to the time control, and what was at the foot of the view gives way to it.
    const stage = (await page.locator('.stage').boundingBox())!;
    const low = (await sheet.boundingBox())!;
    expect(low.x).toBe(0);
    expect(low.width).toBe(390);
    expect(Math.abs(low.y + low.height - (stage.y + stage.height))).toBeLessThan(1);
    await expect(page.locator('.credits')).toBeHidden();
    // A tap on its head makes it as tall as the view, and another brings it back down.
    await sheet.locator('header h2').tap();
    await expect(sheet).toHaveClass(/full/);
    expect((await sheet.boundingBox())!.height).toBeGreaterThan(low.height + 100);
    await sheet.locator('header h2').tap();
    await expect(sheet).not.toHaveClass(/full/);
    // A drag down on its head closes it.
    const head = (await sheet.locator('header').boundingBox())!;
    await touch(page, [line([head.x + 60, head.y + 12], [head.x + 60, head.y + 12 + low.height * 0.8])]);
    await expect(sheet).toBeHidden();
    await expect(page.locator('.credits')).toBeVisible();
  });

  test('the planet\'s panel folds to its state, and lets out the rest', async ({ page }) => {
    await page.goto(`/?b=${latestBuild()}&t=280Ma&lat=-38&lon=-22&d=3`);
    await idle(page);
    const series = page.locator('.planet-row[data-series]');
    await expect(page.locator('.planet-phase')).toBeVisible();
    for (const row of await series.all()) await expect(row).toBeHidden();
    await page.locator('.planet-fold').tap();
    await expect(series.first()).toBeVisible();
  });

  test('two fingers pinch the globe nearer, and back', async ({ page }) => {
    await page.goto(`/?b=${latestBuild()}&t=0Ma&lat=12&lon=-28&d=3.3`);
    await idle(page);
    const d0 = (await state(page)).cam.dist;
    await touch(page, [line([180, 260], [110, 260]), line([210, 260], [280, 260])]);
    const d1 = (await state(page)).cam.dist;
    // Fingers five times as far apart: a fifth as far from the ground.
    expect(d1 - 1).toBeLessThan((d0 - 1) / 3);
    await touch(page, [line([110, 260], [180, 260]), line([280, 260], [210, 260])]);
    expect((await state(page)).cam.dist).toBeGreaterThan(d1 + 0.5);
  });

  test('a tap beside a marker opens it, and two fingers pinch even where one falls on a marker', async ({ page }) => {
    await page.goto(`/?b=${latestBuild()}&t=0Ma&lat=12&lon=-28&d=3.3`);
    await idle(page);
    // The marker furthest from any other, in the middle of the view: a fingertip beside its dot reaches it and no other.
    const at = Object.entries(await markerPositions(page)).filter(([, [x, y]]) => x > 40 && x < 350 && y > 120 && y < 460);
    const apart = (id: string, [x, y]: [number, number]) => Math.min(...at.map(([other, [u, v]]) => (other === id ? Infinity : Math.hypot(u - x, v - y))));
    const [id, [x, y]] = at.sort((a, b) => apart(...b) - apart(...a))[0];
    expect(apart(id, [x, y])).toBeGreaterThan(30);
    await page.touchscreen.tap(x - 9, y + 4);
    await idle(page);
    expect((await state(page)).sel).toBe(id);
    await page.evaluate(() => window.__wikiworldmodel!.set({ sel: null }));
    await idle(page);
    const d0 = (await state(page)).cam.dist;
    await touch(page, [line([x, y], [x - 60, y]), line([x + 20, y], [x + 80, y])]);
    expect((await state(page)).cam.dist - 1).toBeLessThan((d0 - 1) / 2);
  });

  test('a finger drags the rows of the tree of life, and a tap chooses one', async ({ page }) => {
    await page.goto(`/?b=${latestBuild()}&tree=1&t=66Ma`);
    await idle(page);
    const rows = (await page.locator('.tree-panel canvas').boundingBox())!;
    const spot: [number, number] = [rows.x + 150, rows.y + 40];
    await page.touchscreen.tap(...spot);
    await idle(page);
    const first = (await state(page)).sel;
    expect(first).toBeTruthy();
    await page.evaluate(() => window.__wikiworldmodel!.set({ sel: null }));
    await idle(page);
    // Dragged up a few rows, and let go: nothing is chosen by the drag, and the same tap then falls on another row.
    await touch(page, [line([spot[0], rows.y + rows.height - 40], [spot[0], rows.y + rows.height - 140])]);
    await idle(page);
    expect((await state(page)).sel).toBe(null);
    await page.touchscreen.tap(...spot);
    await idle(page);
    const second = (await state(page)).sel;
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
  });

  test('two fingers on the time control narrow its window between them, and leave the time where it was', async ({ page }) => {
    await page.goto(`/?b=${latestBuild()}`);
    await idle(page);
    const before = await state(page);
    const strip = (await page.locator('.tb-canvas').boundingBox())!;
    const y = strip.y + 50;
    await touch(page, [line([strip.x + 175, y], [strip.x + 60, y]), line([strip.x + 215, y], [strip.x + 330, y])]);
    const after = await state(page);
    expect(after.t).toBe(before.t);
    const span = (w: [number, number]) => positionOf(w[1]) - positionOf(w[0]);
    expect(span(after.window)).toBeLessThan(span(before.window) / 3);
  });
});

test.describe('on its side', () => {
  test.use(ON_ITS_SIDE);

  test('the time control is thinner, and a record opens in a column of its own beside the view and the time control', async ({ page }) => {
    await page.goto(`/?b=${latestBuild()}&t=66.2Ma&lat=18&lon=60&d=2.6`);
    await idle(page);
    let bar = (await page.locator('.timebar').boundingBox())!;
    expect(bar.height).toBeLessThan(125);
    expect((await page.locator('.stage').boundingBox())!.height).toBeGreaterThan(340 - 125);
    await page.evaluate(() => window.__wikiworldmodel!.set({ sel: 'earth/lips/deccan-traps' }));
    await idle(page);
    await expect(page.locator('.inspect h2')).toHaveText('Deccan Traps');
    const panel = (await page.locator('.inspect').boundingBox())!;
    const stage = (await page.locator('.stage').boundingBox())!;
    bar = (await page.locator('.timebar').boundingBox())!;
    expect(panel.x).toBeGreaterThan(750 / 2 - 20);
    expect(panel.y).toBeLessThan(12);
    expect(panel.y + panel.height).toBeGreaterThan(340 - 12);
    expect(stage.x + stage.width).toBeLessThanOrEqual(panel.x);
    expect(bar.x + bar.width).toBeLessThanOrEqual(panel.x);
    // The globe is drawn again for the room it has, a pixel of its canvas to a pixel of the screen.
    expect(await page.evaluate(() => document.querySelector<HTMLCanvasElement>('canvas.globe')!.width)).toBe(Math.round(stage.width));
  });
});
