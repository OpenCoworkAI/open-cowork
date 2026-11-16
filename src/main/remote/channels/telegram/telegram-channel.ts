import { ChannelBase } from '../channel-base';
import type { RemoteContent, RemoteResponse, TelegramChannelConfig } from '../../types';
import { getTelegramConfigError } from '../../../../shared/telegram-channel-config';
import { logWarn } from '../../../utils/logger';

interface TelegramFile {
  file_id: string;
  file_size?: number;
  file_name?: string;
  mime_type?: string;
}
interface TelegramMessage {
  message_id: number;
  date: number;
  chat: { id: number; type: string };
  from?: { id: number; is_bot: boolean; first_name?: string };
  text?: string;
  caption?: string;
  photo?: TelegramFile[];
  document?: TelegramFile;
}
interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}
const MAX_FILE_BYTES = 10 * 1024 * 1024;

function formatTelegramHtml(text: string): string {
  const escape = (value: string) =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let html = '';
  let offset = 0;
  for (const match of text.matchAll(/```[^\n`]*\n([\s\S]*?)```|`([^`\n]+)`/g)) {
    html += escape(text.slice(offset, match.index));
    html +=
      match[1] !== undefined
        ? `<pre>${escape(match[1])}</pre>`
        : `<code>${escape(match[2])}</code>`;
    offset = match.index + match[0].length;
  }
  return html + escape(text.slice(offset));
}

/** Polling needs no public webhook. Tokens never appear in logged error objects. */
export class TelegramChannel extends ChannelBase {
  readonly type = 'telegram' as const;
  private controller?: AbortController;
  private polling?: Promise<void>;
  private offset = 0;

  constructor(private config: TelegramChannelConfig) {
    super();
  }

  async start(): Promise<void> {
    if (this.controller) return;
    const configError = getTelegramConfigError(this.config);
    if (configError) throw new Error(configError);
    const controller = new AbortController();
    this.controller = controller;
    try {
      await this.api('getMe', {}, controller.signal);
      await this.api('deleteWebhook', { drop_pending_updates: false }, controller.signal);
      if (controller.signal.aborted) return;
      this._connected = true;
      this.polling = this.poll(controller.signal);
    } catch {
      if (this.controller === controller) {
        this.controller = undefined;
        this._connected = false;
      }
      if (controller.signal.aborted) return;
      throw new Error('Unable to connect to Telegram. Check the bot token and network.');
    }
  }

  async stop(): Promise<void> {
    const controller = this.controller;
    controller?.abort();
    await this.polling;
    if (this.controller === controller) {
      this.polling = undefined;
      this.controller = undefined;
      this._connected = false;
    }
  }

  private async poll(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        const updates = await this.api<TelegramUpdate[]>(
          'getUpdates',
          {
            offset: this.offset,
            timeout: 25,
            allowed_updates: ['message'],
          },
          signal
        );
        if (signal.aborted) break;
        this._connected = true;
        for (const update of updates) {
          if (signal.aborted) break;
          if (update.update_id < this.offset) continue;
          // A malformed message must not cause an infinite replay loop.
          this.offset = update.update_id + 1;
          try {
            if (update.message) await this.receive(update.message, signal);
          } catch {
            logWarn('[Telegram] Unable to process a message or attachment');
          }
        }
      } catch {
        if (signal.aborted) break;
        this._connected = false;
        logWarn('[Telegram] Polling failed; retrying');
        await new Promise<void>((resolve) => {
          const finish = () => {
            clearTimeout(timer);
            signal.removeEventListener('abort', finish);
            resolve();
          };
          const timer = setTimeout(finish, 3000);
          signal.addEventListener('abort', finish, { once: true });
          if (signal.aborted) finish();
        });
      }
    }
  }

  private async receive(message: TelegramMessage, signal: AbortSignal): Promise<void> {
    // Enforce the channel's whitelist before downloading or emitting anything,
    // even when the shared gateway is open for another connector.
    if (
      !message.from ||
      message.from.is_bot ||
      message.chat.type !== 'private' ||
      !this.config.dm.allowFrom?.includes(String(message.from.id))
    )
      return;
    let content: RemoteContent = { type: 'text', text: message.text || message.caption || '' };
    const photo = message.photo?.at(-1);
    const attachment = photo || message.document;
    if (attachment) {
      try {
        const bytes = await this.download(attachment, signal);
        if (photo) {
          content = {
            type: 'image',
            imageBase64: bytes.toString('base64'),
            imageMediaType: 'image/jpeg',
            text: message.caption,
          };
        } else {
          content = {
            type: 'file',
            text: message.caption,
            file: {
              name: attachment.file_name || 'attachment',
              size: bytes.length,
              mimeType: attachment.mime_type,
              inlineDataBase64: bytes.toString('base64'),
            },
          };
        }
      } catch {
        await this.api(
          'sendMessage',
          {
            chat_id: message.chat.id,
            text: 'Unable to download this attachment. Maximum supported size is 10 MB.',
          },
          signal
        );
        return;
      }
    }
    if (!content.text && !attachment) return;
    if (signal.aborted) return;
    this.emitMessage({
      id: String(message.message_id),
      channelType: this.type,
      channelId: String(message.chat.id),
      sender: { id: String(message.from.id), name: message.from.first_name, isBot: false },
      content,
      timestamp: message.date * 1000,
      isGroup: false,
      isMentioned: false,
    });
  }

  async send(response: RemoteResponse): Promise<void> {
    if (!this.controller || this.controller.signal.aborted) throw new Error('Telegram is stopped');
    const { content } = response;
    const text = content.text || content.markdown;
    if (text) {
      // Escape arbitrary model output before adding supported code markup.
      for (const chunk of this.splitMessage(text, 4000)) {
        await this.api(
          'sendMessage',
          {
            chat_id: response.channelId,
            text: formatTelegramHtml(chunk),
            parse_mode: 'HTML',
            ...(content.card ? { reply_markup: content.card } : {}),
          },
          this.controller.signal
        );
      }
    } else if (content.image?.url || content.image?.key) {
      await this.api(
        'sendPhoto',
        { chat_id: response.channelId, photo: content.image.url || content.image.key },
        this.controller.signal
      );
    } else if (content.file?.url) {
      await this.api(
        'sendDocument',
        { chat_id: response.channelId, document: content.file.url },
        this.controller.signal
      );
    } else {
      throw new Error('Unsupported Telegram response content');
    }
  }

  private async download(file: TelegramFile, signal: AbortSignal): Promise<Buffer> {
    if ((file.file_size ?? 0) > MAX_FILE_BYTES) throw new Error('Attachment too large');
    const info = await this.api<{ file_path?: string; file_size?: number }>(
      'getFile',
      { file_id: file.file_id },
      signal
    );
    if (!info.file_path || (info.file_size ?? 0) > MAX_FILE_BYTES)
      throw new Error('Invalid attachment');
    const response = await fetch(
      `https://api.telegram.org/file/bot${this.config.botToken}/${info.file_path}`,
      {
        signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
        redirect: 'error',
      }
    );
    if (
      !response.ok ||
      Number(response.headers.get('content-length')) > MAX_FILE_BYTES ||
      !response.body
    )
      throw new Error('Attachment download failed');
    const chunks: Buffer[] = [];
    let total = 0;
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > MAX_FILE_BYTES) throw new Error('Attachment too large');
        chunks.push(Buffer.from(value));
      }
      return Buffer.concat(chunks);
    } finally {
      await reader.cancel();
    }
  }

  private async api<T = unknown>(
    method: string,
    body: Record<string, unknown>,
    signal: AbortSignal
  ): Promise<T> {
    try {
      const response = await fetch(
        `https://api.telegram.org/bot${this.config.botToken}/${method}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.any([signal, AbortSignal.timeout(35000)]),
          redirect: 'error',
        }
      );
      if (!response.ok) throw new Error('HTTP error');
      const result = (await response.json()) as { ok: boolean; result: T };
      if (!result.ok) throw new Error('API error');
      return result.result;
    } catch {
      throw new Error(`Telegram ${method} request failed`);
    }
  }
}
