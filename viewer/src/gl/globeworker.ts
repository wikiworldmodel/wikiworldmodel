// The globe's generators, off the page, as every generator in the viewer runs (docs/STRUCTURE.md section
// 3.5): a generator is code a contributor wrote, and a worker keeps it apart from the page and its state.
// What it makes is checked against the build's fingerprint on the page, within the tolerance.
import { GENERATOR as BIOME_TEXTURE, generateBiomeTexture, type BiomeTextureParams } from '../../../world/generators/earth/biome/v1.ts';
import { GENERATOR as CLOUDS, generateClouds, type CloudParams } from '../../../world/generators/earth/clouds/v1.ts';
import { GENERATOR as SURFACE, generateSurface, type SurfaceParams } from '../../../world/generators/earth/surface/v1.ts';

export interface ToGlobeWorker {
  id: number;
  generator: string;
  seed: string;
  params: Record<string, unknown>;
}

export type FromGlobeWorker = { id: number; bytes: Uint8Array } | { id: number; error: string };

const RUN: Record<string, (seed: string, params: Record<string, unknown>) => Uint8Array> = {
  [CLOUDS]: (seed, p) => generateClouds(seed, p as unknown as CloudParams),
  [SURFACE]: (seed, p) => generateSurface(seed, p as unknown as SurfaceParams),
  [BIOME_TEXTURE]: (seed, p) => generateBiomeTexture(seed, p as unknown as BiomeTextureParams),
};

const post = (m: FromGlobeWorker, transfer: Transferable[] = []) => (self as unknown as { postMessage(m: unknown, t: Transferable[]): void }).postMessage(m, transfer);

self.onmessage = (e: MessageEvent<ToGlobeWorker>) => {
  const { id, generator, seed, params } = e.data;
  const run = RUN[generator];
  if (!run) {
    post({ id, error: `no code for ${generator} in this viewer` });
    return;
  }
  try {
    const bytes = run(seed, params);
    post({ id, bytes }, [bytes.buffer as ArrayBuffer]);
  } catch (err) {
    post({ id, error: (err as Error).message });
  }
};
