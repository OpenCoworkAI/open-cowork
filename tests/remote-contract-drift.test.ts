import { describe, expect, it } from 'vitest';

import {
  isSafeRemoteAutoApprovedTool,
  normalizeRemoteToolNameForAutoApprove,
} from '../src/main/remote/remote-manager';
import { MessageRouter } from '../src/main/remote/message-router';
import type { RemoteContent, RemoteMessage } from '../src/main/remote/types';
import type { ContentBlock } from '../src/renderer/types';

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
  prompt: string;
  content: ContentBlock[];
}> {
  const router = new MessageRouter();
  let captured:
    | {
        prompt: string;
        content: ContentBlock[];
      }
    | undefined;

  router.setAgentCallback(async (_sessionId, prompt, blocks) => {
    captured = { prompt, content: blocks };
  });

  try {
    await router.routeMessage(buildMessage(content));
  } finally {
    router.stopPeriodicCleanup();
  }

  expect(captured).toBeDefined();
  return captured!;
}

describe('remote contract drift guards', () => {
  it('normalizes display and canonical tool names before auto-approve checks', () => {
    expect(normalizeRemoteToolNameForAutoApprove('mcp__Chrome__navigate_page')).toBe(
      'navigate_page'
    );
    expect(isSafeRemoteAutoApprovedTool('Read')).toBe(true);
    expect(isSafeRemoteAutoApprovedTool('read')).toBe(true);
    expect(isSafeRemoteAutoApprovedTool('navigate_page')).toBe(true);
    expect(isSafeRemoteAutoApprovedTool('mcp__Chrome__navigate_page')).toBe(true);
    expect(isSafeRemoteAutoApprovedTool('evaluate_script')).toBe(false);
    expect(isSafeRemoteAutoApprovedTool('Task')).toBe(false);
  });

  it('preserves Feishu image keys when routing image messages to the agent', async () => {
    const result = await routeAndCapture({ type: 'image', imageKey: 'img_v2_repro' });

    expect(result.prompt).toBe('请处理上述内容');
    expect(result.content).toEqual([
      {
        type: 'text',
        text: '[用户发送了一张图片: imageKey=img_v2_repro]',
      },
    ]);
  });

  it('preserves image URLs and image keys when both are present', async () => {
    const result = await routeAndCapture({
      type: 'image',
      imageUrl: 'https://example.test/image.png',
      imageKey: 'img_v2_repro',
    });

    expect(result.content).toEqual([
      {
        type: 'text',
        text: '[用户发送了一张图片: https://example.test/image.png, imageKey=img_v2_repro]',
      },
    ]);
  });

  it('preserves remote attachment keys for file and voice messages', async () => {
    const fileResult = await routeAndCapture({
      type: 'file',
      file: {
        name: 'report.pdf',
        key: 'file_v2_repro',
        size: 42,
        mimeType: 'application/pdf',
      },
    });
    const voiceResult = await routeAndCapture({
      type: 'voice',
      voice: {
        key: 'voice_v2_repro',
        duration: 12,
      },
    });

    expect(fileResult.content).toEqual([
      {
        type: 'text',
        text: '[用户发送了文件: report.pdf, fileKey=file_v2_repro, size=42, mimeType=application/pdf]',
      },
    ]);
    expect(voiceResult.content).toEqual([
      {
        type: 'text',
        text: '[用户发送了语音消息: voiceKey=voice_v2_repro, duration=12s]',
      },
    ]);
  });
});
