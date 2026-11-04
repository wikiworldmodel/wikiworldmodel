// Rows over the globe: today's map only for about now, the hazards around their years, and a click
// on either saying what the dataset says of it. They draw on canvases of their own, so the globe's
// golden images do not see them.
import { expect, test } from '@playwright/test';
import type { HazardFile, PresentFile } from '../../../core/layers.ts';
import type { SeriesFile } from '../../../core/records.ts';
import { buildFile, idle, latestBuild, markerPositions, settledUrl } from './helpers.ts';

const layers = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const l = window.__lightworld!.layers();
    return { present: l.present, holds: l.holds, hazards: l.hazards, places: l.hazardPlaces };
  });

test('today’s map is drawn for about now, and not at other times', async ({ page }) => {
  const f = buildFile<PresentFile>('present.json');
  expect(f.borders.length).toBeGreaterThan(300);
  expect(f.places.length).toBeGreaterThan(1000);
  await page.goto(`/?b=${latestBuild()}&lat=45&lon=10&d=2`);
  await idle(page);
  const now = await layers(page);
  expect(now.holds).toBe(true);
  expect(now.present.lines).toBeGreaterThan(300);
  expect(now.present.names).toBeGreaterThan(5);
  await page.evaluate(() => window.__lightworld!.set({ t: 1900 }));
  await idle(page);
  const then = await layers(page);
  expect(then.holds).toBe(false);
  expect(then.present.lines).toBe(0);
});

test('a click on a city says what the map says of it', async ({ page }) => {
  await page.goto(`/?b=${latestBuild()}&lat=45&lon=10&d=1.6`);
  await idle(page);
  const name = (await page.evaluate(() => {
    const l = window.__lightworld!.layers();
    // Not one under a marker, a record's, which takes the click: Rome's, or Paris's obelisk.
    return ['Paris', 'Milan', 'Berlin', 'Madrid', 'Vienna', 'London', 'Warsaw', 'Lisbon'].find((n) => {
      const at = l.placeAt(n);
      return at && document.elementFromPoint(at.x, at.y)?.tagName === 'CANVAS';
    });
  }))!;
  expect(name).toBeTruthy();
  const at = (await page.evaluate((n) => window.__lightworld!.layers().placeAt(n), name))!;
  await page.mouse.click(at.x, at.y);
  await idle(page);
  const panel = page.locator('.inspect');
  await expect(panel.locator('h2')).toHaveText(name);
  await expect(panel).toContainText('as the map gives it');
  await expect(panel).toContainText('Natural Earth');
});

test('the hazards of a time show around it: Krakatau in 1883, and a click says what the database says', async ({ page }) => {
  const f = buildFile<HazardFile>('hazards.json');
  expect(f.rows.length).toBeGreaterThan(8000);
  const k = f.rows.find((r) => r.kind === 'eruption' && /Krakatau/i.test(r.name) && Math.floor(r.t) === 1883)!;
  expect(k).toBeTruthy();
  expect(k.size).toBe(6);
  await page.goto(`/?b=${latestBuild()}&t=${k.t}&lat=${k.lat}&lon=${k.lon}&d=1.6&w=1883~1884`);
  await idle(page);
  const here = await layers(page);
  const dot = here.places.find((p) => p.name === k.name);
  expect(dot).toBeTruthy();
  await page.mouse.click(dot!.x, dot!.y);
  await idle(page);
  const panel = page.locator('.inspect');
  await expect(panel.locator('h2')).toHaveText(k.name);
  await expect(panel).toContainText('Volcanic explosivity index 6');
  await expect(panel).toContainText('August 1883');
  await expect(panel).toContainText('Volcanic Eruptions Database');
  // Long before the databases start, nothing.
  await page.evaluate(() => window.__lightworld!.set({ t: -8000, window: [-9000, -7000] }));
  await idle(page);
  expect((await layers(page)).hazards).toBe(0);
});

test('biodiversity through time is a series the planet panel can open', async ({ page }) => {
  const s = buildFile<SeriesFile>('series.json').series.find((x) => x.id === 'field:earth/genera-through-time')!;
  // Every stage but the Greenlandian, which has one genus dated to it.
  expect(s.points.length).toBe(98);
  expect(s.sourceRecord?.citation).toContain('Paleobiology Database');
  // The Cambrian's stages have far fewer genera than the Neogene's; the end-Permian dips.
  const at = (ma: number) => s.points.reduce((a, b) => (Math.abs(b[0] - (1950 - ma * 1e6)) < Math.abs(a[0] - (1950 - ma * 1e6)) ? b : a));
  expect(at(535)[1]).toBeLessThan(at(10)[1]);
  expect(at(251)[1]).toBeLessThan(at(258)[1]);
  await page.goto(`/?b=${latestBuild()}&t=${1950 - 100e6}`);
  await idle(page);
  await expect(page.locator('.planet')).toContainText('Animal genera');
});

test('the planet panel has one row for a quantity, the finest with a value, and none where it has no value', async ({ page }) => {
  const row = (id: string) => page.locator(`.planet-row[data-series="${id}"]`);
  await page.goto(`/?b=${latestBuild()}&t=${1950 - 100e6}`);
  await idle(page);
  await expect(row('field:earth/co2')).toBeVisible();
  await expect(row('field:earth/sea-level')).toBeVisible();
  await expect(row('field:earth/co2-ice-core')).toBeHidden();
  await expect(row('field:earth/sea-level-stack')).toBeHidden();
  // The Last Glacial Maximum: the ice cores and the stack, not the curves of millions of years.
  await page.evaluate((t) => window.__lightworld!.set({ t }), 1950 - 21000);
  await idle(page);
  await expect(row('field:earth/co2-ice-core')).toBeVisible();
  await expect(row('field:earth/co2')).toBeHidden();
  await expect(row('field:earth/sea-level-stack')).toContainText('-1');
  await expect(row('field:earth/sea-level')).toBeHidden();
  // How many people there were, in words a reader can take in.
  await page.evaluate(() => window.__lightworld!.set({ t: 1 }));
  await idle(page);
  await expect(row('field:earth/world-population')).toContainText('232 million people');
  // Today the stack, scaled only as far as 5 ka, gives way to the long curve.
  await page.evaluate(() => window.__lightworld!.set({ t: 1950 }));
  await idle(page);
  await expect(row('field:earth/sea-level')).toContainText('0 m');
  await expect(row('field:earth/sea-level-stack')).toBeHidden();
  await expect(row('field:earth/genera-through-time')).toBeHidden();
});

test('a whole other picture can be chosen, and alternatives of different groups stand together', async ({ page }) => {
  const id = 'people/dispersals/americas-arrival';
  await page.goto(`/?b=${latestBuild()}&sel=${encodeURIComponent(id)}`);
  await idle(page);
  const when = page.locator('.inspect .when');
  const at = async () => (await when.textContent())!;
  const plain = await at();
  const button = page.locator('.tg-alts');
  await expect(button).toHaveText('Alternatives');
  await expect(page.locator('select[data-group="alt:peopling-of-the-americas"]')).toBeHidden();
  await button.click();
  await page.selectOption('select[data-group="alt:peopling-of-the-americas"]', 'alt:peopling-of-the-americas/pre-lgm');
  await idle(page);
  expect(await settledUrl(page)).toContain('alt%3Apeopling-of-the-americas%2Fpre-lgm');
  await expect(button).toHaveText('Alternatives · 1');
  const early = await at();
  expect(early).not.toBe(plain);
  // Another group's choice leaves this one's standing.
  await page.selectOption('select[data-group="alt:ipcc-ar6-scenarios"]', 'alt:ipcc-ar6-scenarios/ssp585');
  await idle(page);
  await expect(button).toHaveText('Alternatives · 2');
  expect(await at()).toBe(early);
  await page.selectOption('select[data-group="alt:peopling-of-the-americas"]', '');
  await idle(page);
  expect(await at()).toContain(plain);
  expect(await at()).not.toContain(early);
});

test('a crowded view names what it has room for, without overlaps, and a dot names itself under the pointer', async ({ page }) => {
  await page.goto(`/?b=${latestBuild()}&t=800&lat=30&lon=45&d=2.4`);
  await idle(page);
  const seen = await page.evaluate(() => {
    const shown = [...document.querySelectorAll<HTMLElement>('.marker')].filter((m) => m.style.display !== 'none');
    const labels = shown.filter((m) => !m.classList.contains('quiet')).map((m) => m.querySelector('.label')!.getBoundingClientRect());
    let overlaps = 0;
    labels.forEach((a, i) => labels.slice(i + 1).forEach((b) => {
      if (a.left + 3 < b.right && b.left + 3 < a.right && a.top + 3 < b.bottom && b.top + 3 < a.bottom) overlaps++;
    }));
    // One the pointer can reach: not under another marker's label, or the toolbar.
    const quiet = shown.find((m) => {
      if (!m.classList.contains('quiet')) return false;
      const d = m.querySelector('.dot')!.getBoundingClientRect();
      return m.contains(document.elementFromPoint(d.left + d.width / 2, d.top + d.height / 2));
    });
    return { shown: shown.length, labelled: labels.length, overlaps, quiet: quiet?.dataset.entity };
  });
  expect(seen.labelled).toBeGreaterThan(5);
  expect(seen.labelled).toBeLessThan(seen.shown);
  expect(seen.overlaps).toBe(0);
  const dot = page.locator(`.marker[data-entity="${seen.quiet}"]`);
  await expect(dot.locator('.label')).toBeHidden();
  await dot.locator('.dot').hover();
  await expect(dot.locator('.label')).toBeVisible();
});

test('the world’s states are drawn at the time shown, each a row of the dataset, and Rome from its own records', async ({ page }) => {
  // The Parthian Empire in 120 CE, in the east of Iran, clear of any marker.
  await page.goto(`/?b=${latestBuild()}&t=120&lat=34&lon=58&d=1.8`);
  await idle(page);
  const stats = await page.evaluate(() => {
    const l = window.__lightworld!.layers();
    return { polities: l.polities, here: l.polityAt(58, 34), inRome: l.polityAt(12.5, 41.9) };
  });
  expect(stats.polities.rows).toBeGreaterThan(5);
  expect(stats.polities.names).toBeGreaterThan(3);
  expect(stats.here).toBe('Parthian Empire');
  expect(stats.inRome).toBeUndefined();
  // A click on the land says who held it, and that it is a row of the dataset, along with the land's own panel.
  await page.mouse.click(640, (760 - 90) / 2);
  await idle(page);
  const panel = page.locator('.inspect');
  await expect(panel.locator('h2')).toHaveText('Land surface');
  await expect(panel.locator('.polity')).toContainText('Parthian Empire');
  await expect(panel.locator('.polity')).toContainText('not a record of ours');
  // A thousand years before, another map; and at the present, none: today's map takes over.
  await page.evaluate(() => window.__lightworld!.set({ t: -880 }));
  await idle(page);
  expect(await page.evaluate(() => window.__lightworld!.layers().polityAt(58, 34))).not.toBe('Parthian Empire');
  await page.evaluate(() => window.__lightworld!.set({ t: 1950 }));
  await idle(page);
  expect((await page.evaluate(() => window.__lightworld!.layers().polities)).rows).toBe(0);
});

test('the roads of the Roman Empire are drawn for the years they are known from', async ({ page }) => {
  await page.goto(`/?b=${latestBuild()}&t=200&lat=42&lon=12&d=1.6`);
  await idle(page);
  expect(await page.evaluate(() => window.__lightworld!.layers().routes)).toBeGreaterThan(1000);
  // Long after: only what the dataset itself dates so late, and that is little.
  await page.evaluate(() => window.__lightworld!.set({ t: 1300 }));
  await idle(page);
  expect(await page.evaluate(() => window.__lightworld!.layers().routes)).toBe(0);
});

test('the world’s languages are drawn when asked for, at the present, and a click says what the catalogue says', async ({ page }) => {
  await page.goto(`/?b=${latestBuild()}&lat=47&lon=2&d=1.5`);
  await idle(page);
  expect(await page.evaluate(() => window.__lightworld!.layers().languages)).toBe(0);
  await page.locator('.tg-langs').click();
  await idle(page);
  expect(await page.evaluate(() => window.__lightworld!.layers().languages)).toBeGreaterThan(50);
  await page.waitForFunction(() => window.__lightworld!.url().includes('langs=1'));
  const at = (await page.evaluate(() => window.__lightworld!.layers().languageAt('Basque')))!;
  expect(at).toBeTruthy();
  await page.mouse.click(at.x, at.y);
  await idle(page);
  const panel = page.locator('.inspect');
  await expect(panel.locator('h2')).toHaveText('Basque');
  await expect(panel).toContainText('Glottocode basq1248');
  await expect(panel).toContainText('Glottolog');
  // They are where they are today, not where they were: not drawn in the past.
  await page.evaluate(() => window.__lightworld!.set({ t: 1200 }));
  await idle(page);
  expect(await page.evaluate(() => window.__lightworld!.layers().languages)).toBe(0);
});

test('a thing that moved is where it was at the time shown: the obelisk leaves Heliopolis for Rome', async ({ page }) => {
  const id = 'people/objects/flaminian-obelisk';
  const at = async (t: number) => {
    await page.evaluate((x) => window.__lightworld!.set({ t: x }), t);
    await idle(page);
    return (await markerPositions(page))[id];
  };
  await page.goto(`/?b=${latestBuild()}&t=-500&lat=36&lon=22&d=2`);
  await idle(page);
  const egypt = await at(-500);
  const rome = await at(100);
  const piazza = await at(1800);
  expect(egypt).toBeTruthy();
  expect(rome).toBeTruthy();
  // From Egypt to Italy: a long way on the screen, up and to the left.
  expect(rome[1]).toBeLessThan(egypt[1] - 40);
  expect(rome[0]).toBeLessThan(egypt[0] - 40);
  // Across Rome, in 1589: hardly at all, but for how the dots around it fan out downwards.
  expect(Math.abs(piazza[0] - rome[0])).toBeLessThan(6);
  expect(Math.abs(piazza[1] - rome[1])).toBeLessThan(6 + 3 * 17);
});
