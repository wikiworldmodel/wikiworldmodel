// The coverage page: every layer drawn along the time control's scale from the build's own counts, a cell picked
// says what answers there and maps it, and a place on the map opens the globe there and then.
import { expect, test } from '@playwright/test';
import type { CoverageFile } from '../../../core/records.ts';
import { fromMa } from '../../../core/time.ts';
import { buildFile, idle, latestBuild } from './helpers.ts';

test('draws every layer, and a picked cell says what answers there and maps it', async ({ page }) => {
  const m = buildFile<CoverageFile>('coverage.json').matrix!;
  await page.goto(`/coverage.html?b=${latestBuild()}`);
  await expect(page.locator('.row.layer')).toHaveCount(m.layers.length);
  await expect(page.locator('.cov-head')).toContainText(latestBuild());

  // The land at the K–Pg boundary: a model's everywhere, as the build counted it.
  const col = m.columns.findIndex(([a, b]) => a <= fromMa(66.04) && fromMa(66.04) < b);
  const track = page.locator('.row.layer[data-layer="geography"] .track');
  const box = (await track.boundingBox())!;
  await track.click({ position: { x: ((col + 0.5) / m.columns.length) * box.width, y: box.height / 2 } });
  const detail = page.locator('.cov-detail');
  await expect(detail.locator('h3')).toHaveText('Land and sea');
  await expect(detail).toContainText('Surface elevation and ocean depth');
  const model = detail.locator('li', { hasText: 'Model' }).first();
  await expect(model.locator('.n')).toHaveText('100%');

  // Its map is the whole grid, in the model's colour.
  const colours = await page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('.cov-detail canvas.map')!;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    const seen = new Set<string>();
    for (let i = 0; i < d.length; i += 4) seen.add(`${d[i]},${d[i + 1]},${d[i + 2]}`);
    return { w: c.width, h: c.height, seen: [...seen] };
  });
  expect(colours.w * colours.h).toBe((180 / m.step) * (360 / m.step));
  expect(colours.seen.length).toBe(1);

  // Expanding a layer shows what answers it, with its grid.
  await page.locator('.row.layer[data-layer="geography"] .label').click();
  await expect(page.locator('.bar', { hasText: 'Surface elevation and ocean depth' })).toBeVisible();
});

test('a place on the map opens the globe there and then', async ({ page }) => {
  await page.goto(`/coverage.html?b=${latestBuild()}`);
  const map = page.locator('.cov-detail canvas.map');
  await expect(map).toBeVisible();
  const box = (await map.boundingBox())!;
  await map.click({ position: { x: box.width * 0.55, y: box.height * 0.3 } });
  await page.waitForURL(/[?&]lat=/);
  const q = new URL(page.url()).searchParams;
  expect(q.get('b')).toBe(latestBuild());
  expect(Number(q.get('lat'))).toBeGreaterThan(20);
  await idle(page);
});

test('the globe links to the coverage of the build it shows', async ({ page }) => {
  await page.goto(`/?b=${latestBuild()}`);
  await idle(page);
  await expect(page.locator('.brand a.coverage-link')).toHaveAttribute('href', `./coverage.html?b=${latestBuild()}`);
});
