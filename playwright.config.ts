import { defineConfig } from '@playwright/test';

// The globe is rendered by SwiftShader (software WebGL), so pixels do not depend on the
// machine's GPU; goldens are shared across platforms.
export default defineConfig({
  testDir: 'viewer/test/e2e',
  // Software rendering is slow but not this slow: fail fast rather than hang CI.
  timeout: 120_000,
  globalTimeout: 15 * 60_000,
  expect: { timeout: 45_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  snapshotPathTemplate: 'viewer/test/golden/{arg}{ext}',
  use: {
    baseURL: 'http://localhost:4173/',
    viewport: { width: 1280, height: 760 },
    deviceScaleFactor: 1,
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
  webServer: {
    command: 'npm run serve',
    url: 'http://localhost:4173/',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
