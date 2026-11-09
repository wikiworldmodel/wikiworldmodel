// A look at the human landscape in a browser, for a person or an agent to see what the slice draws: the globe with the
// anthromes on, and scenes of a few places from low down. Not a test: it writes PNGs for looking at.
//   npm run build:viewer && npx vite preview --config viewer/vite.config.ts --port 4173 &
//   npx tsx viewer/test/look-landscape.mts <out dir>
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const out = process.argv[2] ?? 'dist/look';
mkdirSync(out, { recursive: true });
const build = JSON.parse(readFileSync('dist/builds/index.json', 'utf8')).latest as string;
const base = 'http://localhost:4173/';
const R = 6371000;

// Software WebGL, as the browser tests draw (playwright.config.ts).
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 1 });
page.on('console', (m) => {
  if (m.type() === 'error') console.log('console:', m.text().slice(0, 400));
});
page.on('pageerror', (e) => console.log('page error:', e.message.slice(0, 400)));
/** Wait until the viewer says it has loaded and drawn what the view needs, as the browser tests do (viewer/test/e2e/helpers.ts). */
const idle = async (ms: number) => {
  const t0 = Date.now();
  try {
    await page.waitForFunction(() => window.__wikiworldmodel?.idle(), null, { polling: 250, timeout: ms });
  } catch {
    const waiting = await page.evaluate(() => window.__wikiworldmodel?.waiting() ?? ['the page']).catch(() => ['the page']);
    console.log(`  not idle after ${ms / 1000} s: still waiting on ${waiting.join(', ')}`);
  }
  return Date.now() - t0;
};
const shot = async (name: string, url: string, wait: number) => {
  await page.goto(`${base}${url}`);
  const took = await idle(wait);
  await page.screenshot({ path: join(out, `${name}.png`), timeout: 180_000 });
  const bar = await page.locator('.life-here').first().textContent({ timeout: 1000 }).catch(() => null);
  const people = await page.evaluate(() => window.__wikiworldmodel?.scene()?.people ?? null);
  console.log(name, `(${(took / 1000).toFixed(1)} s)`, bar ? `| bar: ${bar}` : '', people ? `| people: ${JSON.stringify(people)}` : '');
};

// The globe, with Settlement on, at three times.
for (const [name, t, lat, lon] of [['globe-2000bce', -1999, 30, 40], ['globe-1ce', 1, 35, 60], ['globe-1500', 1500, 25, 90]] as [string, number, number, number][]) {
  await shot(name, `?b=${build}&t=${t}&lat=${lat}&lon=${lon}&d=2.6&ly=landscape&cl=0`, 120_000);
}
// Scenes, from a few hundred metres up.
for (const [name, t, lat, lon, m] of [
  ['scene-nile-1500bce', -1499, 30.8, 31.0, 900],
  ['scene-uruk-3000bce', -2999, 31.32, 45.64, 2500],
  ['scene-yangtze-1500', 1500, 30.5, 114.3, 900],
  // Closer, from the south-west of Uruk, looking towards it.
  ['scene-uruk-close', -2999, 31.307, 45.628, 450],
] as [string, number, number, number, number][]) {
  await shot(name, `?b=${build}&t=${t}&lat=${lat}&lon=${lon}&d=${1 + m / R}&h=40&v=70&cl=0&quality=fast`, 300_000);
}
await browser.close();
