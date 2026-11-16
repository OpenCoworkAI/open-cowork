import fs from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

// Execute the real startup function with simulated packaged macOS resources,
// independently of this test host's OS and installed Homebrew directories.
function packagedMac(shellOutput: string | Error) {
  const source = fs.readFileSync(path.resolve('src/main/agent/agent-runner.ts'), 'utf8');
  const start = source.indexOf('let pathEnriched = false;');
  const end = source.indexOf('// Shared pi-ai auth storage', start);
  const script = ts.transpileModule(
    source.slice(start, end) + '\nmodule.exports = enrichProcessPathForBuild;',
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }
  ).outputText;
  const fakeProcess = { platform: 'darwin', env: { PATH: '/usr/bin:/bin' } };
  const execFileSync = vi.fn(() => {
    if (shellOutput instanceof Error) throw shellOutput;
    return shellOutput;
  });
  const module = { exports: {} };
  runInNewContext(script, {
    module,
    exports: {},
    process: fakeProcess,
    app: { isPackaged: true },
    fs: { existsSync: (entry: string) => ['/opt/homebrew/bin', '/usr/local/bin'].includes(entry) },
    getDefaultShell: () => '/bin/zsh',
    execFileSync,
    os: { homedir: () => '/Users/test' },
    getBundledNodePaths: () => ({ node: '/App/Resources/node/bin/node' }),
    resolveBundledPythonBinDir: () => null,
    resolveBundledToolsBinDir: () => null,
    path: path.posix,
    log: vi.fn(),
    logWarn: vi.fn(),
  });
  return { enrich: module.exports as () => Promise<void>, fakeProcess, execFileSync };
}

describe('packaged macOS startup PATH', () => {
  it('makes bundled, login-shell and Homebrew executables discoverable without duplicates', async () => {
    const host = packagedMac('/custom/bin:/usr/bin:/opt/homebrew/bin');
    await host.enrich();
    expect(host.fakeProcess.env.PATH).toBe(
      '/App/Resources/node/bin:/custom/bin:/usr/bin:/opt/homebrew/bin:/usr/local/bin:/bin'
    );
    await host.enrich();
    expect(host.execFileSync).toHaveBeenCalledTimes(1);
  });

  it('retains Homebrew locations when a login-shell startup script fails', async () => {
    const host = packagedMac(new Error('shell startup timed out'));
    await host.enrich();
    expect(host.fakeProcess.env.PATH.split(':')).toEqual([
      '/App/Resources/node/bin',
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/usr/bin',
      '/bin',
    ]);
  });
});
