// The city as drawn at full quality, against goldens: shadows, occlusion, bloom and fine meshes.
// In software each view takes minutes, so these run in their own CI job (city-views.yml): on
// changes to the city's code or records, nightly, and on demand.
import { expect, test } from '@playwright/test';
import { canvasPng, idle, latestBuild } from './helpers.ts';

const OVERVIEW = 't=315.5&lat=41.8915&lon=12.49&d=1.000235&h=302&v=66';
const COLOSSEUM = 't=315.5&lat=41.8902&lon=12.4922&d=1.000029&h=130&v=72';
const FORUM = 't=315.5&lat=41.89185&lon=12.48665&d=1.00004&h=300&v=72';
const PANTHEON = 't=315.5&lat=41.8990&lon=12.4768&d=1.000011&h=178&v=88';
const SUNSET = 't=315.5&lat=41.8915&lon=12.49&d=1.00012&h=280&v=72&hour=18.2';

test.setTimeout(15 * 60_000);

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
