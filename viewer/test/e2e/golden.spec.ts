// Pass criterion: golden-image renders at six times stay stable: three of the planet's
// geography, two of its states, and the Roman Empire's territory near its height.
import { expect, test } from '@playwright/test';
import { canvasPng, idle, latestBuild, markerPositions } from './helpers.ts';

const VIEWS = [
  { name: 'today', query: 't=0Ma&lat=12&lon=-28&d=3.3' },
  { name: 'k-pg-boundary', query: 't=66.03Ma&lat=14&lon=-66&d=2.6' },
  { name: 'pangaea-280ma', query: 't=280Ma&lat=-38&lon=-22&d=3' },
  { name: 'magma-ocean', query: 't=4536Ma&lat=10&lon=20&d=3.3' },
  { name: 'sturtian-snowball', query: 't=690Ma&lat=0&lon=100&d=3.3' },
  { name: 'roman-empire-120', query: 't=120&lat=38&lon=18&d=2.4' },
];

for (const v of VIEWS) {
  test(`renders ${v.name} as before`, async ({ page }) => {
    await page.goto(`/?b=${latestBuild()}&${v.query}`);
    await idle(page);
    expect(await canvasPng(page)).toMatchSnapshot(`${v.name}.png`, { maxDiffPixelRatio: 0.002 });
    expect(JSON.stringify(await markerPositions(page), null, 1)).toMatchSnapshot(`${v.name}.markers.json`);
  });
}
