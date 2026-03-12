import { describe, expect, it } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';

const sidebarPath = path.resolve(process.cwd(), 'src/renderer/components/Sidebar.tsx');

describe('Sidebar Claude redesign', () => {
  it('groups sessions by recency buckets', () => {
    const source = fs.readFileSync(sidebarPath, 'utf8');
    expect(source).toContain('function groupSessionsByDate');
    expect(source).toContain("t('sidebar.today')");
    expect(source).toContain("t('sidebar.yesterday')");
    expect(source).toContain("t('sidebar.previousWeek')");
    expect(source).toContain("t('sidebar.older')");
  });

  it('uses a simpler new chat action with Plus icon', () => {
    const source = fs.readFileSync(sidebarPath, 'utf8');
    expect(source).toContain('<Plus className=');
    expect(source).toContain("t('sidebar.newTask')");
  });

  it('renders a lightweight footer with settings and theme controls', () => {
    const source = fs.readFileSync(sidebarPath, 'utf8');
    expect(source).toContain("t('sidebar.settings')");
    expect(source).toContain("t('sidebar.themeToggle')");
  });

  it('uses the bundled app logo instead of a temporary text mark', () => {
    const source = fs.readFileSync(sidebarPath, 'utf8');
    expect(source).toContain("new URL('../../../resources/logo.png', import.meta.url).href");
    expect(source).toContain('alt="Open Cowork logo"');
  });

  it('keeps the collapsed sidebar minimal instead of rendering the full session list', () => {
    const source = fs.readFileSync(sidebarPath, 'utf8');
    expect(source).toContain("t('sidebar.expandToView')");
    expect(source).not.toContain("sessions.map((session) => {\n            const label = session.title.trim().charAt(0).toUpperCase() || '•';");
  });
});
