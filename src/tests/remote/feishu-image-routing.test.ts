import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../main/utils/logger', () => ({
  log: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock('../../main/remote/remote-config-store', () => ({
  remoteConfigStore: {
    getAll: () => ({ gateway: { enabled: false }, channels: {} }),
    isEnabled: () => false,
    getPairedUsers: () => [],
  },
}));

import { FeishuChannel } from '../../main/remote/channels/feishu/feishu-channel';
import type { FeishuAPI } from '../../main/remote/channels/feishu/feishu-api';
import { MessageRouter } from '../../main/remote/message-router';
import { convertRemoteContentToBlocks } from '../../main/remote/remote-content-blocks';
import { RemoteManager } from '../../main/remote/remote-manager';
import type { FeishuChannelConfig, RemoteContent, RemoteMessage } from '../../main/remote/types';
import type { ContentBlock, ImageContent } from '../../renderer/types';

/** 1x1 transparent PNG */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

const ENCRYPT_KEY = 'test_encrypt_key';
const VERIFICATION_TOKEN = 'v_token_example';
const TIMESTAMP = '1710000000';
const NONCE = 'n1QwErTy';

function officialSha256Signature(rawBody: string): string {
  return createHash('sha256')
    .update(TIMESTAMP + NONCE + ENCRYPT_KEY + rawBody, 'utf8')
    .digest('hex');
}

function signedHeaders(signature: string) {
  return {
    'x-lark-signature': signature,
    'x-lark-request-timestamp': TIMESTAMP,
    'x-lark-request-nonce': NONCE,
  };
}

function channelConfig(): FeishuChannelConfig {
  return {
    type: 'feishu',
    appId: 'cli_test',
    appSecret: 'secret',
    encryptKey: ENCRYPT_KEY,
    verificationToken: VERIFICATION_TOKEN,
    useWebSocket: false,
    dm: { policy: 'pairing' },
  };
}

function setBotOpenId(channel: FeishuChannel, openId: string): void {
  (channel as unknown as { botOpenId: string }).botOpenId = openId;
}

async function handleWebSocketMessage(
  channel: FeishuChannel,
  data: Record<string, unknown>
): Promise<void> {
  await (
    channel as unknown as {
      handleWebSocketMessage: (payload: Record<string, unknown>) => Promise<void>;
    }
  ).handleWebSocketMessage(data);
}

function imageWebhookBody(overrides: {
  chatType?: string;
  mentions?: unknown;
  imageKey?: string;
  eventId?: string;
}): string {
  return JSON.stringify({
    schema: '2.0',
    header: {
      event_id: overrides.eventId ?? 'img-event',
      token: VERIFICATION_TOKEN,
      create_time: '1603977298000',
      event_type: 'im.message.receive_v1',
      tenant_key: '2d8a0e17d6c7622d',
      app_id: 'cli_test',
    },
    event: {
      sender: { sender_id: { open_id: 'ou_user' }, sender_type: 'user' },
      message: {
        message_id: 'om_img',
        chat_id: 'oc_chat',
        chat_type: overrides.chatType ?? 'p2p',
        message_type: 'image',
        content: JSON.stringify({ image_key: overrides.imageKey ?? 'img_v2_repro' }),
        ...(overrides.mentions !== undefined ? { mentions: overrides.mentions } : {}),
      },
    },
  });
}

function buildMessage(content: RemoteContent): RemoteMessage {
  return {
    id: 'msg-1',
    channelType: 'feishu',
    channelId: 'channel-1',
    sender: { id: 'user-1', isBot: false },
    content,
    timestamp: Date.now(),
    isGroup: false,
    isMentioned: false,
  };
}

async function routeAndCapture(content: RemoteContent): Promise<{
  prompt?: string;
  content?: ContentBlock[];
  notices: string[];
}> {
  const router = new MessageRouter();
  let captured: { prompt: string; content: ContentBlock[] } | undefined;
  const notices: string[] = [];

  router.setAgentCallback(async (_sessionId, prompt, blocks) => {
    captured = { prompt, content: blocks };
  });
  router.onResponse(async (response) => {
    if (response.content.type === 'text' && response.content.text) {
      notices.push(response.content.text);
    }
  });

  try {
    await router.routeMessage(buildMessage(content));
  } finally {
    router.stopPeriodicCleanup();
  }

  return { prompt: captured?.prompt, content: captured?.content, notices };
}

describe('convertRemoteContentToBlocks', () => {
  it('turns downloaded imageKey data into an agent image content block', () => {
    const conversion = convertRemoteContentToBlocks({
      type: 'image',
      imageKey: 'img_v2_repro',
      imageBase64: PNG_1X1.toString('base64'),
      imageMediaType: 'image/png',
    });

    expect(conversion.deliverToAgent).toBe(true);
    expect(conversion.blocks).toEqual([
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: PNG_1X1.toString('base64'),
        },
      } satisfies ImageContent,
    ]);
  });

  it('returns an explicit download-failed notice instead of empty blocks', () => {
    const conversion = convertRemoteContentToBlocks({
      type: 'image',
      imageKey: 'img_v2_repro',
    });

    expect(conversion.deliverToAgent).toBe(false);
    expect(conversion.blocks).toEqual([
      {
        type: 'text',
        text: '[图片无法处理: 未能下载 imageKey=img_v2_repro 的图片内容]',
      },
    ]);
  });

  it('delivers file and voice descriptions to the agent', () => {
    expect(
      convertRemoteContentToBlocks({
        type: 'file',
        file: { name: 'report.pdf', key: 'file_v2_repro', size: 42 },
      })
    ).toEqual({
      deliverToAgent: true,
      blocks: [
        {
          type: 'text',
          text: '[用户发送了文件: report.pdf, fileKey=file_v2_repro, size=42]',
        },
      ],
    });

    expect(
      convertRemoteContentToBlocks({
        type: 'voice',
        voice: { key: 'voice_v2_repro', duration: 12 },
      })
    ).toEqual({
      deliverToAgent: true,
      blocks: [
        {
          type: 'text',
          text: '[用户发送了语音消息: voiceKey=voice_v2_repro, duration=12s]',
        },
      ],
    });
  });
});

describe('MessageRouter imageKey routing', () => {
  it('delivers downloaded Feishu images to the agent as image content blocks', async () => {
    const result = await routeAndCapture({
      type: 'image',
      imageKey: 'img_v2_repro',
      imageBase64: PNG_1X1.toString('base64'),
      imageMediaType: 'image/png',
    });

    expect(result.prompt).toBe('请处理上述内容');
    expect(result.content).toEqual([
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: PNG_1X1.toString('base64'),
        },
      },
    ]);
    expect(result.notices).toEqual([]);
  });

  it('does not call the agent with a generic prompt when imageKey download is missing', async () => {
    const result = await routeAndCapture({ type: 'image', imageKey: 'img_v2_repro' });

    expect(result.content).toBeUndefined();
    expect(result.prompt).toBeUndefined();
    expect(result.notices).toEqual(['[图片无法处理: 未能下载 imageKey=img_v2_repro 的图片内容]']);
  });

  it('delivers file and voice messages to the agent instead of a channel-only notice', async () => {
    const fileResult = await routeAndCapture({
      type: 'file',
      file: { name: 'report.pdf', key: 'file_v2_repro', size: 42 },
    });
    const voiceResult = await routeAndCapture({
      type: 'voice',
      voice: { key: 'voice_v2_repro', duration: 12 },
    });

    expect(fileResult.prompt).toBe('请处理上述内容');
    expect(fileResult.content).toEqual([
      {
        type: 'text',
        text: '[用户发送了文件: report.pdf, fileKey=file_v2_repro, size=42]',
      },
    ]);
    expect(fileResult.notices).toEqual([]);

    expect(voiceResult.prompt).toBe('请处理上述内容');
    expect(voiceResult.content).toEqual([
      {
        type: 'text',
        text: '[用户发送了语音消息: voiceKey=voice_v2_repro, duration=12s]',
      },
    ]);
    expect(voiceResult.notices).toEqual([]);
  });
});

describe('RemoteManager startSession content', () => {
  it('passes image content blocks into startSession for the first remote turn', async () => {
    const manager = new RemoteManager();
    const startCalls: Array<{ prompt: string; content?: ContentBlock[] }> = [];

    manager.setAgentExecutor({
      startSession: async (_title, prompt, _cwd, content) => {
        startCalls.push({ prompt, content });
        return { id: 'session-1' } as never;
      },
      continueSession: async () => {},
      stopSession: async () => {},
    });

    const imageContent: ContentBlock[] = [
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: PNG_1X1.toString('base64'),
        },
      },
    ];

    const router = (manager as unknown as { messageRouter: MessageRouter }).messageRouter;
    try {
      await router.routeMessage(
        buildMessage({
          type: 'image',
          imageKey: 'img_v2_repro',
          imageBase64: PNG_1X1.toString('base64'),
          imageMediaType: 'image/png',
        })
      );
    } finally {
      router.stopPeriodicCleanup();
    }

    expect(startCalls).toHaveLength(1);
    expect(startCalls[0]?.prompt).toBe('请处理上述内容');
    expect(startCalls[0]?.content).toEqual(imageContent);
  });
});

describe('FeishuChannel webhook imageKey resolution', () => {
  it('downloads webhook image_key before emitting a remote message', async () => {
    const downloadImage = vi.fn(async () => PNG_1X1);
    const channel = new FeishuChannel(channelConfig(), {
      downloadImage,
    } as unknown as FeishuAPI);

    const received = new Promise<RemoteMessage>((resolve) => {
      channel.onMessage(resolve);
    });

    const body = imageWebhookBody({});

    const result = channel.handleWebhook(signedHeaders(officialSha256Signature(body)), body);
    expect(result).toEqual({ status: 200, data: { code: 0 } });

    const message = await received;
    expect(downloadImage).toHaveBeenCalledWith('img_v2_repro');
    expect(message.content).toEqual({
      type: 'image',
      imageKey: 'img_v2_repro',
      imageBase64: PNG_1X1.toString('base64'),
      imageMediaType: 'image/png',
    });
  });

  it('emits an unresolved imageKey when download fails so the router can notify the user', async () => {
    const channel = new FeishuChannel(channelConfig(), {
      downloadImage: async () => {
        throw new Error('Failed to download image: Not Found');
      },
    } as unknown as FeishuAPI);

    const received = new Promise<RemoteMessage>((resolve) => {
      channel.onMessage(resolve);
    });

    const body = imageWebhookBody({ eventId: 'img-fail' });

    const result = channel.handleWebhook(signedHeaders(officialSha256Signature(body)), body);
    expect(result.status).toBe(200);

    const message = await received;
    expect(message.content).toEqual({ type: 'image', imageKey: 'img_v2_repro' });
  });

  it('resolves WebSocket image payloads with the same contract as webhooks', async () => {
    const downloadImage = vi.fn(async () => PNG_1X1);
    const channel = new FeishuChannel(channelConfig(), {
      downloadImage,
    } as unknown as FeishuAPI);

    const received = new Promise<RemoteMessage>((resolve) => {
      channel.onMessage(resolve);
    });

    await handleWebSocketMessage(channel, {
      messageId: 'om_ws',
      chatId: 'oc_chat',
      chatType: 'p2p',
      senderId: 'ou_user',
      senderType: 'user',
      messageType: 'image',
      content: JSON.stringify({ image_key: 'img_v2_repro' }),
      createTime: '1603977298000',
    });

    const message = await received;
    expect(downloadImage).toHaveBeenCalledWith('img_v2_repro');
    expect(message.content).toEqual({
      type: 'image',
      imageKey: 'img_v2_repro',
      imageBase64: PNG_1X1.toString('base64'),
      imageMediaType: 'image/png',
    });
  });

  it('sends a notice and does not invoke the agent when downloadImage fails', async () => {
    const channel = new FeishuChannel(channelConfig(), {
      downloadImage: async () => {
        throw new Error('Failed to download image: Not Found');
      },
    } as unknown as FeishuAPI);
    const router = new MessageRouter();
    let agentInvoked = false;
    const notices: string[] = [];

    router.setAgentCallback(async () => {
      agentInvoked = true;
    });
    const noticed = new Promise<void>((resolve) => {
      router.onResponse(async (response) => {
        if (response.content.type === 'text' && response.content.text) {
          notices.push(response.content.text);
          resolve();
        }
      });
    });
    channel.onMessage((message) => {
      void router.routeMessage(message);
    });

    const body = imageWebhookBody({ eventId: 'img-download-fail' });
    expect(channel.handleWebhook(signedHeaders(officialSha256Signature(body)), body).status).toBe(
      200
    );

    await noticed;
    expect(agentInvoked).toBe(false);
    expect(notices).toEqual(['[图片无法处理: 未能下载 imageKey=img_v2_repro 的图片内容]']);
    router.stopPeriodicCleanup();
  });

  it('does not download group images that fail the mention gate', async () => {
    const downloadImage = vi.fn(async () => PNG_1X1);
    const channel = new FeishuChannel(channelConfig(), {
      downloadImage,
    } as unknown as FeishuAPI);
    setBotOpenId(channel, 'ou_bot');

    const received = new Promise<RemoteMessage>((resolve) => {
      channel.onMessage(resolve);
    });

    const body = imageWebhookBody({
      chatType: 'group',
      eventId: 'img-group-unmentioned',
      mentions: [{ id: { open_id: 'ou_other' }, key: '@_user_1' }],
    });
    channel.handleWebhook(signedHeaders(officialSha256Signature(body)), body);

    const message = await received;
    expect(downloadImage).not.toHaveBeenCalled();
    expect(message.isGroup).toBe(true);
    expect(message.isMentioned).toBe(false);
    expect(message.content).toEqual({ type: 'image', imageKey: 'img_v2_repro' });
  });

  it('downloads group images after the bot is mentioned', async () => {
    const downloadImage = vi.fn(async () => PNG_1X1);
    const channel = new FeishuChannel(channelConfig(), {
      downloadImage,
    } as unknown as FeishuAPI);
    setBotOpenId(channel, 'ou_bot');

    const received = new Promise<RemoteMessage>((resolve) => {
      channel.onMessage(resolve);
    });

    const body = imageWebhookBody({
      chatType: 'group',
      eventId: 'img-group-mentioned',
      mentions: [{ id: { open_id: 'ou_bot' }, key: '@_user_1' }],
    });
    channel.handleWebhook(signedHeaders(officialSha256Signature(body)), body);

    const message = await received;
    expect(downloadImage).toHaveBeenCalledWith('img_v2_repro');
    expect(message.isMentioned).toBe(true);
    expect(message.content.imageBase64).toBe(PNG_1X1.toString('base64'));
  });

  it('tolerates WebSocket mentions: undefined without throwing and still gates groups', async () => {
    const downloadImage = vi.fn(async () => PNG_1X1);
    const channel = new FeishuChannel(channelConfig(), {
      downloadImage,
    } as unknown as FeishuAPI);
    setBotOpenId(channel, 'ou_bot');

    const dmReceived = new Promise<RemoteMessage>((resolve) => {
      channel.onMessage(resolve);
    });

    await expect(
      handleWebSocketMessage(channel, {
        messageId: 'om_ws_undef',
        chatId: 'oc_chat',
        chatType: 'p2p',
        senderId: 'ou_user',
        senderType: 'user',
        messageType: 'image',
        content: JSON.stringify({ image_key: 'img_v2_repro' }),
        createTime: '1603977298000',
        mentions: undefined,
      })
    ).resolves.toBeUndefined();

    const dmMessage = await dmReceived;
    expect(dmMessage.isMentioned).toBe(false);
    expect(downloadImage).toHaveBeenCalledTimes(1);

    downloadImage.mockClear();
    const groupReceived = new Promise<RemoteMessage>((resolve) => {
      channel.onMessage(resolve);
    });

    await expect(
      handleWebSocketMessage(channel, {
        messageId: 'om_ws_group_undef',
        chatId: 'oc_group',
        chatType: 'group',
        senderId: 'ou_user',
        senderType: 'user',
        messageType: 'image',
        content: JSON.stringify({ image_key: 'img_v2_repro' }),
        createTime: '1603977298000',
        mentions: undefined,
      })
    ).resolves.toBeUndefined();

    const groupMessage = await groupReceived;
    expect(groupMessage.isGroup).toBe(true);
    expect(groupMessage.isMentioned).toBe(false);
    expect(downloadImage).not.toHaveBeenCalled();
  });
});
