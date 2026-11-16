import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { writeReleaseChecksums } = require('../scripts/write-release-checksums.js') as {
  writeReleaseChecksums: (
    directory: string,
    target: string,
    env?: NodeJS.ProcessEnv
  ) => Promise<Array<{ filename: string; sha256: string; size: number }>>;
};
const directories: string[] = [];
function tempDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-checksums-'));
  directories.push(directory);
  return directory;
}
afterEach(() => {
  for (const directory of directories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

describe('release artifact checksums', () => {
  it.each(['Open Cowork.exe', 'Open Cowork.dmg', 'Open Cowork.zip'])(
    'hashes the exact bytes of %s in standard checksum-file format',
    async (filename) => {
      const directory = tempDirectory();
      const content = Buffer.from([0, 255, 1, 2, 3, 13, 10]);
      fs.writeFileSync(path.join(directory, filename), content);
      const sha256 = createHash('sha256').update(content).digest('hex');
      const checksums = await writeReleaseChecksums(directory, 'win-x64', {});
      expect(checksums).toEqual([{ filename, sha256, size: content.length }]);
      expect(fs.readFileSync(path.join(directory, `${filename}.sha256`), 'utf8')).toBe(
        `${sha256}  ${filename}\n`
      );
    }
  );

  it('records the source commit and run in distinct architecture provenance files', async () => {
    const directory = tempDirectory();
    fs.writeFileSync(path.join(directory, 'installer.dmg'), 'installer');
    fs.mkdirSync(path.join(directory, 'unpacked.exe'));
    fs.writeFileSync(path.join(directory, 'ignored.blockmap'), 'metadata');
    const env = {
      GITHUB_SHA: 'abc123',
      GITHUB_REPOSITORY: 'OpenCoworkAI/open-cowork',
      GITHUB_REF: 'refs/tags/v3.3.1',
      GITHUB_SERVER_URL: 'https://github.com',
      GITHUB_RUN_ID: '123',
      GITHUB_WORKFLOW_REF:
        'OpenCoworkAI/open-cowork/.github/workflows/release.yml@refs/tags/v3.3.1',
    };
    await writeReleaseChecksums(directory, 'mac-arm64', env);
    await writeReleaseChecksums(directory, 'mac-x64', env);
    for (const target of ['mac-arm64', 'mac-x64']) {
      const provenance = JSON.parse(
        fs.readFileSync(path.join(directory, `build-provenance-${target}.json`), 'utf8')
      );
      expect(provenance).toMatchObject({
        target,
        commit: 'abc123',
        ref: env.GITHUB_REF,
        runUrl: 'https://github.com/OpenCoworkAI/open-cowork/actions/runs/123',
      });
      expect(provenance.artifacts).toHaveLength(1);
    }
  });

  it('fails a release job instead of uploading checksums with no installers', async () => {
    await expect(writeReleaseChecksums(tempDirectory(), 'win-x64', {})).rejects.toThrow(
      'No release installers'
    );
  });
});
