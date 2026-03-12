import type { PluginCatalogItem, PluginComponentCounts } from '../../renderer/types';

interface CachedCatalog {
  expiresAt: number;
  data: PluginCatalogItem[];
}

const CLAUDE_PLUGINS_URL = 'https://claude.com/plugins';
const CACHE_TTL_MS = 60_000;
const DEFAULT_USER_AGENT = 'open-cowork-plugin-catalog/3.0';
const DETAIL_FETCH_CONCURRENCY = 8;

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
      const homeHtml = await this.fetchText(CLAUDE_PLUGINS_URL);
      const slugs = this.extractPluginSlugs(homeHtml);
      const detailErrors: string[] = [];
      const pluginCandidates = await this.mapWithConcurrency(slugs, DETAIL_FETCH_CONCURRENCY, async (slug) => {
        try {
          return await this.readMarketplacePlugin(slug);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          detailErrors.push(`${slug}: ${message}`);
          return null;
        }
      });

      const data = pluginCandidates
        .filter((plugin): plugin is PluginCatalogItem => plugin !== null)
        .sort((a, b) => a.name.localeCompare(b.name));

      if (slugs.length > 0 && data.length === 0 && detailErrors.length > 0) {
        throw new Error(
          `All plugin detail requests failed (${detailErrors.length}/${slugs.length}). First error: ${detailErrors[0]}`
        );
      }

      return this.setAndFilterCache(data, installableOnly);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to fetch plugin catalog: ${message}`);
    }
  }

  async downloadPlugin(_pluginName: string, _targetRootPath: string): Promise<string> {
    throw new Error('Direct plugin download is no longer supported. Install via Claude CLI instead.');
  }

  private async readMarketplacePlugin(slug: string): Promise<PluginCatalogItem | null> {
    const detailUrl = `${CLAUDE_PLUGINS_URL}/${slug}`;
    const html = await this.fetchText(detailUrl);
    const installCommand = this.extractInstallCommand(html);
    const pluginId = this.extractPluginId(installCommand);

    if (!installCommand || !pluginId) {
      return null;
    }

    const name = this.extractPluginName(html, slug);
    const description = this.extractMetaDescription(html);
    const authorName = this.extractAuthorName(html);

    return {
      name,
      description,
      version: undefined,
      authorName,
      installable: true,
      hasManifest: false,
      componentCounts: { ...EMPTY_COUNTS },
      skillCount: 0,
      hasSkills: false,
      pluginId,
      installCommand,
      detailUrl,
      catalogSource: 'claude-marketplace',
    };
  }

  private extractPluginSlugs(html: string): string[] {
    const slugs = new Set<string>();
    const matches = html.matchAll(
      /\bhref\s*=\s*(?:"(?:https?:\/\/claude\.com)?\/plugins\/([^"#?\/]+)\/?"|'(?:https?:\/\/claude\.com)?\/plugins\/([^'#?\/]+)\/?')/gi
    );
    for (const match of matches) {
      const slug = decodeURIComponent((match[1] ?? match[2] ?? '').trim());
      if (slug) {
        slugs.add(slug);
      }
    }
    return [...slugs];
  }

  private extractInstallCommand(html: string): string | undefined {
    const match = html.match(/\bdata-copy\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
    if (!match) {
      const fallbackMatch = this.decodeHtml(html).match(/claude plugin (?:install|add)\s+[^\s"'`<]+/i);
      return fallbackMatch?.[0];
    }
    const value = this.decodeHtml((match[1] || match[2] || '').trim());
    if (!/^claude plugin (?:install|add)\s+/i.test(value)) {
      return undefined;
    }
    return value;
  }

  private extractPluginId(installCommand: string | undefined): string | undefined {
    if (!installCommand) {
      return undefined;
    }
    const match = installCommand.match(/^claude plugin (?:install|add)\s+([^\s"'`]+)/i);
    return match?.[1];
  }

  private extractPluginName(html: string, fallbackSlug: string): string {
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    if (titleMatch) {
      const title = this.decodeHtml(titleMatch[1]).trim();
      const shortTitle = title.replace(/\s*[–-]\s*Claude Plugin.*$/i, '').trim();
      if (shortTitle) {
        return shortTitle;
      }
    }
    return fallbackSlug;
  }

  private extractMetaDescription(html: string): string | undefined {
    const direct = html.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"[^>]*>/i);
    if (direct?.[1]) {
      return this.decodeHtml(direct[1]).trim();
    }

    const reversed = html.match(/<meta[^>]*content="([^"]*)"[^>]*name="description"[^>]*>/i);
    if (reversed?.[1]) {
      return this.decodeHtml(reversed[1]).trim();
    }

    return undefined;
  }

  private extractAuthorName(html: string): string | undefined {
    const byLabelPattern = /Made by<\/div>\s*<a[^>]*>\s*<div[^>]*>([^<]+)<\/div>/i;
    const match = html.match(byLabelPattern);
    if (!match?.[1]) {
      return undefined;
    }

    const value = this.decodeHtml(match[1]).trim();
    return value || undefined;
  }

  private decodeHtml(value: string): string {
    return value
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#x27;/gi, "'")
      .replace(/&#34;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ');
  }

  private async mapWithConcurrency<T, R>(
    values: T[],
    concurrency: number,
    mapper: (value: T, index: number) => Promise<R>
  ): Promise<R[]> {
    if (values.length === 0) {
      return [];
    }

    const output: R[] = new Array(values.length);
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (nextIndex < values.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        output[currentIndex] = await mapper(values[currentIndex], currentIndex);
      }
    });

    await Promise.all(workers);
    return output;
  }

  private setAndFilterCache(data: PluginCatalogItem[], installableOnly: boolean): PluginCatalogItem[] {
    this.cache = {
      expiresAt: Date.now() + CACHE_TTL_MS,
      data,
    };
    return installableOnly ? data.filter((plugin) => plugin.installable) : data;
  }

  private async fetchText(url: string): Promise<string> {
    const response = await this.fetchFn(url, {
      headers: {
        'User-Agent': DEFAULT_USER_AGENT,
      },
    });

    if (!response.ok) {
      const message = await this.extractErrorMessage(response);
      throw new HttpRequestError(
        response.status,
        url,
        `Request failed (${response.status}) for ${url}${message ? `: ${message}` : ''}`
      );
    }

    return response.text();
  }

  private async extractErrorMessage(response: Response): Promise<string> {
    try {
      const text = await response.text();
      if (!text) {
        return '';
      }
      return text.slice(0, 200);
    } catch {
      return '';
    }
  }
}
