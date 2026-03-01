import { describe, expect, it } from 'vitest';
import { redactSensitiveText } from '../src/main/claude/redaction';

describe('redactSensitiveText', () => {
  it('redacts sk-style keys', () => {
    const input = 'key=sk-ant-abcdefghijklmnopqrstuvwxyz123456';
    const output = redactSensitiveText(input);
    expect(output).toContain('[REDACTED_KEY]');
    expect(output).not.toContain('abcdefghijklmnopqrstuvwxyz123456');
  });

  it('redacts env assignment formats', () => {
    const input = 'OPENAI_API_KEY=sk-abcdef1234567890token';
    const output = redactSensitiveText(input);
    expect(output).toBe('OPENAI_API_KEY=[REDACTED_KEY]');
  });

  it('redacts plain header formats', () => {
    const input = 'authorization: Bearer secret_token_value_1234567890';
    const output = redactSensitiveText(input);
    expect(output).toBe('authorization: [REDACTED_KEY]');
  });

  it('redacts JSON-like header formats', () => {
    const input = '{"x-api-key":"abcDEF1234567890+/="}';
    const output = redactSensitiveText(input);
    expect(output).toBe('{"x-api-key":"[REDACTED_KEY]"}');
  });

  it('redacts standalone bearer tokens', () => {
    const input = 'Authorization failed for bearer abcdefghijklmnopqrstuvwxyz123456';
    const output = redactSensitiveText(input);
    expect(output).toContain('Bearer [REDACTED_KEY]');
    expect(output).not.toContain('abcdefghijklmnopqrstuvwxyz123456');
  });

  it('redacts query-string tokens', () => {
    const input = 'https://example.com/path?token=abc1234567890&x=1';
    const output = redactSensitiveText(input);
    expect(output).toBe('https://example.com/path?token=[REDACTED_KEY]&x=1');
  });

  it('keeps normal text unchanged', () => {
    const input = 'network timeout while requesting model list';
    const output = redactSensitiveText(input);
    expect(output).toBe(input);
  });
});
