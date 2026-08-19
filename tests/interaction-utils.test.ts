import { describe, expect, it } from 'vitest';
import { parsePermissionReply, normalizeChannelId } from '../src/main/remote/interaction-utils';

describe('parsePermissionReply', () => {
  const allowOnceTokens = ['y', 'yes', 'allow', 'approve', 'ok', '1', '是', '允许'];
  const rememberTokens = ['always', 'allow always', 'allow_always', '始终允许'];
  const denyTokens = ['n', 'no', 'deny', 'reject', '0', '拒绝'];

  it.each(allowOnceTokens)('treats %j as allow once', (token) => {
    expect(parsePermissionReply(token)).toEqual({ allow: true });
  });

  it.each(rememberTokens)('treats %j as allow and remember', (token) => {
    expect(parsePermissionReply(token)).toEqual({ allow: true, remember: true });
  });

  it.each(denyTokens)('treats %j as deny', (token) => {
    expect(parsePermissionReply(token)).toEqual({ allow: false });
  });

  it('normalizes case, whitespace, and trailing punctuation', () => {
    expect(parsePermissionReply('  YES  ')).toEqual({ allow: true });
    expect(parsePermissionReply('Allow.')).toEqual({ allow: true });
    expect(parsePermissionReply('approve!')).toEqual({ allow: true });
    expect(parsePermissionReply('允许。')).toEqual({ allow: true });
    expect(parsePermissionReply('允许！')).toEqual({ allow: true });
    expect(parsePermissionReply('  always  ')).toEqual({ allow: true, remember: true });
    expect(parsePermissionReply('Always.')).toEqual({ allow: true, remember: true });
    expect(parsePermissionReply('allow   always')).toEqual({ allow: true, remember: true });
    expect(parsePermissionReply('NO!')).toEqual({ allow: false });
  });

  it('treats unrecognized text as deny (fail-closed)', () => {
    expect(parsePermissionReply('')).toEqual({ allow: false });
    expect(parsePermissionReply('maybe')).toEqual({ allow: false });
    expect(parsePermissionReply('please allow it')).toEqual({ allow: false });
    expect(parsePermissionReply('ok thanks')).toEqual({ allow: false });
    expect(parsePermissionReply('Allow?')).toEqual({ allow: false }); // '?' is not stripped
  });

  it('prefers remember over allow when both could match', () => {
    // "allow always" must not be parsed as allow-once
    expect(parsePermissionReply('allow always')).toEqual({ allow: true, remember: true });
  });
});

describe('normalizeChannelId', () => {
  it('strips a Slack thread suffix', () => {
    expect(normalizeChannelId('C123:1700000000.123456')).toBe('C123');
  });

  it('keeps plain channel ids unchanged', () => {
    expect(normalizeChannelId('C123')).toBe('C123');
  });

  it('keeps Feishu / stdio ids unchanged (no colon)', () => {
    expect(normalizeChannelId('ou_abc123')).toBe('ou_abc123');
    expect(normalizeChannelId('stdio-session-1')).toBe('stdio-session-1');
  });

  it('cuts at the first colon', () => {
    expect(normalizeChannelId('C123:1700.1:extra')).toBe('C123');
  });

  it('handles empty input', () => {
    expect(normalizeChannelId('')).toBe('');
  });
});
