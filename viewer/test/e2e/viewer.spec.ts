import { expect, test } from '@playwright/test';
import type { PlanetFile } from '../../../core/planet.ts';
import { xOf } from '../../src/ui/timebar.ts';
import { buildFile, canvasPatch, canvasPng, idle, latestBuild, markerPositions, settledUrl } from './helpers.ts';

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
  await page.evaluate(() => window.__wikiworldmodel!.set({ t: Math.round(1950 - 66.1e6) }));
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('e');
  await page.fill('.search input', 'deccan');
  await page.keyboard.press('Enter');
  await idle(page);
  const url = await settledUrl(page);
  const state = await page.evaluate(() => window.__wikiworldmodel!.state());
  const pixels = await canvasPng(page);
  const markers = await markerPositions(page);
  expect(state.sel).toBe('earth/lips/deccan-traps');
  expect(state.evidence).toBe(true);

  const other = await context.newPage();
  await other.goto(url);
  await idle(other);
  expect(await other.evaluate(() => window.__wikiworldmodel!.state())).toEqual(state);
  expect(await markerPositions(other)).toEqual(markers);
  // Same build, time, camera and choices: the same pixels, exactly.
  expect((await canvasPng(other)).equals(pixels)).toBe(true);
  await expect(other.locator('.inspect h2')).toHaveText('Deccan Traps');
});

test('scrubbing inside a tile span fetches nothing', async ({ page }) => {
  await page.goto(`/?b=${latestBuild()}&t=70Ma&lat=10&lon=-30&d=3.3`);
  await idle(page);
  const before = await page.evaluate(() => window.__wikiworldmodel!.requests.slice());
  // Tiles for 70 Ma cover 80–60 Ma (fine level) and 80–40 Ma (coarse level).
  for (const ma of [61, 64.5, 68, 72.25, 79.9, 75]) {
    await page.evaluate((t) => window.__wikiworldmodel!.set({ t }), year(ma));
    await idle(page);
  }
  const after = await page.evaluate(() => window.__wikiworldmodel!.requests.slice());
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
  // Too young for the Deccan eruptions it falls within, and for the extinction it caused:
  // the panel names one minimal set of the clashing claims.
  await expect(page.locator('.inspect .claim.inconsistent')).toContainText(/Deccan Traps|Cretaceous–Paleogene mass extinction/);
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

test('the browser runs the cloud and surface generators to what the build made, within the tolerance', async ({ page }) => {
  await page.goto(`/?b=${latestBuild()}`);
  await idle(page);
  for (const name of ['clouds', 'surface'] as const) {
    const out = await page.evaluate((n) => window.__wikiworldmodel![n], name);
    expect(out.expected?.pixels?.n, name).toBeGreaterThan(0);
    expect(out.actual, name).not.toBeNull();
    expect(out.problems, name).toEqual([]);
  }
});

test('the Mesosaurus localities sit together in the Artinskian', async ({ page }) => {
  await page.goto(`/?b=${latestBuild()}&t=285Ma&lat=-38&lon=-22&d=3`);
  await idle(page);
  const m = await markerPositions(page);
  const ids = Object.keys(m).filter((id) => id.startsWith('life/mesosaurus/'));
  expect(ids.sort()).toEqual(['life/mesosaurus/arroyo-de-la-mina', 'life/mesosaurus/calvinia', 'life/mesosaurus/kabus', 'life/mesosaurus/sao-mateus-do-sul']);
  // Today they are on opposite sides of the Atlantic and not shown (they are Permian).
  await page.evaluate(() => window.__wikiworldmodel!.set({ t: 1950 }));
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
  await page.locator('.tg-alts').click();
  await page.selectOption('select[data-group="alt:time-scale"]', 'alt:time-scale/pbdb-2022');
  await idle(page);
  expect(await settledUrl(page)).toContain('alt=alt%3Atime-scale%2Fpbdb-2022');
  await expect(page.locator('.tb-readout')).toContainText('Artinskian');
  await expect(panel.locator('.when')).toContainText('290.1 Ma – 279.3 Ma');
  await expect(panel).toContainText('PBDB interval ages');
});

test('a record shows the relations others make to it, and leads into the tree of life', async ({ page }) => {
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
  await expect(panel.locator('.relations')).toContainText('member of Mesosaurus');
  await expect(panel).toContainText('No source: An editorial label');
  // The taxon: where it sits in the tree, and the fossils that are its members.
  await panel.locator('.relations:not(.inverse) a', { hasText: 'Mesosaurus' }).click();
  await idle(page);
  await expect(panel.locator('h2')).toHaveText('Mesosaurus');
  await expect(panel.locator('.relations:not(.inverse)')).toContainText('descends from sauropsids');
  await expect(panel.locator('.relations.inverse')).toContainText('has member Mesosaurus, Kabus');
});

test('before the plate model reaches, the globe shows no geography and says why', async ({ page }) => {
  await page.goto(`/?b=${latestBuild()}&t=2400Ma&lat=-10&lon=40&d=3.3`);
  await idle(page);
  await expect(page.locator('.notice')).toContainText('the oldest plate model reaches back to 1800 Ma');
  await expect(page.locator('.tb-readout')).toContainText('Siderian');
  await page.mouse.click(640, 300);
  await expect(page.locator('.inspect h2')).toHaveText('Geography unknown');
});

test('between 1100 and 540 Ma the globe shows where the plate model puts its continental blocks', async ({ page }) => {
  await page.goto(`/?b=${latestBuild()}&t=900Ma&lat=-20&lon=150&d=3.6`);
  await idle(page);
  await expect(page.locator('.notice')).toBeHidden();
  await expect(page.locator('.tb-readout')).toContainText('Tonian');
  await page.mouse.click(640, 300);
  const panel = page.locator('.inspect');
  await expect(panel.locator('h2')).toHaveText(/Continental block|Between the blocks/);
  await expect(panel).toContainText('not the coastlines of the time');
  await expect(panel).toContainText('Scotese');
});

test('the future: today\'s map is held for 10 kyr, and the Sun\'s brightness is a projection', async ({ page }) => {
  await page.goto(`/?b=${latestBuild()}&t=-0.00015Ma`);
  await idle(page);
  await expect(page.locator('.tb-readout')).toContainText('2100 CE');
  await expect(page.locator('.notice')).toBeHidden();
  await page.evaluate(() => window.__wikiworldmodel!.set({ t: 1950 + 1e9 }));
  await idle(page);
  await expect(page.locator('.tb-readout')).toContainText('1 Gyr from now');
  await expect(page.locator('.notice')).toContainText('held only to 10 kyr from now');
  const sun = page.locator('.planet-row[data-series="field:sun/luminosity"]');
  await expect(sun).toContainText('1.1 L☉');
  await sun.click();
  await expect(page.locator('.inspect h2')).toHaveText('Brightness of the Sun');
  await expect(page.locator('.inspect .badge.basis-projection')).toBeVisible();
  await expect(page.locator('.inspect')).toContainText('Gough');
});

test('Earth\'s states: nothing before it formed, a magma ocean after the Moon-forming impact, then oceans', async ({ page }) => {
  const { planet } = buildFile<PlanetFile>('planet.json');
  const middle = (id: string) => {
    const { time } = planet!.phases.find((p) => p.subject.endsWith(`@${id}`))!;
    return Math.round((time.start.best! + time.end.best!) / 2);
  };
  await page.goto(`/?b=${latestBuild()}&t=4590Ma&lat=10&lon=20&d=3.3&cl=0`);
  await idle(page);
  await expect(page.locator('.notice')).toContainText('Before Earth: it began to form');
  await expect(page.locator('.planet-phase')).toContainText('not formed yet');
  expect(Math.max(...(await canvasPatch(page, 0.5, 0.5)))).toBeLessThan(30);
  // The magma ocean, seen without its steam: molten rock glows red.
  await page.evaluate((t) => window.__wikiworldmodel!.set({ t }), middle('magma-ocean'));
  await idle(page);
  await expect(page.locator('.planet-phase')).toContainText('Magma ocean under steam');
  const [r, , b] = await canvasPatch(page, 0.5, 0.5, 61);
  expect(r).toBeGreaterThan(b + 15);
  // A click on the globe says the map is unknown, and which record says what covered it.
  await page.mouse.click(640, 300);
  const panel = page.locator('.inspect');
  await expect(panel.locator('h2')).toHaveText('Geography unknown');
  await panel.locator('.planet-state a', { hasText: 'Magma ocean under steam' }).click();
  await idle(page);
  await expect(panel.locator('h2')).toHaveText('Earth');
  await expect(panel.locator('.phases')).toContainText('Proto-Earth');
  // 2 Ga: an ocean world, and nothing says where its land was, so generic land stands in for it, flat and muted.
  await page.evaluate(() => window.__wikiworldmodel!.set({ t: 1950 - 2e9, sel: null }));
  await idle(page);
  await expect(page.locator('.planet-phase')).toContainText('Oceans');
  const here = await page.evaluate(() => window.__wikiworldmodel!.resolve(10, 20, 'geography'));
  expect(here.tier).toBe('generic');
  const [r2, , b2] = await canvasPatch(page, 0.5, 0.5);
  if (here.value === 'sea') expect(b2).toBeGreaterThan(r2 + 20);
  else expect(Math.abs(r2 - b2)).toBeLessThan(25);
  const made = await page.evaluate(() => window.__wikiworldmodel!.genericLand);
  expect(made.actual).not.toBeNull();
  expect(made.problems).toEqual([]);
  // A click says the land is generic.
  await page.mouse.click(640, 300);
  await expect(panel.locator('h2')).toHaveText('Geography unknown');
  await expect(panel).toContainText('generic land is drawn');
});

test('Snowball Earth: the Sturtian ice reaches the equator, unless a claim that leaves open water is picked', async ({ page }) => {
  await page.goto(`/?b=${latestBuild()}&t=690Ma&lat=0&lon=100&d=3.3&cl=0`);
  await idle(page);
  const ice = page.locator('.planet-ice');
  await expect(ice).toContainText('Sturtian glaciation');
  await expect(ice).toContainText('to the equator');
  expect(Math.min(...(await canvasPatch(page, 0.5, 0.5)))).toBeGreaterThan(150);
  await ice.click();
  await idle(page);
  const panel = page.locator('.inspect');
  await expect(panel.locator('h2')).toHaveText('Sturtian glaciation');
  const group = panel.locator('.claim-group', { hasText: 'Ice reached' });
  await expect(group.locator('.badge', { hasText: 'competing claims' })).toBeVisible();
  await group.locator('input[value="earth/events/sturtian-glaciation#ice-reach-abbot-2011"]').check();
  await idle(page);
  await expect(ice).toContainText('to 10°');
  expect(await settledUrl(page)).toContain('pick=');
  // The equator is open water now.
  expect(Math.min(...(await canvasPatch(page, 0.5, 0.5)))).toBeLessThan(120);
});

test('the band under the track names the planet\'s states, and opens their records inside them', async ({ page }) => {
  await page.goto(`/?b=${latestBuild()}&t=2000Ma`);
  await idle(page);
  const box = (await page.locator('.tb-canvas').boundingBox())!;
  const { window: win } = await page.evaluate(() => window.__wikiworldmodel!.state());
  await page.mouse.move(box.x + xOf(1950 - 690e6, win, box.width), box.y + box.height - 6);
  await expect(page.locator('.tb-tip')).toContainText('Sturtian glaciation: ice to the equator');
  await page.mouse.down();
  await page.mouse.up();
  await idle(page);
  await expect(page.locator('.inspect h2')).toHaveText('Sturtian glaciation');
  // The time moved into the glaciation.
  const { t } = await page.evaluate(() => window.__wikiworldmodel!.state());
  expect(t).toBeGreaterThan(1950 - 717e6);
  expect(t).toBeLessThan(1950 - 658e6);
});

test('the time control spans the Hadean to the far future, and its track opens records', async ({ page }) => {
  await page.goto(`/?b=${latestBuild()}`);
  await idle(page);
  await expect(page.locator('.brand span')).toHaveText(/^Hadean to \d+(\.\d+)? Gyr from now$/);
  // Point at the Chicxulub impact's time on the track: the record nearest the pointer is
  // named in a tip, and a click opens it.
  const box = (await page.locator('.tb-canvas').boundingBox())!;
  const { window: win } = await page.evaluate(() => window.__wikiworldmodel!.state());
  await page.mouse.move(box.x + xOf(1950 - 66.038e6, win, box.width), box.y + box.height - 12);
  const tip = page.locator('.tb-tip');
  await expect(tip).toBeVisible();
  const label = (await tip.textContent())!.split(' · ')[0];
  await page.mouse.down();
  await page.mouse.up();
  await idle(page);
  await expect(page.locator('.inspect h2')).toHaveText(label);
  expect(await settledUrl(page)).toContain('sel=');
});

test('Rome: its territory at the time shown, drawn from its dataset, and a click opens its record', async ({ page }) => {
  // Umbria, in view of Rome but clear of its marker.
  await page.goto(`/?b=${latestBuild()}&t=120&lat=43.1&lon=12.4&d=1.6&cl=0`);
  await idle(page);
  await expect(page.locator('.territory-label', { hasText: 'Rome' })).toHaveText('Rome · Empire');
  const [r1, g1] = await canvasPatch(page, 0.5, 0.5, 15);
  // A click on the land opens the state's record, and says which of the dataset's rows is drawn there.
  const box = (await page.locator('canvas.globe').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await idle(page);
  const panel = page.locator('.inspect');
  await expect(panel.locator('h2')).toHaveText('Rome');
  await expect(panel.locator('.here')).toContainText('117 CE – 126 CE: the row named “Roman Empire”');
  await expect(panel.locator('.phases')).toContainText('Republic');
  // Before the founding there is no territory to tint the land.
  await page.evaluate(() => window.__wikiworldmodel!.set({ t: -900, sel: null }));
  await idle(page);
  await expect(page.locator('.territory-labels')).toBeHidden();
  const [r0, g0] = await canvasPatch(page, 0.5, 0.5, 15);
  expect(r1 - g1).toBeGreaterThan(r0 - g0 + 10);
  // Two courts in 420, and nothing left of either after Constantinople fell.
  await page.evaluate(() => window.__wikiworldmodel!.set({ t: 420 }));
  await idle(page);
  await expect(page.locator('.territory-label', { hasText: 'Western Roman Empire' })).toBeVisible();
  await page.evaluate(() => window.__wikiworldmodel!.set({ t: 1460 }));
  await idle(page);
  await expect(page.locator('.territory-labels')).toBeHidden();
});

test('the time control zooms to a few years, reads the day, and keeps it in the link', async ({ page }) => {
  await page.goto(`/?b=${latestBuild()}&t=-42.7986&w=-45.5~-41.5&lat=41.9&lon=12.5&d=2`);
  await idle(page);
  await expect(page.locator('.tb-readout strong')).toHaveText('15 March 44 BCE');
  expect(await settledUrl(page)).toContain('t=-42.799');
  // The Ides of March, on its day.
  const ides = page.locator('.marker[data-entity="people/events/assassination-of-julius-caesar"]');
  await expect(ides).toBeVisible();
  await ides.locator('.dot').click();
  await idle(page);
  await expect(page.locator('.inspect .when')).toContainText('15 March 44 BCE');
  // Zooming in stops at a few years.
  await page.locator('.tb-canvas').hover({ position: { x: 600, y: 50 } });
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -800);
  await idle(page);
  const { window: win } = await page.evaluate(() => window.__wikiworldmodel!.state());
  expect(win[1] - win[0]).toBeGreaterThan(3.9);
  expect(win[1] - win[0]).toBeLessThan(4.1);
});

test('the whole strip gives recent history room: years to the pixel, and its moments apart', async ({ page }) => {
  await page.goto(`/?b=${latestBuild()}`);
  await idle(page);
  const box = (await page.locator('.tb-canvas').boundingBox())!;
  const { window: win } = await page.evaluate(() => window.__wikiworldmodel!.state());
  // Scrubbing to Rome reads a year, and lands within a few years of it.
  await page.mouse.click(box.x + xOf(120, win, box.width), box.y + 60);
  await idle(page);
  await expect(page.locator('.tb-readout strong')).toHaveText(/^\d+ CE$/);
  const { t } = await page.evaluate(() => window.__wikiworldmodel!.state());
  expect(Math.abs(t - 120)).toBeLessThan(10);
  // The track tells Actium from the fall of Constantinople, without zooming.
  const tip = page.locator('.tb-tip');
  await page.mouse.move(box.x + xOf(-30, win, box.width), box.y + box.height - 12);
  await expect(tip).toContainText('Actium');
  await page.mouse.move(box.x + xOf(1453.4, win, box.width), box.y + box.height - 12);
  await expect(tip).toContainText('Constantinople');
  // A moment 315 kyr old is far from today now.
  await page.evaluate(() => window.__wikiworldmodel!.set({ t: 1950 }));
  await idle(page);
  await expect(page.locator('.marker[data-entity="life/occurrences/homo-sapiens-jebel-irhoud"]')).toHaveCount(0);
});

test('a city is labelled by the name it had at the time shown', async ({ page }) => {
  await page.goto(`/?b=${latestBuild()}&t=300&lat=41&lon=29&d=2&w=-800~2000`);
  await idle(page);
  const city = page.locator('.marker[data-entity="places/constantinople"] .label');
  await expect(city).toHaveText('Byzantium');
  await page.evaluate(() => window.__wikiworldmodel!.set({ t: 400 }));
  await idle(page);
  await expect(city).toHaveText('Constantinople');
  await page.evaluate(() => window.__wikiworldmodel!.set({ t: 1950 }));
  await idle(page);
  await expect(city).toHaveText('Istanbul');
});

test('opening a record of the last few thousand years fits the time control to it, and flies to a polity\'s land', async ({ page }) => {
  await page.goto(`/?b=${latestBuild()}`);
  await idle(page);
  await page.fill('.search input', 'Western Roman');
  await page.keyboard.press('Enter');
  await idle(page);
  const s = await page.evaluate(() => window.__wikiworldmodel!.state());
  expect(s.sel).toBe('people/polities/western-roman-empire');
  expect(s.window[1] - s.window[0]).toBeLessThan(500);
  // Its start: the death of Theodosius, 17 January 395.
  expect(s.t).toBeGreaterThan(395);
  expect(s.t).toBeLessThan(395.1);
  expect(s.cam.lat).toBeGreaterThan(30);
  expect(s.cam.lat).toBeLessThan(50);
  expect(s.cam.lon).toBeGreaterThan(-10);
  expect(s.cam.lon).toBeLessThan(25);
});
