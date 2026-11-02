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

/** A file of the latest world build, parsed. */
export function buildFile<T>(name: string): T {
  return JSON.parse(readFileSync(join(REPO, 'dist/builds', latestBuild(), name), 'utf8')) as T;
}

/** The mean colour of a square patch of the globe's canvas, `size` pixels wide, around a point given as fractions of its size. */
export async function canvasPatch(page: Page, fx: number, fy: number, size = 9): Promise<[number, number, number]> {
  return page.evaluate(([fx, fy, size]) => {
    const src = document.querySelector('canvas.globe') as HTMLCanvasElement;
    const c = document.createElement('canvas');
    c.width = src.width;
    c.height = src.height;
    const g = c.getContext('2d')!;
    g.drawImage(src, 0, 0);
    const h = Math.floor(size / 2);
    const d = g.getImageData(Math.round(fx * src.width) - h, Math.round(fy * src.height) - h, size, size).data;
    const sum = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) sum[k] += d[i + k];
    return sum.map((s) => Math.round(s / (d.length / 4))) as [number, number, number];
  }, [fx, fy, size]);
}
