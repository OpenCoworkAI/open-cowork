/**
 * Message Router
 * 消息路由器：将远程消息路由到 Agent，将 Agent 响应路由回 Channel
 */

import { log, logError } from '../utils/logger';
import type {
  RemoteMessage,
  RemoteResponse,
  RemoteSessionMapping,
  ChannelType,
} from './types';
import type { Message, ContentBlock, TextContent } from '../../renderer/types/index';

// Callback type for sending responses back to channels
type ResponseCallback = (response: RemoteResponse) => Promise<void>;

// Callback type for agent execution
type AgentCallback = (
  sessionId: string,
  prompt: string,
  content: ContentBlock[],
  workingDirectory: string | undefined,
  channelType: string,
  channelId: string,
  onMessage: (message: Message) => void,
  onPartial: (delta: string) => void,
) => Promise<void>;

/**
 * Message queue item
 */
interface QueuedMessage {
  message: RemoteMessage;
  addedAt: number;
}

export class MessageRouter {
  // Session mappings: channelType:channelId[:userId] -> session
  private sessionMappings: Map<string, RemoteSessionMapping> = new Map();
  
  // Message queues per session
  private messageQueues: Map<string, QueuedMessage[]> = new Map();
  
  // Processing flags
  private processingSession: Set<string> = new Set();
  
  // Callbacks
  private responseCallback?: ResponseCallback;
  private agentCallback?: AgentCallback;
  
  // Accumulated response text per session (for streaming)
  private responseBuffers: Map<string, string> = new Map();
  
  // Session ID generator
  private sessionIdCounter: number = 0;
  
  // Default working directory for new sessions
  private defaultWorkingDirectory?: string;
  
  constructor() {}
  
  /**
   * Set default working directory for remote sessions
   */
  setDefaultWorkingDirectory(dir: string | undefined): void {
    this.defaultWorkingDirectory = dir;
    log('[MessageRouter] Default working directory set to:', dir || '(none)');
  }
  
  /**
   * Set response callback (called when agent produces a response)
   */
  onResponse(callback: ResponseCallback): void {
    this.responseCallback = callback;
  }
  
  /**
   * Set agent callback (called to execute agent)
   */
  setAgentCallback(callback: AgentCallback): void {
    this.agentCallback = callback;
  }
  
  /**
   * Route incoming message to agent
   */
  async routeMessage(message: RemoteMessage): Promise<void> {
    const sessionKey = this.getSessionKey(message);
    
    log('[MessageRouter] Routing message:', {
      sessionKey,
      messageId: message.id,
      contentType: message.content.type,
    });
    
    // Get or create session mapping
    let mapping = this.sessionMappings.get(sessionKey);
    if (!mapping) {
      mapping = this.createSessionMapping(message, sessionKey);
      this.sessionMappings.set(sessionKey, mapping);
      log('[MessageRouter] Created new session mapping:', mapping);
    }
    
    // Update last active time
    mapping.lastActiveAt = Date.now();
    
    // Add to queue
    this.addToQueue(mapping.sessionId, message);
    
    // Process queue
    await this.processQueue(mapping.sessionId);
  }
  
  /**
   * Get session key from message
   * For DMs: channelType:userId
   * For groups: channelType:channelId
   */
  private getSessionKey(message: RemoteMessage): string {
    if (message.isGroup) {
      return `${message.channelType}:group:${message.channelId}`;
    } else {
      return `${message.channelType}:dm:${message.sender.id}`;
    }
  }
  
  /**
   * Create new session mapping
   */
  private createSessionMapping(message: RemoteMessage, _key: string): RemoteSessionMapping {
    const sessionId = this.generateSessionId();
    
    return {
      channelType: message.channelType,
      channelId: message.channelId,
      userId: message.isGroup ? undefined : message.sender.id,
      sessionId,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };
  }
  
  /**
   * Generate unique session ID for remote sessions
   */
  private generateSessionId(): string {
    this.sessionIdCounter++;
    return `remote-${Date.now()}-${this.sessionIdCounter}`;
  }
  
  /**
   * Add message to queue
   */
  private addToQueue(sessionId: string, message: RemoteMessage): void {
    if (!this.messageQueues.has(sessionId)) {
      this.messageQueues.set(sessionId, []);
    }
    
    this.messageQueues.get(sessionId)!.push({
      message,
      addedAt: Date.now(),
    });
    
    log('[MessageRouter] Added message to queue:', {
      sessionId,
      queueLength: this.messageQueues.get(sessionId)!.length,
    });
  }
  
  /**
   * Process message queue for a session
   */
  private async processQueue(sessionId: string): Promise<void> {
    // Check if already processing
    if (this.processingSession.has(sessionId)) {
      log('[MessageRouter] Session already processing, will process later:', sessionId);
      return;
    }
    
    const queue = this.messageQueues.get(sessionId);
    if (!queue || queue.length === 0) {
      return;
    }
    
    // Mark as processing
    this.processingSession.add(sessionId);
    
    try {
      while (queue.length > 0) {
        const item = queue.shift()!;
        await this.processMessage(sessionId, item.message);
      }
    } finally {
      this.processingSession.delete(sessionId);
    }
  }
  
  /**
   * Process a single message
   */
  private async processMessage(sessionId: string, message: RemoteMessage): Promise<void> {
    if (!this.agentCallback) {
      logError('[MessageRouter] Agent callback not set');
      return;
    }
    
    log('[MessageRouter] Processing message:', {
      sessionId,
      messageId: message.id,
    });
    
    // Convert remote content to agent content blocks
    const content = this.convertToContentBlocks(message);
    const { prompt, cwd } = this.extractPromptAndCwd(message);
    
    // Get session mapping to update/get working directory
    const sessionKey = this.getSessionKey(message);
    const mapping = this.sessionMappings.get(sessionKey);
    
    // Handle !cd command (change directory without executing prompt)
    if (!prompt && cwd) {
      if (mapping) {
        mapping.workingDirectory = cwd;
        log('[MessageRouter] Updated session working directory:', cwd);
      }
      // Send confirmation
      await this.sendCwdChangeResponse(message, cwd);
      return;
    }
    
    // Determine working directory for this message
    // Priority: 1. [cwd:] prefix in message, 2. session's current cwd, 3. default cwd
    let workingDirectory = cwd;
    if (!workingDirectory && mapping?.workingDirectory) {
      workingDirectory = mapping.workingDirectory;
    }
    if (!workingDirectory) {
      workingDirectory = this.defaultWorkingDirectory;
    }
    
    // Update session's working directory if specified in message
    if (cwd && mapping) {
      mapping.workingDirectory = cwd;
    }
    
    log('[MessageRouter] Using working directory:', workingDirectory || '(default)');
    
    // Initialize response buffer
    this.responseBuffers.set(sessionId, '');
    
    try {
      // Call agent with working directory and channel info
      await this.agentCallback(
        sessionId,
        prompt,
        content,
        workingDirectory,
        message.channelType, // Pass channel type for routing
        message.channelId,   // Pass channel ID for routing
        // onMessage callback
        (agentMessage) => {
          this.handleAgentMessage(sessionId, message, agentMessage);
        },
        // onPartial callback
        (delta) => {
          this.handlePartialResponse(sessionId, message, delta);
        },
      );
      
      // Send final accumulated response
      await this.sendFinalResponse(sessionId, message);
      
    } catch (error) {
      logError('[MessageRouter] Error processing message:', error);
      
      // Send error response
      await this.sendErrorResponse(message, error);
    } finally {
      this.responseBuffers.delete(sessionId);
    }
  }
  
  /**
   * Send confirmation for working directory change
   */
  private async sendCwdChangeResponse(originalMessage: RemoteMessage, newCwd: string): Promise<void> {
    if (!this.responseCallback) {
      return;
    }
    
    const response: RemoteResponse = {
      channelType: originalMessage.channelType,
      channelId: originalMessage.channelId,
      content: {
        type: 'text',
        text: `✅ 工作目录已切换到: ${newCwd}`,
      },
      replyTo: originalMessage.id,
    };
    
    await this.responseCallback(response);
  }
  
  /**
   * Convert remote message content to agent content blocks
   */
  private convertToContentBlocks(message: RemoteMessage): ContentBlock[] {
    const blocks: ContentBlock[] = [];
    
    switch (message.content.type) {
      case 'text':
        if (message.content.text) {
          blocks.push({
            type: 'text',
            text: message.content.text,
          } as TextContent);
        }
        break;
        
      case 'image':
        // TODO: Download image and convert to base64
        if (message.content.imageUrl) {
          // For now, add as text description
          blocks.push({
            type: 'text',
            text: `[用户发送了一张图片: ${message.content.imageUrl}]`,
          } as TextContent);
        }
        break;
        
      case 'file':
        if (message.content.file) {
          blocks.push({
            type: 'text',
            text: `[用户发送了文件: ${message.content.file.name}]`,
          } as TextContent);
        }
        break;
        
      case 'voice':
        // TODO: Transcribe voice message
        blocks.push({
          type: 'text',
          text: '[用户发送了语音消息]',
        } as TextContent);
        break;
        
      default:
        blocks.push({
          type: 'text',
          text: message.content.text || '[不支持的消息类型]',
        } as TextContent);
    }
    
    return blocks;
  }
  
  /**
   * Extract prompt text and working directory from message
   * Supports [cwd:路径] prefix to specify working directory
   * Also supports !cd 路径 command to change working directory
   */
  private extractPromptAndCwd(message: RemoteMessage): { prompt: string; cwd?: string } {
    let cwd: string | undefined;
    
    if (message.content.type === 'text' && message.content.text) {
      // Remove @mention if present
      let text = message.content.text;
      
      // Remove common mention patterns
      text = text.replace(/@\S+\s*/g, '').trim();
      
      // Check for [cwd:路径] prefix
      // Supports both [cwd:路径] and [cwd: 路径] formats
      const cwdMatch = text.match(/^\[cwd:\s*([^\]]+)\]\s*/i);
      if (cwdMatch) {
        cwd = cwdMatch[1].trim();
        text = text.slice(cwdMatch[0].length).trim();
        log('[MessageRouter] Extracted cwd from message:', cwd);
      }
      
      // Check for !cd command (sets session cwd without executing a prompt)
      const cdMatch = text.match(/^!cd\s+(.+)$/i);
      if (cdMatch) {
        cwd = cdMatch[1].trim();
        return { prompt: '', cwd };
      }
      
      return { prompt: text || '你好', cwd };
    }
    
    return { prompt: '请处理上述内容', cwd };
  }
  
  /**
   * Handle agent message (complete message)
   */
  private handleAgentMessage(sessionId: string, _originalMessage: RemoteMessage, agentMessage: Message): void {
    // Extract text from agent message
    const textContent = agentMessage.content.find(c => c.type === 'text') as TextContent | undefined;
    
    if (textContent?.text) {
      // Accumulate response
      const buffer = this.responseBuffers.get(sessionId) || '';
      this.responseBuffers.set(sessionId, buffer + textContent.text);
    }
    
    log('[MessageRouter] Received agent message:', {
      sessionId,
      role: agentMessage.role,
      contentTypes: agentMessage.content.map(c => c.type),
    });
  }
  
  /**
   * Handle partial response (streaming)
   */
  private handlePartialResponse(sessionId: string, _originalMessage: RemoteMessage, delta: string): void {
    // Accumulate partial response
    const buffer = this.responseBuffers.get(sessionId) || '';
    this.responseBuffers.set(sessionId, buffer + delta);
  }
  
  /**
   * Send final accumulated response
   */
  private async sendFinalResponse(sessionId: string, originalMessage: RemoteMessage): Promise<void> {
    const responseText = this.responseBuffers.get(sessionId);
    
    if (!responseText || !this.responseCallback) {
      return;
    }
    
    log('[MessageRouter] Sending final response:', {
      sessionId,
      textLength: responseText.length,
    });
    
    const response: RemoteResponse = {
      channelType: originalMessage.channelType,
      channelId: originalMessage.channelId,
      content: {
        type: 'markdown',
        markdown: responseText,
      },
      replyTo: originalMessage.id,
    };
    
    await this.responseCallback(response);
  }
  
  /**
   * Send error response
   */
  private async sendErrorResponse(originalMessage: RemoteMessage, error: unknown): Promise<void> {
    if (!this.responseCallback) {
      return;
    }
    
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    const response: RemoteResponse = {
      channelType: originalMessage.channelType,
      channelId: originalMessage.channelId,
      content: {
        type: 'text',
        text: `❌ 处理消息时发生错误: ${errorMessage}`,
      },
      replyTo: originalMessage.id,
    };
    
    await this.responseCallback(response);
  }
  
  /**
   * Get active session count
   */
  getActiveSessionCount(): number {
    return this.sessionMappings.size;
  }
  
  /**
   * Get session mapping by key
   */
  getSessionMapping(channelType: ChannelType, channelId: string, userId?: string): RemoteSessionMapping | undefined {
    const key = userId 
      ? `${channelType}:dm:${userId}`
      : `${channelType}:group:${channelId}`;
    return this.sessionMappings.get(key);
  }
  
  /**
   * Get all session mappings
   */
  getAllSessionMappings(): RemoteSessionMapping[] {
    return Array.from(this.sessionMappings.values());
  }
  
  /**
   * Clear session mapping
   */
  clearSession(sessionId: string): boolean {
    for (const [key, mapping] of this.sessionMappings) {
      if (mapping.sessionId === sessionId) {
        this.sessionMappings.delete(key);
        this.messageQueues.delete(sessionId);
        this.responseBuffers.delete(sessionId);
        this.processingSession.delete(sessionId);
        log('[MessageRouter] Cleared session:', sessionId);
        return true;
      }
    }
    return false;
  }
  
  /**
   * Clear all sessions
   */
  clearAllSessions(): void {
    this.sessionMappings.clear();
    this.messageQueues.clear();
    this.responseBuffers.clear();
    this.processingSession.clear();
    log('[MessageRouter] Cleared all sessions');
  }
  
  /**
   * Cleanup stale sessions (older than specified time)
   */
  cleanupStaleSessions(maxAge: number = 24 * 60 * 60 * 1000): number {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, mapping] of this.sessionMappings) {
      if (now - mapping.lastActiveAt > maxAge) {
        this.sessionMappings.delete(key);
        this.messageQueues.delete(mapping.sessionId);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      log('[MessageRouter] Cleaned up stale sessions:', cleaned);
    }
    
    return cleaned;
  }
}
