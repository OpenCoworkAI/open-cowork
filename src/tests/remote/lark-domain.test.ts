import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeishuAPI } from '../../main/remote/channels/feishu/feishu-api';

vi.mock('../../main/utils/logger', () => ({ log: vi.fn(), logError: vi.fn(), logWarn: vi.fn() }));

afterEach(() => vi.unstubAllGlobals());

describe('Feishu / international Lark API routing', () => {
  it.each([
    [undefined, 'https://open.feishu.cn'],
    ['feishu', 'https://open.feishu.cn'],
    ['lark', 'https://open.larksuite.com'],
  ] as const)('routes auth and image downloads for %s', async (domain, origin) => {
    const image = new Uint8Array([1, 2, 3]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 0, tenant_access_token: 'token', expire: 7200 }))
      )
      .mockResolvedValueOnce(new Response(image));
    vi.stubGlobal('fetch', fetchMock);
    const api = new FeishuAPI('app', 'secret', domain);
    await expect(api.downloadImage('image-key')).resolves.toEqual(Buffer.from(image));
    expect(fetchMock.mock.calls[0][0]).toBe(
      `${origin}/open-apis/auth/v3/tenant_access_token/internal`
    );
    expect(fetchMock.mock.calls[1][0]).toBe(`${origin}/open-apis/im/v1/images/image-key`);
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer token');
  });
});
