import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';

const REPO = join(import.meta.dirname, '../../..');

/** The latest world build's id. */
export function latestBuild(): string {
  return JSON.parse(readFileSync(join(REPO, 'dist/builds/index.json'), 'utf8')).latest;
}

/** Wait until the viewer has loaded what the view needs and drawn it, twice in a row. */
export async function idle(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__lightworld?.idle(), null, { polling: 100 });
  await page.waitForTimeout(250);
  await page.waitForFunction(() => window.__lightworld?.idle(), null, { polling: 100 });
}

/** The WebGL canvas's own pixels as PNG bytes (no HTML overlays, no fonts). */
export async function canvasPng(page: Page): Promise<Buffer> {
  const url = await page.evaluate(() => (document.querySelector('canvas.globe') as HTMLCanvasElement).toDataURL('image/png'));
  return Buffer.from(url.split(',')[1], 'base64');
}

/** The URL bar, once the viewer has written the current state into it. */
export async function settledUrl(page: Page): Promise<string> {
  await page.waitForFunction(() => location.search === window.__lightworld!.url(), null, { polling: 100 });
  return page.url();
}

/** Visible markers and their screen positions, rounded to whole pixels. */
export async function markerPositions(page: Page): Promise<Record<string, [number, number]>> {
  return page.evaluate(() => {
    const out: Record<string, [number, number]> = {};
    for (const el of document.querySelectorAll<HTMLElement>('.marker')) {
      if (el.style.display === 'none') continue;
      const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(el.style.transform);
      if (m) out[el.dataset.entity!] = [Math.round(Number(m[1])), Math.round(Number(m[2]))];
    }
    return out;
  });
}
