/**
 * Remote Gateway
 * WebSocket 控制平面，管理远程连接和消息路由
 */

import * as crypto from 'crypto';
import { EventEmitter } from 'events';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer, Server as HttpServer, IncomingMessage, ServerResponse } from 'http';
import { log, logError, logWarn } from '../utils/logger';
import type {
  GatewayConfig,
  GatewayStatus,
  IChannel,
  ChannelType,
  RemoteMessage,
  RemoteResponse,
  PairingRequest,
  PairedUser,
  GatewayEvent,
} from './types';
import { MessageRouter } from './message-router';

// WebSocket client connection
interface WSClient {
  id: string;
  ws: WebSocket;
  authenticated: boolean;
  userId?: string;
  connectedAt: number;
  ip: string;
}

// WebSocket message protocol
interface WSMessage {
  type: string;
  payload: unknown;
  requestId?: string;
}

export class RemoteGateway extends EventEmitter {
  private config: GatewayConfig;
  private httpServer?: HttpServer;
  private wss?: WebSocketServer;
  private channels: Map<ChannelType, IChannel> = new Map();
  private wsClients: Map<string, WSClient> = new Map();
  private messageRouter: MessageRouter;

  // Pairing management
  private pairingRequests: Map<string, PairingRequest> = new Map();
  private pairedUsers: Map<string, PairedUser> = new Map();

  private _running: boolean = false;

  // Rate limiting for WebSocket auth
  private authAttempts: Map<string, { count: number; resetTime: number }> = new Map();

  constructor(config: GatewayConfig, messageRouter: MessageRouter) {
    super();
    this.config = config;
    this.messageRouter = messageRouter;

    // Set up message router callback
    this.messageRouter.onResponse(this.handleAgentResponse.bind(this));
  }

  get running(): boolean {
    return this._running;
  }

  /**
   * Start the gateway
   */
  async start(): Promise<void> {
    if (this._running) {
      logWarn('[Gateway] Already running');
      return;
    }

    log('[Gateway] Starting gateway on port', this.config.port);

    try {
      // Create HTTP server for webhook callbacks
      this.httpServer = createServer(this.handleHttpRequest.bind(this));

      // Create WebSocket server
      this.wss = new WebSocketServer({
        server: this.httpServer,
        path: '/ws',
      });

      this.wss.on('connection', this.handleWSConnection.bind(this));
      this.wss.on('error', (error) => {
        logError('[Gateway] WebSocket server error:', error);
        this.emitEvent('gateway.error', { error: error.message });
      });

      // Start listening
      await new Promise<void>((resolve, reject) => {
        this.httpServer!.listen(this.config.port, this.config.bind, () => {
          log(`[Gateway] HTTP/WS server listening on ${this.config.bind}:${this.config.port}`);
          resolve();
        });

        this.httpServer!.on('error', (error) => {
          logError('[Gateway] HTTP server error:', error);
          reject(error);
        });
      });

      // Start all registered channels
      for (const [type, channel] of this.channels) {
        try {
          await channel.start();
          log(`[Gateway] Channel ${type} started`);
        } catch (error) {
          logError(`[Gateway] Failed to start channel ${type}:`, error);
        }
      }

      this._running = true;
      this.emitEvent('gateway.started', { port: this.config.port });
      log('[Gateway] Gateway started successfully');
    } catch (error) {
      logError('[Gateway] Failed to start gateway:', error);
      throw error;
    }
  }

  /**
   * Stop the gateway
   */
  async stop(): Promise<void> {
    if (!this._running && !this.httpServer && !this.wss) {
      return;
    }

    log('[Gateway] Stopping gateway...');

    // Stop all channels
    for (const [type, channel] of this.channels) {
      try {
        await channel.stop();
        log(`[Gateway] Channel ${type} stopped`);
      } catch (error) {
        logError(`[Gateway] Error stopping channel ${type}:`, error);
      }
    }

    // Close all WebSocket connections
    for (const client of this.wsClients.values()) {
      try {
        client.ws.close(1000, 'Gateway shutting down');
      } catch (e) {
        // Ignore close errors
      }
    }
    this.wsClients.clear();

    // Close WebSocket server
    if (this.wss) {
      this.wss.close();
      this.wss = undefined;
    }

    // Close HTTP server
    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => resolve());
      });
      this.httpServer = undefined;
    }

    this._running = false;
    this.emitEvent('gateway.stopped', {});
    log('[Gateway] Gateway stopped');
  }

  /**
   * Register a channel
   */
  registerChannel(channel: IChannel): void {
    if (this.channels.has(channel.type)) {
      logWarn(`[Gateway] Channel ${channel.type} already registered, replacing...`);
    }

    // Set up message handler
    channel.onMessage(this.handleChannelMessage.bind(this));
    channel.onError((error) => {
      logError(`[Gateway] Channel ${channel.type} error:`, error);
      this.emitEvent('channel.error', { channel: channel.type, error: error.message });
    });

    this.channels.set(channel.type, channel);
    log(`[Gateway] Registered channel: ${channel.type}`);

    // Start channel if gateway is already running
    if (this._running) {
      channel.start().catch((error) => {
        logError(`[Gateway] Failed to start channel ${channel.type}:`, error);
      });
    }
  }

  /**
   * Unregister a channel
   */
  async unregisterChannel(type: ChannelType): Promise<void> {
    const channel = this.channels.get(type);
    if (channel) {
      await channel.stop();
      this.channels.delete(type);
      log(`[Gateway] Unregistered channel: ${type}`);
    }
  }

  /**
   * Get gateway status
   */
  getStatus(): GatewayStatus {
    const channelStatuses = Array.from(this.channels.entries()).map(([type, channel]) => ({
      type,
      connected: channel.connected,
    }));

    return {
      running: this._running,
      port: this._running ? this.config.port : undefined,
      publicUrl: undefined, // TODO: Add tunnel support
      channels: channelStatuses,
      activeSessions: this.messageRouter.getActiveSessionCount(),
      pendingPairings: this.pairingRequests.size,
    };
  }

  // Message interceptor for handling interaction responses
  private messageInterceptor?: (message: RemoteMessage) => Promise<boolean> | boolean;

  /**
   * Set message interceptor for interaction responses
   * Returns true if message was consumed (don't route to agent)
   */
  setMessageInterceptor(interceptor: (message: RemoteMessage) => Promise<boolean> | boolean): void {
    this.messageInterceptor = interceptor;
  }

  /**
   * Handle incoming message from a channel
   */
  private async handleChannelMessage(message: RemoteMessage): Promise<void> {
    log('[Gateway] Received message from channel:', {
      type: message.channelType,
      channelId: message.channelId,
      sender: message.sender.id,
    });

    // Check if user is authorized FIRST — before any interceptor processing
    const authorized = await this.checkAuthorization(message);
    if (!authorized) {
      log('[Gateway] User not authorized:', message.sender.id);

      // Handle pairing if enabled
      if (this.config.auth.mode === 'pairing') {
        await this.handlePairingRequest(message);
      } else {
        // Send unauthorized response
        await this.sendToChannel({
          channelType: message.channelType,
          channelId: message.channelId,
          content: {
            type: 'text',
            text: '⚠️ 您没有权限使用此机器人。请联系管理员获取访问权限。',
          },
          replyTo: message.id,
        });
      }
      return;
    }

    // Check if this is a response to a pending interaction (only after authorization)
    if (this.messageInterceptor && message.content.type === 'text' && message.content.text) {
      const consumed = await this.messageInterceptor(message);
      if (consumed) {
        log('[Gateway] Message consumed by interceptor (interaction response)');
        return;
      }
    }

    // Check group settings
    if (message.isGroup) {
      const shouldProcess = this.shouldProcessGroupMessage(message);
      if (!shouldProcess) {
        log('[Gateway] Ignoring group message (not mentioned)');
        return;
      }
    }

    // Route message to agent
    this.emitEvent('message.received', { message });
    await this.messageRouter.routeMessage(message);
  }

  /**
   * Handle agent response
   */
  private async handleAgentResponse(response: RemoteResponse): Promise<void> {
    await this.sendToChannel(response);
  }

  /**
   * Send response to channel (public method for RemoteManager)
   */
  async sendResponse(response: RemoteResponse): Promise<void> {
    await this.sendToChannel(response);
  }

  /**
   * Send response to channel (internal)
   */
  private async sendToChannel(response: RemoteResponse): Promise<void> {
    const channel = this.channels.get(response.channelType);
    if (!channel) {
      logError(`[Gateway] Channel not found: ${response.channelType}`);
      return;
    }

    try {
      await channel.send(response);
      this.emitEvent('message.sent', { response });
    } catch (error) {
      logError(`[Gateway] Failed to send message to channel ${response.channelType}:`, error);
    }
  }

  /**
   * Check if user is authorized
   */
  private async checkAuthorization(message: RemoteMessage): Promise<boolean> {
    const { mode, allowlist } = this.config.auth;

    switch (mode) {
      case 'token':
        // Token auth is for WebSocket clients only, deny channel messages
        return false;

      case 'allowlist':
        if (!allowlist || allowlist.length === 0) {
          return false; // Empty allowlist means deny all
        }
        // Support both scoped (channelType:userId) and legacy (userId) formats
        return (
          allowlist.includes(`${message.channelType}:${message.sender.id}`) ||
          allowlist.includes(message.sender.id)
        );

      case 'pairing': {
        // Check if user is paired
        const pairedKey = `${message.channelType}:${message.sender.id}`;
        return this.pairedUsers.has(pairedKey);
      }

      default:
        return false;
    }
  }

  /**
   * Check if group message should be processed
   */
  private shouldProcessGroupMessage(message: RemoteMessage): boolean {
    // Always process if explicitly mentioned
    if (message.isMentioned) {
      return true;
    }

    // TODO: Check channel-specific group settings
    // For now, require mention in groups by default
    return false;
  }

  /**
   * Handle pairing request from unauthorized user
   */
  private async handlePairingRequest(message: RemoteMessage): Promise<void> {
    const userKey = `${message.channelType}:${message.sender.id}`;

    // Check if already has a pending pairing request
    if (this.pairingRequests.has(userKey)) {
      const existing = this.pairingRequests.get(userKey)!;

      // Check if message contains the pairing code
      const inputCode = message.content.text?.trim();
      if (inputCode === existing.code) {
        // Pairing successful
        this.pairedUsers.set(userKey, {
          userId: message.sender.id,
          userName: message.sender.name,
          channelType: message.channelType,
          pairedAt: Date.now(),
          lastActiveAt: Date.now(),
        });

        this.pairingRequests.delete(userKey);

        await this.sendToChannel({
          channelType: message.channelType,
          channelId: message.channelId,
          content: {
            type: 'text',
            text: '✅ 配对成功！您现在可以开始使用机器人了。',
          },
          replyTo: message.id,
        });

        log('[Gateway] User paired successfully:', userKey);
        return;
      }

      // Check if expired
      if (Date.now() > existing.expiresAt) {
        this.pairingRequests.delete(userKey);
      } else {
        // Already has valid pairing request
        await this.sendToChannel({
          channelType: message.channelType,
          channelId: message.channelId,
          content: {
            type: 'text',
            text: `请输入配对码进行验证。\n\n您的配对码是: **${existing.code}**\n\n请将此配对码发送给管理员进行确认，或直接回复配对码完成配对。`,
          },
          replyTo: message.id,
        });
        return;
      }
    }

    // Generate new pairing code
    const code = this.generatePairingCode();
    const pairingRequest: PairingRequest = {
      code,
      channelType: message.channelType,
      userId: message.sender.id,
      userName: message.sender.name,
      createdAt: Date.now(),
      expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
    };

    this.pairingRequests.set(userKey, pairingRequest);

    await this.sendToChannel({
      channelType: message.channelType,
      channelId: message.channelId,
      content: {
        type: 'text',
        text: `👋 您好！首次使用需要进行配对验证。\n\n您的配对码是: **${code}**\n\n请将此配对码发送给管理员进行确认。配对码有效期10分钟。`,
      },
      replyTo: message.id,
    });

    log('[Gateway] Generated pairing code for user:', userKey);

    // Emit pairing event for UI notification
    this.emitEvent('gateway.pairing_request', {
      code,
      channelType: message.channelType,
      userId: message.sender.id,
      userName: message.sender.name,
    });
  }

  /**
   * Approve pairing request (called from UI)
   */
  approvePairing(channelType: ChannelType, userId: string): boolean {
    const userKey = `${channelType}:${userId}`;
    const request = this.pairingRequests.get(userKey);

    if (!request) {
      logWarn('[Gateway] No pairing request found for:', userKey);
      return false;
    }

    if (Date.now() > request.expiresAt) {
      this.pairingRequests.delete(userKey);
      logWarn('[Gateway] Pairing request expired:', userKey);
      return false;
    }

    this.pairedUsers.set(userKey, {
      userId: request.userId,
      userName: request.userName,
      channelType: request.channelType,
      pairedAt: Date.now(),
      lastActiveAt: Date.now(),
    });

    this.pairingRequests.delete(userKey);
    log('[Gateway] Pairing approved:', userKey);
    return true;
  }

  /**
   * Revoke user pairing
   */
  revokePairing(channelType: ChannelType, userId: string): boolean {
    const userKey = `${channelType}:${userId}`;
    if (this.pairedUsers.has(userKey)) {
      this.pairedUsers.delete(userKey);
      log('[Gateway] Pairing revoked:', userKey);
      return true;
    }
    return false;
  }

  /**
   * Get all paired users
   */
  getPairedUsers(): PairedUser[] {
    return Array.from(this.pairedUsers.values());
  }

  /**
   * Restore a previously-paired user directly (called on startup from persisted config).
   * Bypasses the normal pairing-request flow since the user was already approved.
   */
  restorePairedUser(user: PairedUser): void {
    const userKey = `${user.channelType}:${user.userId}`;
    if (!this.pairedUsers.has(userKey)) {
      this.pairedUsers.set(userKey, user);
      log('[Gateway] Restored paired user:', userKey);
    }
  }

  /**
   * Get pending pairing requests
   */
  getPendingPairings(): PairingRequest[] {
    // Clean up expired requests
    const now = Date.now();
    for (const [key, request] of this.pairingRequests) {
      if (now > request.expiresAt) {
        this.pairingRequests.delete(key);
      }
    }
    return Array.from(this.pairingRequests.values());
  }

  /**
   * Generate 6-digit pairing code
   */
  private generatePairingCode(): string {
    return crypto.randomInt(100000, 999999).toString();
  }

  // ============================================================================
  // HTTP Request Handling (for webhooks)
  // ============================================================================

  private handleHttpRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url || '/';

    // Health check endpoint
    if (url === '/health' || url === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', timestamp: Date.now() }));
      return;
    }

    // Status endpoint
    if (url === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(this.getStatus()));
      return;
    }

    // Channel webhooks
    if (url.startsWith('/webhook/')) {
      this.handleWebhook(req, res, url);
      return;
    }

    // 404 for unknown paths
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }

  private handleWebhook(req: IncomingMessage, res: ServerResponse, url: string): void {
    // Extract channel type from URL: /webhook/feishu, /webhook/telegram, etc.
    const channelType = url.split('/')[2] as ChannelType;

    log(`[Gateway] Received webhook for channel: ${channelType}, URL: ${url}`);

    if (!this.channels.has(channelType)) {
      log(`[Gateway] Channel ${channelType} not found`);
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Channel ${channelType} not found` }));
      return;
    }

    // Collect request body
    let body = '';
    const MAX_BODY_SIZE = 1024 * 1024; // 1MB limit
    let bodyTooLarge = false;
    req.on('data', (chunk: Buffer) => {
      if (bodyTooLarge) return;
      body += chunk.toString();
      if (body.length > MAX_BODY_SIZE) {
        bodyTooLarge = true;
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Request body too large' }));
        req.destroy();
      }
    });

    req.on('end', () => {
      if (bodyTooLarge) return;
      try {
        log(`[Gateway] Webhook body received, length: ${body.length}`);

        // Check if there are listeners for this webhook event
        const listenerCount = this.listenerCount(`webhook:${channelType}`);
        log(`[Gateway] Listeners for webhook:${channelType}: ${listenerCount}`);

        if (listenerCount === 0) {
          log(`[Gateway] No listeners for webhook:${channelType}, returning OK`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ code: 0 }));
          return;
        }

        // Emit webhook event for channel to handle
        this.emit(`webhook:${channelType}`, {
          headers: req.headers,
          body,
          respond: (status: number, data: unknown) => {
            log(`[Gateway] Webhook response: ${status}`, data);
            res.writeHead(status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(data));
          },
        });
      } catch (error) {
        logError('[Gateway] Error processing webhook body:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    });
  }

  // ============================================================================
  // WebSocket Connection Handling
  // ============================================================================

  private handleWSConnection(ws: WebSocket, _req: IncomingMessage): void {
    const clientId = this.generateClientId();
    const ip = _req.socket.remoteAddress || 'unknown';

    const client: WSClient = {
      id: clientId,
      ws,
      authenticated: false,
      connectedAt: Date.now(),
      ip,
    };

    this.wsClients.set(clientId, client);
    log('[Gateway] WebSocket client connected:', clientId);

    ws.on('message', (data: Buffer) => {
      try {
        this.handleWSMessage(client, data);
      } catch (error) {
        logError('[Gateway] Error handling WS message:', error);
      }
    });

    ws.on('close', () => {
      this.wsClients.delete(clientId);
      log('[Gateway] WebSocket client disconnected:', clientId);
    });

    ws.on('error', (error) => {
      logError('[Gateway] WebSocket client error:', clientId, error);
    });

    // Send welcome message
    this.sendWSMessage(ws, {
      type: 'connected',
      payload: { clientId },
    });
  }

  private handleWSMessage(client: WSClient, data: Buffer): void {
    try {
      const message: WSMessage = JSON.parse(data.toString());

      switch (message.type) {
        case 'auth':
          this.handleWSAuth(client, message);
          break;

        case 'message':
          void this.handleWSClientMessage(client, message).catch((error) => {
            logError('[Gateway] Error handling WS client message:', error);
          });
          break;

        case 'ping':
          this.sendWSMessage(client.ws, { type: 'pong', payload: {} });
          break;

        default:
          log('[Gateway] Unknown WS message type:', message.type);
      }
    } catch (error) {
      logError('[Gateway] Failed to parse WS message:', error);
    }
  }

  private checkAuthRateLimit(ip: string): boolean {
    const now = Date.now();
    const attempt = this.authAttempts.get(ip);
    if (!attempt || now > attempt.resetTime) {
      this.authAttempts.set(ip, { count: 1, resetTime: now + 60000 });
      return true;
    }
    attempt.count++;
    return attempt.count <= 5;
  }

  private handleWSAuth(client: WSClient, message: WSMessage): void {
    // Rate limit auth attempts by IP
    if (!this.checkAuthRateLimit(client.ip)) {
      this.sendWSMessage(client.ws, {
        type: 'auth_result',
        payload: { success: false, error: 'Too many auth attempts. Try again later.' },
        requestId: message.requestId,
      });
      return;
    }

    const { token } = message.payload as { token?: string };

    if (this.config.auth.mode === 'token') {
      if (token === this.config.auth.token) {
        client.authenticated = true;
        this.sendWSMessage(client.ws, {
          type: 'auth_result',
          payload: { success: true },
          requestId: message.requestId,
        });
        log('[Gateway] WS client authenticated:', client.id);
      } else {
        this.sendWSMessage(client.ws, {
          type: 'auth_result',
          payload: { success: false, error: 'Invalid token' },
          requestId: message.requestId,
        });
      }
    } else {
      // Other auth modes don't require token for WS
      client.authenticated = true;
      this.sendWSMessage(client.ws, {
        type: 'auth_result',
        payload: { success: true },
        requestId: message.requestId,
      });
    }
  }

  private async handleWSClientMessage(client: WSClient, message: WSMessage): Promise<void> {
    try {
      if (!client.authenticated) {
        this.sendWSMessage(client.ws, {
          type: 'error',
          payload: { error: 'Not authenticated' },
          requestId: message.requestId,
        });
        return;
      }

      const { text } = message.payload as { text: string; sessionId?: string };

      // Create a remote message from WS client
      const remoteMessage: RemoteMessage = {
        id: this.generateMessageId(),
        channelType: 'websocket',
        channelId: client.id,
        sender: {
          id: client.userId || client.id,
          isBot: false,
        },
        content: {
          type: 'text',
          text,
        },
        timestamp: Date.now(),
        isGroup: false,
        isMentioned: true,
      };

      // Route to agent
      await this.messageRouter.routeMessage(remoteMessage);
    } catch (error) {
      logError('[Gateway] Error in handleWSClientMessage:', error);
    }
  }

  private sendWSMessage(ws: WebSocket, message: WSMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * Broadcast message to all authenticated WS clients
   */
  broadcastWS(message: WSMessage): void {
    for (const client of this.wsClients.values()) {
      if (client.authenticated) {
        this.sendWSMessage(client.ws, message);
      }
    }
  }

  private generateClientId(): string {
    return `ws-${Date.now()}-${crypto.randomUUID()}`;
  }

  private generateMessageId(): string {
    return `msg-${Date.now()}-${crypto.randomUUID()}`;
  }

  private emitEvent(type: string, data: unknown): void {
    const event: GatewayEvent = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      type: type as any,
      timestamp: Date.now(),
      data,
    };
    this.emit('event', event);
    this.emit(type, data);
  }
}
