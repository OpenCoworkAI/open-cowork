import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests for src/main/remote/channels/email/*
 *  - provider preset resolution
 *  - end-to-end receive -> emit -> threaded reply behaviour of EmailChannel
 */

// --- electron / logger stubs -------------------------------------------------
vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/test-user-data',
    getVersion: () => '0.0.0-test',
    isPackaged: false,
    on: vi.fn(),
  },
}));

// --- mail library mocks ------------------------------------------------------
const sendMailMock = vi.fn(async (_opts: Record<string, unknown>) => ({
  messageId: '<reply@bot>',
}));
const verifyMock = vi.fn(async () => true);
const closeMock = vi.fn();

vi.mock('nodemailer', () => ({
  createTransport: vi.fn(() => ({
    verify: verifyMock,
    sendMail: sendMailMock,
    close: closeMock,
  })),
}));

// One unseen message on the first poll, none afterwards.
let searchCalls = 0;
const messageFlagsAddMock = vi.fn(async () => true);

class MockImapFlow {
  usable = true;
  private handlers: Record<string, (arg: unknown) => void> = {};
  constructor(public opts: unknown) {}
  on(event: string, handler: (arg: unknown) => void) {
    this.handlers[event] = handler;
  }
  async connect() {}
  async logout() {}
  async getMailboxLock() {
    return { release: () => {} };
  }
  async search() {
    searchCalls += 1;
    return searchCalls === 1 ? [1] : [];
  }
  fetch() {
    async function* gen() {
      yield { uid: 1, source: Buffer.from('raw') };
    }
    return gen();
  }
  messageFlagsAdd = messageFlagsAddMock;
}

vi.mock('imapflow', () => ({ ImapFlow: MockImapFlow }));

const parsed = {
  from: { value: [{ address: 'User@Example.com', name: 'User' }] },
  subject: 'Re: Help me',
  text: 'please help',
  html: '',
  messageId: '<msg1@example.com>',
  references: '<root@example.com>',
  inReplyTo: '<root@example.com>',
  date: new Date('2026-01-01T00:00:00Z'),
};
vi.mock('mailparser', () => ({ simpleParser: vi.fn(async () => parsed) }));

// -----------------------------------------------------------------------------
import { EmailChannel } from '../../main/remote/channels/email/email-channel';
import {
  resolveImapEndpoint,
  resolveSmtpEndpoint,
} from '../../main/remote/channels/email/email-providers';
import type { EmailChannelConfig, RemoteMessage } from '../../main/remote/types';

function baseConfig(overrides: Partial<EmailChannelConfig> = {}): EmailChannelConfig {
  return {
    type: 'email',
    provider: 'gmail',
    user: 'assistant@example.com',
    password: 'app-secret',
    dm: { policy: 'allowlist', allowFrom: ['user@example.com'] },
    pollIntervalSec: 999, // effectively disable the interval during the test
    ...overrides,
  };
}

describe('email provider presets', () => {
  it('resolves preset IMAP/SMTP endpoints for a known provider', () => {
    const cfg = baseConfig({ provider: 'gmail' });
    expect(resolveImapEndpoint(cfg)).toEqual({ host: 'imap.gmail.com', port: 993, secure: true });
    expect(resolveSmtpEndpoint(cfg)).toEqual({ host: 'smtp.gmail.com', port: 465, secure: true });
  });

  it('prefers explicit endpoints over the preset', () => {
    const cfg = baseConfig({
      provider: 'gmail',
      imap: { host: 'imap.custom', port: 143, secure: false },
    });
    expect(resolveImapEndpoint(cfg)).toEqual({ host: 'imap.custom', port: 143, secure: false });
  });

  it('throws for a custom provider without explicit hosts', () => {
    const cfg = baseConfig({ provider: 'custom', imap: undefined, smtp: undefined });
    expect(() => resolveImapEndpoint(cfg)).toThrow(/custom email provider/i);
    expect(() => resolveSmtpEndpoint(cfg)).toThrow(/custom email provider/i);
  });
});

describe('EmailChannel', () => {
  beforeEach(() => {
    searchCalls = 0;
    sendMailMock.mockClear();
    messageFlagsAddMock.mockClear();
  });

  afterEach(async () => {
    vi.clearAllTimers();
  });

  it('receives an email and emits a threaded RemoteMessage, then marks it seen', async () => {
    const channel = new EmailChannel(baseConfig());
    const received: RemoteMessage[] = [];
    channel.onMessage((m) => received.push(m));

    await channel.start();

    expect(received).toHaveLength(1);
    const msg = received[0];
    // channelId is the thread root (References[0]).
    expect(msg.channelId).toBe('<root@example.com>');
    // Sender address is normalized to lowercase.
    expect(msg.sender.id).toBe('user@example.com');
    expect(msg.content.text).toContain('Subject: Re: Help me');
    expect(msg.content.text).toContain('please help');
    expect(msg.isMentioned).toBe(true);
    // The message was flagged \Seen so it is not reprocessed.
    expect(messageFlagsAddMock).toHaveBeenCalledTimes(1);

    await channel.stop();
  });

  it('sends a correctly threaded reply for a known thread', async () => {
    const channel = new EmailChannel(baseConfig());
    channel.onMessage(() => {});
    await channel.start();

    await channel.send({
      channelType: 'email',
      channelId: '<root@example.com>',
      content: { type: 'markdown', markdown: 'Sure, here is the answer.' },
    });

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const arg = sendMailMock.mock.calls[0][0];
    expect(arg.to).toBe('user@example.com');
    expect(arg.subject).toBe('Re: Help me');
    expect(arg.text).toBe('Sure, here is the answer.');
    // In-Reply-To points at the user's last message; References carries the chain.
    expect(arg.inReplyTo).toBe('<msg1@example.com>');
    expect(arg.references).toEqual(
      expect.arrayContaining(['<root@example.com>', '<msg1@example.com>'])
    );

    await channel.stop();
  });

  it('drops replies for an unknown thread without throwing', async () => {
    const channel = new EmailChannel(baseConfig());
    channel.onMessage(() => {});
    await channel.start();

    await expect(
      channel.send({
        channelType: 'email',
        channelId: '<does-not-exist>',
        content: { type: 'text', text: 'hi' },
      })
    ).resolves.toBeUndefined();
    expect(sendMailMock).not.toHaveBeenCalled();

    await channel.stop();
  });
});
