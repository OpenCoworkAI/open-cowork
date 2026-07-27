/**
 * Email Channel
 *
 * Lets users drive the agent over email. Incoming mail is received via IMAP
 * (polling the inbox for unseen messages); agent replies are sent via SMTP as
 * properly threaded responses (In-Reply-To / References), so the whole
 * conversation maps to a single agent session per mail thread.
 *
 * Works with common market providers (Gmail, Outlook/Microsoft 365, Yahoo,
 * iCloud, GMX, WEB.DE, Zoho) via presets, or any custom IMAP/SMTP server.
 *
 * Credentials are held in memory only for the lifetime of the channel; they are
 * persisted encrypted at rest by the remote config store and are never logged.
 */

import { ChannelBase, withRetry } from '../channel-base';
import { log, logError, logWarn } from '../../../utils/logger';
import { resolveImapEndpoint, resolveSmtpEndpoint } from './email-providers';
import type {
  EmailChannelConfig,
  RemoteMessage,
  RemoteResponse,
  RemoteResponseContent,
} from '../../types';

// Lazy-loaded SDK types (imported dynamically at runtime, like the Slack channel)
type ImapFlowClient = import('imapflow').ImapFlow;
type SmtpTransport = import('nodemailer').Transporter;

/** Reply routing info captured per mail thread. */
interface ThreadRef {
  /** Address to reply to (original sender). */
  to: string;
  /** Original subject (without a leading Re:). */
  subject: string;
  /** Message-ID of the most recent message in the thread. */
  lastMessageId: string;
  /** Full References chain for the thread. */
  references: string[];
}

const DEFAULT_MAILBOX = 'INBOX';
const DEFAULT_POLL_INTERVAL_SEC = 30;
const MIN_POLL_INTERVAL_SEC = 10;
/** Cap on remembered message-ids / threads to keep memory bounded. */
const MAX_TRACKED = 2000;

export class EmailChannel extends ChannelBase {
  readonly type = 'email' as const;

  private config: EmailChannelConfig;
  private imap?: ImapFlowClient;
  private smtp?: SmtpTransport;
  private pollTimer?: NodeJS.Timeout;
  private polling = false;
  private stopping = false;

  /** channelId (thread root message-id) -> reply routing info. */
  private threads = new Map<string, ThreadRef>();
  /** Guard against processing the same message twice across overlapping polls. */
  private processedMessageIds = new Set<string>();

  constructor(config: EmailChannelConfig) {
    super();
    this.config = config;
  }

  async start(): Promise<void> {
    if (this._connected) {
      logWarn('[Email] Channel already started');
      return;
    }

    this.logStatus('Starting channel...', { user: this.config.user });
    this.stopping = false;

    const imapEndpoint = resolveImapEndpoint(this.config);
    const smtpEndpoint = resolveSmtpEndpoint(this.config);

    try {
      const { ImapFlow } = await import('imapflow');
      const nodemailer = await import('nodemailer');

      // SMTP transport (created once, reused for every reply)
      this.smtp = nodemailer.createTransport({
        host: smtpEndpoint.host,
        port: smtpEndpoint.port,
        secure: smtpEndpoint.secure,
        // STARTTLS ports (e.g. 587) must still negotiate TLS before auth.
        requireTLS: !smtpEndpoint.secure,
        auth: { user: this.config.user, pass: this.config.password },
      });
      await this.smtp.verify();
      log('[Email] SMTP transport verified:', smtpEndpoint.host);

      // IMAP client
      this.imap = new ImapFlow({
        host: imapEndpoint.host,
        port: imapEndpoint.port,
        secure: imapEndpoint.secure,
        auth: { user: this.config.user, pass: this.config.password },
        logger: false,
      });

      this.imap.on('error', (error: Error) => {
        // Connection-level errors are recovered on the next poll via ensureImap().
        logWarn('[Email] IMAP connection error:', error.message);
      });

      await this.imap.connect();
      log('[Email] IMAP connected:', imapEndpoint.host);

      this._connected = true;

      // Prime the inbox immediately, then poll on an interval.
      await this.pollOnce();
      const intervalMs =
        Math.max(this.config.pollIntervalSec ?? DEFAULT_POLL_INTERVAL_SEC, MIN_POLL_INTERVAL_SEC) *
        1000;
      this.pollTimer = setInterval(() => {
        void this.pollOnce();
      }, intervalMs);

      this.logStatus('Channel started successfully', {
        imap: imapEndpoint.host,
        smtp: smtpEndpoint.host,
        pollIntervalSec: intervalMs / 1000,
      });
    } catch (error) {
      logError('[Email] Failed to start channel:', this.describeError(error));
      this._connected = false;
      await this.cleanup();
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  async stop(): Promise<void> {
    if (!this._connected && !this.imap && !this.smtp) return;

    this.logStatus('Stopping channel...');
    this.stopping = true;
    await this.cleanup();
    this._connected = false;
    this.logStatus('Channel stopped');
  }

  private async cleanup(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    try {
      await this.imap?.logout();
    } catch {
      // ignore logout errors during shutdown
    }
    this.imap = undefined;
    try {
      this.smtp?.close();
    } catch {
      // ignore
    }
    this.smtp = undefined;
  }

  async send(response: RemoteResponse): Promise<void> {
    if (!this._connected || !this.smtp) {
      throw new Error('Channel not connected');
    }

    const thread = this.threads.get(response.channelId);
    if (!thread) {
      logWarn('[Email] No thread found for channelId, dropping reply:', response.channelId);
      return;
    }

    const body = this.contentToText(response.content);
    if (!body.trim()) return;

    await withRetry(
      async () => {
        await this.sendReply(thread, body);
      },
      {
        maxRetries: 3,
        delayMs: 1500,
        onRetry: (attempt, error) => {
          logWarn(`[Email] Send retry ${attempt}:`, error.message);
        },
      }
    );
  }

  // ==========================================================================
  // Receiving
  // ==========================================================================

  /** Ensure the IMAP client exists and is usable, reconnecting if needed. */
  private async ensureImap(): Promise<ImapFlowClient> {
    if (this.imap && this.imap.usable) return this.imap;

    const { ImapFlow } = await import('imapflow');
    const imapEndpoint = resolveImapEndpoint(this.config);
    log('[Email] (Re)connecting IMAP:', imapEndpoint.host);

    this.imap = new ImapFlow({
      host: imapEndpoint.host,
      port: imapEndpoint.port,
      secure: imapEndpoint.secure,
      auth: { user: this.config.user, pass: this.config.password },
      logger: false,
    });
    this.imap.on('error', (error: Error) => {
      logWarn('[Email] IMAP connection error:', error.message);
    });
    await this.imap.connect();
    return this.imap;
  }

  /** Poll the mailbox once for unseen messages and emit them to the agent. */
  private async pollOnce(): Promise<void> {
    if (this.polling || this.stopping) return;
    this.polling = true;

    const mailbox = this.config.mailbox || DEFAULT_MAILBOX;
    let lock: Awaited<ReturnType<ImapFlowClient['getMailboxLock']>> | undefined;

    try {
      const client = await this.ensureImap();
      lock = await client.getMailboxLock(mailbox);

      const uids = (await client.search({ seen: false }, { uid: true })) || [];
      if (uids.length === 0) return;

      log('[Email] Found', uids.length, 'unseen message(s)');

      for await (const msg of client.fetch(uids, { uid: true, source: true }, { uid: true })) {
        try {
          await this.processIncoming(msg.source as Buffer);
          // Mark as seen so it is not reprocessed on the next poll.
          await client.messageFlagsAdd(msg.uid, ['\\Seen'], { uid: true });
        } catch (error) {
          logError('[Email] Failed to process message:', this.describeError(error));
        }
      }
    } catch (error) {
      if (!this.stopping) {
        logWarn('[Email] Poll failed:', this.describeError(error));
      }
    } finally {
      lock?.release();
      this.polling = false;
    }
  }

  /** Parse a raw message and emit it as a RemoteMessage. */
  private async processIncoming(source: Buffer): Promise<void> {
    const { simpleParser } = await import('mailparser');
    const parsed = await simpleParser(source);

    const fromAddress = parsed.from?.value?.[0]?.address?.toLowerCase();
    if (!fromAddress) {
      logWarn('[Email] Skipping message without a From address');
      return;
    }

    // Ignore mail we sent ourselves (avoids loops on providers that copy Sent to Inbox).
    if (fromAddress === (this.config.fromAddress || this.config.user).toLowerCase()) {
      return;
    }

    const messageId = parsed.messageId || `${fromAddress}-${Date.now()}`;
    if (this.processedMessageIds.has(messageId)) return;
    this.remember(this.processedMessageIds, messageId);

    const references = this.normalizeReferences(parsed.references, parsed.inReplyTo);
    // Thread root is the stable conversation id: first entry of the References
    // chain, or this message's own id for a brand-new thread.
    const rootId = references[0] || messageId;
    const channelId = rootId;

    const rawSubject = parsed.subject || '(no subject)';
    const baseSubject = this.stripReplyPrefix(rawSubject);
    const body = (parsed.text || parsed.html || '').toString();

    // Record / update reply routing for this thread.
    this.remember(this.threads, channelId, {
      to: fromAddress,
      subject: baseSubject,
      lastMessageId: messageId,
      references: [...references, messageId],
    });

    const remoteMessage: RemoteMessage = {
      id: messageId,
      channelType: 'email',
      channelId,
      sender: {
        id: fromAddress,
        name: parsed.from?.value?.[0]?.name || fromAddress,
        isBot: false,
      },
      content: {
        type: 'text',
        text: `Subject: ${rawSubject}\n\n${body}`.trim(),
      },
      timestamp: (parsed.date instanceof Date ? parsed.date : new Date()).getTime(),
      isGroup: false,
      // Direct mail to the bot is always treated as an explicit request.
      isMentioned: true,
    };

    this.emitMessage(remoteMessage);
  }

  // ==========================================================================
  // Sending
  // ==========================================================================

  private async sendReply(thread: ThreadRef, body: string): Promise<void> {
    if (!this.smtp) throw new Error('SMTP transport not initialized');

    const fromAddress = this.config.fromAddress || this.config.user;
    const from = this.config.fromName ? `${this.config.fromName} <${fromAddress}>` : fromAddress;

    const info = await this.smtp.sendMail({
      from,
      to: thread.to,
      subject: this.ensureReplyPrefix(thread.subject),
      text: body,
      inReplyTo: thread.lastMessageId,
      references: thread.references,
    });

    // Our reply becomes the newest message in the thread so a follow-up reply
    // from the user threads correctly.
    if (info.messageId) {
      thread.lastMessageId = info.messageId;
      thread.references = [...thread.references, info.messageId];
    }

    log('[Email] Reply sent to', thread.to, 'messageId:', info.messageId);
  }

  private contentToText(content: RemoteResponseContent): string {
    switch (content.type) {
      case 'text':
        return content.text || '';
      case 'markdown':
        return content.markdown || '';
      case 'file':
        return content.file ? `[File: ${content.file.name}]` : '';
      case 'image':
        return '[Image attachment omitted]';
      default:
        return content.text || content.markdown || '';
    }
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  /** Normalize mailparser's references (string | string[] | undefined) to an array. */
  private normalizeReferences(
    references: string | string[] | undefined,
    inReplyTo: string | undefined
  ): string[] {
    const list: string[] = [];
    if (Array.isArray(references)) {
      list.push(...references);
    } else if (typeof references === 'string') {
      list.push(...references.split(/\s+/).filter(Boolean));
    }
    if (inReplyTo && !list.includes(inReplyTo)) {
      list.push(inReplyTo);
    }
    return list;
  }

  private stripReplyPrefix(subject: string): string {
    return subject.replace(/^\s*(re|aw|fwd|wg|fw)\s*:\s*/i, '').trim();
  }

  private ensureReplyPrefix(subject: string): string {
    return /^\s*re\s*:/i.test(subject) ? subject : `Re: ${subject}`;
  }

  /** Insert into a bounded Map/Set, evicting the oldest entry when full. */
  private remember<K, V>(store: Map<K, V> | Set<K>, key: K, value?: V): void {
    if (store instanceof Set) {
      if (store.size >= MAX_TRACKED) {
        const first = store.values().next().value as K | undefined;
        if (first !== undefined) store.delete(first);
      }
      store.add(key);
    } else {
      if (store.size >= MAX_TRACKED && !store.has(key)) {
        const first = store.keys().next().value as K | undefined;
        if (first !== undefined) store.delete(first);
      }
      store.set(key, value as V);
    }
  }

  /** Redact credentials from any error before it reaches the logs. */
  private describeError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    const pass = this.config.password;
    if (pass && message.includes(pass)) {
      return message.split(pass).join('***');
    }
    return message;
  }
}
