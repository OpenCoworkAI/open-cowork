import { describe, expect, it, vi } from 'vitest';
import { PluginCatalogService } from '../src/main/skills/plugin-catalog-service';

const CLAUDE_PLUGINS_URL = 'https://claude.com/plugins';

function createHtmlResponse(html: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => html,
  } as Response;
}

describe('PluginCatalogService', () => {
  it('extracts install commands and tolerates partial detail-page failures', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === CLAUDE_PLUGINS_URL) {
        return createHtmlResponse(`
          <a href='https://claude.com/plugins/frontend-design/'>Frontend Design</a>
          <a href="/plugins/productivity">Productivity</a>
          <a href="/plugins/context7">Context7</a>
          <a href="/plugins/broken-plugin">Broken Plugin</a>
          <a href="/plugins/context7">Context7 Duplicate</a>
        `);
      }

      if (url === `${CLAUDE_PLUGINS_URL}/frontend-design`) {
        return createHtmlResponse(`
          <title>Frontend Design – Claude Plugin | Anthropic</title>
          <meta name="description" content="Craft production-grade frontends." />
          <div class="u-text-style-caption">Made by</div>
          <a href="https://anthropic.com"><div>Anthropic</div></a>
          <div data-copy="claude plugin install frontend-design@claude-plugins-official"></div>
        `);
      }

      if (url === `${CLAUDE_PLUGINS_URL}/context7`) {
        return createHtmlResponse(`
          <title>Context7 – Claude Plugin | Anthropic</title>
          <meta name="description" content="Use up-to-date documentation context." />
          <div class="u-text-style-caption">Made by</div>
          <a href="https://upstash.com"><div>Upstash</div></a>
          <p>Run this in terminal: claude plugin install context7@claude-plugins-official</p>
        `);
      }

      if (url === `${CLAUDE_PLUGINS_URL}/productivity`) {
        return createHtmlResponse(`
          <title>Productivity Plugins | Anthropic</title>
          <meta name="description" content="Category page." />
        `);
      }

      if (url === `${CLAUDE_PLUGINS_URL}/broken-plugin`) {
        return createHtmlResponse('upstream exploded', 500);
      }

      return createHtmlResponse('Not Found', 404);
    });

    const service = new PluginCatalogService(fetchMock as typeof fetch);
    const plugins = await service.listAnthropicPlugins(false, false);

    expect(plugins).toEqual([
      {
        name: 'Context7',
        description: 'Use up-to-date documentation context.',
        version: undefined,
        authorName: 'Upstash',
        installable: true,
        hasManifest: false,
        componentCounts: {
          skills: 0,
          commands: 0,
          agents: 0,
          hooks: 0,
          mcp: 0,
        },
        skillCount: 0,
        hasSkills: false,
        pluginId: 'context7@claude-plugins-official',
        installCommand: 'claude plugin install context7@claude-plugins-official',
        detailUrl: 'https://claude.com/plugins/context7',
        catalogSource: 'claude-marketplace',
      },
      {
        name: 'Frontend Design',
        description: 'Craft production-grade frontends.',
        version: undefined,
        authorName: 'Anthropic',
        installable: true,
        hasManifest: false,
        componentCounts: {
          skills: 0,
          commands: 0,
          agents: 0,
          hooks: 0,
          mcp: 0,
        },
        skillCount: 0,
        hasSkills: false,
        pluginId: 'frontend-design@claude-plugins-official',
        installCommand: 'claude plugin install frontend-design@claude-plugins-official',
        detailUrl: 'https://claude.com/plugins/frontend-design',
        catalogSource: 'claude-marketplace',
      },
    ]);
  });

  it('supports installableOnly with marketplace entries', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === CLAUDE_PLUGINS_URL) {
        return createHtmlResponse('<a href="/plugins/code-review">Code Review</a>');
      }
      if (url === `${CLAUDE_PLUGINS_URL}/code-review`) {
        return createHtmlResponse('<div data-copy="claude plugin install code-review@claude-plugins-official"></div>');
      }
      return createHtmlResponse('Not Found', 404);
    });

    const service = new PluginCatalogService(fetchMock as typeof fetch);
    const plugins = await service.listAnthropicPlugins(false, true);

    expect(plugins).toHaveLength(1);
    expect(plugins[0]).toEqual(
      expect.objectContaining({
        name: 'code-review',
        installable: true,
        pluginId: 'code-review@claude-plugins-official',
        catalogSource: 'claude-marketplace',
      })
    );
  });

  it('surfaces readable error when marketplace fetch fails', async () => {
    const fetchMock = vi.fn(async () => createHtmlResponse('upstream down', 503));
    const service = new PluginCatalogService(fetchMock as typeof fetch);

    await expect(service.listAnthropicPlugins()).rejects.toThrow('Failed to fetch plugin catalog');
  });

  it('surfaces readable error when all detail pages fail', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === CLAUDE_PLUGINS_URL) {
        return createHtmlResponse('<a href="/plugins/context7">Context7</a>');
      }
      return createHtmlResponse('plugin detail unavailable', 503);
    });

    const service = new PluginCatalogService(fetchMock as typeof fetch);
    await expect(service.listAnthropicPlugins()).rejects.toThrow('All plugin detail requests failed');
  });
});
