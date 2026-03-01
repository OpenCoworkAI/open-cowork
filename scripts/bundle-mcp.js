/**
 * Bundle MCP Servers using esbuild
 * 
 * This script bundles MCP server TypeScript files into standalone JavaScript files
 * with all dependencies included, so they can run without accessing node_modules.
 */

const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const PROJECT_ROOT = path.join(__dirname, '..');
const SRC_MCP_DIR = path.join(PROJECT_ROOT, 'src', 'main', 'mcp');
const DIST_MCP_DIR = path.join(PROJECT_ROOT, 'dist-mcp');

// MCP servers to bundle
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

async function bundleMCPServers() {
  console.log('🔨 Bundling MCP Servers with esbuild...\n');
  
  // Ensure output directory exists
  if (!fs.existsSync(DIST_MCP_DIR)) {
    fs.mkdirSync(DIST_MCP_DIR, { recursive: true });
  }
  
  for (const server of servers) {
    const entryPoint = path.join(SRC_MCP_DIR, server.entry);
    const outfile = path.join(DIST_MCP_DIR, `${server.name}.js`);
    
    console.log(`📦 Bundling ${server.description}...`);
    console.log(`   Entry: ${server.entry}`);
    console.log(`   Output: dist-mcp/${server.name}.js`);
    
    try {
      const result = await esbuild.build({
        entryPoints: [entryPoint],
        bundle: true,
        platform: 'node',
        target: 'node20',
        format: 'cjs',
        outfile: outfile,
        external: [
          // Don't bundle native modules - they must be in node_modules
          'better-sqlite3',
          '@img/sharp-darwin-arm64',
          '@img/sharp-darwin-x64',
          '@img/sharp-win32-x64',
          '@img/sharp-linux-x64',
        ],
        sourcemap: false,
        minify: false, // Keep readable for debugging
        logLevel: 'info',
        metafile: true,
      });
      
      // Get file size
      const stats = fs.statSync(outfile);
      const sizeKB = (stats.size / 1024).toFixed(2);
      
      console.log(`   ✅ Success! Size: ${sizeKB} KB`);
      
      // Show top dependencies (for information)
      if (result.metafile) {
        const inputs = Object.keys(result.metafile.inputs)
          .filter(p => p.includes('node_modules'))
          .map(p => {
            const match = p.match(/node_modules\/(@?[^\/]+(?:\/[^\/]+)?)/);
            return match ? match[1] : null;
          })
          .filter(Boolean);
        
        const uniqueDeps = [...new Set(inputs)];
        if (uniqueDeps.length > 0) {
          console.log(`   📚 Bundled ${uniqueDeps.length} unique packages`);
        }
      }
      
      console.log('');
      
    } catch (error) {
      console.error(`   ❌ Failed to bundle ${server.name}:`, error.message);
      process.exit(1);
    }
  }
  
  console.log('✅ All MCP servers bundled successfully!\n');
}

bundleMCPServers().catch((error) => {
  console.error('❌ Bundle failed:', error);
  process.exit(1);
});
