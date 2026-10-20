import { readFileSync, writeFileSync } from 'fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import { dirname, resolve } from 'path';
import { builtinModules } from 'module';

// Run before the main bundle evaluates. Rollup captures worker_threads.Worker while
// evaluating imports, which is too late to patch from application code. The helper
// is a sibling file so this require does not replace the main module's exports.
const imageResizePackagingSourcePath = resolve(
  __dirname,
  'src/main/agent/image-resize-packaging.cjs'
);
const imageResizeWorkerBanner =
  "require('./image-resize-packaging.cjs').installPackagedImageWorkerResolver();\n";

function copyImageResizePackagingPlugin() {
  return {
    name: 'copy-image-resize-packaging',
    writeBundle(options: { dir?: string; file?: string }) {
      const outDir = options.dir || (options.file ? dirname(options.file) : '');
      if (!outDir) return;
      writeFileSync(
        resolve(outDir, 'image-resize-packaging.cjs'),
        readFileSync(imageResizePackagingSourcePath)
      );
    },
  };
}

// Node built-in modules must be external for Electron main process
const nodeBuiltins = builtinModules.flatMap((m) => [m, `node:${m}`]);
// Keep the SDK's module boundary: bundling it makes Rollup's CJS namespace
// helper crash on inherited enumerable exports from the external `ws` package.
const googleGenAiExternals = ['@google/genai', /^@google\/genai\//];
const mcpExternals = [/^@modelcontextprotocol\/(?:client|core|server)(?:\/.*)?$/];
const ignoredWatchPaths = [
  '**/release/**',
  '**/dist/**',
  '**/dist-electron/**',
  '**/dist-wsl-agent/**',
  '**/dist-lima-agent/**',
  '**/dist-mcp/**',
];

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'src/main/index.ts',
        onstart(args) {
          args.startup();
        },
        vite: {
          plugins: [copyImageResizePackagingPlugin()],
          build: {
            outDir: 'dist-electron/main',
            rollupOptions: {
              external: [
                ...nodeBuiltins,
                ...googleGenAiExternals,
                'better-sqlite3',
                'bufferutil',
                'utf-8-validate',
                'electron',
                // Externalize large CJS-compatible main-process dependencies
                // NOTE: ESM-only packages (@mariozechner/pi-coding-agent, pi-ai, electron-store, uuid)
                // must stay bundled — CJS require() can't load them
                '@anthropic-ai/sdk',
                '@larksuiteoapi/node-sdk',
                'openai',
                ...mcpExternals,
                'electron-updater',
                'chokidar',
                'archiver',
                'ngrok',
                'ws',
                'glob',
                'dotenv',
                '@slack/bolt',
                '@slack/web-api',
              ],
              output: {
                // Ensure consistent interop for CJS/ESM
                interop: 'auto',
                banner: imageResizeWorkerBanner,
              },
            },
          },
        },
      },
      {
        entry: 'src/preload/index.ts',
        onstart(args) {
          args.reload();
        },
        vite: {
          build: {
            outDir: 'dist-electron/preload',
            rollupOptions: {
              external: ['electron'],
            },
          },
        },
      },
    ]),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@main': resolve(__dirname, 'src/main'),
      '@renderer': resolve(__dirname, 'src/renderer'),
    },
  },
  server: {
    watch: {
      ignored: ignoredWatchPaths,
    },
  },
  build: {
    sourcemap: process.env.NODE_ENV !== 'production',
    outDir: 'dist',
    emptyOutDir: true,
  },
});
