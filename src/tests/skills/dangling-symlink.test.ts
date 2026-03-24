import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// We test the isDanglingSymlink helper by importing the module indirectly.
// Since it's a module-level function, we recreate its logic here for unit testing.
function isDanglingSymlink(filePath: string): boolean {
  try {
    const lstat = fs.lstatSync(filePath);
    if (!lstat.isSymbolicLink()) return false;
    try {
      fs.statSync(filePath);
      return false;
    } catch {
      return true;
    }
  } catch {
    return false;
  }
}

function supportsDirectorySymlinks(): boolean {
  const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-symlink-probe-'));
  const targetPath = path.join(probeDir, 'target');
  const linkPath = path.join(probeDir, 'link');

  try {
    fs.mkdirSync(targetPath);
    fs.symlinkSync(targetPath, linkPath, 'dir');
    return true;
  } catch {
    return false;
  } finally {
    fs.rmSync(probeDir, { recursive: true, force: true });
  }
}

const itIfDirectorySymlinkSupported = supportsDirectorySymlinks() ? it : it.skip;

describe('isDanglingSymlink', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns false for a regular file', () => {
    const filePath = path.join(tmpDir, 'file.txt');
    fs.writeFileSync(filePath, 'hello');
    expect(isDanglingSymlink(filePath)).toBe(false);
  });

  it('returns false for a regular directory', () => {
    const dirPath = path.join(tmpDir, 'dir');
    fs.mkdirSync(dirPath);
    expect(isDanglingSymlink(dirPath)).toBe(false);
  });

  itIfDirectorySymlinkSupported('returns false for a valid symlink', () => {
    const targetPath = path.join(tmpDir, 'target');
    fs.mkdirSync(targetPath);
    const linkPath = path.join(tmpDir, 'link');
    fs.symlinkSync(targetPath, linkPath, 'dir');
    expect(isDanglingSymlink(linkPath)).toBe(false);
  });

  itIfDirectorySymlinkSupported('returns true for a dangling symlink', () => {
    const linkPath = path.join(tmpDir, 'dangling');
    fs.symlinkSync(path.join(tmpDir, 'missing-target'), linkPath, 'dir');
    expect(isDanglingSymlink(linkPath)).toBe(true);
  });

  it('returns false for a non-existent path', () => {
    expect(isDanglingSymlink(path.join(tmpDir, 'nope'))).toBe(false);
  });

  itIfDirectorySymlinkSupported(
    'returns true when symlink target is removed after creation',
    () => {
      const targetPath = path.join(tmpDir, 'target-dir');
      fs.mkdirSync(targetPath);
      const linkPath = path.join(tmpDir, 'link-to-target');
      fs.symlinkSync(targetPath, linkPath, 'dir');

      // Symlink is valid before removal
      expect(isDanglingSymlink(linkPath)).toBe(false);

      // Remove the target
      fs.rmSync(targetPath, { recursive: true });

      // Now the symlink is dangling
      expect(isDanglingSymlink(linkPath)).toBe(true);
    }
  );
});

describe('dangling symlink cleanup in skill directories', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-skills-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  itIfDirectorySymlinkSupported('fs.existsSync returns false for dangling symlinks', () => {
    const linkPath = path.join(tmpDir, 'docx');
    fs.symlinkSync(path.join(tmpDir, 'missing-asar-path'), linkPath, 'dir');
    expect(fs.existsSync(linkPath)).toBe(false);
  });

  itIfDirectorySymlinkSupported('fs.mkdirSync fails on path with dangling symlink', () => {
    const linkPath = path.join(tmpDir, 'docx');
    fs.symlinkSync(path.join(tmpDir, 'missing-asar-path'), linkPath, 'dir');

    expect(() => {
      fs.mkdirSync(linkPath, { recursive: true });
    }).toThrow();
  });

  itIfDirectorySymlinkSupported('unlinkSync removes a dangling symlink', () => {
    const linkPath = path.join(tmpDir, 'docx');
    fs.symlinkSync(path.join(tmpDir, 'missing-asar-path'), linkPath, 'dir');

    // Confirm it's dangling
    expect(isDanglingSymlink(linkPath)).toBe(true);

    // Remove the dangling symlink
    fs.unlinkSync(linkPath);

    // Now the path is gone
    expect(isDanglingSymlink(linkPath)).toBe(false);
    expect(fs.existsSync(linkPath)).toBe(false);

    // And we can create a real directory there
    fs.mkdirSync(linkPath);
    expect(fs.statSync(linkPath).isDirectory()).toBe(true);
  });

  itIfDirectorySymlinkSupported('readdirSync lists dangling symlinks by name', () => {
    const linkPath = path.join(tmpDir, 'docx');
    fs.symlinkSync(path.join(tmpDir, 'missing-asar-path'), linkPath, 'dir');

    const entries = fs.readdirSync(tmpDir);
    expect(entries).toContain('docx');
  });

  itIfDirectorySymlinkSupported('statSync throws ENOENT on dangling symlinks', () => {
    const linkPath = path.join(tmpDir, 'docx');
    fs.symlinkSync(path.join(tmpDir, 'missing-asar-path'), linkPath, 'dir');

    expect(() => {
      fs.statSync(linkPath);
    }).toThrow(/ENOENT/);
  });
});
