import type { TelegramChannelConfig } from './ipc-types';

export function getTelegramConfigError(config: TelegramChannelConfig): string | null {
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(config.botToken.trim())) return 'Invalid Telegram bot token';
  if (config.webhookUrl) return 'Telegram settings currently support long polling only';
  if (
    config.dm.policy !== 'allowlist' ||
    !config.dm.allowFrom?.length ||
    config.dm.allowFrom.some((id) => !/^\d+$/.test(id))
  ) {
    return 'Telegram requires at least one numeric allowed user ID';
  }
  return null;
}
