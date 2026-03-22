/**
 * Build MCP server TypeScript files into self-contained CommonJS bundles.
 *
 * Uses esbuild to bundle all dependencies into a single file per server so the
 * packaged app can run MCP servers from Resources/mcp/ without shipping a
 * node_modules directory next to them.
 *
 * On Windows, freshly generated bundle files can remain transiently locked for
 * a short time. To make packaging more reliable, this script also stages the
 * built files into a separate directory that electron-builder can copy from.
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');
const SRC_MCP_DIR = path.join(PROJECT_ROOT, 'src', 'main', 'mcp');
const DIST_MCP_DIR = path.join(PROJECT_ROOT, 'dist-mcp');
const STAGED_MCP_DIR = path.join(PROJECT_ROOT, '.bundle-resources', 'mcp');
const FILE_OP_RETRY_COUNT = 8;
const FILE_OP_RETRY_DELAY_MS = 250;

const servers = [
  {
    name: 'gui-operate-server',
    entry: 'gui-operate-server.ts',
    description: 'GUI Automation MCP Server',
  },
  {
    name: 'software-dev-server-example',
    entry: 'software-dev-server-example.ts',
    description: 'Software Development MCP Server',
  },
];

const NODE_EXTERNALS = [
  'child_process',
  'crypto',
  'dns',
  'events',
  'fs',
  'fs/promises',
  'http',
  'https',
  'net',
  'os',
  'path',
  'stream',
  'tls',
  'url',
  'util',
  'worker_threads',
  'zlib',
  'node:child_process',
  'node:crypto',
  'node:dns',
  'node:events',
  'node:fs',
  'node:fs/promises',
  'node:http',
  'node:https',
  'node:net',
  'node:os',
  'node:path',
  'node:stream',
  'node:tls',
  'node:url',
  'node:util',
  'node:worker_threads',
  'node:zlib',
  'node:diagnostics_channel',
];

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function removePathIfExists(targetPath) {
  if (fs.existsSync(targetPath)) {
    fs.rmSync(targetPath, { recursive: true, force: true });
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableFileOpError(error) {
  return Boolean(
    error &&
      (error.code === 'EBUSY' || error.code === 'EPERM' || error.code === 'ENOTEMPTY')
  );
}

async function removePathWithRetries(targetPath) {
  let lastError = null;

  for (let attempt = 1; attempt <= FILE_OP_RETRY_COUNT; attempt += 1) {
    try {
      if (!fs.existsSync(targetPath)) {
        return;
      }

      fs.rmSync(targetPath, { recursive: true, force: true });
      if (!fs.existsSync(targetPath)) {
        return;
      }

      const error = new Error(`Path still exists after removal: ${targetPath}`);
      error.code = 'ENOTEMPTY';
      throw error;
    } catch (error) {
      lastError = error;
      if (!isRetryableFileOpError(error) || attempt === FILE_OP_RETRY_COUNT) {
        throw error;
      }

      console.warn(
        `[bundle:mcp] Remove retry ${attempt}/${FILE_OP_RETRY_COUNT} for ${path.basename(targetPath)}: ${error.code}`
      );
      await sleep(FILE_OP_RETRY_DELAY_MS);
    }
  }

  if (lastError) {
    throw lastError;
  }
}

async function copyFileWithRetries(sourcePath, destinationPath) {
  let lastError = null;

  for (let attempt = 1; attempt <= FILE_OP_RETRY_COUNT; attempt += 1) {
    try {
      fs.copyFileSync(sourcePath, destinationPath);
      return;
    } catch (error) {
      lastError = error;
      if (!isRetryableFileOpError(error) || attempt === FILE_OP_RETRY_COUNT) {
        throw error;
      }

      console.warn(
        `[bundle:mcp] Copy retry ${attempt}/${FILE_OP_RETRY_COUNT} for ${path.basename(sourcePath)}: ${error.code}`
      );
      await sleep(FILE_OP_RETRY_DELAY_MS);
    }
  }

  if (lastError) {
    throw lastError;
  }
}

async function copyDirectoryContentsWithRetries(sourceDir, destinationDir) {
  fs.mkdirSync(destinationDir, { recursive: true });

  const sourceEntries = fs.readdirSync(sourceDir, { withFileTypes: true });
  const sourceEntryNames = new Set(sourceEntries.map((entry) => entry.name));
  const destinationEntries = fs.readdirSync(destinationDir, { withFileTypes: true });

  for (const entry of destinationEntries) {
    if (!sourceEntryNames.has(entry.name)) {
      await removePathWithRetries(path.join(destinationDir, entry.name));
    }
  }

  for (const entry of sourceEntries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const destinationPath = path.join(destinationDir, entry.name);

    if (entry.isDirectory()) {
      await copyDirectoryContentsWithRetries(sourcePath, destinationPath);
      continue;
    }

    await copyFileWithRetries(sourcePath, destinationPath);
  }
}

async function replaceDirectoryWithRetries(sourceDir, destinationDir) {
  let lastError = null;

  for (let attempt = 1; attempt <= FILE_OP_RETRY_COUNT; attempt += 1) {
    try {
      await removePathWithRetries(destinationDir);
      fs.renameSync(sourceDir, destinationDir);
      return;
    } catch (error) {
      if (!fs.existsSync(sourceDir) && fs.existsSync(destinationDir)) {
        return;
      }

      lastError = error;
      if (!isRetryableFileOpError(error)) {
        throw error;
      }
      if (attempt === FILE_OP_RETRY_COUNT) {
        break;
      }

      console.warn(
        `[bundle:mcp] Directory swap retry ${attempt}/${FILE_OP_RETRY_COUNT} for ${path.basename(destinationDir)}: ${error.code}`
      );
      await sleep(FILE_OP_RETRY_DELAY_MS);
    }
  }

  if (lastError) {
    console.warn(
      `[bundle:mcp] Falling back to copy-based directory swap for ${path.basename(destinationDir)}`
    );
    await copyDirectoryContentsWithRetries(sourceDir, destinationDir);
    removePathIfExists(sourceDir);
  }
}

async function bundleWithEsbuild() {
  const esbuild = require('esbuild');

  for (const server of servers) {
    const entryPoint = path.join(SRC_MCP_DIR, server.entry);
    const outfile = path.join(DIST_MCP_DIR, `${server.name}.js`);

    await esbuild.build({
      entryPoints: [entryPoint],
      outfile,
      bundle: true,
      platform: 'node',
      target: 'node20',
      format: 'cjs',
      external: NODE_EXTERNALS,
      sourcemap: false,
      minify: false,
      logLevel: 'warning',
    });

    const stats = fs.statSync(outfile);
    const sizeKB = (stats.size / 1024).toFixed(2);
    console.log(`Built ${server.description}`);
    console.log(`   Entry: ${server.entry}`);
    console.log(`   Output: dist-mcp/${server.name}.js (${sizeKB} KB, bundled)`);
  }
}

function transpileFallback() {
  const ts = require('typescript');

  console.log('esbuild unavailable, falling back to TypeScript transpile-only');
  console.log('Dependencies will NOT be bundled. MCP servers may fail in packaged builds.\n');

  const sourceFiles = fs.readdirSync(SRC_MCP_DIR).filter((file) => file.endsWith('.ts'));

  for (const file of sourceFiles) {
    const inputPath = path.join(SRC_MCP_DIR, file);
    const outputPath = path.join(DIST_MCP_DIR, file.replace(/\.ts$/, '.js'));
    const sourceText = fs.readFileSync(inputPath, 'utf8');
    const result = ts.transpileModule(sourceText, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        esModuleInterop: true,
        resolveJsonModule: true,
        allowSyntheticDefaultImports: true,
      },
      fileName: inputPath,
      reportDiagnostics: true,
    });

    if (result.diagnostics?.length) {
      const errors = result.diagnostics.filter(
        (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error
      );
      if (errors.length > 0) {
        throw new Error(
          `${file}\n${errors
            .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
            .join('\n')}`
        );
      }
    }

    fs.writeFileSync(outputPath, result.outputText);
  }

  for (const server of servers) {
    const outfile = path.join(DIST_MCP_DIR, `${server.name}.js`);
    const stats = fs.statSync(outfile);
    const sizeKB = (stats.size / 1024).toFixed(2);
    console.log(`Built ${server.description}`);
    console.log(`   Entry: ${server.entry}`);
    console.log(`   Output: dist-mcp/${server.name}.js (${sizeKB} KB, transpile-only)`);
  }
}

async function stageBundledServers(
  sourceDir = DIST_MCP_DIR,
  stagedDir = STAGED_MCP_DIR,
  serverList = servers
) {
  const stageRoot = path.dirname(stagedDir);
  const tempDir = path.join(stageRoot, `mcp.tmp-${process.pid}-${Date.now()}`);

  ensureDir(stageRoot);
  removePathIfExists(tempDir);
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    for (const server of serverList) {
      const filename = `${server.name}.js`;
      await copyFileWithRetries(path.join(sourceDir, filename), path.join(tempDir, filename));
    }

    await replaceDirectoryWithRetries(tempDir, stagedDir);
    console.log(`[bundle:mcp] Staged bundled MCP servers at ${path.relative(PROJECT_ROOT, stagedDir)}`);
  } catch (error) {
    removePathIfExists(tempDir);
    throw error;
  }
}

async function bundleMCPServers() {
  console.log('Building MCP Servers...\n');
  ensureDir(DIST_MCP_DIR);

  try {
    require.resolve('esbuild');
    await bundleWithEsbuild();
  } catch {
    transpileFallback();
  }

  await stageBundledServers();

  console.log('\nAll MCP servers built successfully!\n');
}

module.exports = {
  bundleMCPServers,
  stageBundledServers,
};

if (require.main === module) {
  bundleMCPServers().catch((error) => {
    console.error('Bundle failed:', error?.stack || error);
    process.exit(1);
  });
}
