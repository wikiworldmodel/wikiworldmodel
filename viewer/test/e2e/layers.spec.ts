// Rows over the globe: today's map only for about now, the hazards around their years, and a click
// on either saying what the dataset says of it. They draw on canvases of their own, so the globe's
// golden images do not see them.
import { expect, test } from '@playwright/test';
import type { HazardFile, PresentFile } from '../../../core/layers.ts';
import type { SeriesFile } from '../../../core/records.ts';
import { buildFile, canvasPatch, idle, latestBuild, markerPositions, settledUrl } from './helpers.ts';

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

test('where people lived is drawn when asked for: the Nile reads as populated at 1 CE, the Sahara does not, and neither does the sea change', async ({ page }) => {
  const NILE = [31.5, 30.5];
  const SAHARA = [12, 20];
  const SEA = [34, 34];
  await page.goto(`/?b=${latestBuild()}&t=1&lat=27&lon=25&d=1.7&cl=0`);
  await idle(page);
  const spot = (at: number[]) => page.evaluate(([lon, lat]) => window.__lightworld!.layers().peopleAt(lon, lat), at);
  const patch = async (at: number[]) => {
    const c = (await spot(at))!;
    const box = (await page.locator('canvas.globe').boundingBox())!;
    return canvasPatch(page, c.x / box.width, c.y / box.height, 5);
  };
  // Until it is asked for it is not drawn or loaded, and the globe is as it always was.
  expect((await page.evaluate(() => window.__lightworld!.layers().people)).drawn).toBe(false);
  expect(await page.evaluate(() => window.__lightworld!.requests.some((r) => r.endsWith('people.lwt')))).toBe(false);
  await expect(page.locator('.people-legend')).toBeHidden();
  await page.locator('.tg-people').click();
  await idle(page);
  await page.waitForFunction(() => window.__lightworld!.url().includes('people=1'));
  const on = await page.evaluate(() => window.__lightworld!.layers().people);
  expect(on.drawn).toBe(true);
  expect(on.lit).toBeGreaterThan(5000);
  // The numbers tell them apart…
  const nile = (await spot(NILE))!;
  const sahara = (await spot(SAHARA))!;
  expect(nile.people).toBeGreaterThan(500_000);
  expect(nile.level).toBeGreaterThan(0.7);
  expect(sahara.people).toBeLessThan(100);
  expect(sahara.level).toBe(0);
  const onNile = await patch(NILE);
  const onSahara = await patch(SAHARA);
  const onSea = await patch(SEA);
  // …and so does the drawing: a bright warm glow on the one, the dimmed land on the other.
  expect(onNile[0]).toBeGreaterThan(180);
  expect(onNile[0]).toBeGreaterThan(onNile[2] + 60);
  expect(onSahara[0]).toBeLessThan(110);
  expect(onNile[0]).toBeGreaterThan(onSahara[0] + 80);
  // With it off again the Sahara is brighter than it was under the layer, and the sea has not changed.
  await page.locator('.tg-people').click();
  await idle(page);
  expect((await page.evaluate(() => window.__lightworld!.layers().people)).drawn).toBe(false);
  await expect(page.locator('.people-legend')).toBeHidden();
  const offSahara = await patch(SAHARA);
  const offSea = await patch(SEA);
  expect(offSahara[0]).toBeGreaterThan(onSahara[0] + 30);
  for (let i = 0; i < 3; i++) expect(Math.abs(offSea[i] - onSea[i])).toBeLessThan(2);
});

test('the cells of the people drawn come to the world’s series, and it says it is a reconstruction', async ({ page }) => {
  const points = buildFile<SeriesFile>('series.json').series.find((x) => x.id === 'field:earth/world-population')!.points;
  const value = (t: number) => {
    const i = points.findIndex((p) => p[0] >= t);
    if (points[i][0] === t) return points[i][1];
    const [a, b] = [points[i - 1], points[i]];
    return a[1] + ((b[1] - a[1]) * (t - a[0])) / (b[0] - a[0]);
  };
  await page.goto(`/?b=${latestBuild()}&t=1&lat=20&lon=80&d=2.4&people=1&cl=0`);
  await idle(page);
  const legend = page.locator('.people-legend');
  await expect(legend).toBeVisible();
  await expect(legend).toContainText('Where people lived');
  await expect(legend).toContainText('reconstruction');
  await expect(legend).toContainText('Not a count');
  await expect(legend).toContainText('Klein Goldewijk');
  await expect(legend.locator('.pl-ticks')).toContainText('1,000');
  for (const t of [-5000, 1, 1450, 1955, 2012, 2015]) {
    await page.evaluate((x) => window.__lightworld!.set({ t: x }), t);
    await idle(page);
    const p = await page.evaluate(() => window.__lightworld!.layers().people);
    expect(p.drawn, `at ${t}`).toBe(true);
    expect(Math.abs(p.total - value(t)) / value(t), `at ${t}: ${p.total} against ${value(t)}`).toBeLessThan(5e-5);
  }
  // More of the world shows as time goes on, on a scale that does not move.
  await page.evaluate(() => window.__lightworld!.set({ t: -5000 }));
  await idle(page);
  const early = await page.evaluate(() => window.__lightworld!.layers().people.lit);
  await page.evaluate(() => window.__lightworld!.set({ t: 2015 }));
  await idle(page);
  expect(await page.evaluate(() => window.__lightworld!.layers().people.lit)).toBeGreaterThan(early);
  // Past its last step, and before its first, nothing is drawn, and the legend says why.
  await page.evaluate(() => window.__lightworld!.set({ t: 2020 }));
  await idle(page);
  expect(await page.evaluate(() => window.__lightworld!.layers().people.drawn)).toBe(false);
  await expect(legend).toContainText('nothing is drawn at this time');
  await page.evaluate(() => window.__lightworld!.set({ t: -20000 }));
  await idle(page);
  expect(await page.evaluate(() => window.__lightworld!.layers().people.drawn)).toBe(false);
  await expect(legend).toContainText('10,000 BC to 2015 AD');
});

test('a click says what the dataset gives for that cell, and how far to trust it', async ({ page }) => {
  // The plain of the Ganges, or wherever else near it no marker takes the click.
  const places = [[25.5, 83.5], [24.5, 86.5], [27.5, 79.5], [22.5, 78.5], [18.5, 75.5]];
  await page.goto(`/?b=${latestBuild()}&t=1&lat=${places[0][0]}&lon=${places[0][1]}&d=1.6&people=1&cl=0`);
  await idle(page);
  let place = places[0];
  for (const p of places) {
    await page.evaluate(([lat, lon]) => window.__lightworld!.set({ cam: { lat, lon, dist: 1.6 } }), p);
    await idle(page);
    place = p;
    const at = (await page.evaluate(([lat, lon]) => window.__lightworld!.layers().peopleAt(lon, lat), p))!;
    if (await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName === 'CANVAS', at)) break;
  }
  const cell = (await page.evaluate(([lat, lon]) => window.__lightworld!.layers().peopleAt(lon, lat), place))!;
  const middle = { x: cell.x, y: cell.y };
  await page.mouse.click(middle.x, middle.y);
  await idle(page);
  const panel = page.locator('.inspect .people');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('People here');
  await expect(panel).toContainText('reconstruction');
  // What the dataset gives: this cell, its steps on either side, and straight between them.
  const [south, west] = [Math.floor(place[0]), Math.floor(place[1])];
  await expect(panel).toContainText(`1° cell from ${south}°N to ${south + 1}°N and ${west}°E to ${west + 1}°E`);
  await expect(panel).toContainText('at its step 0 AD');
  await expect(panel).toContainText('at its step 100 AD');
  await expect(panel).toContainText('not an estimate');
  await expect(panel).toContainText(`${cell.land.toLocaleString('en-US')} km² of land`);
  // How uncertain: the authors' own range at 1 CE, read from the field's record.
  await expect(panel).toContainText('±75%');
  await expect(panel).toContainText('give no range for a single place');
  await expect(panel).toContainText('general, globally applicable HYDE allocation rules');
  await expect(panel).toContainText('Klein Goldewijk');
  // At a later time the range narrows, as they say it does.
  await page.evaluate(() => window.__lightworld!.set({ t: 1900 }));
  await idle(page);
  await page.mouse.click(middle.x, middle.y);
  await idle(page);
  await expect(panel).toContainText('±5%');
  await expect(panel).toContainText('at its step 1900 AD');
  await expect(panel).not.toContainText('Between its steps');
  // With the layer off a click on the land says nothing of people.
  await page.locator('.tg-people').click();
  await idle(page);
  await page.mouse.click(middle.x, middle.y);
  await idle(page);
  await expect(panel).toBeHidden();
  await expect(page.locator('.inspect h2')).toHaveText('Land surface');
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
