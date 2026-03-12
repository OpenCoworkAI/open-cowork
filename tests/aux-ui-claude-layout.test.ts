import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const apiConfigSetManagerPath = path.resolve(process.cwd(), 'src/renderer/components/ApiConfigSetManager.tsx');
const globalNoticeToastPath = path.resolve(process.cwd(), 'src/renderer/components/GlobalNoticeToast.tsx');
const sandboxSetupDialogPath = path.resolve(process.cwd(), 'src/renderer/components/SandboxSetupDialog.tsx');
const sandboxSyncToastPath = path.resolve(process.cwd(), 'src/renderer/components/SandboxSyncToast.tsx');

describe('auxiliary ui claude-style layout', () => {
  it('uses softer shells for the config set manager', () => {
    const source = fs.readFileSync(apiConfigSetManagerPath, 'utf8');
    expect(source).toContain('rounded-[1.6rem]');
  });

  it('uses a calmer toast shell for global notices', () => {
    const source = fs.readFileSync(globalNoticeToastPath, 'utf8');
    expect(source).toContain('rounded-[1.4rem]');
    expect(source).toContain('bg-background/92');
  });

  it('uses a quieter setup dialog shell', () => {
    const source = fs.readFileSync(sandboxSetupDialogPath, 'utf8');
    expect(source).toContain('rounded-[2rem]');
    expect(source).toContain('bg-background');
  });

  it('uses a quieter sync toast shell', () => {
    const source = fs.readFileSync(sandboxSyncToastPath, 'utf8');
    expect(source).toContain('rounded-[1.6rem]');
    expect(source).toContain('bg-background/92');
  });
});
