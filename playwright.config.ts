import { defineConfig } from '@playwright/test';

// E2E smoke tests launch the real Electron app (no browser download needed).
// Run with: npm run test:e2e  (builds the renderer first)
export default defineConfig({
  testDir: './tests-e2e',
  timeout: 60_000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
});
