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
  RemoteResponseContent,
} from '../../types';
import { AESCipher } from '@larksuiteoapi/node-sdk';
import { FeishuAPI } from './feishu-api';
import { FeishuWSClient } from './feishu-ws-client';
import { parseFeishuMessageContent, resolveFeishuRemoteContent } from './feishu-message-content';

function normalizeFeishuMentions(mentions: unknown): Record<string, unknown>[] {
  if (!Array.isArray(mentions)) {
    return [];
  }
  return mentions.filter(
    (item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object'
  );
}

export class FeishuChannel extends ChannelBase {
  readonly type = 'feishu' as const;

  private config: FeishuChannelConfig;
  private api: FeishuAPI;
  private wsClient?: FeishuWSClient; // WebSocket client for long polling

  // Bot info
  private botOpenId?: string;
  private botName?: string;

  constructor(config: FeishuChannelConfig, api?: FeishuAPI) {
    super();
    this.config = config;
    this.api = api ?? new FeishuAPI(config.appId, config.appSecret);
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
    // Official Feishu/Lark event callback signature:
    // SHA256(timestamp + nonce + encryptKey + rawBody)
    // See larksuite/node-sdk dispatcher/request-handle.ts checkIsEventValidated.
    const encryptKey = this.config?.encryptKey;
    if (!encryptKey) return false;

    try {
      const content = timestamp + nonce + encryptKey + body;
      const computedSignature = crypto.createHash('sha256').update(content).digest('hex');
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
      const envelope = JSON.parse(body) as unknown;
      if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
        return { status: 400, data: { error: 'Invalid JSON' } };
      }

      const unwrapped = this.unwrapWebhookPayload(envelope as Record<string, unknown>);
      if (!unwrapped.ok) {
        return { status: unwrapped.status, data: { error: unwrapped.error } };
      }

      return this.dispatchWebhookPayload(unwrapped.payload);
    } catch (error) {
      if (error instanceof SyntaxError) {
        return { status: 400, data: { error: 'Invalid JSON' } };
      }
      logError('[Feishu] Webhook handling error');
      return { status: 500, data: { error: 'Internal error' } };
    }
  }

  /**
   * Decrypt `{ encrypt }` envelopes with AESCipher (AES-256-CBC, key = SHA256(encryptKey)).
   * Signature verification already used the raw outer body; this runs next so encrypted
   * URL challenges and events share the plaintext handlers.
   */
  private unwrapWebhookPayload(
    envelope: Record<string, unknown>
  ): { ok: true; payload: Record<string, unknown> } | { ok: false; status: number; error: string } {
    if (envelope.encrypt === undefined) {
      return { ok: true, payload: envelope };
    }
    if (typeof envelope.encrypt !== 'string' || envelope.encrypt.length === 0) {
      logWarn('[Feishu] Encrypted webhook envelope is invalid');
      return { ok: false, status: 400, error: 'Invalid encrypted payload' };
    }

    const encryptKey = this.config.encryptKey;
    if (!encryptKey) {
      logWarn('[Feishu] Encrypted webhook received without encryptKey configured');
      return { ok: false, status: 400, error: 'Invalid encrypted payload' };
    }

    try {
      const plaintext = new AESCipher(encryptKey).decrypt(envelope.encrypt);
      const payload = JSON.parse(plaintext) as unknown;
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        logWarn('[Feishu] Encrypted webhook plaintext is not a JSON object');
        return { ok: false, status: 400, error: 'Invalid encrypted payload' };
      }
      return { ok: true, payload: payload as Record<string, unknown> };
    } catch {
      logWarn('[Feishu] Encrypted webhook decryption failed');
      return { ok: false, status: 400, error: 'Invalid encrypted payload' };
    }
  }

  private dispatchWebhookPayload(data: Record<string, unknown>): {
    status: number;
    data: Record<string, unknown>;
  } {
    // Handle URL verification challenge. Signature uses encryptKey; the
    // body token must match Verification Token when one is configured.
    if (data.type === 'url_verification') {
      const expectedToken = this.config.verificationToken;
      if (expectedToken && data.token !== expectedToken) {
        logWarn('[Feishu] URL verification token mismatch');
        return { status: 403, data: { error: 'Invalid verification token' } };
      }
      log('[Feishu] URL verification challenge');
      return {
        status: 200,
        data: { challenge: data.challenge },
      };
    }

    const header = data.header as { event_type?: string } | undefined;
    const event = data.event as Record<string, unknown> | undefined;

    // Handle v2 schema (飞书新版事件格式)
    if (data.schema === '2.0') {
      log('[Feishu] Processing v2 schema event');
      const eventType = header?.event_type;
      log('[Feishu] Event type:', eventType);

      if (eventType === 'im.message.receive_v1' && event) {
        this.handleMessageEvent(event);
      }

      return { status: 200, data: { code: 0 } };
    }

    // Handle v1 schema (飞书旧版事件格式)
    if (event) {
      log('[Feishu] Processing v1 schema event');
      const eventType = header?.event_type || (event.type as string | undefined);
      log('[Feishu] Event type:', eventType);

      if ((eventType === 'im.message.receive_v1' || eventType === 'message') && event) {
        this.handleMessageEvent(event);
      }

      return { status: 200, data: { code: 0 } };
    }

    log('[Feishu] Unknown webhook format, returning OK');
    return { status: 200, data: { code: 0 } };
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
      void this.handleWebSocketMessage(data);
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
   * Handle incoming webhook message event
   */
  private handleMessageEvent(event: Record<string, unknown>): void {
    void this.handleMessageEventAsync(event);
  }

  private async handleMessageEventAsync(event: Record<string, unknown>): Promise<void> {
    try {
      const message = event.message as Record<string, unknown> | undefined;
      const sender = event.sender as Record<string, unknown> | undefined;
      if (!message || !sender) {
        logWarn('[Feishu] Unable to parse message event');
        return;
      }

      const senderId = sender.sender_id as Record<string, unknown> | undefined;
      if (senderId?.open_id === this.botOpenId) {
        return;
      }

      await this.emitIncomingFeishuMessage({
        id: String(message.message_id || ''),
        channelId: String(message.chat_id || ''),
        senderId: String(senderId?.open_id || senderId?.user_id || 'unknown'),
        senderName: senderId?.name as string | undefined,
        isBot: sender.sender_type === 'bot',
        timestamp: parseInt(String(message.create_time || '0')) || Date.now(),
        isGroup: message.chat_type === 'group',
        mentions: message.mentions,
        parseSource: message,
        raw: event,
      });
    } catch (error) {
      logError('[Feishu] Error handling message event:', error);
    }
  }

  /**
   * Handle inbound WebSocket payloads with the same content contract as webhooks.
   */
  private async handleWebSocketMessage(data: Record<string, unknown>): Promise<void> {
    try {
      log('[Feishu] Received message via WebSocket:', data);

      if (data.senderType === 'bot') {
        return;
      }

      await this.emitIncomingFeishuMessage({
        id: String(data.messageId || ''),
        channelId: String(data.chatId || ''),
        senderId: String(data.senderId || ''),
        senderName: '',
        isBot: false,
        timestamp: parseInt(String(data.createTime || '0')) || Date.now(),
        isGroup: data.chatType === 'group',
        mentions: data.mentions,
        parseSource: {
          message_type: data.messageType,
          content: data.content,
          mentions: data.mentions,
        },
        raw: {
          chatId: data.chatId,
          chatType: data.chatType,
          messageType: data.messageType,
          senderId: data.senderId,
          content: data.content,
        },
      });
    } catch (error) {
      logError('[Feishu] Error processing WebSocket message:', error);
    }
  }

  private async emitIncomingFeishuMessage(params: {
    id: string;
    channelId: string;
    senderId: string;
    senderName?: string;
    isBot: boolean;
    timestamp: number;
    isGroup: boolean;
    mentions: unknown;
    parseSource: Record<string, unknown>;
    raw: unknown;
  }): Promise<void> {
    const parsed = parseFeishuMessageContent(params.parseSource);
    if (!parsed) {
      logWarn('[Feishu] Unable to parse message content');
      return;
    }

    const mentions = normalizeFeishuMentions(params.mentions);
    const isMentioned = this.checkMentioned({ mentions });
    const shouldProcess = this.shouldProcessMessage({
      isGroup: params.isGroup,
      isMentioned,
      channelId: params.channelId,
    });

    if (parsed.type === 'text' && parsed.text) {
      parsed.text = this.stripBotMentionFromText(parsed.text, { mentions });
    }

    // Download imageKey only after the mention/eligibility gate. Unmentioned
    // group images are still emitted (cheap) so Gateway auth/pairing can run,
    // but we skip Feishu image downloads that would be discarded.
    const content = shouldProcess
      ? await resolveFeishuRemoteContent(parsed, (imageKey) => this.api.downloadImage(imageKey))
      : parsed;

    const remoteMessage: RemoteMessage = {
      id: params.id,
      channelType: 'feishu',
      channelId: params.channelId,
      sender: {
        id: params.senderId,
        name: params.senderName,
        isBot: params.isBot,
      },
      content,
      timestamp: params.timestamp,
      isGroup: params.isGroup,
      isMentioned,
      raw: params.raw,
    };

    this.emitMessage(remoteMessage);
  }

  /**
   * Group messages require @mention unless this chat's settings say otherwise.
   * DMs are always eligible. Matches Gateway's default "require mention in groups".
   */
  private shouldProcessMessage(params: {
    isGroup: boolean;
    isMentioned: boolean;
    channelId: string;
  }): boolean {
    if (!params.isGroup) {
      return true;
    }
    if (params.isMentioned) {
      return true;
    }
    const groupSettings = this.config.groups?.[params.channelId];
    const requireMention =
      groupSettings?.requireMention ?? this.config.defaultGroupSettings?.requireMention ?? true;
    return requireMention === false;
  }

  /**
   * Strip only the bot's own @mention placeholder from message text.
   * Feishu encodes @mentions as @_user_N keys in the text.
   * We identify the bot's key via the mentions array and only remove that one.
   */
  private stripBotMentionFromText(text: string, message: Record<string, unknown>): string {
    const mentions = normalizeFeishuMentions(message.mentions);
    if (!this.botOpenId || mentions.length === 0) {
      return text;
    }
    let result = text;
    for (const m of mentions) {
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
   * Check if the bot was mentioned in the message
   */
  private checkMentioned(message: Record<string, unknown>): boolean {
    if (!this.botOpenId) {
      return false;
    }

    return normalizeFeishuMentions(message.mentions).some((m) => {
      const mid = m.id as Record<string, unknown> | undefined;
      return mid?.open_id === this.botOpenId || m.key === '@_all';
    });
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
      sanitized = sanitized.substring(0, 10000) + '\n\n... (内容过长已截断)';
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
