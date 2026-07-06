/**
 * StdioChannel — IChannel implementation for stdin/stdout RPC.
 *
 * Reads JSONL messages from process.stdin, writes JSONL responses to process.stdout.
 * Plugs into RemoteManager/Gateway to get session mapping, permission handling,
 * and response buffering for free.
 *
 * Protocol:
 *   Input (stdin, one JSON object per line):
 *     {"type":"session.start","prompt":"...","cwd":"/path"}
 *     {"type":"session.message","sessionId":"xxx","text":"continue"}
 *     {"type":"session.abort","sessionId":"xxx"}
 *
 *   Output (stdout, one JSON object per line):
 *     {"type":"session.started","sessionId":"xxx"}
 *     {"type":"agent.text_delta","sessionId":"xxx","text":"..."}
 *     {"type":"agent.tool_start","sessionId":"xxx","tool":"Read","input":{...}}
 *     {"type":"agent.tool_end","sessionId":"xxx","tool":"Read","output":"..."}
 *     {"type":"session.end","sessionId":"xxx","result":"..."}
 *     {"type":"error","message":"..."}
 */

import * as readline from 'readline';
import * as crypto from 'crypto';
import { ChannelBase } from './channel-base';
import { log, logError } from '../../utils/logger';
import type { ChannelType, RemoteMessage, RemoteResponse } from '../types';

// ── Input message types ──

export interface StdioSessionStart {
  type: 'session.start';
  prompt: string;
  cwd?: string;
}

export interface StdioSessionMessage {
  type: 'session.message';
  sessionId: string;
  text: string;
}

export interface StdioSessionAbort {
  type: 'session.abort';
  sessionId: string;
}

export type StdioInputMessage = StdioSessionStart | StdioSessionMessage | StdioSessionAbort;

// ── Output event types ──

export interface StdioOutputEvent {
  type: string;
  sessionId?: string;
  [key: string]: unknown;
}

// ── Channel implementation ──

export class StdioChannel extends ChannelBase {
  readonly type: ChannelType = 'stdio' as ChannelType;

  private rl: readline.Interface | null = null;
  private activeSessions: Set<string> = new Set();

  async start(): Promise<void> {
    if (this._connected) return;

    this.rl = readline.createInterface({
      input: process.stdin,
      terminal: false,
    });

    this.rl.on('line', (line) => this.handleLine(line));
    this.rl.on('close', () => this.handleClose());

    // Handle EPIPE: reader closed the pipe while we're still writing
    process.stdout.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EPIPE') {
        log('[StdioChannel] stdout EPIPE — reader disconnected');
        this._connected = false;
      } else {
        logError('[StdioChannel] stdout error:', err);
      }
    });

    this._connected = true;
    this.logStatus('started');
    this.writeEvent({ type: 'stdio.ready' });
  }

  async stop(): Promise<void> {
    if (!this._connected) return;

    this._connected = false;
    this.activeSessions.clear();

    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }

    this.logStatus('stopped');
  }

  async send(response: RemoteResponse): Promise<void> {
    if (!this._connected) return;

    const { channelId, content, replyTo } = response;

    // The stdioEventInterceptor handles real-time streaming (text_delta, tool events)
    // using proper session IDs. This send() path is only called by MessageRouter's
    // responseCallback for error/status responses (which have replyTo set).
    // Skip non-reply responses to avoid duplicate text with wrong session IDs.
    if (!replyTo) return;

    if (content.type === 'text' && content.text) {
      this.writeEvent({
        type: 'error',
        sessionId: channelId,
        message: content.text,
      });
    }
  }

  /**
   * Write a structured event for tool start.
   * Called directly by the integration layer (not through the standard send path).
   */
  writeToolStart(sessionId: string, tool: string, input: unknown): void {
    this.writeEvent({
      type: 'agent.tool_start',
      sessionId,
      tool,
      input,
    });
  }

  /**
   * Write a structured event for tool end.
   */
  writeToolEnd(sessionId: string, tool: string, output: string): void {
    this.writeEvent({
      type: 'agent.tool_end',
      sessionId,
      tool,
      output,
    });
  }

  /**
   * Write a session.started event.
   */
  writeSessionStarted(sessionId: string): void {
    this.activeSessions.add(sessionId);
    this.writeEvent({ type: 'session.started', sessionId });
  }

  /**
   * Write a session.end event.
   */
  writeSessionEnd(sessionId: string, result?: string): void {
    this.activeSessions.delete(sessionId);
    this.writeEvent({ type: 'session.end', sessionId, ...(result ? { result } : {}) });
  }

  /**
   * Write an error event.
   */
  writeError(message: string, sessionId?: string): void {
    this.writeEvent({ type: 'error', message, ...(sessionId ? { sessionId } : {}) });
  }

  // ── Private ──

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    let msg: StdioInputMessage;
    try {
      msg = JSON.parse(trimmed) as StdioInputMessage;
    } catch {
      this.writeError(`Invalid JSON: ${trimmed.slice(0, 200)}`);
      return;
    }

    if (!msg || typeof msg !== 'object' || !msg.type) {
      this.writeError('Message must have a "type" field');
      return;
    }

    switch (msg.type) {
      case 'session.start':
        this.handleSessionStart(msg);
        break;
      case 'session.message':
        this.handleSessionMessage(msg);
        break;
      case 'session.abort':
        this.handleSessionAbort(msg);
        break;
      default:
        this.writeError(`Unknown message type: ${(msg as { type: string }).type}`);
    }
  }

  private handleSessionStart(msg: StdioSessionStart): void {
    if (!msg.prompt) {
      this.writeError('session.start requires a "prompt" field');
      return;
    }

    const messageId = this.generateMessageId();
    // Use a consistent channel ID derived from the message for session routing
    const channelId = `stdio-${crypto.randomUUID()}`;

    const remoteMessage: RemoteMessage = {
      id: messageId,
      channelType: this.type,
      channelId,
      sender: {
        id: 'stdio-user',
        name: 'stdio',
        isBot: false,
      },
      content: {
        type: 'text',
        text: msg.cwd ? `[cwd:${msg.cwd}] ${msg.prompt}` : msg.prompt,
      },
      timestamp: Date.now(),
      isGroup: false,
      isMentioned: true,
    };

    this.emitMessage(remoteMessage);
  }

  private handleSessionMessage(msg: StdioSessionMessage): void {
    if (!msg.sessionId || !msg.text) {
      this.writeError('session.message requires "sessionId" and "text" fields');
      return;
    }

    const messageId = this.generateMessageId();

    const remoteMessage: RemoteMessage = {
      id: messageId,
      channelType: this.type,
      channelId: msg.sessionId,
      sender: {
        id: 'stdio-user',
        name: 'stdio',
        isBot: false,
      },
      content: {
        type: 'text',
        text: msg.text,
      },
      timestamp: Date.now(),
      isGroup: false,
      isMentioned: true,
    };

    this.emitMessage(remoteMessage);
  }

  private handleSessionAbort(msg: StdioSessionAbort): void {
    if (!msg.sessionId) {
      this.writeError('session.abort requires a "sessionId" field');
      return;
    }

    // Emit as a special abort message that the router can intercept
    const messageId = this.generateMessageId();

    const remoteMessage: RemoteMessage = {
      id: messageId,
      channelType: this.type,
      channelId: msg.sessionId,
      sender: {
        id: 'stdio-user',
        name: 'stdio',
        isBot: false,
      },
      content: {
        type: 'text',
        text: '!stop',
      },
      timestamp: Date.now(),
      isGroup: false,
      isMentioned: true,
    };

    this.emitMessage(remoteMessage);
  }

  private handleClose(): void {
    log('[StdioChannel] stdin closed');
    this._connected = false;

    // Emit abort for all active sessions so the agent stops
    for (const sessionId of this.activeSessions) {
      this.emitMessage({
        id: this.generateMessageId(),
        channelType: this.type,
        channelId: sessionId,
        sender: { id: 'stdio-user', name: 'stdio', isBot: false },
        content: { type: 'text', text: '!stop' },
        timestamp: Date.now(),
        isGroup: false,
        isMentioned: true,
      });
    }
    this.activeSessions.clear();

    if (this.rl) {
      this.rl = null;
    }
  }

  /**
   * Write a structured event to stdout (JSONL).
   */
  writeEvent(event: StdioOutputEvent): void {
    try {
      const line = JSON.stringify(event);
      process.stdout.write(line + '\n');
    } catch (err) {
      logError('[StdioChannel] Failed to write event:', err);
    }
  }
}
