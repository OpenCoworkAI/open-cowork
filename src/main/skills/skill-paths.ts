import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { isPathWithinRoot } from '../tools/path-containment';

function physicalDirExists(dirPath: string): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const originalFs = require('original-fs') as typeof import('fs');
    return originalFs.existsSync(dirPath) && originalFs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function shouldUseCaseInsensitiveContainment(rootPath: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(rootPath) || rootPath.startsWith('\\\\');
}

export function resolveBuiltinSkillsPath(): string {
  const appPath = app.getAppPath();
  const unpackedPath = appPath.replace(/\.asar$/, '.asar.unpacked');

  const possiblePaths = [
    path.join(__dirname, '..', '..', '..', '.claude', 'skills'),
    path.join(process.resourcesPath || '', 'skills'),
    ...(physicalDirExists(path.join(unpackedPath, '.claude', 'skills'))
      ? [path.join(unpackedPath, '.claude', 'skills')]
      : []),
    path.join(appPath, '.claude', 'skills'),
  ];

  for (const candidate of possiblePaths) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return '';
}

export function resolveProjectSkillDirs(projectRoot?: string): string[] {
  if (!projectRoot) {
    return [];
  }

  const resolvedProjectRoot = path.resolve(projectRoot);
  const candidate = path.join(resolvedProjectRoot, '.skills');

  try {
    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory()) {
      return [];
    }

    const realCandidate = fs.realpathSync(candidate);
    if (
      !isPathWithinRoot(
        realCandidate,
        resolvedProjectRoot,
        shouldUseCaseInsensitiveContainment(resolvedProjectRoot)
      )
    ) {
      return [];
    }

    return [path.resolve(candidate)];
  } catch {
    return [];
  }
}
