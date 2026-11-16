import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  client: vi.fn(),
  wsClient: vi.fn(),
  start: vi.fn(async () => {}),
  close: vi.fn(),
}));
vi.mock('@larksuiteoapi/node-sdk', () => ({
  Domain: { Feishu: 'https://open.feishu.cn', Lark: 'https://open.larksuite.com' },
  LoggerLevel: { debug: 0, info: 1, warn: 2, error: 3 },
  Client: class {
    constructor(config: unknown) {
      mocks.client(config);
    }
  },
  WSClient: class {
    constructor(config: unknown) {
      mocks.wsClient(config);
    }
    start = mocks.start;
    close = mocks.close;
  },
  EventDispatcher: class {
    register() {
      return this;
    }
  },
}));
vi.mock('../../main/utils/logger', () => ({ log: vi.fn(), logError: vi.fn(), logWarn: vi.fn() }));

import { FeishuWSClient } from '../../main/remote/channels/feishu/feishu-ws-client';

describe('Feishu / Lark websocket endpoint discovery', () => {
  it.each([
    [undefined, 'https://open.feishu.cn'],
    ['lark', 'https://open.larksuite.com'],
  ] as const)('configures both SDK clients for %s', async (domain, origin) => {
    const client = new FeishuWSClient({ appId: 'app', appSecret: 'secret', domain });
    await client.start();
    try {
      expect(mocks.client).toHaveBeenLastCalledWith(expect.objectContaining({ domain: origin }));
      expect(mocks.wsClient).toHaveBeenLastCalledWith(expect.objectContaining({ domain: origin }));
    } finally {
      await client.stop();
    }
  });
});
