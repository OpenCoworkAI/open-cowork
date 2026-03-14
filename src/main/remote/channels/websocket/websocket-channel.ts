/**
 * WebSocket Channel
 * Generic WebSocket-based channel for direct client connections
 */

import { ChannelBase } from '../channel-base';
import { log } from '../../../utils/logger';
import type {
  WebSocketChannelConfig,
  RemoteMessage,
  RemoteResponse,
} from '../../types';

/**
 * WebSocket Channel - handles messages from WebSocket clients
 * connected directly to the gateway's WebSocket server.
 *
 * This channel acts as a bridge, converting WebSocket messages
 * from the gateway into the unified RemoteMessage format.
 */
export class WebSocketChannel extends ChannelBase {
  readonly type = 'websocket' as const;

  private config: WebSocketChannelConfig;
  private pendingResponses: Map<string, (response: RemoteResponse) => void> = new Map();

  constructor(config: WebSocketChannelConfig) {
    super();
    this.config = config;
  }

  async start(): Promise<void> {
    log('[WebSocket Channel] Started');
    this._connected = true;
  }

  async stop(): Promise<void> {
    log('[WebSocket Channel] Stopped');
    this._connected = false;
    this.pendingResponses.clear();
  }

  async send(response: RemoteResponse): Promise<void> {
    // WebSocket responses are sent back through the gateway's WebSocket server
    // The gateway handles the actual WebSocket send
    const callback = this.pendingResponses.get(response.replyTo || '');
    if (callback) {
      callback(response);
      this.pendingResponses.delete(response.replyTo || '');
    }

    // Also emit the response for the gateway to pick up
    this.emit('response', response);
  }

  /**
   * Handle an incoming WebSocket message from a client
   */
  handleClientMessage(clientId: string, data: {
    id?: string;
    text?: string;
    type?: string;
  }): void {
    const message: RemoteMessage = {
      id: data.id || `ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      channelType: 'websocket',
      channelId: clientId,
      sender: {
        id: clientId,
        name: clientId,
        isBot: false,
      },
      content: {
        type: (data.type as RemoteMessage['content']['type']) || 'text',
        text: data.text || '',
      },
      timestamp: Date.now(),
      isGroup: false,
      isMentioned: true, // Always treat WS messages as directed
    };

    if (this.messageHandler) {
      this.messageHandler(message);
    }
  }

  /**
   * Check if a client ID is allowed to connect
   */
  isClientAllowed(clientId: string): boolean {
    if (this.config.allowAnonymous) {
      return true;
    }
    if (this.config.allowedClients && this.config.allowedClients.length > 0) {
      return this.config.allowedClients.includes(clientId);
    }
    // If no restrictions configured, allow all
    return true;
  }
}
