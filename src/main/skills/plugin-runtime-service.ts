import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { app } from 'electron';
import type {
  InstalledPlugin,
  PluginCatalogItemV2,
  PluginComponentCounts,
  PluginComponentEnabledState,
  PluginComponentKind,
  PluginInstallResultV2,
  PluginToggleResult,
} from '../../renderer/types';
import { log, logError } from '../utils/logger';
import { getDefaultShell } from '../utils/shell-resolver';
import { pluginRegistryStore } from './plugin-registry-store';
import { PluginCatalogService } from './plugin-catalog-service';

const execFileAsync = promisify(execFile);

interface PluginManifest {
  name?: string;
  description?: string;
  version?: string;
  author?: string | { name?: string };
  commands?: string | string[];
  agents?: string | string[];
  hooks?: string | Record<string, unknown>;
  mcpServers?: string | Record<string, unknown>;
  [key: string]: unknown;
}

interface CommandOutput {
  stdout: string;
  stderr: string;
}

type CommandRunner = (command: string, args: string[]) => Promise<CommandOutput>;

interface ClaudeInstalledPluginRecord {
  id?: string;
  installPath?: string;
}

interface ClaudePluginListOutput {
  installed?: ClaudeInstalledPluginRecord[];
}

const EMPTY_COUNTS: PluginComponentCounts = {
  skills: 0,
  commands: 0,
  agents: 0,
  hooks: 0,
  mcp: 0,
};

const EMPTY_COMPONENT_STATE: PluginComponentEnabledState = {
  skills: false,
  commands: false,
  agents: false,
  hooks: false,
  mcp: false,
};

function cloneCounts(counts: PluginComponentCounts): PluginComponentCounts {
  return {
    skills: counts.skills,
    commands: counts.commands,
    agents: counts.agents,
    hooks: counts.hooks,
    mcp: counts.mcp,
  };
}

function cloneComponentState(state: PluginComponentEnabledState): PluginComponentEnabledState {
  return {
    skills: state.skills,
    commands: state.commands,
    agents: state.agents,
    hooks: state.hooks,
    mcp: state.mcp,
  };
}

export class PluginRuntimeService {
  private readonly catalogService: PluginCatalogService;
  private readonly commandRunner: CommandRunner;

  constructor(
    catalogService: PluginCatalogService = new PluginCatalogService(),
    commandRunner: CommandRunner = PluginRuntimeService.defaultCommandRunner
  ) {
    this.catalogService = catalogService;
    this.commandRunner = commandRunner;
  }

  async listCatalog(options?: { installableOnly?: boolean }): Promise<PluginCatalogItemV2[]> {
    const installableOnly = options?.installableOnly === true;
    const plugins = await this.catalogService.listAnthropicPlugins(false, installableOnly);
    return plugins.map((plugin) => ({
      name: plugin.name,
      description: plugin.description,
      version: plugin.version,
      authorName: plugin.authorName,
      installable: plugin.installable,
      hasManifest: plugin.hasManifest,
      componentCounts: cloneCounts(plugin.componentCounts),
      pluginId: plugin.pluginId,
      installCommand: plugin.installCommand,
      detailUrl: plugin.detailUrl,
      catalogSource: plugin.catalogSource,
    }));
  }

  listInstalled(): InstalledPlugin[] {
    return pluginRegistryStore.list().map((plugin) => this.normalizeInstalledPlugin(plugin));
  }

  async install(pluginRef: string): Promise<PluginInstallResultV2> {
    log(`[PluginRuntime] Install requested: ${pluginRef}`);
    const catalog = await this.catalogService.listAnthropicPlugins(false, false);
    const requested = pluginRef.trim();
    const loweredRequested = requested.toLowerCase();
    const targetPlugin = this.resolveCatalogPlugin(catalog, loweredRequested);
    if (!targetPlugin) {
      throw new Error(`Plugin not found in marketplace catalog: ${pluginRef}`);
    }

    const pluginId = this.getCatalogPluginId(targetPlugin);
    if (!pluginId) {
      throw new Error(`Unable to resolve plugin id for ${pluginRef}`);
    }
    log(`[PluginRuntime] Resolved marketplace plugin id: ${pluginId} (from ${pluginRef})`);

    await this.installWithClaudeCli(pluginId);
    const pluginRootPath = await this.resolveInstallPathFromCli(pluginId);
    const result = await this.installFromDirectory(pluginRootPath);
    log(
      `[PluginRuntime] Install completed: ${result.plugin.name} (${result.plugin.pluginId}), source=${result.plugin.sourcePath}, runtime=${result.plugin.runtimePath}`
    );
    return result;
  }

  async installFromDirectory(pluginRootPath: string): Promise<PluginInstallResultV2> {
    if (!fs.existsSync(pluginRootPath) || !fs.statSync(pluginRootPath).isDirectory()) {
      throw new Error('Plugin directory does not exist');
    }
    log(`[PluginRuntime] Importing plugin directory: ${pluginRootPath}`);

    const sourceManifest = this.readManifest(pluginRootPath);
    const displayName = sourceManifest?.name?.trim() || path.basename(pluginRootPath);
    const pluginId = this.sanitizePluginId(displayName);
    const sourcePath = this.getSourcePath(pluginId);
    const runtimePath = this.getRuntimePath(pluginId);
    const componentCounts = this.detectComponentCounts(pluginRootPath, sourceManifest);

    fs.rmSync(sourcePath, { recursive: true, force: true });
    fs.rmSync(runtimePath, { recursive: true, force: true });
    this.copyDirectory(pluginRootPath, sourcePath);

    const now = Date.now();
    const defaultComponentState = this.getDefaultComponentState(componentCounts);
    const hasAnyComponent = this.hasAnyEnabledComponent(defaultComponentState, componentCounts);
    const installedPlugin: InstalledPlugin = {
      pluginId,
      name: displayName,
      description: sourceManifest?.description,
      version: sourceManifest?.version,
      authorName: this.resolveAuthorName(sourceManifest?.author),
      enabled: hasAnyComponent,
      sourcePath,
      runtimePath,
      componentCounts,
      componentsEnabled: defaultComponentState,
      installedAt: now,
      updatedAt: now,
    };

    pluginRegistryStore.save(installedPlugin);
    await this.materializeRuntime(pluginId);

    const persisted = pluginRegistryStore.get(pluginId);
    if (!persisted) {
      throw new Error(`Failed to persist installed plugin: ${pluginId}`);
    }

    const warnings: string[] = [];
    if (!sourceManifest) {
      warnings.push('plugin.json not found, generated runtime manifest with defaults');
    }

    const result = {
      plugin: this.normalizeInstalledPlugin(persisted),
      installedSkills: this.listSkillNames(sourcePath),
      warnings,
    };
    log(
      `[PluginRuntime] Imported plugin: ${result.plugin.name} (${result.plugin.pluginId}), components=${JSON.stringify(result.plugin.componentCounts)}`
    );
    return result;
  }

  async setEnabled(pluginId: string, enabled: boolean): Promise<PluginToggleResult> {
    const plugin = pluginRegistryStore.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin not found: ${pluginId}`);
    }

    const normalized = this.normalizeInstalledPlugin(plugin);
    normalized.enabled = enabled;
    normalized.updatedAt = Date.now();
    pluginRegistryStore.save(normalized);

    await this.materializeRuntime(pluginId);
    const updated = pluginRegistryStore.get(pluginId);
    if (!updated) {
      throw new Error(`Plugin not found after update: ${pluginId}`);
    }
    log(`[PluginRuntime] Plugin toggled: ${updated.name} (${pluginId}) enabled=${enabled}`);
    return {
      success: true,
      plugin: this.normalizeInstalledPlugin(updated),
    };
  }

  async setComponentEnabled(
    pluginId: string,
    component: PluginComponentKind,
    enabled: boolean
  ): Promise<PluginToggleResult> {
    const plugin = pluginRegistryStore.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin not found: ${pluginId}`);
    }

    const normalized = this.normalizeInstalledPlugin(plugin);
    const hasComponent = normalized.componentCounts[component] > 0;
    normalized.componentsEnabled[component] = enabled && hasComponent;
    normalized.updatedAt = Date.now();
    pluginRegistryStore.save(normalized);

    await this.materializeRuntime(pluginId);
    const updated = pluginRegistryStore.get(pluginId);
    if (!updated) {
      throw new Error(`Plugin not found after update: ${pluginId}`);
    }
    log(
      `[PluginRuntime] Plugin component toggled: ${updated.name} (${pluginId}) component=${component} enabled=${normalized.componentsEnabled[component]} available=${hasComponent}`
    );
    return {
      success: true,
      plugin: this.normalizeInstalledPlugin(updated),
    };
  }

  async uninstall(pluginId: string): Promise<{ success: boolean }> {
    log(`[PluginRuntime] Uninstall requested: ${pluginId}`);
    const plugin = pluginRegistryStore.get(pluginId);
    if (!plugin) {
      log(`[PluginRuntime] Uninstall skipped: plugin not found (${pluginId})`);
      return { success: false };
    }

    log(
      `[PluginRuntime] Removing plugin files: ${plugin.name} (${pluginId}), source=${plugin.sourcePath}, runtime=${plugin.runtimePath}`
    );
    fs.rmSync(plugin.sourcePath, { recursive: true, force: true });
    fs.rmSync(plugin.runtimePath, { recursive: true, force: true });
    const success = pluginRegistryStore.delete(pluginId);
    log(`[PluginRuntime] Uninstall completed: ${plugin.name} (${pluginId}) success=${success}`);
    return { success };
  }

  async getEnabledRuntimePlugins(): Promise<InstalledPlugin[]> {
    const plugins = this.listInstalled().filter(
      (plugin) => plugin.enabled && this.hasAnyEnabledComponent(plugin.componentsEnabled, plugin.componentCounts)
    );

    const ready: InstalledPlugin[] = [];
    for (const plugin of plugins) {
      if (!fs.existsSync(plugin.runtimePath)) {
        await this.materializeRuntime(plugin.pluginId);
      }
      if (fs.existsSync(plugin.runtimePath)) {
        ready.push(plugin);
      }
    }
    return ready;
  }

  private static async defaultCommandRunner(command: string, args: string[]): Promise<CommandOutput> {
    // Enrich PATH for packaged app (same strategy as agent-runner)
    let env = { ...process.env };
    if (process.platform === 'darwin' || process.platform === 'linux') {
      try {
        const userShell = getDefaultShell();
        const { execSync } = require('child_process');
        const shellOutput = execSync(`${userShell} -l -c "echo $PATH"`, {
          encoding: 'utf-8',
          timeout: 3000,
        }).trim();
        if (shellOutput) env.PATH = shellOutput;
      } catch { /* use process.env.PATH */ }
    } else if (process.platform === 'win32') {
      try {
        const { execSync } = require('child_process');
        const winPath = execSync(
          'powershell.exe -NoProfile -Command "[Environment]::GetEnvironmentVariable(\'Path\', \'User\') + \';\' + [Environment]::GetEnvironmentVariable(\'Path\', \'Machine\')"',
          { encoding: 'utf-8', timeout: 5000 }
        ).trim();
        if (winPath) {
          const winPaths = winPath.split(';').filter((p: string) => p.trim());
          const currentPaths = (env.PATH || '').split(';').filter((p: string) => p.trim());
          const allPaths = [...winPaths];
          for (const p of currentPaths) {
            if (!allPaths.some(ep => ep.toLowerCase() === p.toLowerCase())) {
              allPaths.push(p);
            }
          }
          env.PATH = allPaths.join(';');
        }
      } catch { /* use process.env.PATH */ }
    }
    const result = await execFileAsync(command, args, {
      env,
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
    });
    return {
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    };
  }

  private async installWithClaudeCli(pluginId: string): Promise<void> {
    log(`[PluginRuntime] Running Claude CLI install: ${pluginId}`);
    try {
      await this.commandRunner('claude', ['plugin', 'install', pluginId]);
      log(`[PluginRuntime] Claude CLI install succeeded: ${pluginId}`);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'ENOENT') {
        throw new Error('Failed to install plugin: claude command not found. Please install Claude Code CLI first.');
      }

      const stderr = (error as { stderr?: string }).stderr?.trim();
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to install plugin via Claude CLI: ${stderr || message}`);
    }
  }

  private async resolveInstallPathFromCli(pluginId: string): Promise<string> {
    const installed = await this.listInstalledPluginsFromCli();
    log(`[PluginRuntime] Installed plugins reported by Claude CLI: ${installed.length}`);
    const record =
      installed.find((plugin) => plugin.id === pluginId)
      ?? installed.find((plugin) => plugin.id?.toLowerCase() === pluginId.toLowerCase());

    if (!record?.installPath) {
      const availableIds = installed.map((plugin) => plugin.id).filter((id): id is string => Boolean(id));
      log(`[PluginRuntime] installPath resolution failed for ${pluginId}, availableIds=${JSON.stringify(availableIds)}`);
      throw new Error(`Failed to install plugin: installPath not found for ${pluginId}`);
    }

    const pluginRootPath = record.installPath;
    log(`[PluginRuntime] Resolved installPath from Claude CLI: ${pluginId} -> ${pluginRootPath}`);
    if (!fs.existsSync(pluginRootPath) || !fs.statSync(pluginRootPath).isDirectory()) {
      throw new Error(`Failed to install plugin: installPath is not a directory (${pluginRootPath})`);
    }

    return pluginRootPath;
  }

  private async listInstalledPluginsFromCli(): Promise<ClaudeInstalledPluginRecord[]> {
    let commandOutput: CommandOutput;
    try {
      commandOutput = await this.commandRunner('claude', ['plugin', 'list', '--json']);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'ENOENT') {
        throw new Error('Failed to read installed plugins: claude command not found.');
      }

      const stderr = (error as { stderr?: string }).stderr?.trim();
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to read installed plugins from Claude CLI: ${stderr || message}`);
    }

    let parsed: ClaudePluginListOutput | ClaudeInstalledPluginRecord[];
    try {
      parsed = JSON.parse(commandOutput.stdout) as ClaudePluginListOutput | ClaudeInstalledPluginRecord[];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to parse Claude plugin list JSON: ${message}`);
    }

    if (Array.isArray(parsed)) {
      return parsed;
    }

    return Array.isArray(parsed.installed) ? parsed.installed : [];
  }

  private extractPluginId(installCommand: string | undefined): string | undefined {
    if (!installCommand) {
      return undefined;
    }

    const match = installCommand.match(/^claude plugin (?:install|add)\s+([^\s"'`]+)/i);
    return match?.[1];
  }

  private getCatalogPluginId(plugin: PluginCatalogItemV2): string | undefined {
    return plugin.pluginId ?? this.extractPluginId(plugin.installCommand);
  }

  private resolveCatalogPlugin(catalog: PluginCatalogItemV2[], loweredRequested: string): PluginCatalogItemV2 | null {
    const byExactPluginId = catalog.find((plugin) => this.getCatalogPluginId(plugin)?.toLowerCase() === loweredRequested);
    if (byExactPluginId) {
      return byExactPluginId;
    }

    const byBarePluginId = catalog.filter((plugin) => {
      const pluginId = this.getCatalogPluginId(plugin);
      return pluginId?.split('@')[0]?.toLowerCase() === loweredRequested;
    });
    if (byBarePluginId.length === 1) {
      return byBarePluginId[0];
    }
    if (byBarePluginId.length > 1) {
      const candidates = byBarePluginId
        .map((plugin) => this.getCatalogPluginId(plugin))
        .filter((value): value is string => Boolean(value));
      throw new Error(
        `Multiple plugins matched this id prefix. Please install using full plugin id: ${candidates.join(', ')}`
      );
    }

    const byName = catalog.filter((plugin) => plugin.name.toLowerCase() === loweredRequested);
    if (byName.length === 1) {
      return byName[0];
    }
    if (byName.length > 1) {
      const candidates = byName
        .map((plugin) => this.getCatalogPluginId(plugin))
        .filter((value): value is string => Boolean(value));
      throw new Error(`Multiple plugins share this name. Please install by plugin id: ${candidates.join(', ')}`);
    }

    return null;
  }

  private async materializeRuntime(pluginId: string): Promise<void> {
    const plugin = pluginRegistryStore.get(pluginId);
    if (!plugin) {
      return;
    }

    fs.rmSync(plugin.runtimePath, { recursive: true, force: true });

    const active = plugin.enabled && this.hasAnyEnabledComponent(plugin.componentsEnabled, plugin.componentCounts);
    if (!active) {
      return;
    }

    this.copyDirectory(plugin.sourcePath, plugin.runtimePath);

    const sourceManifest = this.readManifest(plugin.sourcePath);
    const runtimeManifest = this.buildRuntimeManifest(plugin, sourceManifest);
    this.pruneDisabledComponents(plugin, sourceManifest);
    this.writeRuntimeManifest(plugin.runtimePath, runtimeManifest);

    log(`[PluginRuntime] Materialized runtime plugin: ${plugin.name} (${plugin.pluginId})`);
  }

  private buildRuntimeManifest(plugin: InstalledPlugin, sourceManifest: PluginManifest | null): PluginManifest {
    const metadata: PluginManifest = sourceManifest ? { ...sourceManifest } : {};
    metadata.name = plugin.name;
    metadata.version = plugin.version ?? metadata.version ?? '0.1.0';
    metadata.description = plugin.description ?? metadata.description;
    if (plugin.authorName && !metadata.author) {
      metadata.author = plugin.authorName;
    }

    if (!this.isRuntimeComponentEnabled(plugin, 'commands')) {
      delete metadata.commands;
    }
    if (!this.isRuntimeComponentEnabled(plugin, 'agents')) {
      delete metadata.agents;
    }
    if (!this.isRuntimeComponentEnabled(plugin, 'hooks')) {
      delete metadata.hooks;
    }
    if (!this.isRuntimeComponentEnabled(plugin, 'mcp')) {
      delete metadata.mcpServers;
    }

    return metadata;
  }

  private pruneDisabledComponents(plugin: InstalledPlugin, sourceManifest: PluginManifest | null): void {
    if (!this.isRuntimeComponentEnabled(plugin, 'skills')) {
      this.removeRelativePath(plugin.runtimePath, './skills');
    }

    if (!this.isRuntimeComponentEnabled(plugin, 'commands')) {
      for (const componentPath of this.resolveComponentPaths(sourceManifest?.commands, ['./commands'])) {
        this.removeRelativePath(plugin.runtimePath, componentPath);
      }
    }

    if (!this.isRuntimeComponentEnabled(plugin, 'agents')) {
      for (const componentPath of this.resolveComponentPaths(sourceManifest?.agents, ['./agents'])) {
        this.removeRelativePath(plugin.runtimePath, componentPath);
      }
    }

    if (!this.isRuntimeComponentEnabled(plugin, 'hooks')) {
      if (typeof sourceManifest?.hooks === 'string') {
        this.removeRelativePath(plugin.runtimePath, sourceManifest.hooks);
      } else {
        this.removeRelativePath(plugin.runtimePath, './hooks/hooks.json');
      }
      this.removeRelativePath(plugin.runtimePath, './hooks');
      this.removeRelativePath(plugin.runtimePath, './hooks-handlers');
    }

    if (!this.isRuntimeComponentEnabled(plugin, 'mcp')) {
      if (typeof sourceManifest?.mcpServers === 'string') {
        this.removeRelativePath(plugin.runtimePath, sourceManifest.mcpServers);
      } else {
        this.removeRelativePath(plugin.runtimePath, './.mcp.json');
      }
      this.removeRelativePath(plugin.runtimePath, './mcp');
    }
  }

  private writeRuntimeManifest(runtimeRootPath: string, manifest: PluginManifest): void {
    const manifestDir = path.join(runtimeRootPath, '.claude-plugin');
    fs.mkdirSync(manifestDir, { recursive: true });
    const manifestPath = path.join(manifestDir, 'plugin.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  }

  private detectComponentCounts(pluginRootPath: string, manifest: PluginManifest | null): PluginComponentCounts {
    const counts = cloneCounts(EMPTY_COUNTS);
    counts.skills = this.countSkills(pluginRootPath);
    counts.commands = this.countMarkdownComponent(pluginRootPath, this.resolveComponentPaths(manifest?.commands, ['./commands']));
    counts.agents = this.countMarkdownComponent(pluginRootPath, this.resolveComponentPaths(manifest?.agents, ['./agents']));
    counts.hooks = this.countHooks(pluginRootPath, manifest);
    counts.mcp = this.countMcp(pluginRootPath, manifest);
    return counts;
  }

  private countSkills(pluginRootPath: string): number {
    const skillsRoot = path.join(pluginRootPath, 'skills');
    if (!fs.existsSync(skillsRoot) || !fs.statSync(skillsRoot).isDirectory()) {
      return 0;
    }
    const entries = fs.readdirSync(skillsRoot, { withFileTypes: true });
    return entries.reduce((count, entry) => {
      if (!entry.isDirectory()) {
        return count;
      }
      const skillFile = path.join(skillsRoot, entry.name, 'SKILL.md');
      return fs.existsSync(skillFile) ? count + 1 : count;
    }, 0);
  }

  private countMarkdownComponent(pluginRootPath: string, relativePaths: string[]): number {
    const uniqueFiles = new Set<string>();
    for (const relativePath of relativePaths) {
      const absolutePath = this.resolveSafePath(pluginRootPath, relativePath);
      if (!absolutePath || !fs.existsSync(absolutePath)) {
        continue;
      }
      this.collectMarkdownFiles(absolutePath, uniqueFiles);
    }
    return uniqueFiles.size;
  }

  private countHooks(pluginRootPath: string, manifest: PluginManifest | null): number {
    if (manifest?.hooks && typeof manifest.hooks === 'object') {
      return 1;
    }

    const hookPaths =
      typeof manifest?.hooks === 'string'
        ? [manifest.hooks]
        : ['./hooks/hooks.json'];

    for (const hookPath of hookPaths) {
      const absolutePath = this.resolveSafePath(pluginRootPath, hookPath);
      if (absolutePath && fs.existsSync(absolutePath)) {
        return 1;
      }
    }
    return 0;
  }

  private countMcp(pluginRootPath: string, manifest: PluginManifest | null): number {
    if (manifest?.mcpServers && typeof manifest.mcpServers === 'object') {
      return 1;
    }

    const mcpPaths =
      typeof manifest?.mcpServers === 'string'
        ? [manifest.mcpServers]
        : ['./.mcp.json'];

    for (const mcpPath of mcpPaths) {
      const absolutePath = this.resolveSafePath(pluginRootPath, mcpPath);
      if (absolutePath && fs.existsSync(absolutePath)) {
        return 1;
      }
    }
    return 0;
  }

  private getDefaultComponentState(componentCounts: PluginComponentCounts): PluginComponentEnabledState {
    return {
      skills: componentCounts.skills > 0,
      commands: componentCounts.commands > 0,
      agents: componentCounts.agents > 0,
      hooks: false,
      mcp: false,
    };
  }

  private hasAnyEnabledComponent(
    componentsEnabled: PluginComponentEnabledState,
    componentCounts: PluginComponentCounts
  ): boolean {
    return (Object.keys(componentsEnabled) as PluginComponentKind[]).some(
      (component) => componentsEnabled[component] && componentCounts[component] > 0
    );
  }

  private isRuntimeComponentEnabled(plugin: InstalledPlugin, component: PluginComponentKind): boolean {
    return plugin.componentsEnabled[component] && plugin.componentCounts[component] > 0;
  }

  private resolveComponentPaths(value: string | string[] | undefined, fallback: string[]): string[] {
    if (!value) {
      return fallback;
    }
    return Array.isArray(value) ? value : [value];
  }

  private resolveSafePath(rootPath: string, relativePath: string): string | null {
    const normalized = relativePath.trim().replace(/\\/g, '/').replace(/^\.\//, '');
    if (!normalized || normalized.startsWith('/') || normalized.startsWith('../') || normalized.includes('/../')) {
      return null;
    }
    return path.join(rootPath, normalized);
  }

  private collectMarkdownFiles(targetPath: string, output: Set<string>): void {
    const stat = fs.statSync(targetPath);
    if (stat.isFile()) {
      if (targetPath.toLowerCase().endsWith('.md')) {
        output.add(targetPath);
      }
      return;
    }

    const entries = fs.readdirSync(targetPath, { withFileTypes: true });
    for (const entry of entries) {
      this.collectMarkdownFiles(path.join(targetPath, entry.name), output);
    }
  }

  private removeRelativePath(rootPath: string, relativePath: string): void {
    const absolutePath = this.resolveSafePath(rootPath, relativePath);
    if (!absolutePath) {
      return;
    }
    if (fs.existsSync(absolutePath)) {
      fs.rmSync(absolutePath, { recursive: true, force: true });
    }
  }

  private copyDirectory(sourcePath: string, targetPath: string): void {
    if (!fs.existsSync(targetPath)) {
      fs.mkdirSync(targetPath, { recursive: true });
    }

    const entries = fs.readdirSync(sourcePath, { withFileTypes: true });
    for (const entry of entries) {
      const sourceEntryPath = path.join(sourcePath, entry.name);
      const targetEntryPath = path.join(targetPath, entry.name);
      if (entry.isDirectory()) {
        this.copyDirectory(sourceEntryPath, targetEntryPath);
      } else if (entry.isSymbolicLink()) {
        const linkTarget = fs.readlinkSync(sourceEntryPath);
        fs.symlinkSync(linkTarget, targetEntryPath);
      } else {
        fs.copyFileSync(sourceEntryPath, targetEntryPath);
      }
    }
  }

  private listSkillNames(pluginRootPath: string): string[] {
    const skillsRoot = path.join(pluginRootPath, 'skills');
    if (!fs.existsSync(skillsRoot) || !fs.statSync(skillsRoot).isDirectory()) {
      return [];
    }
    const entries = fs.readdirSync(skillsRoot, { withFileTypes: true });
    const names: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const skillFile = path.join(skillsRoot, entry.name, 'SKILL.md');
      if (fs.existsSync(skillFile)) {
        names.push(entry.name);
      }
    }
    return names.sort((a, b) => a.localeCompare(b));
  }

  private readManifest(pluginRootPath: string): PluginManifest | null {
    const manifestPath = path.join(pluginRootPath, '.claude-plugin', 'plugin.json');
    if (!fs.existsSync(manifestPath)) {
      return null;
    }
    try {
      return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as PluginManifest;
    } catch (error) {
      logError(`[PluginRuntime] Failed to parse plugin manifest: ${manifestPath}`, error);
      return null;
    }
  }

  private sanitizePluginId(name: string): string {
    const sanitized = name
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return sanitized || `plugin-${Date.now()}`;
  }

  private resolveAuthorName(author: PluginManifest['author']): string | undefined {
    if (!author) {
      return undefined;
    }
    if (typeof author === 'string') {
      return author;
    }
    return author.name;
  }

  private normalizeInstalledPlugin(plugin: InstalledPlugin): InstalledPlugin {
    return {
      ...plugin,
      componentCounts: plugin.componentCounts
        ? cloneCounts(plugin.componentCounts)
        : cloneCounts(EMPTY_COUNTS),
      componentsEnabled: plugin.componentsEnabled
        ? cloneComponentState(plugin.componentsEnabled)
        : cloneComponentState(EMPTY_COMPONENT_STATE),
    };
  }

  private getPluginsRootPath(): string {
    return path.join(app.getPath('userData'), 'claude', 'plugins');
  }

  private getSourcePath(pluginId: string): string {
    return path.join(this.getPluginsRootPath(), 'source', pluginId);
  }

  private getRuntimePath(pluginId: string): string {
    return path.join(this.getPluginsRootPath(), 'runtime', pluginId);
  }
}
