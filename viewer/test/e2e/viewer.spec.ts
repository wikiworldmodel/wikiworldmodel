import { expect, test } from '@playwright/test';
import { canvasPng, idle, latestBuild, markerPositions, settledUrl } from './helpers.ts';

const year = (ma: number) => Math.round(1950 - ma * 1e6);

test('a shared link reproduces the same view', async ({ page, context }) => {
  await page.goto(`/?b=${latestBuild()}`);
  await idle(page);
  // Fly, zoom the time control, move through time, open evidence mode and a record.
  await page.mouse.move(640, 300);
  await page.mouse.down();
  await page.mouse.move(560, 350, { steps: 6 });
  await page.mouse.up();
  await page.locator('.tb-canvas').hover({ position: { x: 900, y: 50 } });
  await page.mouse.wheel(0, -500);
  await page.evaluate(() => window.__lightworld!.set({ t: Math.round(1950 - 66.1e6) }));
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('e');
  await page.fill('.search input', 'deccan');
  await page.keyboard.press('Enter');
  await idle(page);
  const url = await settledUrl(page);
  const state = await page.evaluate(() => window.__lightworld!.state());
  const pixels = await canvasPng(page);
  const markers = await markerPositions(page);
  expect(state.sel).toBe('earth/lips/deccan-traps');
  expect(state.evidence).toBe(true);

  const other = await context.newPage();
  await other.goto(url);
  await idle(other);
  expect(await other.evaluate(() => window.__lightworld!.state())).toEqual(state);
  expect(await markerPositions(other)).toEqual(markers);
  // Same build, time, camera and choices: the same pixels, exactly.
  expect((await canvasPng(other)).equals(pixels)).toBe(true);
  await expect(other.locator('.inspect h2')).toHaveText('Deccan Traps');
});

test('scrubbing inside a tile span fetches nothing', async ({ page }) => {
  await page.goto(`/?b=${latestBuild()}&t=70Ma&lat=10&lon=-30&d=3.3`);
  await idle(page);
  const before = await page.evaluate(() => window.__lightworld!.requests.slice());
  // Tiles for 70 Ma cover 80–60 Ma (fine level) and 80–40 Ma (coarse level).
  for (const ma of [61, 64.5, 68, 72.25, 79.9, 75]) {
    await page.evaluate((t) => window.__lightworld!.set({ t }), year(ma));
    await idle(page);
  }
  const after = await page.evaluate(() => window.__lightworld!.requests.slice());
  expect(after).toEqual(before);
});

test('clicking an entity shows its claims and sources, and competing claims switch', async ({ page }) => {
  await page.goto(`/?b=${latestBuild()}`);
  await idle(page);
  await page.fill('.search input', 'india asia');
  await page.keyboard.press('Enter');
  await idle(page);
  const panel = page.locator('.inspect');
  await expect(panel.locator('h2')).toHaveText('India–Asia collision onset');
  await expect(panel).toContainText('59 ± 1 Ma');
  await expect(panel).toContainText('machine-made, needs review');
  await expect(panel.locator('.sources')).toContainText('Earth-Science Reviews 160');
  await expect(panel.locator('.sources a').first()).toHaveAttribute('href', /doi\.org\/10\./);
  await expect(panel).toContainText('Hu et al. 2016, abstract');
  // Pick the older claim; the URL records it and the dates follow.
  await panel.locator('input[value="earth/events/india-asia-collision#date-yin-harrison-2000"]').check();
  await idle(page);
  expect(await settledUrl(page)).toContain('pick=earth%2Fevents%2Findia-asia-collision%23date-yin-harrison-2000');
  await expect(panel.locator('.when')).toContainText('70 Ma');
  // The Himalaya's start is derived from the collision, so it moves too.
  await page.fill('.search input', 'himalaya');
  await page.keyboard.press('Enter');
  await idle(page);
  await expect(panel.locator('h2')).toHaveText('Himalaya');
  await expect(panel.locator('.when')).toContainText('70 Ma');
  await expect(panel).toContainText('Derived by the chronology solver');
});

test('a claim that contradicts the world cannot be chosen, and says why', async ({ page }) => {
  await page.goto(`/?b=${latestBuild()}`);
  await idle(page);
  await page.fill('.search input', 'chicxulub impact');
  await page.keyboard.press('Enter');
  await idle(page);
  const swisher = page.locator('.inspect input[value="earth/events/chicxulub-impact#date-swisher-1992"]');
  await expect(swisher).toBeDisabled();
  await expect(page.locator('.inspect .claim.inconsistent')).toContainText('Deccan Traps');
});

test('clicking the ground shows the field and its source', async ({ page }) => {
  await page.goto(`/?b=${latestBuild()}&t=280Ma&lat=-38&lon=-22&d=3`);
  await idle(page);
  await page.mouse.click(640, 330);
  const panel = page.locator('.inspect');
  await expect(panel).toContainText('Interpolated between');
  await expect(panel).toContainText('Scotese');
  await expect(panel.locator('.badge.basis-reconstruction')).toBeVisible();
});

test('evidence mode marks reconstruction and procedural content', async ({ page }) => {
  await page.goto(`/?b=${latestBuild()}&t=66.03Ma&lat=14&lon=-66&d=2.6`);
  await idle(page);
  const plain = await canvasPng(page);
  await page.keyboard.press('e');
  await idle(page);
  await expect(page.locator('body')).toHaveClass(/evidence/);
  await expect(page.locator('.legend')).toBeVisible();
  expect(await settledUrl(page)).toContain('ev=1');
  expect((await canvasPng(page)).equals(plain)).toBe(false);
});

test('the browser runs the cloud generator to the same bytes as the build', async ({ page }) => {
  await page.goto(`/?b=${latestBuild()}`);
  await idle(page);
  const clouds = await page.evaluate(() => window.__lightworld!.clouds);
  expect(clouds.actual).toBe(clouds.expected);
  expect(clouds.expected).toMatch(/^[0-9a-f]{64}$/);
});

test('the Mesosaurus localities sit together in the Artinskian', async ({ page }) => {
  await page.goto(`/?b=${latestBuild()}&t=285Ma&lat=-38&lon=-22&d=3`);
  await idle(page);
  const m = await markerPositions(page);
  const ids = Object.keys(m).filter((id) => id.startsWith('life/mesosaurus/'));
  expect(ids.sort()).toEqual(['life/mesosaurus/arroyo-de-la-mina', 'life/mesosaurus/calvinia', 'life/mesosaurus/kabus', 'life/mesosaurus/sao-mateus-do-sul']);
  // Today they are on opposite sides of the Atlantic and not shown (they are Permian).
  await page.evaluate(() => window.__lightworld!.set({ t: 1950 }));
  await idle(page);
  const now = await markerPositions(page);
  expect(Object.keys(now).filter((id) => id.startsWith('life/mesosaurus/'))).toEqual([]);
});

test('switching the time-scale alternative re-dates the stages and the records that cite them', async ({ page }) => {
  await page.goto(`/?b=${latestBuild()}&t=281Ma&lat=-38&lon=-22&d=3`);
  await idle(page);
  await expect(page.locator('.tb-readout')).toContainText('Kungurian');
  await page.fill('.search input', 'mateus');
  await page.keyboard.press('Enter');
  await idle(page);
  const panel = page.locator('.inspect');
  await expect(panel.locator('.when')).toContainText('290.1 Ma – 283.5 Ma');
  await expect(panel).toContainText('during Artinskian');
  // The PBDB's own time scale ends the Artinskian at 279.3 Ma.
  await page.selectOption('select[data-group="alt:time-scale"]', 'alt:time-scale/pbdb-2022');
  await idle(page);
  expect(await settledUrl(page)).toContain('alt=alt%3Atime-scale%2Fpbdb-2022');
  await expect(page.locator('.tb-readout')).toContainText('Artinskian');
  await expect(panel.locator('.when')).toContainText('290.1 Ma – 279.3 Ma');
  await expect(panel).toContainText('PBDB interval ages');
});

test('a record shows the relations others make to it, and the records it wants', async ({ page }) => {
  await page.goto(`/?b=${latestBuild()}`);
  await idle(page);
  await page.fill('.search input', 'south-central');
  await page.keyboard.press('Enter');
  await idle(page);
  const panel = page.locator('.inspect');
  await expect(panel.locator('h2')).toHaveText('south-central Africa');
  await expect(panel.locator('.relations.inverse')).toContainText('carries Mesosaurus, Calvinia');
  await expect(panel.locator('.relations.inverse')).toContainText('carries Mesosaurus, Kabus');
  await panel.locator('.relations.inverse a', { hasText: 'Kabus' }).click();
  await idle(page);
  await expect(panel.locator('h2')).toHaveText('Mesosaurus, Kabus');
  await expect(panel.locator('.relations')).toContainText('member of life/taxa/mesosaurus-tenuidens wanted');
  await expect(panel).toContainText('No source: An editorial label');
});
