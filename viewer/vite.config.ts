import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const BUILDS = resolve(__dirname, '../dist/builds');

const TYPES: Record<string, string> = { '.json': 'application/json', '.lwt': 'application/octet-stream' };

/** Serve world builds (dist/builds) at /builds/ during development and preview. */
function builds(): Plugin {
  const serve = (req: { url?: string }, res: import('node:http').ServerResponse, next: () => void) => {
    const url = (req.url ?? '').split('?')[0];
    if (!url.startsWith('/builds/')) return next();
    const path = join(BUILDS, decodeURIComponent(url.slice('/builds/'.length)));
    if (!path.startsWith(BUILDS) || !existsSync(path) || !statSync(path).isFile()) {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.setHeader('Content-Type', TYPES[extname(path)] ?? 'application/octet-stream');
    res.setHeader('Cache-Control', url.endsWith('index.json') ? 'no-cache' : 'public, max-age=31536000, immutable');
    createReadStream(path).pipe(res);
  };
  return {
    name: 'lightworld-builds',
    configureServer: (s) => void s.middlewares.use(serve),
    configurePreviewServer: (s) => void s.middlewares.use(serve),
  };
}

export default defineConfig({
  root: __dirname,
  base: './',
  plugins: [builds()],
  server: { fs: { allow: [resolve(__dirname, '..')] } },
  build: { outDir: resolve(__dirname, '../dist/site'), emptyOutDir: true, target: 'es2022' },
});
