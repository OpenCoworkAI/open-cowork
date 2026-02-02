/**
 * Feishu (飞书) Channel
 * 实现飞书机器人的消息接收和发送
 */

import { ChannelBase, withRetry } from '../channel-base';
import { log, logError, logWarn } from '../../../utils/logger';
import type {
  FeishuChannelConfig,
  RemoteMessage,
  RemoteResponse,
  RemoteContent,
} from '../../types';
import { FeishuAPI } from './feishu-api';
import { FeishuWSClient } from './feishu-ws-client';

export class FeishuChannel extends ChannelBase {
  readonly type = 'feishu' as const;
  
  private config: FeishuChannelConfig;
  private api: FeishuAPI;
  private wsClient?: any;  // WebSocket client for long polling
  private webhookHandler?: (data: any) => void;
  
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
   * Handle incoming webhook request
   */
  handleWebhook(headers: Record<string, string>, body: string): { status: number; data: any } {
    log('[Feishu] Received webhook request');
    
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
    this.wsClient.on('message', (data: any) => {
      log('[Feishu] Received message via WebSocket:', data);
      
      // Skip bot's own messages
      if (data.senderType === 'bot') {
        return;
      }
      
      // Build remote message
      // Use chatId as channelId - Feishu API needs chat_id to send messages
      const remoteMessage: RemoteMessage = {
        channelType: 'feishu',
        channelId: data.chatId,  // Use actual chat_id for sending messages
        messageId: data.messageId,
        sender: {
          id: data.senderId,
          name: '', // Will be filled if needed
          type: 'user',
        },
        content: {
          type: 'text',
          text: data.text || '',
          raw: data.content,
        },
        timestamp: parseInt(data.createTime) || Date.now(),
        metadata: {
          chatId: data.chatId,
          chatType: data.chatType,
          messageType: data.messageType,
          senderId: data.senderId,  // Store senderId for reference
        },
      };
      
      // Emit message to handler (same as webhook mode)
      this.emitMessage(remoteMessage);
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
  private handleMessageEvent(event: any): void {
    try {
      const message = event.message;
      const sender = event.sender;
      
      // Skip bot's own messages
      if (sender.sender_id?.open_id === this.botOpenId) {
        return;
      }
      
      // Parse message content
      const content = this.parseMessageContent(message);
      if (!content) {
        logWarn('[Feishu] Unable to parse message content');
        return;
      }
      
      // Check if mentioned
      const isMentioned = this.checkMentioned(message);
      
      // Build remote message
      const remoteMessage: RemoteMessage = {
        id: message.message_id,
        channelType: 'feishu',
        channelId: message.chat_id,
        sender: {
          id: sender.sender_id?.open_id || sender.sender_id?.user_id || 'unknown',
          name: sender.sender_id?.name,
          isBot: sender.sender_type === 'bot',
        },
        content,
        timestamp: parseInt(message.create_time) || Date.now(),
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
   * Parse message content based on type
   */
  private parseMessageContent(message: any): RemoteContent | null {
    const msgType = message.message_type;
    
    try {
      const contentJson = JSON.parse(message.content);
      
      switch (msgType) {
        case 'text':
          return {
            type: 'text',
            text: contentJson.text,
          };
          
        case 'image':
          return {
            type: 'image',
            imageKey: contentJson.image_key,
          };
          
        case 'file':
          return {
            type: 'file',
            file: {
              name: contentJson.file_name,
              key: contentJson.file_key,
              size: contentJson.file_size,
            },
          };
          
        case 'audio':
          return {
            type: 'voice',
            voice: {
              key: contentJson.file_key,
              duration: contentJson.duration,
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
            text: `[不支持的消息类型: ${msgType}]`,
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
  private extractTextFromPost(post: any): string {
    const texts: string[] = [];
    
    try {
      const content = post.content || post.zh_cn?.content || post.en_us?.content || [];
      
      for (const paragraph of content) {
        for (const element of paragraph) {
          if (element.tag === 'text') {
            texts.push(element.text);
          } else if (element.tag === 'at') {
            texts.push(`@${element.user_name || element.user_id}`);
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
  private checkMentioned(message: any): boolean {
    if (!message.mentions || !this.botOpenId) {
      return false;
    }
    
    return message.mentions.some((m: any) => 
      m.id?.open_id === this.botOpenId || m.key === '@_all'
    );
  }
  
  /**
   * Send message to Feishu
   */
  private async sendMessage(chatId: string, content: any, replyTo?: string): Promise<void> {
    let msgType: string;
    let msgContent: any;
    
    switch (content.type) {
      case 'text':
        msgType = 'text';
        msgContent = { text: content.text };
        break;
        
      case 'markdown':
        // Feishu doesn't support native markdown, convert to interactive card
        msgType = 'interactive';
        msgContent = this.markdownToCard(content.markdown);
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
        msgContent = content.card;
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
        const textContent = msgContent.text || content.text || String(content);
        
        // Split long messages
        if (textContent.length > 4000) {
          const chunks = this.splitMessage(textContent, 4000);
          for (const chunk of chunks) {
            if (replyTo) {
              await this.wsClient.replyMessage(replyTo, chunk, 'text');
            } else {
              await this.wsClient.sendMessage(chatId, 'chat_id', chunk, 'text');
            }
            await new Promise(resolve => setTimeout(resolve, 200));
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
      if (msgType === 'text' && msgContent.text && msgContent.text.length > 4000) {
        const chunks = this.splitMessage(msgContent.text, 4000);
        for (const chunk of chunks) {
          await this.api.sendMessage(chatId, 'text', { text: chunk }, replyTo);
          // Small delay between chunks
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      } else {
        await this.api.sendMessage(chatId, msgType, msgContent, replyTo);
      }
    }
  }
  
  /**
   * Convert markdown to Feishu interactive card
   */
  private markdownToCard(markdown: string): any {
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
