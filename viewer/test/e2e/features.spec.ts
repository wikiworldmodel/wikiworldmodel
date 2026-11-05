// Pass criteria: the globe fetches only the feature tiles its view needs; what a cell left to its
// children shows when the camera comes near; and a record far from the view can still be reached.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { featureTileUrl, type FeatureIndex } from '../../../core/featuretiles.ts';
import type { Feature } from '../../../core/tileset.ts';
import { idle, latestBuild } from './helpers.ts';

const dir = () => join('dist/builds', latestBuild());
const index = () => JSON.parse(readFileSync(join(dir(), 'features/index.json'), 'utf8')) as FeatureIndex;
const fetched = (page: import('@playwright/test').Page) => page.evaluate(() => window.__lightworld!.requests.filter((u) => u.includes('/features/t')));

test('from orbit it fetches a few of the feature tiles, and no dates of other pictures', async ({ page }) => {
  const i = index();
  await page.goto(`/?b=${latestBuild()}&t=120&lat=38&lon=18&d=2.4`);
  await idle(page);
  const urls = await fetched(page);
  expect(urls.length).toBeGreaterThan(0);
  expect(urls.length).toBeLessThan(i.tiles.length / 2);
  expect(await page.evaluate(() => window.__lightworld!.requests.some((u) => u.endsWith('features/variants.json')))).toBe(false);
});

test('the dates of other pictures come when another picture is asked for', async ({ page }) => {
  await page.goto(`/?b=${latestBuild()}&t=0Ma&lat=12&lon=-28&d=3.3&alt=${encodeURIComponent(firstAlternative())}`);
  await idle(page);
  expect(await page.evaluate(() => window.__lightworld!.requests.some((u) => u.endsWith('features/variants.json')))).toBe(true);
});

test('a tile below the root comes only when its cell is in view, and then its markers show', async ({ page }) => {
  const r = index().tiles.find((x) => x.q !== '');
  test.skip(!r, 'nothing in this world is thinned yet');
  const rows = JSON.parse(readFileSync(join(dir(), featureTileUrl(r!)), 'utf8')) as Feature[];
  const f = rows.find((x) => x.time.start.best !== null && !x.moves && x.time.start.best > -1e5)!;
  const t = `t=${f.time.start.best}`;
  const marker = page.locator(`.marker[data-entity="${f.id}"]`);
  // From the far side of the globe.
  await page.goto(`/?b=${latestBuild()}&${t}&lat=${-f.location.lat}&lon=${f.location.lon + 180}&d=3.3`);
  await idle(page);
  await expect(marker).toHaveCount(0);
  expect((await fetched(page)).filter((u) => u.endsWith(featureTileUrl(r!)))).toEqual([]);
  await page.goto(`/?b=${latestBuild()}&${t}&lat=${f.location.lat}&lon=${f.location.lon}&d=1.25`);
  await idle(page);
  await expect(marker).toBeVisible();
});

test('a record whose tile the view has not asked for can still be opened and reached', async ({ page }) => {
  const i = index();
  const id = Object.keys(i.where).find((x) => x.endsWith('chicxulub-impact'))!;
  const url = featureTileUrl(i.tiles[i.where[id]]);
  await page.goto(`/?b=${latestBuild()}&t=120&lat=38&lon=18&d=2.4`);
  await idle(page);
  expect((await fetched(page)).filter((u) => u.endsWith(url))).toEqual([]);
  await page.goto(`/?b=${latestBuild()}&t=120&lat=38&lon=18&d=2.4&sel=${encodeURIComponent(id)}`);
  await idle(page);
  await expect(page.locator('.inspect')).toContainText('Chicxulub');
  // Its tile came for the panel; and flying to it from search finds its time and place.
  await page.locator('.search input').fill('Chicxulub impact');
  await page.locator('.search input').press('Enter');
  await idle(page);
  await expect(page.locator(`.marker[data-entity="${id}"]`)).toBeVisible();
});

function firstAlternative(): string {
  const ts = JSON.parse(readFileSync(join(dir(), 'tileset.json'), 'utf8')) as { alternatives: { members: { id: string }[] }[] };
  return ts.alternatives[0].members[0].id;
}
