import { afterEach, describe, expect, it, vi } from 'vitest';

async function importCommonWithExecFileSync(execFileSync: ReturnType<typeof vi.fn>) {
  vi.resetModules();
  vi.doMock('node:child_process', () => ({ execFileSync }));
  return import('../.github/scripts/deepseek-common.mjs');
}

function missingCommandError(command: string): NodeJS.ErrnoException {
  const error = new Error(`spawnSync ${command} ENOENT`) as NodeJS.ErrnoException;
  error.code = 'ENOENT';
  return error;
}

describe('deepseek-common runRg', () => {
  afterEach(() => {
    vi.doUnmock('node:child_process');
    vi.resetModules();
  });

  it('falls back to git grep when ripgrep is not installed', async () => {
    const execFileSync = vi.fn((command: string, args: string[]) => {
      if (command === 'rg') {
        throw missingCommandError('rg');
      }
      if (command === 'git') {
        expect(args).toEqual([
          'grep',
          '-n',
          '-F',
          '--max-count',
          '2',
          '-e',
          'Roadmap',
          '--',
          ':!node_modules/**',
          '.',
        ]);
        return 'ROADMAP.md:1:# Open Cowork Roadmap\n';
      }
      throw new Error(`unexpected command: ${command}`);
    });

    const { runRg } = await importCommonWithExecFileSync(execFileSync);

    expect(
      runRg(['-n', '-F', '--max-count', '2', '-e', 'Roadmap', '--glob', '!node_modules/**', '.'])
    ).toBe('ROADMAP.md:1:# Open Cowork Roadmap');
  });

  it('returns no snippets when ripgrep and git grep are both unavailable', async () => {
    const execFileSync = vi.fn((command: string) => {
      throw missingCommandError(command);
    });

    const { runRg } = await importCommonWithExecFileSync(execFileSync);

    expect(runRg(['-n', '-F', '-e', 'Roadmap', '.'])).toBe('');
  });
});
