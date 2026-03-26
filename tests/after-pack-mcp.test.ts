import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('after-pack MCP handling', () => {
  it('copies staged MCP bundles into resources with retry logic', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'scripts/after-pack.js'), 'utf8');

    expect(source).toContain("const { stageMcpResources } = require('./stage-mcp-resources');");
    expect(source).toContain("const existingStageDir = path.join(projectRoot, 'dist-mcp-stage');");
    expect(source).toContain("const bundledMcpDir = path.join(resourcesDir, 'mcp');");
    expect(source).toContain('copyDirWithRetry(stageDir, bundledMcpDir)');
    expect(source).toContain('MCP: copied');
  });
});
