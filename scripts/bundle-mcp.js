/**
 * Build MCP server TypeScript files into runnable CommonJS output.
 *
 * We intentionally use the TypeScript compiler API instead of esbuild here.
 * In locked-down Windows environments, spawning esbuild's helper process can
 * fail even when the executable exists, which blocks packaging.
 */

const path = require('path');
const fs = require('fs');
const ts = require('typescript');

const PROJECT_ROOT = path.join(__dirname, '..');
const SRC_MCP_DIR = path.join(PROJECT_ROOT, 'src', 'main', 'mcp');
const DIST_MCP_DIR = path.join(PROJECT_ROOT, 'dist-mcp');

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

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function formatDiagnostic(diagnostic) {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
}

function transpileMCPFiles() {
  const sourceFiles = fs.readdirSync(SRC_MCP_DIR)
    .filter((file) => file.endsWith('.ts'));

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
      const errors = result.diagnostics.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
      if (errors.length > 0) {
        throw new Error(`${file}\n${errors.map(formatDiagnostic).join('\n')}`);
      }
    }

    fs.writeFileSync(outputPath, result.outputText);
  }
}

async function bundleMCPServers() {
  console.log('🔨 Building MCP Servers with TypeScript...\n');

  ensureDir(DIST_MCP_DIR);
  transpileMCPFiles();

  for (const server of servers) {
    const outfile = path.join(DIST_MCP_DIR, `${server.name}.js`);
    console.log(`📦 Built ${server.description}`);
    console.log(`   Entry: ${server.entry}`);
    console.log(`   Output: dist-mcp/${server.name}.js`);

    const stats = fs.statSync(outfile);
    const sizeKB = (stats.size / 1024).toFixed(2);
    console.log(`   ✅ Success! Size: ${sizeKB} KB`);
    console.log('');
  }

  console.log('✅ All MCP servers built successfully!\n');
}

bundleMCPServers().catch((error) => {
  console.error('❌ Bundle failed:', error?.stack || error);
  process.exit(1);
});
