/**
 * WebSocket Channel
 *
 * Delivers agent responses back to WebSocket clients of the remote gateway.
 *
 * Why this file exists: `RemoteGateway.sendToChannel()` looks up a registered channel by
 * `response.channelType`. WebSocket clients send messages with `channelType: 'websocket'`
 * (see `handleWSClientMessage`), but nothing registers a `'websocket'` channel — only Feishu
 * and Slack are registered in `RemoteManager.registerChannels()`. As a result every agent
 * answer for a WebSocket client is dropped with `Channel not found: websocket`, and a
 * companion client can send prompts but never sees the answer.
 *
 * Install: see upstream/APPLY.md in the companion app repository.
 */

import { ChannelBase } from './channel-base';
import type { ChannelType, RemoteResponse } from '../types';
import { log, logWarn } from '../../utils/logger';

/** Frame shape understood by the gateway WebSocket protocol. */
export interface WebSocketFrame {
  type: string;
  payload: unknown;
  requestId?: string;
}

export interface WebSocketChannelOptions {
  /** Delivers one frame to a connected, authenticated WebSocket client. */
  sendToClient: (clientId: string, frame: WebSocketFrame) => boolean;
  /** Optional: resolves the local session bound to a WebSocket client id. */
  resolveSessionId?: (clientId: string) => string | undefined;
}

export class WebSocketChannel extends ChannelBase {
  override readonly type: ChannelType = 'websocket';

  constructor(private readonly options: WebSocketChannelOptions) {
    super();
  }

  override async start(): Promise<void> {
    this._connected = true;
    log('[WebSocketChannel] Started');
  }

  override async stop(): Promise<void> {
    this._connected = false;
    log('[WebSocketChannel] Stopped');
  }

  /**
   * Sends an agent response to the WebSocket client that asked for it.
   *
   * `response.channelId` holds the gateway-side client id, because
   * `RemoteGateway.handleWSClientMessage()` builds its `RemoteMessage` with
   * `channelId: client.id`.
   *
   * Note: the message router emits one complete answer per turn, so every frame is sent with
   * `done: true`. Token-level streaming would require the router to call this channel for each
   * delta; the client already handles repeated frames with `done: false` followed by a final
   * `done: true` frame.
   */
  override async send(response: RemoteResponse): Promise<void> {
    const clientId = response.channelId;
    if (!clientId) {
      logWarn('[WebSocketChannel] Response without channelId, dropping');
      return;
    }

    const content = response.content;
    const isMarkdown = content.type === 'markdown';
    const text = isMarkdown ? content.markdown ?? '' : content.text ?? '';

    if (!text) {
      logWarn(`[WebSocketChannel] Unsupported response content type: ${content.type}`);
      return;
    }

    const delivered = this.options.sendToClient(clientId, {
      type: 'response',
      payload: {
        sessionId: this.options.resolveSessionId?.(clientId),
        text,
        markdown: isMarkdown ? content.markdown : undefined,
        done: true,
        replyTo: response.replyTo,
      },
    });

    if (!delivered) {
      logWarn(`[WebSocketChannel] Client ${clientId} is not connected, message dropped`);
    }
  }
}
