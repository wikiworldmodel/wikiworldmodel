// Pass criterion: golden-image renders at three times stay stable.
import { expect, test } from '@playwright/test';
import { canvasPng, idle, latestBuild, markerPositions } from './helpers.ts';

const VIEWS = [
  { name: 'today', query: 't=0Ma&lat=12&lon=-28&d=3.3' },
  { name: 'k-pg-boundary', query: 't=66.03Ma&lat=14&lon=-66&d=2.6' },
  { name: 'pangaea-280ma', query: 't=280Ma&lat=-38&lon=-22&d=3' },
];

for (const v of VIEWS) {
  test(`renders ${v.name} as before`, async ({ page }) => {
    await page.goto(`/?b=${latestBuild()}&${v.query}`);
    await idle(page);
    expect(await canvasPng(page)).toMatchSnapshot(`${v.name}.png`, { maxDiffPixelRatio: 0.002 });
    expect(JSON.stringify(await markerPositions(page), null, 1)).toMatchSnapshot(`${v.name}.markers.json`);
  });
}
