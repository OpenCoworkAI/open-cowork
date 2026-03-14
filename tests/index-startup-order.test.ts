import { describe, expect, it } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';

const indexPath = path.resolve(process.cwd(), 'src/main/index.ts');

describe('Main process startup order', () => {
  it('initializes session manager before creating the main window', () => {
    const source = fs.readFileSync(indexPath, 'utf8');
    const startupBlock = source.match(/app\.whenReady\(\)\.then\(async \(\) => \{[\s\S]*?\n\}\);/)?.[0] || '';

    const createWindowIndex = startupBlock.indexOf('createWindow();');
    const sessionManagerIndex = startupBlock.indexOf('sessionManager = new SessionManager');
    const skillsManagerIndex = startupBlock.indexOf('skillsManager = new SkillsManager');

    expect(sessionManagerIndex).toBeGreaterThan(-1);
    expect(skillsManagerIndex).toBeGreaterThan(-1);
    expect(createWindowIndex).toBeGreaterThan(-1);
    expect(sessionManagerIndex).toBeLessThan(createWindowIndex);
    expect(skillsManagerIndex).toBeLessThan(createWindowIndex);
  });

  it('does not force-disable sandbox mode on every startup', () => {
    const source = fs.readFileSync(indexPath, 'utf8');

    expect(source).not.toContain("configStore.set('sandboxEnabled', false);");
  });

  it('surfaces startup failures through a top-level catch handler', () => {
    const source = fs.readFileSync(indexPath, 'utf8');

    expect(source).toContain('app.whenReady().then(async () => {');
    expect(source).toContain('}).catch((error) => {');
    expect(source).toContain('dialog.showErrorBox(');
  });
});
