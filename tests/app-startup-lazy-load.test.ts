import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const appPath = path.resolve(process.cwd(), 'src/renderer/App.tsx');

describe('App startup lazy loading', () => {
  it('defers non-welcome panels behind lazy imports', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).not.toContain("import { ChatView } from './components/ChatView';");
    expect(source).not.toContain("import { ContextPanel } from './components/ContextPanel';");
    expect(source).not.toContain("import { SettingsPanel } from './components/SettingsPanel';");
    // ConfigModal was retired: API-config notices route to the settings modal.
    expect(source).not.toContain("components/ConfigModal");

    expect(source).toContain('const ChatView = lazy(() =>');
    expect(source).toContain('const ContextPanel = lazy(() =>');
    expect(source).toContain('const SettingsPanel = lazy(() =>');
  });

  it('uses suspense boundaries for deferred panels', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('<Suspense fallback=');
  });
});
