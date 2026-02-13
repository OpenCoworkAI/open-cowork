import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let testRoot = '';

vi.mock('electron', () => ({
  app: {
    getName: () => 'open-cowork-test',
    getVersion: () => '0.0.0-test',
    getPath: (name: string) => {
      if (name === 'userData') return path.join(testRoot, 'userData');
      if (name === 'temp') return path.join(testRoot, 'temp');
      if (name === 'home') return path.join(testRoot, 'home');
      return testRoot;
    },
  },
}));

vi.mock('../src/main/utils/logger', () => ({
  log: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

function createPluginFixture(root: string, pluginName: string): string {
  const pluginRoot = path.join(root, pluginName);
  fs.mkdirSync(path.join(pluginRoot, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(
    path.join(pluginRoot, '.claude-plugin', 'plugin.json'),
    JSON.stringify(
      {
        name: pluginName,
        version: '1.0.0',
        description: `${pluginName} plugin`,
      },
      null,
      2
    ),
    'utf8'
  );

  fs.mkdirSync(path.join(pluginRoot, 'skills', 'alpha'), { recursive: true });
  fs.writeFileSync(
    path.join(pluginRoot, 'skills', 'alpha', 'SKILL.md'),
    '---\nname: alpha\ndescription: Alpha skill\n---\n',
    'utf8'
  );

  fs.mkdirSync(path.join(pluginRoot, 'commands'), { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, 'commands', 'do.md'), '# do', 'utf8');

  fs.mkdirSync(path.join(pluginRoot, 'agents'), { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, 'agents', 'reviewer.md'), '# reviewer', 'utf8');

  fs.mkdirSync(path.join(pluginRoot, 'hooks'), { recursive: true });
  fs.writeFileSync(
    path.join(pluginRoot, 'hooks', 'hooks.json'),
    JSON.stringify({ hooks: { Stop: [] } }),
    'utf8'
  );

  fs.writeFileSync(path.join(pluginRoot, '.mcp.json'), JSON.stringify({ mcpServers: {} }), 'utf8');
  return pluginRoot;
}

async function createRuntimeService() {
  const { PluginRuntimeService } = await import('../src/main/skills/plugin-runtime-service');
  const fakeCatalogService = {
    listAnthropicPlugins: vi.fn(),
    downloadPlugin: vi.fn(),
  } as any;
  return new PluginRuntimeService(fakeCatalogService);
}

describe('PluginRuntimeService', () => {
  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'open-cowork-plugin-runtime-'));
    fs.mkdirSync(path.join(testRoot, 'userData'), { recursive: true });
    fs.mkdirSync(path.join(testRoot, 'temp'), { recursive: true });
    fs.mkdirSync(path.join(testRoot, 'home'), { recursive: true });
    vi.resetModules();
  });

  afterEach(() => {
    if (testRoot && fs.existsSync(testRoot)) {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it('materializes runtime with default component policy', async () => {
    const fixturesRoot = path.join(testRoot, 'fixtures');
    const pluginRoot = createPluginFixture(fixturesRoot, 'full-plugin');
    const service = await createRuntimeService();

    const result = await service.installFromDirectory(pluginRoot);

    expect(result.plugin.componentsEnabled).toEqual({
      skills: true,
      commands: true,
      agents: true,
      hooks: false,
      mcp: false,
    });
    expect(fs.existsSync(path.join(result.plugin.sourcePath, 'skills'))).toBe(true);
    expect(fs.existsSync(path.join(result.plugin.runtimePath, 'skills'))).toBe(true);
    expect(fs.existsSync(path.join(result.plugin.runtimePath, 'commands'))).toBe(true);
    expect(fs.existsSync(path.join(result.plugin.runtimePath, 'agents'))).toBe(true);
    expect(fs.existsSync(path.join(result.plugin.runtimePath, 'hooks'))).toBe(false);
    expect(fs.existsSync(path.join(result.plugin.runtimePath, '.mcp.json'))).toBe(false);
  });

  it('re-materializes runtime when hooks and mcp are enabled', async () => {
    const fixturesRoot = path.join(testRoot, 'fixtures');
    const pluginRoot = createPluginFixture(fixturesRoot, 'runtime-toggle');
    const service = await createRuntimeService();

    const installResult = await service.installFromDirectory(pluginRoot);
    await service.setComponentEnabled(installResult.plugin.pluginId, 'hooks', true);
    await service.setComponentEnabled(installResult.plugin.pluginId, 'mcp', true);

    const installed = service.listInstalled().find((plugin) => plugin.pluginId === installResult.plugin.pluginId);
    expect(installed).toBeDefined();
    expect(installed?.componentsEnabled.hooks).toBe(true);
    expect(installed?.componentsEnabled.mcp).toBe(true);
    expect(fs.existsSync(path.join(installed!.runtimePath, 'hooks', 'hooks.json'))).toBe(true);
    expect(fs.existsSync(path.join(installed!.runtimePath, '.mcp.json'))).toBe(true);
  });

  it('excludes globally disabled plugin from SDK runtime list', async () => {
    const fixturesRoot = path.join(testRoot, 'fixtures');
    const pluginRoot = createPluginFixture(fixturesRoot, 'global-disable');
    const service = await createRuntimeService();

    const installResult = await service.installFromDirectory(pluginRoot);
    await service.setEnabled(installResult.plugin.pluginId, false);

    const runtimePlugins = await service.getEnabledRuntimePlugins();
    expect(runtimePlugins).toEqual([]);
    expect(fs.existsSync(installResult.plugin.runtimePath)).toBe(false);
  });

  it('removes source/runtime directories on uninstall', async () => {
    const fixturesRoot = path.join(testRoot, 'fixtures');
    const pluginRoot = createPluginFixture(fixturesRoot, 'remove-me');
    const service = await createRuntimeService();

    const installResult = await service.installFromDirectory(pluginRoot);
    const uninstallResult = await service.uninstall(installResult.plugin.pluginId);

    expect(uninstallResult.success).toBe(true);
    expect(fs.existsSync(installResult.plugin.sourcePath)).toBe(false);
    expect(fs.existsSync(installResult.plugin.runtimePath)).toBe(false);
    expect(service.listInstalled()).toEqual([]);
  });
});
