/**
 * Slack channel config helpers shared by renderer validation and main IPC.
 *
 * Remote Control settings persist Socket Mode only (`useSocketMode: true`).
 * Webhook mode (`useSocketMode === false`) requires `signingSecret` because
 * SlackChannel.verifySlackSignature rejects requests without it.
 */

import type { SlackChannelConfig } from './ipc-types';

export const SLACK_SOCKET_MODE_BOT_TOKEN_REQUIRED = 'Slack Socket Mode requires a bot token';
export const SLACK_SOCKET_MODE_APP_TOKEN_REQUIRED = 'Slack Socket Mode requires an app token';
export const SLACK_WEBHOOK_SIGNING_SECRET_REQUIRED = 'Slack webhook mode requires a signing secret';

export const SLACK_DM_POLICIES = ['open', 'pairing', 'allowlist'] as const;
export type SlackDmPolicy = (typeof SLACK_DM_POLICIES)[number];

const GATEWAY_AUTH_STRICTNESS: Record<string, number> = {
  open: 1,
  pairing: 2,
  allowlist: 3,
  token: 4,
};

export function parseSlackDmPolicy(value: unknown): SlackDmPolicy {
  return SLACK_DM_POLICIES.includes(value as SlackDmPolicy) ? (value as SlackDmPolicy) : 'pairing';
}

export function getSlackChannelConfigError(config: {
  botToken?: string;
  appToken?: string;
  useSocketMode?: boolean;
  signingSecret?: string;
}): string | null {
  if (!config.botToken?.trim()) {
    return SLACK_SOCKET_MODE_BOT_TOKEN_REQUIRED;
  }

  if (config.useSocketMode === false) {
    if (!config.signingSecret?.trim()) {
      return SLACK_WEBHOOK_SIGNING_SECRET_REQUIRED;
    }
    return null;
  }

  if (!config.appToken?.trim()) {
    return SLACK_SOCKET_MODE_APP_TOKEN_REQUIRED;
  }

  return null;
}

export function isSlackSocketConfigComplete(config: {
  botToken?: string;
  appToken?: string;
}): boolean {
  return Boolean(config.botToken?.trim() && config.appToken?.trim());
}

/**
 * Pairing guide / pending-pairing empty state should follow Feishu, and Slack
 * only when Slack is actually configured. Unconfigured Slack defaults to
 * pairing in form state and must not force the pairing UI on Feishu-only setups.
 */
export function isRemotePairingPolicy(options: {
  feishuDmPolicy: string;
  slackDmPolicy: string;
  isSlackConfigured: boolean;
}): boolean {
  return (
    options.feishuDmPolicy === 'pairing' ||
    (options.isSlackConfigured && options.slackDmPolicy === 'pairing')
  );
}

/**
 * Slack must not relax a stricter gateway auth mode already enforced by Feishu
 * (or another channel). allowlist > pairing > open; token is never rewritten.
 */
export function shouldApplySlackDmPolicyToGateway(
  slackPolicy: SlackDmPolicy,
  currentMode: string | undefined
): boolean {
  if (currentMode === 'token') {
    return false;
  }
  const currentRank = GATEWAY_AUTH_STRICTNESS[currentMode ?? ''] ?? 0;
  const nextRank = GATEWAY_AUTH_STRICTNESS[slackPolicy] ?? 0;
  return nextRank >= currentRank;
}

export function mergeSlackChannelConfig(
  existing: SlackChannelConfig | undefined,
  incoming: SlackChannelConfig
): SlackChannelConfig {
  return {
    ...existing,
    ...incoming,
    dm: {
      ...existing?.dm,
      ...incoming.dm,
    },
    groups: incoming.groups ?? existing?.groups,
    channels: incoming.channels ?? existing?.channels,
  };
}

export function buildSlackSocketChannelConfig(input: {
  botToken: string;
  appToken: string;
  dmPolicy: unknown;
}): SlackChannelConfig {
  return {
    type: 'slack',
    botToken: input.botToken.trim(),
    appToken: input.appToken.trim(),
    useSocketMode: true,
    dm: { policy: parseSlackDmPolicy(input.dmPolicy) },
  };
}
