import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const { stageBundledServers } = require('../scripts/bundle-mcp.js');

const tempRoots: string[] = [];

describe('bundle-mcp staging', () => {
  afterEach(() => {
    while (tempRoots.length > 0) {
      const tempRoot = tempRoots.pop();
      if (tempRoot) {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      }
    }
  });

  it('stages bundled MCP servers into a fresh directory', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-bundle-mcp-'));
    tempRoots.push(tempRoot);

    const sourceDir = path.join(tempRoot, 'dist-mcp');
    const stagedDir = path.join(tempRoot, '.bundle-resources', 'mcp');

    fs.mkdirSync(sourceDir, { recursive: true });

    fs.writeFileSync(path.join(sourceDir, 'gui-operate-server.js'), 'module.exports = "gui";\n');
    fs.writeFileSync(
      path.join(sourceDir, 'software-dev-server-example.js'),
      'module.exports = "dev";\n'
    );

    await stageBundledServers(sourceDir, stagedDir, [
      { name: 'gui-operate-server' },
      { name: 'software-dev-server-example' },
    ]);

    expect(fs.readFileSync(path.join(stagedDir, 'gui-operate-server.js'), 'utf8')).toContain(
      'gui'
    );
    expect(
      fs.readFileSync(path.join(stagedDir, 'software-dev-server-example.js'), 'utf8')
    ).toContain('dev');

    const tempEntries = fs
      .readdirSync(path.dirname(stagedDir))
      .filter((entry) => entry.includes('mcp.tmp-'));
    expect(tempEntries).toEqual([]);
  });

  it('points electron-builder extraResources at the staged MCP directory', () => {
    const builderConfig = fs.readFileSync(path.resolve(process.cwd(), 'electron-builder.yml'), 'utf8');

    expect(builderConfig).toContain('.bundle-resources/mcp');
    expect(builderConfig).not.toContain('- from: dist-mcp');
  });
});
