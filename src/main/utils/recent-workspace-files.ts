import fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import path from 'node:path';

export interface RecentWorkspaceFile {
  path: string;
  modifiedAt: number;
  size: number;
}

const EXCLUDED_DIRS = new Set([
  '.git',
  'node_modules',
  '.cowork-user-data',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.turbo',
]);

const EXCLUDED_FILES = new Set([
  '.DS_Store',
  'Thumbs.db',
  'desktop.ini',
  '.localized',
]);

const EXCLUDED_FILE_PATTERNS = [
  /^\._/, // macOS resource fork sidecar files
  /^~\$/, // Office lock/temp files
  /^\.~lock\..*#$/, // LibreOffice lock files
  /~$/, // editor backup files like report.md~
  /\.(?:tmp|temp|swp|swo|swn|bak|orig|rej|crdownload|part)$/i,
];

export async function listRecentWorkspaceFiles(
  rootDir: string,
  sinceMs: number,
  limit: number = 50
): Promise<RecentWorkspaceFile[]> {
  const results: RecentWorkspaceFile[] = [];
  const queue = [path.resolve(rootDir)];

  while (queue.length > 0) {
    const currentDir = queue.shift();
    if (!currentDir) {
      continue;
    }

    let entries: Dirent[] = [];
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRS.has(entry.name)) {
          queue.push(fullPath);
        }
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (shouldIgnoreFile(entry.name)) {
        continue;
      }

      try {
        const stat = await fs.stat(fullPath);
        const touchedAt = Math.max(stat.mtimeMs, stat.birthtimeMs || 0);
        if (touchedAt < sinceMs) {
          continue;
        }

        results.push({
          path: fullPath,
          modifiedAt: touchedAt,
          size: stat.size,
        });
      } catch {
        // 忽略扫描过程中的瞬时文件错误
      }
    }
  }

  return results
    .sort((a, b) => b.modifiedAt - a.modifiedAt)
    .slice(0, limit);
}

function shouldIgnoreFile(fileName: string): boolean {
  if (EXCLUDED_FILES.has(fileName)) {
    return true;
  }

  return EXCLUDED_FILE_PATTERNS.some((pattern) => pattern.test(fileName));
}
