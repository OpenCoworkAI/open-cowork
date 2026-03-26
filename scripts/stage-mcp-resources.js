#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_SOURCE_DIR = 'dist-mcp';
const DEFAULT_STAGE_DIR = 'dist-mcp-stage';
const RETRYABLE_ERROR_CODES = new Set(['EBUSY', 'EPERM', 'ENOTEMPTY', 'EMFILE']);

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isDirectory(targetPath) {
  try {
    return fs.statSync(targetPath).isDirectory();
  } catch {
    return false;
  }
}

function collectRelativeFiles(rootDir) {
  const results = [];
  const stack = [''];

  while (stack.length > 0) {
    const relativePath = stack.pop();
    const absolutePath = path.join(rootDir, relativePath);
    const entries = fs.readdirSync(absolutePath, { withFileTypes: true });

    for (const entry of entries) {
      const childRelativePath = relativePath ? path.join(relativePath, entry.name) : entry.name;
      if (entry.isDirectory()) {
        stack.push(childRelativePath);
        continue;
      }
      results.push(childRelativePath);
    }
  }

  results.sort();
  return results;
}

async function stageMcpResources({
  projectRoot = process.cwd(),
  sourceDirName = DEFAULT_SOURCE_DIR,
  stageDirName = DEFAULT_STAGE_DIR,
  maxAttempts = 6,
  retryDelayMs = 200,
} = {}) {
  const sourceDir = path.resolve(projectRoot, sourceDirName);
  const stageDir = path.resolve(projectRoot, stageDirName);

  if (!isDirectory(sourceDir)) {
    throw new Error(
      `[before-build] MCP source directory is missing: ${sourceDir}. Run "npm run build:mcp" before packaging.`
    );
  }

  let attempt = 0;
  for (; attempt < maxAttempts; attempt += 1) {
    try {
      fs.rmSync(stageDir, { recursive: true, force: true });
      fs.cpSync(sourceDir, stageDir, { recursive: true });
      break;
    } catch (error) {
      const retryable = error && RETRYABLE_ERROR_CODES.has(error.code);
      if (!retryable || attempt === maxAttempts - 1) {
        throw error;
      }

      const delay = retryDelayMs * Math.pow(2, attempt);
      console.warn(
        `[before-build] Failed to stage MCP resources (${error.code}) attempt ${attempt + 1}/${maxAttempts}. Retrying in ${delay}ms...`
      );
      await sleep(delay);
    }
  }

  const files = collectRelativeFiles(stageDir);
  if (files.length === 0) {
    throw new Error(`[before-build] MCP staging directory is empty after copy: ${stageDir}`);
  }

  console.log(
    `[before-build] Staged MCP resources: ${sourceDirName} -> ${stageDirName} (${files.length} files)`
  );

  return {
    sourceDir,
    stageDir,
    files,
    attempts: attempt + 1,
  };
}

async function beforeBuild(context) {
  const projectRoot = context?.projectDir || process.cwd();
  await stageMcpResources({ projectRoot });
  return true;
}

if (require.main === module) {
  beforeBuild()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('[before-build] Failed to stage MCP resources:', error?.message || error);
      process.exit(1);
    });
}

module.exports = beforeBuild;
module.exports.stageMcpResources = stageMcpResources;
