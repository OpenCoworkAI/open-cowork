import { afterEach, describe, expect, it, vi } from 'vitest';
import { TelegramChannel } from '../../main/remote/channels/telegram/telegram-channel';
import { convertRemoteContentToBlocks } from '../../main/remote/remote-content-blocks';
import type { RemoteMessage, TelegramChannelConfig } from '../../main/remote/types';
import { getTelegramConfigError } from '../../shared/telegram-channel-config';

vi.mock('../../main/utils/logger', () => ({ log: vi.fn(), logError: vi.fn(), logWarn: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());

const config = (): TelegramChannelConfig => ({
  type: 'telegram',
  botToken: '123456:test-token',
  dm: { policy: 'allowlist', allowFrom: ['42'] },
});

function message(extra: Record<string, unknown> = {}) {
  return {
    message_id: 3,
    date: 100,
    chat: { id: 42, type: 'private' },
    from: { id: 42, is_bot: false, first_name: 'User' },
    text: 'hello',
    ...extra,
  };
}

function installFetch(messages: unknown[] = [], attachment = new Uint8Array([1, 2, 3])) {
  let polls = 0;
  const calls: { method: string; body: Record<string, unknown> }[] = [];
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const method = String(url).split('/').at(-1)!;
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    calls.push({ method, body });
    if (String(url).includes('/file/')) return new Response(attachment);
    let result: unknown = true;
    if (method === 'getMe') result = { id: 99, username: 'testbot' };
    if (method === 'getFile')
      result = { file_path: 'photos/photo.jpg', file_size: attachment.length };
    if (method === 'getUpdates') {
      if (polls++ === 0 && messages.length) {
        result = messages.map((entry, index) => ({
          update_id: index + 10,
          ...(entry && typeof entry === 'object' && 'callback_query' in entry
            ? entry
            : { message: entry }),
        }));
      } else {
        return await new Promise<Response>((_resolve, reject) => {
          const abort = () => reject(new Error('aborted'));
          init?.signal?.addEventListener('abort', abort, { once: true });
          if (init?.signal?.aborted) abort();
        });
      }
    }
    return new Response(JSON.stringify({ ok: true, result }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

describe('Telegram polling channel', () => {
  it('routes allowed private chats and aborts polling on stop', async () => {
    const { calls } = installFetch([message()]);
    const channel = new TelegramChannel(config());
    const received = vi.fn();
    channel.onMessage(received);
    await channel.start();
    try {
      await vi.waitFor(() => expect(received).toHaveBeenCalledOnce());
      expect(received).toHaveBeenCalledWith(
        expect.objectContaining({
          channelType: 'telegram',
          channelId: '42',
          sender: expect.objectContaining({ id: '42' }),
          content: { type: 'text', text: 'hello' },
        })
      );
      await vi.waitFor(() =>
        expect(calls.filter((call) => call.method === 'getUpdates')).toHaveLength(2)
      );
      expect(calls.at(-1)?.body.offset).toBe(11);
      expect(channel.connected).toBe(true);
    } finally {
      await channel.stop();
    }
    expect(channel.connected).toBe(false);
    const count = calls.length;
    await channel.stop();
    expect(calls).toHaveLength(count);
  });

  it('rejects strangers, bots and groups before any image download', async () => {
    const { calls } = installFetch([
      message({ from: { id: 7, is_bot: false }, photo: [{ file_id: 'secret' }] }),
      message({ from: { id: 42, is_bot: true } }),
      message({ chat: { id: -100, type: 'group' } }),
    ]);
    const channel = new TelegramChannel(config());
    const received = vi.fn();
    channel.onMessage(received);
    await channel.start();
    try {
      await vi.waitFor(() =>
        expect(calls.filter((call) => call.method === 'getUpdates')).toHaveLength(2)
      );
      expect(received).not.toHaveBeenCalled();
      expect(calls.some((call) => call.method === 'getFile')).toBe(false);
    } finally {
      await channel.stop();
    }
  });

  it.each(['photo', 'document'])(
    'delivers %s bytes, including the caption, to agent content',
    async (kind) => {
      const file = { file_id: 'image-key', file_name: 'report.txt', mime_type: 'text/plain' };
      installFetch([
        message({ text: undefined, caption: 'inspect', [kind]: kind === 'photo' ? [file] : file }),
      ]);
      const channel = new TelegramChannel(config());
      let resolve!: (message: RemoteMessage) => void;
      const received = new Promise<RemoteMessage>((done) => {
        resolve = done;
      });
      channel.onMessage(resolve);
      await channel.start();
      try {
        const result = await received;
        const conversion = convertRemoteContentToBlocks(result.content);
        expect(conversion.deliverToAgent).toBe(true);
        expect(conversion.blocks[0]).toEqual({ type: 'text', text: 'inspect' });
        expect(conversion.blocks[1]).toMatchObject(
          kind === 'photo'
            ? { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AQID' } }
            : {
                type: 'file_attachment',
                filename: 'report.txt',
                relativePath: '',
                inlineDataBase64: 'AQID',
              }
        );
      } finally {
        await channel.stop();
      }
    }
  );

  it('rejects oversized documents with a notice without running the agent', async () => {
    const { calls } = installFetch([
      message({ document: { file_id: 'huge', file_size: 11 * 1024 * 1024 } }),
    ]);
    const channel = new TelegramChannel(config());
    const received = vi.fn();
    channel.onMessage(received);
    await channel.start();
    try {
      await vi.waitFor(() =>
        expect(calls.some((call) => call.method === 'sendMessage')).toBe(true)
      );
      expect(calls.some((call) => call.method === 'getFile')).toBe(false);
      expect(received).not.toHaveBeenCalled();
    } finally {
      await channel.stop();
    }
  });

  it('escapes response HTML, preserves code formatting and splits long replies', async () => {
    const { calls } = installFetch();
    const channel = new TelegramChannel(config());
    await channel.start();
    try {
      await channel.send({
        channelType: 'telegram',
        channelId: '42',
        content: { type: 'markdown', markdown: '<script> & `x < y`\n```js\na < b\n```' },
      });
      expect(calls.find((call) => call.method === 'sendMessage')?.body).toMatchObject({
        parse_mode: 'HTML',
        text: '&lt;script&gt; &amp; <code>x &lt; y</code>\n<pre>a &lt; b\n</pre>',
      });
      await channel.send({
        channelType: 'telegram',
        channelId: '42',
        content: { type: 'text', text: 'x'.repeat(9000) },
      });
      expect(calls.filter((call) => call.method === 'sendMessage')).toHaveLength(4);
    } finally {
      await channel.stop();
    }
  });

  it('never exposes a bot token in connection failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error(`https://api.telegram.org/bot${config().botToken}/getMe`);
      })
    );
    const channel = new TelegramChannel(config());
    await expect(channel.start()).rejects.toThrow('Unable to connect to Telegram');
    await expect(channel.start()).rejects.not.toThrow(config().botToken);
    expect(channel.connected).toBe(false);
  });

  it('cancels an in-flight connection without restarting polling', async () => {
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    const channel = new TelegramChannel(config());
    const starting = channel.start();
    await channel.stop();
    await expect(starting).resolves.toBeUndefined();
    expect(channel.connected).toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('cancels the retry delay when polling fails', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/getUpdates')) throw new Error('network failure');
      return new Response(JSON.stringify({ ok: true, result: true }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const channel = new TelegramChannel(config());
    await channel.start();
    await vi.waitFor(() => expect(channel.connected).toBe(false));
    await channel.stop();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it.each([42, 7])(
    'validates callback sender %s before emitting a permission control',
    async (userId) => {
      const { calls } = installFetch([
        {
          callback_query: {
            id: 'callback',
            from: { id: userId, is_bot: false },
            message: message(),
            data: `perm:${'a'.repeat(24)}:y`,
          },
        },
      ]);
      const channel = new TelegramChannel(config());
      const received = vi.fn();
      channel.onMessage(received);
      await channel.start();
      try {
        await vi.waitFor(() =>
          expect(calls.some((call) => call.method === 'answerCallbackQuery')).toBe(true)
        );
        if (userId === 42) {
          expect(received).toHaveBeenCalledWith(
            expect.objectContaining({
              sender: { id: '42', isBot: false },
              content: {
                type: 'interactive',
                interactive: { kind: 'telegram_permission', token: 'a'.repeat(24), answer: 'y' },
              },
            })
          );
        } else expect(received).not.toHaveBeenCalled();
      } finally {
        await channel.stop();
      }
    }
  );

  it.each([
    { ...config(), botToken: '' },
    { ...config(), dm: { policy: 'open' as const } },
    { ...config(), dm: { policy: 'allowlist' as const, allowFrom: [] } },
    { ...config(), dm: { policy: 'allowlist' as const, allowFrom: ['not-an-id'] } },
    { ...config(), webhookUrl: 'https://example.com' },
  ])('rejects invalid configuration %#', (invalid) => {
    expect(getTelegramConfigError(invalid)).not.toBeNull();
  });
});
