/**
 * Feishu (飞书) Channel
 * 实现飞书机器人的消息接收和发送
 */

import * as crypto from 'crypto';
import * as dns from 'dns';
import { promisify } from 'util';
import { ChannelBase, withRetry } from '../channel-base';
import { log, logError, logWarn } from '../../../utils/logger';
import type {
  FeishuChannelConfig,
  RemoteMessage,
  RemoteResponse,
  RemoteContent,
  RemoteResponseContent,
} from '../../types';
import { FeishuAPI } from './feishu-api';
import { FeishuWSClient } from './feishu-ws-client';

export class FeishuChannel extends ChannelBase {
  readonly type = 'feishu' as const;

  private config: FeishuChannelConfig;
  private api: FeishuAPI;
  private wsClient?: FeishuWSClient; // WebSocket client for long polling

  // Bot info
  private botOpenId?: string;
  private botName?: string;

  constructor(config: FeishuChannelConfig) {
    super();
    this.config = config;
    this.api = new FeishuAPI(config.appId, config.appSecret);
  }

  /**
   * Start the channel
   */
  async start(): Promise<void> {
    if (this._connected) {
      logWarn('[Feishu] Channel already started');
      return;
    }

    this.logStatus('Starting channel...');

    try {
      // Get access token
      await this.api.refreshToken();

      // Get bot info
      const botInfo = await this.api.getBotInfo();
      this.botOpenId = botInfo.open_id;
      this.botName = botInfo.app_name;

      log('[Feishu] Bot info:', { openId: this.botOpenId, name: this.botName });

      // Start message receiving
      if (this.config.useWebSocket) {
        await this.startWebSocketMode();
      } else {
        this.logStatus('Using webhook mode - waiting for incoming webhooks');
      }

      this._connected = true;
      this.logStatus('Channel started successfully');
    } catch (error) {
      logError('[Feishu] Failed to start channel:', error);
      this._connected = false;
      throw error;
    }
  }

  /**
   * Stop the channel
   */
  async stop(): Promise<void> {
    if (!this._connected) {
      return;
    }

    this.logStatus('Stopping channel...');

    // Close WebSocket if active
    if (this.wsClient) {
      try {
        // Remove event listeners before stopping to prevent state issues
        this.wsClient.removeAllListeners();
        await this.wsClient.stop();
      } catch (e) {
        // Ignore
      }
      this.wsClient = undefined;
    }

    this._connected = false;
    this.logStatus('Channel stopped');
  }

  /**
   * Send response to Feishu
   */
  async send(response: RemoteResponse): Promise<void> {
    if (!this._connected) {
      throw new Error('Channel not connected');
    }

    const { channelId, content, replyTo } = response;

    log('[Feishu] Sending message:', {
      channelId,
      contentType: content.type,
      hasReplyTo: !!replyTo,
    });

    try {
      await withRetry(
        async () => {
          await this.sendMessage(channelId, content, replyTo);
        },
        {
          maxRetries: 3,
          delayMs: 1000,
          onRetry: (attempt, error) => {
            logWarn(`[Feishu] Send retry ${attempt}:`, error.message);
          },
        }
      );

      log('[Feishu] Message sent successfully');
    } catch (error) {
      logError('[Feishu] Failed to send message:', error);
      throw error;
    }
  }

  /**
   * Verify webhook signature from X-Lark-Signature header
   */
  private verifyWebhookSignature(
    timestamp: string,
    nonce: string,
    body: string,
    signature: string
  ): boolean {
    const verificationToken = this.config?.verificationToken;
    if (!verificationToken) return false; // Reject — verificationToken is required for webhook mode

    try {
      const content = timestamp + nonce + verificationToken + body;
      const computedSignature = crypto
        .createHmac('sha256', verificationToken)
        .update(content)
        .digest('hex');
      const sigBuf = Buffer.from(signature, 'hex');
      const computedBuf = Buffer.from(computedSignature, 'hex');
      if (sigBuf.length !== computedBuf.length) return false;
      return crypto.timingSafeEqual(sigBuf, computedBuf);
    } catch {
      return false;
    }
  }

  /**
   * Handle incoming webhook request
   */
  handleWebhook(
    _headers: Record<string, string>,
    body: string
  ): { status: number; data: Record<string, unknown> } {
    log('[Feishu] Received webhook request');

    // Verify webhook signature — always required
    const signature = _headers['x-lark-signature'];
    const timestamp = _headers['x-lark-request-timestamp'] || '';
    const nonce = _headers['x-lark-request-nonce'] || '';
    if (!signature) {
      logWarn('[Feishu] Webhook request rejected: missing X-Lark-Signature header');
      return { status: 403, data: { error: 'Missing signature' } };
    }
    if (!this.verifyWebhookSignature(timestamp, nonce, body, signature)) {
      logWarn('[Feishu] Webhook signature verification failed');
      return { status: 403, data: { error: 'Invalid signature' } };
    }

    try {
      const data = JSON.parse(body);
      log('[Feishu] Webhook data:', JSON.stringify(data, null, 2));

      // Handle URL verification challenge
      if (data.type === 'url_verification') {
        log('[Feishu] URL verification challenge');
        return {
          status: 200,
          data: { challenge: data.challenge },
        };
      }

      // Handle v2 schema (飞书新版事件格式)
      if (data.schema === '2.0') {
        log('[Feishu] Processing v2 schema event');
        const eventType = data.header?.event_type;
        log('[Feishu] Event type:', eventType);

        if (eventType === 'im.message.receive_v1') {
          this.handleMessageEvent(data.event);
        }

        return { status: 200, data: { code: 0 } };
      }

      // Handle v1 schema (飞书旧版事件格式)
      if (data.event) {
        log('[Feishu] Processing v1 schema event');
        const eventType = data.header?.event_type || data.event?.type;
        log('[Feishu] Event type:', eventType);

        if (eventType === 'im.message.receive_v1' || eventType === 'message') {
          this.handleMessageEvent(data.event);
        }

        return { status: 200, data: { code: 0 } };
      }

      // Verify request if encryption is enabled
      if (this.config.encryptKey && data.encrypt) {
        log('[Feishu] Encrypted message received, decryption not yet implemented');
        // TODO: Implement message decryption
        return { status: 501, data: { code: 1, msg: 'Encrypted webhook not yet supported' } };
      }

      log('[Feishu] Unknown webhook format, returning OK');
      return { status: 200, data: { code: 0 } };
    } catch (error) {
      logError('[Feishu] Webhook handling error:', error);
      return { status: 500, data: { error: 'Internal error' } };
    }
  }

  /**
   * Start WebSocket mode (长连接)
   */
  private async startWebSocketMode(): Promise<void> {
    log('[Feishu] Starting WebSocket long connection mode...');

    // Create WebSocket client
    this.wsClient = new FeishuWSClient({
      appId: this.config.appId,
      appSecret: this.config.appSecret,
      logLevel: 'info',
    });

    // Handle incoming messages
    log('[Feishu] Registering message listener on wsClient');
    this.wsClient.on('message', (data: Record<string, unknown>) => {
      try {
        log('[Feishu] Received message via WebSocket:', data);

        // Skip bot's own messages
        if (data.senderType === 'bot') {
          return;
        }

        // Build remote message
        // Use chatId as channelId - Feishu API needs chat_id to send messages
        const rawText = String(data.text || '');
        // Strip only the bot's own @mention placeholder from the text
        const cleanedText = this.stripBotMentionFromText(rawText, {
          mentions: Array.isArray(data.mentions) ? data.mentions : [],
        });
        const remoteMessage: RemoteMessage = {
          id: String(data.messageId || ''),
          channelType: 'feishu',
          channelId: String(data.chatId || ''), // Use actual chat_id for sending messages
          sender: {
            id: String(data.senderId || ''),
            name: '', // Will be filled if needed
            isBot: false,
          },
          content: {
            type: 'text',
            text: cleanedText,
          },
          timestamp: parseInt(String(data.createTime || '0')) || Date.now(),
          isGroup: data.chatType === 'group',
          isMentioned:
            (Array.isArray(data.mentions) &&
              data.mentions.some((m: Record<string, unknown>) => {
                const mid = m.id as Record<string, unknown> | undefined;
                return mid?.open_id === this.botOpenId;
              })) ||
            false,
          raw: {
            chatId: data.chatId,
            chatType: data.chatType,
            messageType: data.messageType,
            senderId: data.senderId,
            content: data.content,
          },
        };

        // Emit message to handler (same as webhook mode)
        this.emitMessage(remoteMessage);
      } catch (error) {
        logError('[Feishu] Error processing WebSocket message:', error);
      }
    });

    // Handle connection events
    this.wsClient.on('connected', () => {
      log('[Feishu] WebSocket connected');
      this._connected = true;
    });

    this.wsClient.on('disconnected', () => {
      logWarn('[Feishu] WebSocket disconnected');
      this._connected = false;
    });

    this.wsClient.on('error', (error: Error) => {
      logError('[Feishu] WebSocket error:', error);
    });

    // Start connection
    await this.wsClient.start();
  }

  /**
   * Handle incoming message event
   */
  private handleMessageEvent(event: Record<string, unknown>): void {
    try {
      const message = event.message as Record<string, unknown>;
      const sender = event.sender as Record<string, unknown>;

      // Skip bot's own messages
      const senderId = sender.sender_id as Record<string, unknown> | undefined;
      if (senderId?.open_id === this.botOpenId) {
        return;
      }

      // Parse message content
      const content = this.parseMessageContent(message);
      if (!content) {
        logWarn('[Feishu] Unable to parse message content');
        return;
      }

      // Strip only the bot's own @mention from text content (not all @mentions)
      if (content.type === 'text' && content.text) {
        content.text = this.stripBotMentionFromText(content.text, message);
      }

      // Check if mentioned
      const isMentioned = this.checkMentioned(message);

      // Build remote message
      const remoteMessage: RemoteMessage = {
        id: String(message.message_id || ''),
        channelType: 'feishu',
        channelId: String(message.chat_id || ''),
        sender: {
          id: String(senderId?.open_id || senderId?.user_id || 'unknown'),
          name: senderId?.name as string | undefined,
          isBot: sender.sender_type === 'bot',
        },
        content,
        timestamp: parseInt(String(message.create_time || '0')) || Date.now(),
        isGroup: message.chat_type === 'group',
        isMentioned,
        raw: event,
      };

      // Emit message
      this.emitMessage(remoteMessage);
    } catch (error) {
      logError('[Feishu] Error handling message event:', error);
    }
  }

  /**
   * Strip only the bot's own @mention placeholder from message text.
   * Feishu encodes @mentions as @_user_N keys in the text.
   * We identify the bot's key via the mentions array and only remove that one.
   */
  private stripBotMentionFromText(text: string, message: Record<string, unknown>): string {
    if (!this.botOpenId || !Array.isArray(message.mentions)) {
      return text;
    }
    let result = text;
    for (const m of message.mentions as Record<string, unknown>[]) {
      const mid = m.id as Record<string, unknown> | undefined;
      if (mid?.open_id === this.botOpenId && typeof m.key === 'string') {
        // Remove this specific mention key and trailing space
        result = result.replace(
          new RegExp(m.key.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&') + '\\s*', 'g'),
          ''
        );
      }
    }
    return result.trim();
  }

  /**
   * Parse message content based on type
   */
  private parseMessageContent(message: Record<string, unknown>): RemoteContent | null {
    const msgType = message.message_type as string;

    try {
      const contentJson = JSON.parse(message.content as string) as Record<string, unknown>;

      switch (msgType) {
        case 'text':
          return {
            type: 'text',
            text: contentJson.text as string | undefined,
          };

        case 'image':
          return {
            type: 'image',
            imageKey: contentJson.image_key as string | undefined,
          };

        case 'file':
          return {
            type: 'file',
            file: {
              name: contentJson.file_name as string,
              key: contentJson.file_key as string | undefined,
              size: contentJson.file_size as number | undefined,
            },
          };

        case 'audio':
          return {
            type: 'voice',
            voice: {
              key: contentJson.file_key as string | undefined,
              duration: contentJson.duration as number | undefined,
            },
          };

        case 'post':
          // Rich text post
          return {
            type: 'rich_text',
            text: this.extractTextFromPost(contentJson),
            richText: contentJson,
          };

        case 'interactive':
          return {
            type: 'interactive',
            interactive: contentJson,
          };

        default:
          log('[Feishu] Unknown message type:', msgType);
          return {
            type: 'text',
            text: `[Unsupported message type: ${msgType}]`,
          };
      }
    } catch (error) {
      logError('[Feishu] Failed to parse message content:', error);
      return null;
    }
  }

  /**
   * Extract plain text from rich text post
   */
  private extractTextFromPost(post: Record<string, unknown>): string {
    const texts: string[] = [];

    try {
      const zhCn = post.zh_cn as Record<string, unknown> | undefined;
      const enUs = post.en_us as Record<string, unknown> | undefined;
      const rawContent = post.content || zhCn?.content || enUs?.content || [];
      const content = Array.isArray(rawContent) ? (rawContent as unknown[][]) : [];

      for (const paragraph of content) {
        for (const el of paragraph) {
          const element = el as Record<string, unknown>;
          if (element.tag === 'text') {
            texts.push(String(element.text || ''));
          } else if (element.tag === 'at') {
            texts.push(`@${element.user_name || element.user_id || ''}`);
          }
        }
        texts.push('\n');
      }
    } catch (error) {
      logError('[Feishu] Failed to extract text from post:', error);
    }

    return texts.join('').trim();
  }

  /**
   * Check if the bot was mentioned in the message
   */
  private checkMentioned(message: Record<string, unknown>): boolean {
    if (!message.mentions || !this.botOpenId) {
      return false;
    }

    return (
      Array.isArray(message.mentions) &&
      message.mentions.some((m: Record<string, unknown>) => {
        const mid = m.id as Record<string, unknown> | undefined;
        return mid?.open_id === this.botOpenId || m.key === '@_all';
      })
    );
  }

  /**
   * Send message to Feishu
   */
  private async sendMessage(
    chatId: string,
    content: RemoteResponseContent,
    replyTo?: string
  ): Promise<void> {
    let msgType: string;
    let msgContent: Record<string, unknown>;

    switch (content.type) {
      case 'text':
        msgType = 'text';
        msgContent = { text: content.text };
        break;

      case 'markdown':
        // Feishu doesn't support native markdown, convert to interactive card
        msgType = 'interactive';
        msgContent = this.markdownToCard(content.markdown ?? '');
        break;

      case 'image':
        if (content.image?.key) {
          msgType = 'image';
          msgContent = { image_key: content.image.key };
        } else if (content.image?.base64 || content.image?.url) {
          // Upload image first
          const imageKey = await this.uploadImage(content.image);
          msgType = 'image';
          msgContent = { image_key: imageKey };
        } else {
          throw new Error('Invalid image content');
        }
        break;

      case 'card':
        msgType = 'interactive';
        msgContent = content.card as Record<string, unknown>;
        break;

      default:
        // Default to text
        msgType = 'text';
        msgContent = { text: content.text || String(content) };
    }

    // Use WebSocket client if available, otherwise use API
    if (this.config.useWebSocket && this.wsClient) {
      // For WebSocket mode, use the SDK client to send messages
      if (msgType === 'interactive') {
        // Send interactive card as-is
        if (replyTo) {
          await this.wsClient.replyMessage(replyTo, JSON.stringify(msgContent), 'interactive');
        } else {
          await this.wsClient.sendMessage(chatId, 'chat_id', msgContent, 'interactive');
        }
      } else {
        // For text messages
        const textContent =
          (typeof msgContent.text === 'string' ? msgContent.text : undefined) || content.text || '';

        // Split long messages
        if (textContent.length > 4000) {
          const chunks = this.splitMessage(textContent, 4000);
          for (const chunk of chunks) {
            if (replyTo) {
              await this.wsClient.replyMessage(replyTo, chunk, 'text');
            } else {
              await this.wsClient.sendMessage(chatId, 'chat_id', chunk, 'text');
            }
            await new Promise((resolve) => setTimeout(resolve, 200));
          }
        } else {
          if (replyTo) {
            await this.wsClient.replyMessage(replyTo, textContent, 'text');
          } else {
            await this.wsClient.sendMessage(chatId, 'chat_id', textContent, 'text');
          }
        }
      }
    } else {
      // Use API mode
      // Split long messages
      const msgText = typeof msgContent.text === 'string' ? msgContent.text : undefined;
      if (msgType === 'text' && msgText && msgText.length > 4000) {
        const chunks = this.splitMessage(msgText, 4000);
        for (const chunk of chunks) {
          await this.api.sendMessage(chatId, 'text', { text: chunk }, replyTo);
          // Small delay between chunks
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      } else {
        await this.api.sendMessage(chatId, msgType, msgContent, replyTo);
      }
    }
  }

  /**
   * Convert markdown to Feishu interactive card
   */
  private markdownToCard(markdown: string): Record<string, unknown> {
    // Simple markdown to card conversion
    // Feishu cards support a subset of markdown in certain elements

    return {
      config: {
        wide_screen_mode: true,
      },
      elements: [
        {
          tag: 'markdown',
          content: this.sanitizeMarkdownForFeishu(markdown),
        },
      ],
    };
  }

  /**
   * Sanitize markdown for Feishu compatibility
   */
  private sanitizeMarkdownForFeishu(markdown: string): string {
    // Feishu markdown supports:
    // - **bold**, *italic*, ~~strikethrough~~
    // - [link](url)
    // - `code`, ```code block```
    // - > quote
    // - Lists

    // Remove unsupported elements
    let sanitized = markdown;

    // Limit length
    if (sanitized.length > 10000) {
      sanitized = sanitized.substring(0, 10000) + '\n\n... (Content too long, truncated)';
    }

    return sanitized;
  }

  /**
   * Upload image to Feishu
   */
  private async uploadImage(image: { url?: string; base64?: string }): Promise<string> {
    if (image.url) {
      // Validate URL before fetching to prevent SSRF
      const parsed = new URL(image.url);
      if (parsed.protocol !== 'https:') {
        throw new Error('Only HTTPS image URLs allowed');
      }

      // Resolve the hostname to catch DNS-rebinding and block private IPs
      const lookup = promisify(dns.lookup);
      let resolvedIp: string;
      try {
        const result = await lookup(parsed.hostname);
        resolvedIp = result.address;
      } catch {
        throw new Error('Failed to resolve image URL hostname');
      }

      const isPrivateIp = (ip: string): boolean =>
        /^(127\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|169\.254\.|0\.)/.test(ip) ||
        /^::1$/.test(ip) ||
        /^[fF][cCdD][0-9a-fA-F]{2}:/.test(ip) ||
        // IPv4-mapped IPv6 addresses (::ffff:192.168.x.x etc.)
        /^::ffff:(127\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|169\.254\.|0\.)/.test(ip);

      if (isPrivateIp(resolvedIp) || parsed.hostname === 'localhost') {
        throw new Error('Internal URLs not allowed');
      }
      // Download and upload
      const response = await fetch(image.url);
      const buffer = await response.arrayBuffer();
      return await this.api.uploadImage(Buffer.from(buffer));
    } else if (image.base64) {
      const buffer = Buffer.from(image.base64, 'base64');
      return await this.api.uploadImage(buffer);
    }

    throw new Error('No image data provided');
  }
}
