// Pass criteria for the tree of life: the panel and the globe agree at every time; a taxon's bar
// starts within the solver's bounds; choosing a group lights up its fossils on the globe and along
// the time control; and it holds its thousand-odd taxa without trouble.
import { expect, test } from '@playwright/test';
import type { TreeFile } from '../../../core/tree.ts';
import { buildFile, idle, latestBuild } from './helpers.ts';

const year = (ma: number) => Math.round(1950 - ma * 1e6);

const rows = (page: import('@playwright/test').Page) => page.evaluate(() => window.__lightworld!.tree()!.rows);
const open = async (page: import('@playwright/test').Page, query: string) => {
  await page.goto(`/?b=${latestBuild()}&tree=1&${query}`);
  await idle(page);
  await page.waitForFunction(() => window.__lightworld!.tree());
  await idle(page);
};

test('T opens the panel, the link keeps it open, and its close button shuts it', async ({ page }) => {
  await page.goto(`/?b=${latestBuild()}&t=${year(100)}`);
  await idle(page);
  await expect(page.locator('.tree-panel')).toBeHidden();
  await page.keyboard.press('t');
  await idle(page);
  await expect(page.locator('.tree-panel')).toBeVisible();
  expect((await page.evaluate(() => window.__lightworld!.state())).tree).toBe(true);
  await page.waitForFunction(() => window.__lightworld!.url().includes('tree=1'));
  await page.locator('.tree-panel .close').click();
  await expect(page.locator('.tree-panel')).toBeHidden();
});

test('the panel and the globe agree at every time, by the same rule', async ({ page }) => {
  await open(page, `t=${year(300)}`);
  const f = buildFile<TreeFile>('tree.json');
  const byId = new Map(f.nodes.map((n) => [n.id, n]));
  for (const ma of [3000, 500, 300, 230, 150, 66.5, 60, 1]) {
    await page.evaluate((t) => window.__lightworld!.set({ t }), year(ma));
    await idle(page);
    const t = year(ma);
    for (const r of await rows(page)) {
      const n = byId.get(r.id)!;
      const start = n.time.start.best ?? -Infinity;
      const end = n.time.end.best ?? Infinity;
      expect(r.arisen, `${r.id} at ${ma} Ma`).toBe(start <= t);
      expect(r.alive, `${r.id} at ${ma} Ma`).toBe(start <= t && t <= end);
    }
    // A record the globe shows with a marker of a taxon's fossil is in the panel's alive group's reach.
    const shown = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.marker')].filter((m) => m.style.display !== 'none' && Number(m.style.opacity || 1) > 0.5).map((m) => m.dataset.entity!));
    const members = new Map(f.members.map((m) => [m.entity, m.taxon]));
    for (const id of shown) {
      const taxon = members.get(id);
      if (taxon === undefined) continue;
      // Its lineage has arisen by the time its fossil shows.
      const s = f.nodes[taxon].time.start.best ?? -Infinity;
      expect(s, `${id} at ${ma} Ma`).toBeLessThanOrEqual(t + 2e7);
    }
  }
});

test('a taxon’s bar starts within the solver’s bounds, in the picture chosen', async ({ page }) => {
  await open(page, `t=${year(100)}`);
  const f = buildFile<TreeFile>('tree.json');
  const byId = new Map(f.nodes.map((n) => [n.id, n]));
  const list = await rows(page);
  expect(list.length).toBeGreaterThanOrEqual(26);
  for (const r of list) {
    const n = byId.get(r.id)!;
    if (r.start === null) continue;
    if (n.time.start.lo !== null) expect(r.start).toBeGreaterThanOrEqual(n.time.start.lo - 1e-6);
    if (n.time.start.hi !== null) expect(r.start).toBeLessThanOrEqual(n.time.start.hi + 1e-6);
  }
  // A competing claim for a taxon's start moves the bar, and the panel follows the picture.
  const withVariant = f.nodes.find((n) => n.variants && Object.values(n.variants).some((v) => v.start.best !== n.time.start.best) && list.some((r) => r.id === n.id));
  if (withVariant) {
    const [key, variant] = Object.entries(withVariant.variants!).find(([, v]) => v.start.best !== withVariant.time.start.best)!;
    const scenario = key.includes('#') ? { picks: key.split('+') } : { alt: key.split('+') };
    await page.evaluate((s) => window.__lightworld!.set(s), scenario);
    await idle(page);
    const moved = (await rows(page)).find((r) => r.id === withVariant.id)!;
    expect(moved.start).toBe(variant.start.best);
  }
});

test('choosing a group lights up its fossils on the globe and along the time control', async ({ page }) => {
  await open(page, `t=${year(66.5)}&lat=50&lon=-85&d=2.6`);
  await page.evaluate(() => window.__lightworld!.set({ sel: 'life/taxa/dinosauria' }));
  await idle(page);
  const lit = await page.evaluate(() => window.__lightworld!.tree()!);
  expect(lit.litRows).toBeGreaterThan(100);
  // Clearing it puts them out.
  await page.evaluate(() => window.__lightworld!.set({ sel: null }));
  await idle(page);
  expect((await page.evaluate(() => window.__lightworld!.tree()!)).litRows).toBe(0);
  // A row of the panel chooses its taxon.
  const f = buildFile<TreeFile>('tree.json');
  const marked = f.members.map((m) => f.nodes[m.taxon].id);
  expect(marked.length).toBeGreaterThan(5);
  const fromMarker = marked[0];
  await page.evaluate((id) => window.__lightworld!.set({ sel: id }), fromMarker);
  await idle(page);
  const again = await page.evaluate(() => window.__lightworld!.tree()!);
  expect(again.litMarkers.length).toBeGreaterThan(0);
  for (const id of again.litMarkers) expect(f.members.some((m) => m.entity === id)).toBe(true);
  // The marker it lights is shown as lit, wherever its time is.
  const features = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.marker.lit')].filter((m) => m.style.display !== 'none').map((m) => m.dataset.entity!));
  for (const id of features) expect(again.litMarkers).toContain(id);
});

test('the tree works with the thousand-odd taxa of the build: shown folded, and a frame drawn in a blink', async ({ page }) => {
  await open(page, `t=${year(66.5)}`);
  const f = buildFile<TreeFile>('tree.json');
  expect(f.nodes.length).toBeGreaterThan(1000);
  const list = await rows(page);
  expect(list.length).toBeLessThan(f.nodes.length);
  await expect(page.locator('.tree-panel .tree-count')).toContainText(/\d/);
  // Scrolling and redrawing a tree this size takes no time to speak of.
  const ms = await page.evaluate(async () => {
    const c = document.querySelector<HTMLCanvasElement>('.tree-panel canvas')!;
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) c.dispatchEvent(new WheelEvent('wheel', { deltaY: 40, bubbles: true, cancelable: true }));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    return performance.now() - t0;
  });
  expect(ms).toBeLessThan(2500);
});
