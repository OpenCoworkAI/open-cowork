/**
 * Feishu WebSocket Long Connection Client
 * 飞书长连接客户端 - 无需公网 IP 或 ngrok
 */

import * as Lark from '@larksuiteoapi/node-sdk';
import { EventEmitter } from 'events';
import { log, logError, logWarn } from '../../../utils/logger';

export interface FeishuWSConfig {
  appId: string;
  appSecret: string;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}

export interface FeishuMessage {
  messageId: string;
  chatId: string;
  chatType: 'p2p' | 'group';
  senderId: string;
  senderType: 'user' | 'bot';
  messageType: string;
  content: string;
  createTime: string;
}

/**
 * Feishu WebSocket Client
 * Uses Feishu SDK's long connection mode
 */
export class FeishuWSClient extends EventEmitter {
  private config: FeishuWSConfig;
  private client: Lark.Client | null = null;
  private wsClient: Lark.WSClient | null = null;
  private connected: boolean = false;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;

  constructor(config: FeishuWSConfig) {
    super();
    this.config = config;
  }

  /**
   * Start the WebSocket connection
   */
  async start(): Promise<void> {
    if (this.connected) {
      logWarn('[FeishuWS] Already connected');
      return;
    }

    const { appId, appSecret } = this.config;

    if (!appId || !appSecret) {
      throw new Error('Feishu appId and appSecret are required');
    }

    log('[FeishuWS] Starting long connection...');

    try {
      // Create API client for sending messages
      this.client = new Lark.Client({
        appId,
        appSecret,
        disableTokenCache: false,
      });

      // Create WebSocket client for receiving messages
      const loggerLevel = this.getLoggerLevel();
      
      this.wsClient = new Lark.WSClient({
        appId,
        appSecret,
        loggerLevel,
      });

      // Start WebSocket connection with event dispatcher
      await this.wsClient.start({
        eventDispatcher: new Lark.EventDispatcher({}).register({
          // Handle im.message.receive_v1 event (receive message v2.0)
          'im.message.receive_v1': async (data: any) => {
            try {
              await this.handleMessageReceive(data);
            } catch (err) {
              logError('[FeishuWS] Error handling message:', err);
            }
          },
        }),
      });

      this.connected = true;
      this.reconnectAttempts = 0;
      log('[FeishuWS] Long connection established successfully');
      this.emit('connected');

    } catch (error) {
      logError('[FeishuWS] Failed to start:', error);
      this.connected = false;
      this.emit('error', error);
      
      // Try to reconnect
      this.scheduleReconnect();
    }
  }

  /**
   * Stop the WebSocket connection
   */
  async stop(): Promise<void> {
    log('[FeishuWS] Stopping long connection...');
    
    // Note: The Lark SDK doesn't expose a direct stop method
    // Setting to null will allow garbage collection
    this.wsClient = null;
    this.client = null;
    this.connected = false;
    
    this.emit('disconnected');
    log('[FeishuWS] Long connection stopped');
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Send a message
   * @param content - For text: plain text string. For interactive: card object (will be JSON stringified)
   */
  async sendMessage(
    receiveId: string,
    receiveIdType: 'chat_id' | 'open_id' | 'user_id' | 'union_id',
    content: string | object,
    msgType: 'text' | 'interactive' = 'text'
  ): Promise<boolean> {
    if (!this.client) {
      logError('[FeishuWS] Client not initialized');
      return false;
    }

    try {
      let messageContent: string;
      
      if (msgType === 'text') {
        // Text message: wrap in { text: ... }
        messageContent = JSON.stringify({ text: content });
      } else if (msgType === 'interactive') {
        // Interactive card: content should be the card object
        messageContent = typeof content === 'string' ? content : JSON.stringify(content);
      } else {
        messageContent = JSON.stringify({ text: String(content) });
      }

      log('[FeishuWS] Sending message:', { msgType, contentLength: messageContent.length });

      const response = await this.client.im.v1.message.create({
        params: {
          receive_id_type: receiveIdType,
        },
        data: {
          receive_id: receiveId,
          content: messageContent,
          msg_type: msgType,
        },
      });

      if (response.code === 0) {
        log('[FeishuWS] Message sent successfully');
        return true;
      } else {
        logError('[FeishuWS] Failed to send message:', response.msg);
        return false;
      }
    } catch (error) {
      logError('[FeishuWS] Error sending message:', error);
      return false;
    }
  }

  /**
   * Reply to a message
   * @param content - For text: plain text. For interactive: JSON string of card object
   */
  async replyMessage(
    messageId: string,
    content: string,
    msgType: 'text' | 'interactive' = 'text'
  ): Promise<boolean> {
    if (!this.client) {
      logError('[FeishuWS] Client not initialized');
      return false;
    }

    try {
      let messageContent: string;
      
      if (msgType === 'text') {
        messageContent = JSON.stringify({ text: content });
      } else if (msgType === 'interactive') {
        // Interactive card: content is already JSON string
        messageContent = content;
      } else {
        messageContent = JSON.stringify({ text: content });
      }

      log('[FeishuWS] Replying to message:', { msgType, contentLength: messageContent.length });

      const response = await this.client.im.v1.message.reply({
        path: {
          message_id: messageId,
        },
        data: {
          content: messageContent,
          msg_type: msgType,
        },
      });

      if (response.code === 0) {
        log('[FeishuWS] Reply sent successfully');
        return true;
      } else {
        logError('[FeishuWS] Failed to reply:', response.msg);
        return false;
      }
    } catch (error) {
      logError('[FeishuWS] Error replying:', error);
      return false;
    }
  }

  /**
   * Handle incoming message event
   */
  private async handleMessageReceive(data: any): Promise<void> {
    // Skip if connection has been stopped (old instance receiving messages)
    if (!this.connected) {
      log('[FeishuWS] Ignoring message - connection stopped');
      return;
    }
    
    log('[FeishuWS] Received message event:', JSON.stringify(data, null, 2));

    const message = data.message;
    if (!message) {
      logWarn('[FeishuWS] No message in event data');
      return;
    }

    // Parse message
    const feishuMessage: FeishuMessage = {
      messageId: message.message_id,
      chatId: message.chat_id,
      chatType: message.chat_type === 'p2p' ? 'p2p' : 'group',
      senderId: data.sender?.sender_id?.open_id || data.sender?.sender_id?.user_id || '',
      senderType: data.sender?.sender_type === 'user' ? 'user' : 'bot',
      messageType: message.message_type,
      content: message.content,
      createTime: message.create_time,
    };

    // Parse content based on message type
    let textContent = '';
    try {
      if (message.message_type === 'text') {
        const parsed = JSON.parse(message.content);
        textContent = parsed.text || '';
      } else {
        // For other types, just use raw content
        textContent = message.content;
      }
    } catch {
      textContent = message.content;
    }

    log('[FeishuWS] Parsed message:', {
      from: feishuMessage.senderId,
      chatType: feishuMessage.chatType,
      text: textContent,
    });

    // Emit message event
    const listenerCount = this.listenerCount('message');
    log('[FeishuWS] Emitting message event, listener count:', listenerCount);
    this.emit('message', {
      ...feishuMessage,
      text: textContent,
    });
    log('[FeishuWS] Message event emitted');
  }

  /**
   * Schedule reconnection
   */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logError('[FeishuWS] Max reconnect attempts reached');
      this.emit('reconnectFailed');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    
    log(`[FeishuWS] Scheduling reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`);
    
    setTimeout(() => {
      this.start().catch((err) => {
        logError('[FeishuWS] Reconnect failed:', err);
      });
    }, delay);
  }

  /**
   * Get Lark SDK logger level
   */
  private getLoggerLevel(): Lark.LoggerLevel {
    switch (this.config.logLevel) {
      case 'debug':
        return Lark.LoggerLevel.debug;
      case 'info':
        return Lark.LoggerLevel.info;
      case 'warn':
        return Lark.LoggerLevel.warn;
      case 'error':
        return Lark.LoggerLevel.error;
      default:
        return Lark.LoggerLevel.info;
    }
  }
}
