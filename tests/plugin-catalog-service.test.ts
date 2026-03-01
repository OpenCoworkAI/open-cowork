import { describe, expect, it, vi } from 'vitest';
import { PluginCatalogService } from '../src/main/skills/plugin-catalog-service';

function createJsonResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as Response;
}

describe('PluginCatalogService', () => {
  it('lists plugins with full component counts', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/contents/plugins?ref=main')) {
        return createJsonResponse([
          { name: 'frontend-design', type: 'dir', path: 'plugins/frontend-design' },
          { name: 'hookify', type: 'dir', path: 'plugins/hookify' },
        ]);
      }

      if (url.includes('/frontend-design/.claude-plugin/plugin.json?ref=main')) {
        return createJsonResponse({
          name: 'frontend-design',
          description: 'Frontend design skill',
          version: '1.0.0',
          author: { name: 'Anthropic' },
        });
      }
      if (url.includes('/hookify/.claude-plugin/plugin.json?ref=main')) {
        return createJsonResponse({
          name: 'hookify',
          description: 'Hook tooling',
          version: '0.1.0',
          author: { name: 'Anthropic' },
        });
      }

      if (url.includes('/frontend-design/skills?ref=main')) {
        return createJsonResponse([{ name: 'frontend-design', type: 'dir' }]);
      }
      if (url.includes('/frontend-design/skills/frontend-design/SKILL.md?ref=main')) {
        return createJsonResponse({ name: 'SKILL.md', type: 'file' });
      }
      if (url.includes('/frontend-design/commands?ref=main')) {
        return createJsonResponse({ message: 'Not Found' }, 404);
      }
      if (url.includes('/frontend-design/agents?ref=main')) {
        return createJsonResponse({ message: 'Not Found' }, 404);
      }
      if (url.includes('/frontend-design/hooks/hooks.json?ref=main')) {
        return createJsonResponse({ message: 'Not Found' }, 404);
      }
      if (url.includes('/frontend-design/.mcp.json?ref=main')) {
        return createJsonResponse({ message: 'Not Found' }, 404);
      }

      if (url.includes('/hookify/skills?ref=main')) {
        return createJsonResponse([{ name: 'writing-rules', type: 'dir' }]);
      }
      if (url.includes('/hookify/skills/writing-rules/SKILL.md?ref=main')) {
        return createJsonResponse({ name: 'SKILL.md', type: 'file' });
      }
      if (url.includes('/hookify/commands?ref=main')) {
        return createJsonResponse([
          { name: 'configure.md', type: 'file', path: 'plugins/hookify/commands/configure.md' },
          { name: 'help.md', type: 'file', path: 'plugins/hookify/commands/help.md' },
        ]);
      }
      if (url.includes('/hookify/agents?ref=main')) {
        return createJsonResponse([
          { name: 'conversation-analyzer.md', type: 'file', path: 'plugins/hookify/agents/conversation-analyzer.md' },
        ]);
      }
      if (url.includes('/hookify/hooks/hooks.json?ref=main')) {
        return createJsonResponse({ name: 'hooks.json', type: 'file' });
      }
      if (url.includes('/hookify/.mcp.json?ref=main')) {
        return createJsonResponse({ message: 'Not Found' }, 404);
      }

      return createJsonResponse({ message: 'Not Found' }, 404);
    });

    const service = new PluginCatalogService(fetchMock as typeof fetch);
    const plugins = await service.listAnthropicPlugins(false, false);

    expect(plugins).toEqual([
      {
        name: 'frontend-design',
        description: 'Frontend design skill',
        version: '1.0.0',
        authorName: 'Anthropic',
        installable: true,
        hasManifest: true,
        componentCounts: {
          skills: 1,
          commands: 0,
          agents: 0,
          hooks: 0,
          mcp: 0,
        },
        skillCount: 1,
        hasSkills: true,
      },
      {
        name: 'hookify',
        description: 'Hook tooling',
        version: '0.1.0',
        authorName: 'Anthropic',
        installable: true,
        hasManifest: true,
        componentCounts: {
          skills: 1,
          commands: 2,
          agents: 1,
          hooks: 1,
          mcp: 0,
        },
        skillCount: 1,
        hasSkills: true,
      },
    ]);
  });

  it('filters installable plugins by any component (not only skills)', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/contents/plugins?ref=main')) {
        return createJsonResponse([
          { name: 'code-review', type: 'dir', path: 'plugins/code-review' },
          { name: 'empty-plugin', type: 'dir', path: 'plugins/empty-plugin' },
        ]);
      }

      if (url.includes('/code-review/.claude-plugin/plugin.json?ref=main')) {
        return createJsonResponse({ name: 'code-review', description: 'PR review workflow', version: '1.0.0' });
      }
      if (url.includes('/empty-plugin/.claude-plugin/plugin.json?ref=main')) {
        return createJsonResponse({ name: 'empty-plugin', description: 'No components', version: '1.0.0' });
      }

      if (url.includes('/code-review/skills?ref=main')) {
        return createJsonResponse({ message: 'Not Found' }, 404);
      }
      if (url.includes('/code-review/commands?ref=main')) {
        return createJsonResponse([{ name: 'code-review.md', type: 'file', path: 'plugins/code-review/commands/code-review.md' }]);
      }
      if (url.includes('/code-review/agents?ref=main')) {
        return createJsonResponse({ message: 'Not Found' }, 404);
      }
      if (url.includes('/code-review/hooks/hooks.json?ref=main')) {
        return createJsonResponse({ message: 'Not Found' }, 404);
      }
      if (url.includes('/code-review/.mcp.json?ref=main')) {
        return createJsonResponse({ message: 'Not Found' }, 404);
      }

      if (url.includes('/empty-plugin/skills?ref=main')) {
        return createJsonResponse({ message: 'Not Found' }, 404);
      }
      if (url.includes('/empty-plugin/commands?ref=main')) {
        return createJsonResponse({ message: 'Not Found' }, 404);
      }
      if (url.includes('/empty-plugin/agents?ref=main')) {
        return createJsonResponse({ message: 'Not Found' }, 404);
      }
      if (url.includes('/empty-plugin/hooks/hooks.json?ref=main')) {
        return createJsonResponse({ message: 'Not Found' }, 404);
      }
      if (url.includes('/empty-plugin/.mcp.json?ref=main')) {
        return createJsonResponse({ message: 'Not Found' }, 404);
      }

      return createJsonResponse({ message: 'Not Found' }, 404);
    });

    const service = new PluginCatalogService(fetchMock as typeof fetch);
    const plugins = await service.listAnthropicPlugins(false, true);

    expect(plugins).toHaveLength(1);
    expect(plugins[0]).toEqual(
      expect.objectContaining({
        name: 'code-review',
        installable: true,
        componentCounts: expect.objectContaining({ commands: 1 }),
        hasSkills: false,
      })
    );
  });

  it('surfaces readable error when catalog fetch fails', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('network down');
    });
    const service = new PluginCatalogService(fetchMock as typeof fetch);

    await expect(service.listAnthropicPlugins()).rejects.toThrow('Failed to fetch plugin catalog');
  });

  it('falls back to jsDelivr when GitHub API is rate-limited', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('api.github.com/repos/anthropics/claude-code/contents/plugins?ref=main')) {
        return createJsonResponse({ message: 'API rate limit exceeded' }, 403);
      }

      if (url === 'https://data.jsdelivr.com/v1/package/gh/anthropics/claude-code@main') {
        return createJsonResponse({
          files: [
            {
              type: 'directory',
              name: 'plugins',
              files: [
                {
                  type: 'directory',
                  name: 'hookify',
                  files: [
                    {
                      type: 'directory',
                      name: '.claude-plugin',
                      files: [{ type: 'file', name: 'plugin.json' }],
                    },
                    {
                      type: 'directory',
                      name: 'skills',
                      files: [
                        {
                          type: 'directory',
                          name: 'writing-rules',
                          files: [{ type: 'file', name: 'SKILL.md' }],
                        },
                      ],
                    },
                    {
                      type: 'directory',
                      name: 'commands',
                      files: [{ type: 'file', name: 'help.md' }],
                    },
                    {
                      type: 'directory',
                      name: 'hooks',
                      files: [{ type: 'file', name: 'hooks.json' }],
                    },
                  ],
                },
              ],
            },
          ],
        });
      }

      if (url === 'https://cdn.jsdelivr.net/gh/anthropics/claude-code@main/plugins/hookify/.claude-plugin/plugin.json') {
        return createJsonResponse({
          name: 'hookify',
          description: 'Hook tooling',
          version: '0.1.0',
          author: { name: 'Anthropic' },
        });
      }

      return createJsonResponse({ message: 'Not Found' }, 404);
    });

    const service = new PluginCatalogService(fetchMock as typeof fetch);
    const plugins = await service.listAnthropicPlugins();

    expect(plugins).toEqual([
      {
        name: 'hookify',
        description: 'Hook tooling',
        version: '0.1.0',
        authorName: 'Anthropic',
        installable: true,
        hasManifest: true,
        componentCounts: {
          skills: 1,
          commands: 1,
          agents: 0,
          hooks: 1,
          mcp: 0,
        },
        skillCount: 1,
        hasSkills: true,
      },
    ]);
  });
});
