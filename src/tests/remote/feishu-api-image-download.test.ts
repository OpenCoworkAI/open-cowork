import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeishuAPI } from '../../main/remote/channels/feishu/feishu-api';

vi.mock('../../main/utils/logger', () => ({ log: vi.fn(), logError: vi.fn(), logWarn: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());

describe('Feishu image API endpoint selection', () => {
  it.each([
    ['om/message', '/im/v1/messages/om%2Fmessage/resources/img%2Fkey?type=image'],
    [undefined, '/im/v1/images/img%2Fkey'],
  ] as const)(
    'downloads image bytes in the correct message context: %s',
    async (messageId, endpoint) => {
      const image = new Uint8Array([1, 2, 3]);
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ code: 0, tenant_access_token: 'token', expire: 7200 }))
        )
        .mockResolvedValueOnce(new Response(image));
      vi.stubGlobal('fetch', fetchMock);
      const api = new FeishuAPI('app', 'secret');
      await expect(api.downloadImage('img/key', messageId)).resolves.toEqual(Buffer.from(image));
      expect(fetchMock.mock.calls[1][0]).toBe(`https://open.feishu.cn/open-apis${endpoint}`);
      expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer token');
    }
  );
});
