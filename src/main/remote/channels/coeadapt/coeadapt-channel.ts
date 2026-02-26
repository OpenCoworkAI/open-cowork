/**
 * Coeadapt Channel
 * Connects Open Cowork to the Coeadapt career development platform,
 * enabling bi-directional messaging and career workflow automation.
 */

import { ChannelBase, withRetry } from '../channel-base';
import { log, logError, logWarn } from '../../../utils/logger';
import type {
  CoeadaptChannelConfig,
  CoeadaptEventType,
  RemoteMessage,
  RemoteResponse,
} from '../../types';
import {
  CoeadaptAPI,
  type CoeadaptCredentials,
  type CoeadaptUserProfile,
} from './coeadapt-api';

/** Reconnect delay range for WebSocket (ms) */
const WS_RECONNECT_MIN_MS = 2_000;
const WS_RECONNECT_MAX_MS = 30_000;

export class CoeadaptChannel extends ChannelBase {
  readonly type = 'coeadapt' as const;

  private config: CoeadaptChannelConfig;
  private api: CoeadaptAPI;
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = WS_RECONNECT_MIN_MS;
  private shouldReconnect = false;

  // Cached platform user info
  private currentUser: CoeadaptUserProfile | null = null;

  constructor(config: CoeadaptChannelConfig) {
    super();
    this.config = config;

    const credentials: CoeadaptCredentials = {};
    if (config.apiKey) {
      credentials.apiKey = config.apiKey;
    }

    this.api = new CoeadaptAPI(config.baseUrl, credentials);
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  async start(): Promise<void> {
    if (this._connected) {
      logWarn('[Coeadapt] Channel already started');
      return;
    }

    this.logStatus('Starting channel...');

    try {
      // Authenticate with Coeadapt platform
      await withRetry(() => this.api.authenticate(), {
        maxRetries: 3,
        delayMs: 1_000,
        onRetry: (attempt, error) => {
          logWarn(`[Coeadapt] Auth attempt ${attempt} failed: ${error.message}`);
        },
      });

      // Fetch current user profile
      this.currentUser = await this.api.getCurrentUser();
      log('[Coeadapt] Authenticated as:', {
        userId: this.currentUser.id,
        name: this.currentUser.displayName,
      });

      // Open WebSocket for real-time events (if endpoint configured)
      if (this.config.wsEndpoint) {
        this.shouldReconnect = true;
        await this.connectWebSocket();
      }

      this._connected = true;
      this.logStatus('Channel started successfully');
    } catch (error) {
      logError('[Coeadapt] Failed to start channel:', error);
      this._connected = false;
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this._connected) {
      return;
    }

    this.logStatus('Stopping channel...');

    this.shouldReconnect = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close(1000, 'Channel stopping');
      this.ws = null;
    }

    this._connected = false;
    this.logStatus('Channel stopped');
  }

  // --------------------------------------------------------------------------
  // WebSocket connection
  // --------------------------------------------------------------------------

  private async connectWebSocket(): Promise<void> {
    if (!this.config.wsEndpoint) {
      return;
    }

    return new Promise<void>((resolve, reject) => {
      try {
        const wsUrl = this.config.wsEndpoint!;
        log('[Coeadapt] Connecting WebSocket:', wsUrl);

        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          log('[Coeadapt] WebSocket connected');
          this.reconnectDelay = WS_RECONNECT_MIN_MS;

          // Subscribe to configured event types
          if (this.config.webhook?.events?.length) {
            this.ws?.send(
              JSON.stringify({
                type: 'subscribe',
                events: this.config.webhook.events,
              })
            );
          }

          resolve();
        };

        this.ws.onmessage = (event) => {
          this.handleWebSocketMessage(event.data);
        };

        this.ws.onerror = (event) => {
          logError('[Coeadapt] WebSocket error:', event);
          this.emitError(new Error('Coeadapt WebSocket connection error'));
        };

        this.ws.onclose = (event) => {
          log('[Coeadapt] WebSocket closed:', {
            code: event.code,
            reason: event.reason,
          });

          this.ws = null;

          if (this.shouldReconnect) {
            this.scheduleReconnect();
          }
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return;
    }

    log(`[Coeadapt] Reconnecting in ${this.reconnectDelay}ms...`);

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;

      try {
        await this.connectWebSocket();
      } catch (error) {
        logError('[Coeadapt] Reconnect failed:', error);
        // Exponential backoff
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, WS_RECONNECT_MAX_MS);
        if (this.shouldReconnect) {
          this.scheduleReconnect();
        }
      }
    }, this.reconnectDelay);
  }

  // --------------------------------------------------------------------------
  // Incoming message handling
  // --------------------------------------------------------------------------

  private handleWebSocketMessage(raw: string | Buffer): void {
    try {
      const data =
        typeof raw === 'string' ? raw : raw.toString('utf-8');
      const payload = JSON.parse(data) as CoeadaptWebSocketPayload;

      switch (payload.type) {
        case 'event':
          this.handlePlatformEvent(payload);
          break;

        case 'message':
          this.handleUserMessage(payload);
          break;

        case 'ping':
          // Respond to keep-alive
          this.ws?.send(JSON.stringify({ type: 'pong' }));
          break;

        default:
          log('[Coeadapt] Unknown WS message type:', payload.type);
      }
    } catch (error) {
      logError('[Coeadapt] Failed to parse WebSocket message:', error);
    }
  }

  private handlePlatformEvent(payload: CoeadaptWebSocketPayload): void {
    const eventType = payload.event as CoeadaptEventType | undefined;
    if (!eventType) return;

    log('[Coeadapt] Platform event:', eventType);

    // Convert Coeadapt platform events into RemoteMessages
    // so the agent runner can respond to them.
    const message: RemoteMessage = {
      id: payload.id || this.generateMessageId(),
      channelType: 'coeadapt',
      channelId: payload.userId || 'system',
      sender: {
        id: payload.userId || 'coeadapt-system',
        name: payload.userName || 'Coeadapt',
        isBot: !payload.userId,
      },
      content: {
        type: 'text',
        text: this.buildEventPrompt(eventType, payload.data),
      },
      timestamp: Date.now(),
      isGroup: false,
      isMentioned: true,
      raw: payload,
    };

    this.emitMessage(message);
  }

  private handleUserMessage(payload: CoeadaptWebSocketPayload): void {
    const message: RemoteMessage = {
      id: payload.id || this.generateMessageId(),
      channelType: 'coeadapt',
      channelId: payload.userId || 'unknown',
      sender: {
        id: payload.userId || 'unknown',
        name: payload.userName,
        isBot: false,
      },
      content: {
        type: 'text',
        text: payload.text || '',
      },
      timestamp: Date.now(),
      isGroup: false,
      isMentioned: true,
      raw: payload,
    };

    this.emitMessage(message);
  }

  /**
   * Build a contextual prompt from a Coeadapt platform event,
   * so the AI agent understands what action to take.
   */
  private buildEventPrompt(
    eventType: CoeadaptEventType,
    data?: Record<string, unknown>
  ): string {
    const prompts: Record<CoeadaptEventType, string> = {
      'career.roadmap_updated':
        'The user\'s career roadmap has been updated on Coeadapt. Review the changes and provide guidance on next steps.',
      'career.skill_gap_analyzed':
        'A skill gap analysis has been completed on Coeadapt. Summarize the gaps and suggest a learning plan.',
      'career.plan_generated':
        'A new career plan has been generated on Coeadapt. Review it and help the user refine their strategy.',
      'portfolio.item_added':
        'A new portfolio item has been added on Coeadapt. Help the user create a polished case study document for it.',
      'portfolio.review_requested':
        'The user has requested a portfolio review via Coeadapt. Analyze their portfolio and provide improvement suggestions.',
      'interview.session_started':
        'An interview prep session has been initiated from Coeadapt. Help the user practice with role-specific questions.',
      'interview.feedback_ready':
        'Interview feedback is ready from Coeadapt. Summarize the feedback and suggest areas for improvement.',
      'job.match_found':
        'New job matches have been found on Coeadapt. Summarize the opportunities and help evaluate fit.',
      'job.application_status_changed':
        'A job application status has changed on Coeadapt. Update the user and suggest next steps.',
      'user.profile_updated':
        'The user\'s profile has been updated on Coeadapt. Acknowledge the changes.',
      'user.message':
        'The user sent a message via the Coeadapt platform.',
    };

    let prompt = prompts[eventType] || `Coeadapt event: ${eventType}`;

    if (data) {
      prompt += `\n\nEvent data: ${JSON.stringify(data, null, 2)}`;
    }

    return prompt;
  }

  // --------------------------------------------------------------------------
  // Outgoing messages
  // --------------------------------------------------------------------------

  async send(response: RemoteResponse): Promise<void> {
    const { channelId, content } = response;

    const text =
      content.text || content.markdown || '[Unsupported content type]';

    try {
      await withRetry(
        () =>
          this.api.sendMessage(channelId, {
            type: 'text',
            text,
          }),
        {
          maxRetries: 3,
          delayMs: 500,
          onRetry: (attempt, error) => {
            logWarn(
              `[Coeadapt] Send retry ${attempt}: ${error.message}`
            );
          },
        }
      );

      this.logStatus('Message sent', {
        channelId,
        contentLength: text.length,
      });
    } catch (error) {
      logError('[Coeadapt] Failed to send message:', error);
      throw error;
    }
  }

  // --------------------------------------------------------------------------
  // Accessors
  // --------------------------------------------------------------------------

  getAPI(): CoeadaptAPI {
    return this.api;
  }

  getCurrentUser(): CoeadaptUserProfile | null {
    return this.currentUser;
  }
}

// --------------------------------------------------------------------------
// Internal WebSocket payload shape
// --------------------------------------------------------------------------

interface CoeadaptWebSocketPayload {
  type: 'event' | 'message' | 'ping' | 'pong';
  id?: string;
  event?: string;
  userId?: string;
  userName?: string;
  text?: string;
  data?: Record<string, unknown>;
}
