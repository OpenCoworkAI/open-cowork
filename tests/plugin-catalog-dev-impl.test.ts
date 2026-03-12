import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginCatalogService } from '../src/main/skills/plugin-catalog-service';

// ---------------------------------------------------------------------------
// HTML fixtures — minimal strings that match the regex patterns used by
// PluginCatalogService's extractors.
// ---------------------------------------------------------------------------

function pluginHomeHtml(slugs: string[]): string {
  const links = slugs
    .map((slug) => `<a href="/plugins/${slug}">Plugin ${slug}</a>`)
    .join('\n');
  return `<html><body>${links}</body></html>`;
}

function pluginDetailHtml(opts: {
  slug: string;
  installCommand: string;
  title?: string;
  description?: string;
  authorName?: string;
}): string {
  const title = opts.title ?? `${opts.slug} – Claude Plugin`;
  const descMeta = opts.description
    ? `<meta name="description" content="${opts.description}">`
    : '';
  const authorBlock = opts.authorName
    ? `<div>Made by</div><a href="#"><div>${opts.authorName}</div></a>`
    : '';
  return [
    '<html><head>',
    `<title>${title}</title>`,
    descMeta,
    '</head><body>',
    `<button data-copy="${opts.installCommand}">Copy</button>`,
    authorBlock,
    '</body></html>',
  ].join('\n');
}

function mockResponse(html: string, ok = true, status = 200): Response {
  return {
    ok,
    status,
    text: () => Promise.resolve(html),
    headers: new Headers(),
    redirected: false,
    statusText: ok ? 'OK' : 'Not Found',
    type: 'basic',
    url: '',
    clone: () => mockResponse(html, ok, status),
    body: null,
    bodyUsed: false,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    blob: () => Promise.resolve(new Blob()),
    formData: () => Promise.resolve(new FormData()),
    json: () => Promise.resolve({}),
    bytes: () => Promise.resolve(new Uint8Array()),
  } as Response;
}

describe('PluginCatalogService', () => {
  let fetchFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchFn = vi.fn();
  });

  it('parses catalog items from mocked HTML pages', async () => {
    const homeHtml = pluginHomeHtml(['my-tool', 'another-plugin']);

    fetchFn
      .mockResolvedValueOnce(mockResponse(homeHtml)) // home page
      .mockResolvedValueOnce(
        mockResponse(
          pluginDetailHtml({
            slug: 'my-tool',
            installCommand: 'claude plugin install @anthropic/my-tool',
            title: 'My Tool – Claude Plugin',
            description: 'A useful tool',
            authorName: 'Anthropic',
          })
        )
      )
      .mockResolvedValueOnce(
        mockResponse(
          pluginDetailHtml({
            slug: 'another-plugin',
            installCommand: 'claude plugin add @community/another-plugin',
            title: 'Another Plugin – Claude Plugin',
            description: 'Another useful plugin',
            authorName: 'Community',
          })
        )
      );

    const service = new PluginCatalogService(fetchFn as unknown as typeof fetch);
    const items = await service.listAnthropicPlugins();

    expect(items).toHaveLength(2);

    // Items are sorted by name
    const [another, myTool] = items;

    expect(myTool.name).toBe('My Tool');
    expect(myTool.description).toBe('A useful tool');
    expect(myTool.authorName).toBe('Anthropic');
    expect(myTool.installCommand).toBe('claude plugin install @anthropic/my-tool');
    expect(myTool.pluginId).toBe('@anthropic/my-tool');
    expect(myTool.installable).toBe(true);
    expect(myTool.catalogSource).toBe('claude-marketplace');
    expect(myTool.detailUrl).toBe('https://claude.com/plugins/my-tool');

    expect(another.name).toBe('Another Plugin');
    expect(another.pluginId).toBe('@community/another-plugin');
  });

  it('returns empty array when home page has no plugin links', async () => {
    fetchFn.mockResolvedValueOnce(
      mockResponse('<html><body><p>No plugins here</p></body></html>')
    );

    const service = new PluginCatalogService(fetchFn as unknown as typeof fetch);
    const items = await service.listAnthropicPlugins();

    expect(items).toEqual([]);
    // Only the home page should have been fetched
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('throws with descriptive message when fetch fails with network error', async () => {
    fetchFn.mockRejectedValue(new TypeError('fetch failed'));

    const service = new PluginCatalogService(fetchFn as unknown as typeof fetch);

    await expect(service.listAnthropicPlugins()).rejects.toThrow(
      /Failed to fetch plugin catalog.*fetch failed/
    );
  });

  it('caches results and respects forceRefresh', async () => {
    const homeHtml = pluginHomeHtml(['cached-plugin']);
    const detailHtml = pluginDetailHtml({
      slug: 'cached-plugin',
      installCommand: 'claude plugin install @anthropic/cached-plugin',
      title: 'Cached Plugin – Claude Plugin',
    });

    fetchFn
      .mockResolvedValueOnce(mockResponse(homeHtml))
      .mockResolvedValueOnce(mockResponse(detailHtml));

    const service = new PluginCatalogService(fetchFn as unknown as typeof fetch);

    // First call — fetches from network
    const first = await service.listAnthropicPlugins();
    expect(first).toHaveLength(1);
    expect(fetchFn).toHaveBeenCalledTimes(2); // home + 1 detail

    // Second call — should use cache, no additional fetches
    const second = await service.listAnthropicPlugins();
    expect(second).toHaveLength(1);
    expect(fetchFn).toHaveBeenCalledTimes(2); // unchanged

    // Force refresh — should fetch again
    fetchFn
      .mockResolvedValueOnce(mockResponse(homeHtml))
      .mockResolvedValueOnce(mockResponse(detailHtml));

    const third = await service.listAnthropicPlugins(true);
    expect(third).toHaveLength(1);
    expect(fetchFn).toHaveBeenCalledTimes(4); // 2 more calls
  });
});
