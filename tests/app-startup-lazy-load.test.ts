import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const appPath = path.resolve(process.cwd(), 'src/renderer/App.tsx');

describe('App startup lazy loading', () => {
  it('defers non-welcome panels behind lazy imports', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).not.toContain("import { ChatView } from './components/ChatView';");
    expect(source).not.toContain("import { ContextPanel } from './components/ContextPanel';");
    expect(source).not.toContain("import { ConfigModal } from './components/ConfigModal';");
    expect(source).not.toContain("import { SettingsPanel } from './components/SettingsPanel';");

    expect(source).toContain("const ChatView = lazy(() => import('./components/ChatView').then");
    expect(source).toContain("const ContextPanel = lazy(() => import('./components/ContextPanel').then");
    expect(source).toContain("const ConfigModal = lazy(() => import('./components/ConfigModal').then");
    expect(source).toContain("const SettingsPanel = lazy(() => import('./components/SettingsPanel').then");
  });

  it('uses suspense boundaries for deferred panels', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('<Suspense fallback=');
  });
});
