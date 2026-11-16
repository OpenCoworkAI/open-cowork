import { describe, expect, it } from 'vitest';
import {
  SLACK_SOCKET_MODE_APP_TOKEN_REQUIRED,
  SLACK_SOCKET_MODE_BOT_TOKEN_REQUIRED,
  SLACK_WEBHOOK_SIGNING_SECRET_REQUIRED,
  buildSlackSocketChannelConfig,
  getSlackChannelConfigError,
  isRemotePairingPolicy,
  isSlackSocketConfigComplete,
  mergeSlackChannelConfig,
  parseSlackDmPolicy,
  shouldApplySlackDmPolicyToGateway,
} from '../../shared/slack-channel-config';

describe('getSlackChannelConfigError', () => {
  it('rejects Socket Mode configs missing botToken', () => {
    expect(
      getSlackChannelConfigError({
        useSocketMode: true,
        appToken: 'xapp-test',
      })
    ).toBe(SLACK_SOCKET_MODE_BOT_TOKEN_REQUIRED);
    expect(
      getSlackChannelConfigError({
        botToken: '   ',
        appToken: 'xapp-test',
      })
    ).toBe(SLACK_SOCKET_MODE_BOT_TOKEN_REQUIRED);
  });

  it('rejects Socket Mode configs missing appToken', () => {
    expect(
      getSlackChannelConfigError({
        botToken: 'xoxb-test',
        useSocketMode: true,
      })
    ).toBe(SLACK_SOCKET_MODE_APP_TOKEN_REQUIRED);
    expect(
      getSlackChannelConfigError({
        botToken: 'xoxb-test',
        appToken: '   ',
      })
    ).toBe(SLACK_SOCKET_MODE_APP_TOKEN_REQUIRED);
  });

  it('rejects webhook configs without signingSecret', () => {
    expect(
      getSlackChannelConfigError({
        botToken: 'xoxb-test',
        useSocketMode: false,
      })
    ).toBe(SLACK_WEBHOOK_SIGNING_SECRET_REQUIRED);
    expect(
      getSlackChannelConfigError({
        botToken: 'xoxb-test',
        useSocketMode: false,
        signingSecret: '  ',
      })
    ).toBe(SLACK_WEBHOOK_SIGNING_SECRET_REQUIRED);
  });

  it('accepts complete Socket Mode and webhook configs', () => {
    expect(
      getSlackChannelConfigError({
        botToken: 'xoxb-test',
        appToken: 'xapp-test',
        useSocketMode: true,
      })
    ).toBeNull();
    expect(
      getSlackChannelConfigError({
        botToken: 'xoxb-test',
        useSocketMode: false,
        signingSecret: 'signing-secret',
      })
    ).toBeNull();
  });
});

describe('isSlackSocketConfigComplete', () => {
  it('requires both bot and app tokens', () => {
    expect(isSlackSocketConfigComplete({ botToken: 'xoxb-test' })).toBe(false);
    expect(isSlackSocketConfigComplete({ appToken: 'xapp-test' })).toBe(false);
    expect(isSlackSocketConfigComplete({ botToken: 'xoxb-test', appToken: 'xapp-test' })).toBe(
      true
    );
  });
});

describe('parseSlackDmPolicy', () => {
  it('accepts open, pairing, and allowlist', () => {
    expect(parseSlackDmPolicy('open')).toBe('open');
    expect(parseSlackDmPolicy('pairing')).toBe('pairing');
    expect(parseSlackDmPolicy('allowlist')).toBe('allowlist');
  });

  it('falls back to pairing for unexpected values', () => {
    expect(parseSlackDmPolicy('nope')).toBe('pairing');
    expect(parseSlackDmPolicy(undefined)).toBe('pairing');
  });
});

describe('isRemotePairingPolicy', () => {
  it('hides pairing UI when only Feishu is configured with open and Slack is unconfigured', () => {
    expect(
      isRemotePairingPolicy({
        feishuDmPolicy: 'open',
        slackDmPolicy: 'pairing',
        isSlackConfigured: false,
      })
    ).toBe(false);
    expect(
      isRemotePairingPolicy({
        feishuDmPolicy: 'allowlist',
        slackDmPolicy: 'pairing',
        isSlackConfigured: false,
      })
    ).toBe(false);
  });

  it('shows pairing UI for Feishu pairing or configured Slack pairing', () => {
    expect(
      isRemotePairingPolicy({
        feishuDmPolicy: 'pairing',
        slackDmPolicy: 'pairing',
        isSlackConfigured: false,
      })
    ).toBe(true);
    expect(
      isRemotePairingPolicy({
        feishuDmPolicy: 'open',
        slackDmPolicy: 'pairing',
        isSlackConfigured: true,
      })
    ).toBe(true);
  });
});

describe('shouldApplySlackDmPolicyToGateway', () => {
  it('does not relax an existing allowlist to pairing or open', () => {
    expect(shouldApplySlackDmPolicyToGateway('pairing', 'allowlist')).toBe(false);
    expect(shouldApplySlackDmPolicyToGateway('open', 'allowlist')).toBe(false);
  });

  it('allows equal or stricter updates', () => {
    expect(shouldApplySlackDmPolicyToGateway('allowlist', 'allowlist')).toBe(true);
    expect(shouldApplySlackDmPolicyToGateway('pairing', 'open')).toBe(true);
    expect(shouldApplySlackDmPolicyToGateway('pairing', 'pairing')).toBe(true);
  });

  it('never rewrites token auth', () => {
    expect(shouldApplySlackDmPolicyToGateway('allowlist', 'token')).toBe(false);
  });
});

describe('mergeSlackChannelConfig', () => {
  it('preserves dm.allowFrom and groups when the incoming payload omits them', () => {
    expect(
      mergeSlackChannelConfig(
        {
          type: 'slack',
          botToken: 'xoxb-old',
          appToken: 'xapp-old',
          useSocketMode: true,
          dm: { policy: 'allowlist', allowFrom: ['U123'] },
          groups: { C1: { requireMention: true } },
        },
        {
          type: 'slack',
          botToken: 'xoxb-new',
          appToken: 'xapp-new',
          useSocketMode: true,
          dm: { policy: 'pairing' },
        }
      )
    ).toEqual({
      type: 'slack',
      botToken: 'xoxb-new',
      appToken: 'xapp-new',
      useSocketMode: true,
      dm: { policy: 'pairing', allowFrom: ['U123'] },
      groups: { C1: { requireMention: true } },
    });
  });
});

describe('buildSlackSocketChannelConfig', () => {
  it('persists Socket Mode credentials and a validated DM policy', () => {
    expect(
      buildSlackSocketChannelConfig({
        botToken: '  xoxb-test  ',
        appToken: '  xapp-test  ',
        dmPolicy: 'open',
      })
    ).toEqual({
      type: 'slack',
      botToken: 'xoxb-test',
      appToken: 'xapp-test',
      useSocketMode: true,
      dm: { policy: 'open' },
    });
  });

  it('defaults invalid DM policy values to pairing', () => {
    expect(
      buildSlackSocketChannelConfig({
        botToken: 'xoxb-test',
        appToken: 'xapp-test',
        dmPolicy: 'invalid',
      }).dm.policy
    ).toBe('pairing');
  });
});
