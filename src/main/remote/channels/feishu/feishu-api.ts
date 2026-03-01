/**
 * Feishu API Client
 * 飞书开放平台 API 封装
 */

import { log, logError } from '../../../utils/logger';

const FEISHU_API_BASE = 'https://open.feishu.cn/open-apis';

interface TokenResponse {
  code: number;
  msg: string;
  tenant_access_token?: string;
  expire: number;
}

interface BotInfoResponse {
  code: number;
  msg: string;
  bot?: {
    activate_status: number;
    app_name: string;
    avatar_url: string;
    ip_white_list: string[];
    open_id: string;
  };
}

interface SendMessageResponse {
  code: number;
  msg: string;
  data?: {
    message_id: string;
  };
}

export class FeishuAPI {
  private appId: string;
  private appSecret: string;
  private accessToken?: string;
  private tokenExpireAt?: number;
  
  constructor(appId: string, appSecret: string) {
    this.appId = appId;
    this.appSecret = appSecret;
  }
  
  /**
   * Get tenant access token
   */
  async refreshToken(): Promise<string> {
    // Check if token is still valid
    if (this.accessToken && this.tokenExpireAt && Date.now() < this.tokenExpireAt - 60000) {
      return this.accessToken;
    }
    
    log('[FeishuAPI] Refreshing access token...');
    
    const response = await fetch(`${FEISHU_API_BASE}/auth/v3/tenant_access_token/internal`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        app_id: this.appId,
        app_secret: this.appSecret,
      }),
    });
    
    const data: TokenResponse = await response.json();
    
    if (data.code !== 0 || !data.tenant_access_token) {
      throw new Error(`Failed to get access token: ${data.msg}`);
    }
    
    this.accessToken = data.tenant_access_token;
    this.tokenExpireAt = Date.now() + data.expire * 1000;
    
    log('[FeishuAPI] Access token refreshed, expires in', data.expire, 'seconds');
    
    return this.accessToken;
  }
  
  /**
   * Get bot info
   */
  async getBotInfo(): Promise<{ open_id: string; app_name: string; avatar_url: string }> {
    const token = await this.refreshToken();
    
    const response = await fetch(`${FEISHU_API_BASE}/bot/v3/info`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });
    
    const data: BotInfoResponse = await response.json();
    
    if (data.code !== 0 || !data.bot) {
      throw new Error(`Failed to get bot info: ${data.msg}`);
    }
    
    return {
      open_id: data.bot.open_id,
      app_name: data.bot.app_name,
      avatar_url: data.bot.avatar_url,
    };
  }
  
  /**
   * Send message to chat
   */
  async sendMessage(
    chatId: string,
    msgType: string,
    content: any,
    replyMessageId?: string
  ): Promise<string> {
    const token = await this.refreshToken();
    
    const body: any = {
      receive_id: chatId,
      msg_type: msgType,
      content: JSON.stringify(content),
    };
    
    // Add reply info if replying to a message
    if (replyMessageId) {
      body.reply_in_thread = false;
    }
    
    log('[FeishuAPI] Sending message:', {
      chatId,
      msgType,
      contentLength: body.content.length,
    });
    
    const response = await fetch(
      `${FEISHU_API_BASE}/im/v1/messages?receive_id_type=chat_id`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify(body),
      }
    );
    
    const data: SendMessageResponse = await response.json();
    
    if (data.code !== 0) {
      logError('[FeishuAPI] Send message failed:', data);
      throw new Error(`Failed to send message: ${data.msg} (code: ${data.code})`);
    }
    
    log('[FeishuAPI] Message sent:', data.data?.message_id);
    
    return data.data?.message_id || '';
  }
  
  /**
   * Reply to a message
   */
  async replyMessage(
    messageId: string,
    msgType: string,
    content: any
  ): Promise<string> {
    const token = await this.refreshToken();
    
    const body = {
      msg_type: msgType,
      content: JSON.stringify(content),
    };
    
    log('[FeishuAPI] Replying to message:', messageId);
    
    const response = await fetch(
      `${FEISHU_API_BASE}/im/v1/messages/${messageId}/reply`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify(body),
      }
    );
    
    const data: SendMessageResponse = await response.json();
    
    if (data.code !== 0) {
      logError('[FeishuAPI] Reply message failed:', data);
      throw new Error(`Failed to reply message: ${data.msg}`);
    }
    
    return data.data?.message_id || '';
  }
  
  /**
   * Upload image to Feishu
   */
  async uploadImage(imageBuffer: Buffer): Promise<string> {
    const token = await this.refreshToken();
    
    // Create form data
    const formData = new FormData();
    formData.append('image_type', 'message');
    formData.append('image', new Blob([new Uint8Array(imageBuffer)]), 'image.png');
    
    const response = await fetch(`${FEISHU_API_BASE}/im/v1/images`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
      body: formData,
    });
    
    const data = await response.json();
    
    if (data.code !== 0) {
      throw new Error(`Failed to upload image: ${data.msg}`);
    }
    
    return data.data.image_key;
  }
  
  /**
   * Upload file to Feishu
   */
  async uploadFile(fileBuffer: Buffer, fileName: string, fileType: string): Promise<string> {
    const token = await this.refreshToken();
    
    const formData = new FormData();
    formData.append('file_type', fileType);
    formData.append('file_name', fileName);
    formData.append('file', new Blob([new Uint8Array(fileBuffer)]), fileName);
    
    const response = await fetch(`${FEISHU_API_BASE}/im/v1/files`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
      body: formData,
    });
    
    const data = await response.json();
    
    if (data.code !== 0) {
      throw new Error(`Failed to upload file: ${data.msg}`);
    }
    
    return data.data.file_key;
  }
  
  /**
   * Download image from Feishu
   */
  async downloadImage(imageKey: string): Promise<Buffer> {
    const token = await this.refreshToken();
    
    const response = await fetch(
      `${FEISHU_API_BASE}/im/v1/images/${imageKey}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      }
    );
    
    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.statusText}`);
    }
    
    const buffer = await response.arrayBuffer();
    return Buffer.from(buffer);
  }
  
  /**
   * Download file from Feishu
   */
  async downloadFile(fileKey: string): Promise<Buffer> {
    const token = await this.refreshToken();
    
    const response = await fetch(
      `${FEISHU_API_BASE}/im/v1/files/${fileKey}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      }
    );
    
    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.statusText}`);
    }
    
    const buffer = await response.arrayBuffer();
    return Buffer.from(buffer);
  }
  
  /**
   * Get chat info
   */
  async getChatInfo(chatId: string): Promise<any> {
    const token = await this.refreshToken();
    
    const response = await fetch(
      `${FEISHU_API_BASE}/im/v1/chats/${chatId}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      }
    );
    
    const data = await response.json();
    
    if (data.code !== 0) {
      throw new Error(`Failed to get chat info: ${data.msg}`);
    }
    
    return data.data;
  }
  
  /**
   * Get user info
   */
  async getUserInfo(userId: string, idType: 'open_id' | 'user_id' = 'open_id'): Promise<any> {
    const token = await this.refreshToken();
    
    const response = await fetch(
      `${FEISHU_API_BASE}/contact/v3/users/${userId}?user_id_type=${idType}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      }
    );
    
    const data = await response.json();
    
    if (data.code !== 0) {
      throw new Error(`Failed to get user info: ${data.msg}`);
    }
    
    return data.data.user;
  }
  
  /**
   * Send typing indicator (Feishu doesn't have native support, but we can use this for other purposes)
   */
  async sendTypingIndicator(_chatId: string): Promise<void> {
    // Feishu doesn't support typing indicators
    // This is a no-op placeholder
  }
  
  /**
   * Create interactive card message
   */
  createCard(options: {
    title?: string;
    content: string;
    buttons?: Array<{
      text: string;
      value: string;
      type?: 'primary' | 'default' | 'danger';
    }>;
  }): any {
    const elements: any[] = [
      {
        tag: 'markdown',
        content: options.content,
      },
    ];
    
    if (options.buttons && options.buttons.length > 0) {
      elements.push({
        tag: 'action',
        actions: options.buttons.map(btn => ({
          tag: 'button',
          text: {
            tag: 'plain_text',
            content: btn.text,
          },
          type: btn.type || 'default',
          value: { action: btn.value },
        })),
      });
    }
    
    const card: any = {
      config: {
        wide_screen_mode: true,
      },
      elements,
    };
    
    if (options.title) {
      card.header = {
        title: {
          tag: 'plain_text',
          content: options.title,
        },
      };
    }
    
    return card;
  }
}
