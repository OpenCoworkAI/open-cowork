import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const nativeExecutorPath = path.resolve(process.cwd(), 'src/main/sandbox/native-executor.ts');
const wslAgentPath = path.resolve(process.cwd(), 'src/main/sandbox/wsl-agent/index.ts');
const limaAgentPath = path.resolve(process.cwd(), 'src/main/sandbox/lima-agent/index.ts');

describe('Sandbox executor containment wiring', () => {
  it('uses containment helpers instead of raw workspace prefix matching', () => {
    const nativeSource = fs.readFileSync(nativeExecutorPath, 'utf8');
    const wslSource = fs.readFileSync(wslAgentPath, 'utf8');
    const limaSource = fs.readFileSync(limaAgentPath, 'utf8');

    expect(nativeSource).toContain("import { isPathWithinRoot } from '../tools/path-containment';");
    expect(nativeSource).toContain('isPathWithinRoot(targetCheck, workspaceCheck, isWindows)');
    expect(nativeSource).toContain('isPathWithinRoot(realCheck, workspaceCheck, isWindows)');

    expect(wslSource).toContain("import { isPathWithinRoot } from './path-containment';");
    expect(wslSource).toContain('isPathWithinRoot(resolved, this.workspacePath)');

    expect(limaSource).toContain("import { isPathWithinRoot } from './path-containment';");
    expect(limaSource).toContain('isPathWithinRoot(resolved, this.workspacePath)');
  });
});
