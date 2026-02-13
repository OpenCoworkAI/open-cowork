import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PluginCatalogItem, PluginComponentCounts } from '../../renderer/types';

interface GitHubContentEntry {
  name: string;
  path: string;
  type: 'file' | 'dir';
  url?: string;
  download_url?: string | null;
}

interface PluginManifest {
  name?: string;
  description?: string;
  version?: string;
  author?: string | { name?: string };
}

interface CachedCatalog {
  expiresAt: number;
  data: PluginCatalogItem[];
}

interface JsDelivrEntry {
  type: 'file' | 'directory';
  name: string;
  files?: JsDelivrEntry[];
}

interface JsDelivrPackageMeta {
  files?: JsDelivrEntry[];
}

const ANTHROPIC_PLUGINS_ROOT = 'plugins';
const GITHUB_API_ROOT = 'https://api.github.com/repos/anthropics/claude-code/contents';
const JSDELIVR_META_URL = 'https://data.jsdelivr.com/v1/package/gh/anthropics/claude-code@main';
const JSDELIVR_CDN_ROOT = 'https://cdn.jsdelivr.net/gh/anthropics/claude-code@main';
const CACHE_TTL_MS = 60_000;
const DEFAULT_USER_AGENT = 'open-cowork-plugin-catalog/2.0';

const EMPTY_COUNTS: PluginComponentCounts = {
  skills: 0,
  commands: 0,
  agents: 0,
  hooks: 0,
  mcp: 0,
};

class HttpRequestError extends Error {
  status: number;
  url: string;

  constructor(status: number, url: string, message: string) {
    super(message);
    this.status = status;
    this.url = url;
  }
}

export class PluginCatalogService {
  private readonly fetchFn: typeof fetch;
  private cache: CachedCatalog | null = null;

  constructor(fetchFn: typeof fetch = fetch) {
    this.fetchFn = fetchFn;
  }

  async listAnthropicPlugins(forceRefresh = false, installableOnly = false): Promise<PluginCatalogItem[]> {
    if (!forceRefresh && this.cache && this.cache.expiresAt > Date.now()) {
      return installableOnly
        ? this.cache.data.filter((plugin) => plugin.installable)
        : this.cache.data;
    }

    try {
      const entries = await this.fetchJson<GitHubContentEntry[]>(
        `${GITHUB_API_ROOT}/${ANTHROPIC_PLUGINS_ROOT}?ref=main`
      );
      const pluginDirs = entries.filter((entry) => entry.type === 'dir');
      const plugins = await Promise.all(pluginDirs.map((entry) => this.readPlugin(entry.name)));
      const data = plugins
        .filter((plugin): plugin is PluginCatalogItem => plugin !== null)
        .sort((a, b) => a.name.localeCompare(b.name));
      return this.setAndFilterCache(data, installableOnly);
    } catch (error) {
      if (this.shouldFallbackToJsDelivr(error)) {
        const fallbackData = await this.listFromJsDelivr();
        return this.setAndFilterCache(fallbackData, installableOnly);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to fetch plugin catalog: ${message}`);
    }
  }

  async downloadPlugin(pluginName: string, targetRootPath: string): Promise<string> {
    const pluginRootPath = path.join(targetRootPath, pluginName);
    fs.rmSync(pluginRootPath, { recursive: true, force: true });
    fs.mkdirSync(pluginRootPath, { recursive: true });

    try {
      await this.downloadDirectory(`${ANTHROPIC_PLUGINS_ROOT}/${pluginName}`, pluginRootPath);
    } catch (error) {
      if (!this.shouldFallbackToJsDelivr(error)) {
        throw error;
      }
      await this.downloadPluginFromJsDelivr(pluginName, pluginRootPath);
    }

    return pluginRootPath;
  }

  private async readPlugin(pluginName: string): Promise<PluginCatalogItem | null> {
    const manifest = await this.fetchJson<PluginManifest | null>(
      `${GITHUB_API_ROOT}/${ANTHROPIC_PLUGINS_ROOT}/${pluginName}/.claude-plugin/plugin.json?ref=main`,
      true
    );

    const componentCounts = await this.countPluginComponents(pluginName);
    return this.buildCatalogItem(pluginName, manifest, componentCounts, manifest !== null);
  }

  private buildCatalogItem(
    pluginName: string,
    manifest: PluginManifest | null,
    componentCounts: PluginComponentCounts,
    hasManifest: boolean
  ): PluginCatalogItem {
    const installable = this.hasAnyComponent(componentCounts);
    return {
      name: pluginName,
      description: manifest?.description,
      version: manifest?.version,
      authorName: this.resolveAuthorName(manifest?.author),
      installable,
      hasManifest,
      componentCounts: { ...componentCounts },
      skillCount: componentCounts.skills,
      hasSkills: componentCounts.skills > 0,
    };
  }

  private async countPluginComponents(pluginName: string): Promise<PluginComponentCounts> {
    const [skills, commands, agents, hooks, mcp] = await Promise.all([
      this.countSkills(pluginName),
      this.countMarkdownFilesAtPath(`${ANTHROPIC_PLUGINS_ROOT}/${pluginName}/commands`),
      this.countMarkdownFilesAtPath(`${ANTHROPIC_PLUGINS_ROOT}/${pluginName}/agents`),
      this.pathExists(`${ANTHROPIC_PLUGINS_ROOT}/${pluginName}/hooks/hooks.json`),
      this.pathExists(`${ANTHROPIC_PLUGINS_ROOT}/${pluginName}/.mcp.json`),
    ]);

    return {
      skills,
      commands,
      agents,
      hooks: hooks ? 1 : 0,
      mcp: mcp ? 1 : 0,
    };
  }

  private async countSkills(pluginName: string): Promise<number> {
    const skillEntries = await this.fetchJson<GitHubContentEntry[] | null>(
      `${GITHUB_API_ROOT}/${ANTHROPIC_PLUGINS_ROOT}/${pluginName}/skills?ref=main`,
      true
    );
    if (!skillEntries) {
      return 0;
    }

    let skillCount = 0;
    for (const entry of skillEntries) {
      if (entry.type !== 'dir') {
        continue;
      }
      const skillFile = await this.fetchJson<GitHubContentEntry | null>(
        `${GITHUB_API_ROOT}/${ANTHROPIC_PLUGINS_ROOT}/${pluginName}/skills/${entry.name}/SKILL.md?ref=main`,
        true
      );
      if (skillFile) {
        skillCount += 1;
      }
    }
    return skillCount;
  }

  private async countMarkdownFilesAtPath(repoPath: string): Promise<number> {
    const entries = await this.fetchJson<GitHubContentEntry[] | null>(
      `${GITHUB_API_ROOT}/${repoPath}?ref=main`,
      true
    );
    if (!entries) {
      return 0;
    }

    let total = 0;
    for (const entry of entries) {
      if (entry.type === 'dir') {
        total += await this.countMarkdownFilesAtPath(entry.path);
        continue;
      }
      if (entry.name.toLowerCase().endsWith('.md')) {
        total += 1;
      }
    }
    return total;
  }

  private async pathExists(repoPath: string): Promise<boolean> {
    const entry = await this.fetchJson<GitHubContentEntry | null>(
      `${GITHUB_API_ROOT}/${repoPath}?ref=main`,
      true
    );
    return entry !== null;
  }

  private async downloadDirectory(repoPath: string, targetDirPath: string): Promise<void> {
    fs.mkdirSync(targetDirPath, { recursive: true });
    const entries = await this.fetchJson<GitHubContentEntry[]>(`${GITHUB_API_ROOT}/${repoPath}?ref=main`);

    for (const entry of entries) {
      const targetPath = path.join(targetDirPath, entry.name);
      if (entry.type === 'dir') {
        await this.downloadDirectory(entry.path, targetPath);
        continue;
      }
      await this.downloadFile(entry, targetPath);
    }
  }

  private async downloadFile(entry: GitHubContentEntry, targetPath: string): Promise<void> {
    if (entry.download_url) {
      const response = await this.fetchFn(entry.download_url, {
        headers: {
          'User-Agent': DEFAULT_USER_AGENT,
        },
      });
      if (!response.ok) {
        throw new Error(`Failed to download file ${entry.path}: HTTP ${response.status}`);
      }
      const content = Buffer.from(await response.arrayBuffer());
      fs.writeFileSync(targetPath, content);
      return;
    }

    const fileInfo = await this.fetchJson<{ content?: string; encoding?: string }>(
      entry.url ?? `${GITHUB_API_ROOT}/${entry.path}?ref=main`
    );
    if (!fileInfo.content) {
      throw new Error(`Missing file content for ${entry.path}`);
    }
    if (fileInfo.encoding === 'base64') {
      fs.writeFileSync(targetPath, Buffer.from(fileInfo.content, 'base64'));
      return;
    }
    fs.writeFileSync(targetPath, fileInfo.content, 'utf8');
  }

  private setAndFilterCache(data: PluginCatalogItem[], installableOnly: boolean): PluginCatalogItem[] {
    this.cache = {
      expiresAt: Date.now() + CACHE_TTL_MS,
      data,
    };
    return installableOnly ? data.filter((plugin) => plugin.installable) : data;
  }

  private shouldFallbackToJsDelivr(error: unknown): boolean {
    if (!(error instanceof HttpRequestError)) {
      return false;
    }
    if (!error.url.includes('api.github.com')) {
      return false;
    }
    return error.status === 403 || error.status === 429;
  }

  private async listFromJsDelivr(): Promise<PluginCatalogItem[]> {
    const metadata = await this.fetchJson<JsDelivrPackageMeta>(JSDELIVR_META_URL, false, false);
    const pluginsDirectory = this.findDirectoryByPath(metadata.files ?? [], [ANTHROPIC_PLUGINS_ROOT]);
    if (!pluginsDirectory?.files?.length) {
      return [];
    }

    const pluginDirs = pluginsDirectory.files.filter((entry) => entry.type === 'directory');
    const plugins: PluginCatalogItem[] = [];

    for (const pluginDir of pluginDirs) {
      const manifestPath = `${ANTHROPIC_PLUGINS_ROOT}/${pluginDir.name}/.claude-plugin/plugin.json`;
      const manifest = await this.fetchJson<PluginManifest | null>(
        `${JSDELIVR_CDN_ROOT}/${manifestPath}`,
        true,
        false
      );

      const componentCounts = this.countComponentsFromTree(pluginDir);
      plugins.push(this.buildCatalogItem(pluginDir.name, manifest, componentCounts, manifest !== null));
    }

    return plugins.sort((a, b) => a.name.localeCompare(b.name));
  }

  private countComponentsFromTree(pluginDir: JsDelivrEntry): PluginComponentCounts {
    const counts = { ...EMPTY_COUNTS };
    counts.skills = this.countSkillsFromTree(pluginDir);
    counts.commands = this.countMarkdownDirectoryFromTree(pluginDir, 'commands');
    counts.agents = this.countMarkdownDirectoryFromTree(pluginDir, 'agents');
    counts.hooks = this.fileExistsInDirectory(pluginDir, ['hooks', 'hooks.json']) ? 1 : 0;
    counts.mcp = this.fileExistsInDirectory(pluginDir, ['.mcp.json']) ? 1 : 0;
    return counts;
  }

  private countSkillsFromTree(pluginDir: JsDelivrEntry): number {
    const skillsDir = this.findDirectoryByPath(pluginDir.files ?? [], ['skills']);
    if (!skillsDir?.files?.length) {
      return 0;
    }

    return skillsDir.files.reduce((count, entry) => {
      if (entry.type !== 'directory') {
        return count;
      }
      const hasSkillFile = (entry.files ?? []).some((file) => file.type === 'file' && file.name === 'SKILL.md');
      return hasSkillFile ? count + 1 : count;
    }, 0);
  }

  private countMarkdownDirectoryFromTree(pluginDir: JsDelivrEntry, directoryName: string): number {
    const directory = this.findDirectoryByPath(pluginDir.files ?? [], [directoryName]);
    if (!directory) {
      return 0;
    }
    return this.countMarkdownFilesInTree(directory);
  }

  private countMarkdownFilesInTree(entry: JsDelivrEntry): number {
    if (entry.type === 'file') {
      return entry.name.toLowerCase().endsWith('.md') ? 1 : 0;
    }
    return (entry.files ?? []).reduce((sum, child) => sum + this.countMarkdownFilesInTree(child), 0);
  }

  private fileExistsInDirectory(rootEntry: JsDelivrEntry, pathSegments: string[]): boolean {
    if (pathSegments.length === 0) {
      return false;
    }

    const [firstSegment, ...rest] = pathSegments;
    const children = rootEntry.files ?? [];
    const candidate = children.find((entry) => entry.name === firstSegment);
    if (!candidate) {
      return false;
    }
    if (rest.length === 0) {
      return candidate.type === 'file' || candidate.type === 'directory';
    }
    if (candidate.type !== 'directory') {
      return false;
    }
    return this.fileExistsInDirectory(candidate, rest);
  }

  private async downloadPluginFromJsDelivr(pluginName: string, targetPluginPath: string): Promise<void> {
    const metadata = await this.fetchJson<JsDelivrPackageMeta>(JSDELIVR_META_URL, false, false);
    const pluginsDirectory = this.findDirectoryByPath(metadata.files ?? [], [ANTHROPIC_PLUGINS_ROOT]);
    const pluginDirectory = (pluginsDirectory?.files ?? []).find(
      (entry) => entry.type === 'directory' && entry.name === pluginName
    );
    if (!pluginDirectory) {
      throw new Error(`Plugin not found in jsDelivr metadata: ${pluginName}`);
    }

    await this.downloadDirectoryFromJsDelivr(pluginDirectory, `${ANTHROPIC_PLUGINS_ROOT}/${pluginName}`, targetPluginPath);
  }

  private async downloadDirectoryFromJsDelivr(entry: JsDelivrEntry, repoPath: string, targetPath: string): Promise<void> {
    fs.mkdirSync(targetPath, { recursive: true });

    for (const child of entry.files ?? []) {
      const childRepoPath = `${repoPath}/${child.name}`;
      const childTargetPath = path.join(targetPath, child.name);

      if (child.type === 'directory') {
        await this.downloadDirectoryFromJsDelivr(child, childRepoPath, childTargetPath);
        continue;
      }

      const response = await this.fetchFn(`${JSDELIVR_CDN_ROOT}/${childRepoPath}`, {
        headers: {
          'User-Agent': DEFAULT_USER_AGENT,
        },
      });
      if (!response.ok) {
        throw new Error(`Failed to download file ${childRepoPath}: HTTP ${response.status}`);
      }
      const content = Buffer.from(await response.arrayBuffer());
      fs.writeFileSync(childTargetPath, content);
    }
  }

  private findDirectoryByPath(entries: JsDelivrEntry[], pathSegments: string[]): JsDelivrEntry | null {
    let currentEntries = entries;
    let current: JsDelivrEntry | null = null;

    for (const segment of pathSegments) {
      current = currentEntries.find((entry) => entry.type === 'directory' && entry.name === segment) ?? null;
      if (!current) {
        return null;
      }
      currentEntries = current.files ?? [];
    }

    return current;
  }

  private hasAnyComponent(componentCounts: PluginComponentCounts): boolean {
    return componentCounts.skills > 0
      || componentCounts.commands > 0
      || componentCounts.agents > 0
      || componentCounts.hooks > 0
      || componentCounts.mcp > 0;
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

  private async fetchJson<T>(url: string, allowNotFound = false, useGitHubHeaders = true): Promise<T> {
    const headers: Record<string, string> = {
      'User-Agent': DEFAULT_USER_AGENT,
    };
    if (useGitHubHeaders) {
      headers.Accept = 'application/vnd.github+json';
    }

    const response = await this.fetchFn(url, { headers });
    if (allowNotFound && response.status === 404) {
      return null as T;
    }
    if (!response.ok) {
      const message = await this.extractErrorMessage(response);
      throw new HttpRequestError(
        response.status,
        url,
        `Request failed (${response.status}) for ${url}${message ? `: ${message}` : ''}`
      );
    }
    return response.json() as Promise<T>;
  }

  private async extractErrorMessage(response: Response): Promise<string> {
    try {
      const text = await response.text();
      if (!text) {
        return '';
      }
      const parsed = JSON.parse(text) as { message?: string };
      if (parsed.message) {
        return parsed.message;
      }
      return text;
    } catch {
      return '';
    }
  }
}
