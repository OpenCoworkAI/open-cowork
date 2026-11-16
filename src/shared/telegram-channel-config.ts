import type { TelegramChannelConfig } from './ipc-types';

export function getTelegramConfigError(config: TelegramChannelConfig): string | null {
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(config.botToken.trim())) return 'Invalid Telegram bot token';
  if (config.webhookUrl) return 'Telegram settings currently support long polling only';
  if (
    config.notifications !== undefined &&
    (typeof config.notifications !== 'object' ||
      config.notifications === null ||
      Array.isArray(config.notifications) ||
      Object.values(config.notifications).some((value) => typeof value !== 'boolean'))
  ) {
    return 'Telegram notification preferences must be booleans';
  }
  if (
    config.dm.policy !== 'allowlist' ||
    !config.dm.allowFrom?.length ||
    config.dm.allowFrom.some((id) => !/^\d+$/.test(id))
  ) {
    return 'Telegram requires at least one numeric allowed user ID';
  }
  return null;
}
