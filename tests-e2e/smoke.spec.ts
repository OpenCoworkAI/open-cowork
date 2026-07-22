import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'node:path';

/**
 * First-run smoke: launches the packaged-equivalent app (built renderer +
 * built main) and asserts the core shell renders. This is the only automated
 * check of the "one-click install, it just opens" promise — unit tests never
 * exercise the real Electron boot path.
 *
 * Prerequisite: `vite build` has produced dist/ and dist-electron/
 * (the `test:e2e` npm script handles this).
 */

let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  app = await electron.launch({
    args: [path.resolve(__dirname, '..')],
    env: {
      ...process.env,
      // The dev-shell trap: this variable forces Electron into plain-Node
      // mode and crashes the main process. Never inherit it in E2E.
      ELECTRON_RUN_AS_NODE: undefined as unknown as string,
      NODE_ENV: 'production',
    },
  });
  page = await app.firstWindow();
});

test.afterAll(async () => {
  await app?.close();
});

test('main window opens and renders the app shell', async () => {
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#root')).not.toBeEmpty({ timeout: 30_000 });
  // Welcome view greets on a fresh profile; an existing profile may restore
  // a session instead — both render the sidebar brand.
  await expect(page.getByText('Open Cowork').first()).toBeVisible({ timeout: 15_000 });
});

test('settings modal opens over the intact layout and closes with Escape', async () => {
  const settingsButton = page.locator('button', { hasText: /设置|Settings/ }).first();
  await settingsButton.click();
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toBeVisible({ timeout: 10_000 });

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});
