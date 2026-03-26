import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('stage-mcp-resources beforeBuild hook', () => {
  it('copies MCP bundles from dist-mcp into dist-mcp-stage', async () => {
    const projectRoot = fs.mkdtempSync(path.join(process.cwd(), '.tmp-stage-mcp-'));
    tempDirs.push(projectRoot);

    const sourceDir = path.join(projectRoot, 'dist-mcp');
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'gui-operate-server.js'), 'module.exports = {};');
    fs.writeFileSync(
      path.join(sourceDir, 'software-dev-server-example.js'),
      'module.exports = {};'
    );

    const beforeBuild = await import('../scripts/stage-mcp-resources.js');
    const result = await beforeBuild.stageMcpResources({
      projectRoot,
      maxAttempts: 1,
      retryDelayMs: 1,
    });

    const stageDir = path.join(projectRoot, 'dist-mcp-stage');
    expect(result.stageDir).toBe(stageDir);
    expect(fs.existsSync(path.join(stageDir, 'gui-operate-server.js'))).toBe(true);
    expect(fs.existsSync(path.join(stageDir, 'software-dev-server-example.js'))).toBe(true);
  });

  it('fails with an actionable message when dist-mcp is missing', async () => {
    const projectRoot = fs.mkdtempSync(path.join(process.cwd(), '.tmp-stage-mcp-missing-'));
    tempDirs.push(projectRoot);

    const beforeBuild = await import('../scripts/stage-mcp-resources.js');
    await expect(
      beforeBuild.stageMcpResources({
        projectRoot,
        maxAttempts: 1,
        retryDelayMs: 1,
      })
    ).rejects.toThrow('Run "npm run build:mcp" before packaging');
  });
});
