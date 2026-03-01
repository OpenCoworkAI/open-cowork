/**
 * Channel Base Class
 * 所有 Channel 的基类，定义通用接口和方法
 */

import { EventEmitter } from 'events';
import { log, logError, logWarn } from '../../utils/logger';
import type {
  IChannel,
  ChannelType,
  RemoteMessage,
  RemoteResponse,
  RemoteResponseContent,
} from '../types';

export abstract class ChannelBase extends EventEmitter implements IChannel {
  abstract readonly type: ChannelType;
  
  protected _connected: boolean = false;
  protected messageHandler?: (message: RemoteMessage) => void;
  protected errorHandler?: (error: Error) => void;
  
  get connected(): boolean {
    return this._connected;
  }
  
  /**
   * Start the channel
   * Subclasses must implement this method
   */
  abstract start(): Promise<void>;
  
  /**
   * Stop the channel
   * Subclasses must implement this method
   */
  abstract stop(): Promise<void>;
  
  /**
   * Send a response to the channel
   * Subclasses must implement this method
   */
  abstract send(response: RemoteResponse): Promise<void>;
  
  /**
   * Set message handler
   */
  onMessage(handler: (message: RemoteMessage) => void): void {
    this.messageHandler = handler;
  }
  
  /**
   * Set error handler
   */
  onError(handler: (error: Error) => void): void {
    this.errorHandler = handler;
  }
  
  /**
   * Emit a received message to the handler
   */
  protected emitMessage(message: RemoteMessage): void {
    log(`[${this.type}] Received message:`, {
      id: message.id,
      channelId: message.channelId,
      sender: message.sender.id,
      type: message.content.type,
      isGroup: message.isGroup,
      isMentioned: message.isMentioned,
    });
    
    if (this.messageHandler) {
      try {
        this.messageHandler(message);
      } catch (error) {
        logError(`[${this.type}] Error in message handler:`, error);
        this.emitError(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }
  
  /**
   * Emit an error to the handler
   */
  protected emitError(error: Error): void {
    logError(`[${this.type}] Channel error:`, error);
    
    if (this.errorHandler) {
      this.errorHandler(error);
    }
    
    this.emit('error', error);
  }
  
  /**
   * Log channel status
   */
  protected logStatus(status: string, details?: Record<string, unknown>): void {
    log(`[${this.type}] ${status}`, details || '');
  }
  
  /**
   * Format response content for logging (truncate long text)
   */
  protected formatContentForLog(content: RemoteResponseContent): string {
    if (content.text) {
      const text = content.text.length > 100 
        ? content.text.substring(0, 100) + '...' 
        : content.text;
      return `text: "${text}"`;
    }
    if (content.markdown) {
      const md = content.markdown.length > 100 
        ? content.markdown.substring(0, 100) + '...' 
        : content.markdown;
      return `markdown: "${md}"`;
    }
    if (content.image) {
      return `image: ${content.image.url || content.image.key || '[base64]'}`;
    }
    if (content.file) {
      return `file: ${content.file.name}`;
    }
    if (content.card) {
      return `card: [interactive]`;
    }
    return `type: ${content.type}`;
  }
  
  /**
   * Split long message into chunks
   * Useful for platforms with message length limits
   */
  protected splitMessage(text: string, maxLength: number = 4000): string[] {
    if (text.length <= maxLength) {
      return [text];
    }
    
    const chunks: string[] = [];
    let remaining = text;
    
    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        chunks.push(remaining);
        break;
      }
      
      // Try to split at a natural break point
      let splitIndex = maxLength;
      
      // Look for paragraph break
      const paragraphBreak = remaining.lastIndexOf('\n\n', maxLength);
      if (paragraphBreak > maxLength * 0.5) {
        splitIndex = paragraphBreak + 2;
      } else {
        // Look for line break
        const lineBreak = remaining.lastIndexOf('\n', maxLength);
        if (lineBreak > maxLength * 0.5) {
          splitIndex = lineBreak + 1;
        } else {
          // Look for sentence end
          const sentenceEnd = remaining.lastIndexOf('。', maxLength);
          const periodEnd = remaining.lastIndexOf('. ', maxLength);
          const bestEnd = Math.max(sentenceEnd, periodEnd);
          if (bestEnd > maxLength * 0.5) {
            splitIndex = bestEnd + 1;
          }
        }
      }
      
      chunks.push(remaining.substring(0, splitIndex));
      remaining = remaining.substring(splitIndex);
    }
    
    return chunks;
  }
  
  /**
   * Generate unique message ID
   */
  protected generateMessageId(): string {
    return `${this.type}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
}

/**
 * Retry helper for channel operations
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: {
    maxRetries?: number;
    delayMs?: number;
    backoffMultiplier?: number;
    shouldRetry?: (error: Error) => boolean;
    onRetry?: (attempt: number, error: Error) => void;
  } = {}
): Promise<T> {
  const {
    maxRetries = 3,
    delayMs = 1000,
    backoffMultiplier = 2,
    shouldRetry = () => true,
    onRetry,
  } = options;
  
  let lastError: Error | undefined;
  let currentDelay = delayMs;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (attempt === maxRetries || !shouldRetry(lastError)) {
        throw lastError;
      }
      
      if (onRetry) {
        onRetry(attempt, lastError);
      }
      
      logWarn(`[Retry] Attempt ${attempt}/${maxRetries} failed, retrying in ${currentDelay}ms...`);
      await new Promise(resolve => setTimeout(resolve, currentDelay));
      currentDelay *= backoffMultiplier;
    }
  }
  
  throw lastError;
}
