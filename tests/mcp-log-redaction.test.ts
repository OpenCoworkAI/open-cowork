import { describe, it, expect } from 'vitest';

import {
  traceKeyTokens,
  isSensitiveTraceKey,
  redactSensitiveValue,
  redactSensitiveText,
  summarizeToolArgs,
} from '../src/main/mcp/mcp-log-redaction';

describe('traceKeyTokens (agent-desktop trace_key_tokens parity)', () => {
  it('splits camelCase boundaries', () => {
    expect(traceKeyTokens('userName')).toEqual(['user', 'name']);
    expect(traceKeyTokens('apiKey')).toEqual(['api', 'key']);
    expect(traceKeyTokens('windowTitle')).toEqual(['window', 'title']);
  });

  it('splits on non-alphanumeric separators', () => {
    expect(traceKeyTokens('window_title')).toEqual(['window', 'title']);
    expect(traceKeyTokens('AGENT_DESKTOP_SESSION')).toEqual([
      'agent',
      'desktop',
      'session',
    ]);
    expect(traceKeyTokens('request.url')).toEqual(['request', 'url']);
  });

  it('splits trailing uppercase runs like HTTPStatus', () => {
    expect(traceKeyTokens('HTTPStatus')).toEqual(['http', 'status']);
  });

  it('returns single token for simple keys', () => {
    expect(traceKeyTokens('text')).toEqual(['text']);
    expect(traceKeyTokens('x')).toEqual(['x']);
  });
});

describe('isSensitiveTraceKey', () => {
  it('flags sensitive simple keys', () => {
    expect(isSensitiveTraceKey('text')).toBe(true);
    expect(isSensitiveTraceKey('password')).toBe(true);
    expect(isSensitiveTraceKey('token')).toBe(true);
    expect(isSensitiveTraceKey('query')).toBe(true);
    expect(isSensitiveTraceKey('url')).toBe(true);
    expect(isSensitiveTraceKey('value')).toBe(true);
    expect(isSensitiveTraceKey('name')).toBe(true);
    expect(isSensitiveTraceKey('key')).toBe(true);
    expect(isSensitiveTraceKey('actions')).toBe(true);
  });

  it('flags composite keys containing sensitive tokens', () => {
    expect(isSensitiveTraceKey('user_token')).toBe(true);
    expect(isSensitiveTraceKey('api_url')).toBe(true);
    expect(isSensitiveTraceKey('window_title')).toBe(true);
    expect(isSensitiveTraceKey('placeholder')).toBe(true);
  });

  it('does not flag structural/non-sensitive keys', () => {
    expect(isSensitiveTraceKey('x')).toBe(false);
    expect(isSensitiveTraceKey('y')).toBe(false);
    expect(isSensitiveTraceKey('press_enter')).toBe(false);
    expect(isSensitiveTraceKey('coordinate_type')).toBe(false);
    expect(isSensitiveTraceKey('display_index')).toBe(false);
    expect(isSensitiveTraceKey('input_method')).toBe(false);
    expect(isSensitiveTraceKey('preserve_clipboard')).toBe(false);
    expect(isSensitiveTraceKey('timestamp')).toBe(false);
  });
});

describe('redactSensitiveValue', () => {
  it('redacts values under sensitive keys, keeping shape and length', () => {
    const input = {
      text: 'hello world',
      press_enter: true,
    };
    expect(redactSensitiveValue(input)).toEqual({
      text: { redacted: true, length: 11 },
      press_enter: true,
    });
  });

  it('redacts nested objects and arrays recursively', () => {
    const input = {
      files: [{ name: 'report.docx' }, { name: 'a.txt' }],
      meta: { query: 'select *', limit: 10 },
    };
    const out = redactSensitiveValue(input) as Record<string, unknown>;
    const files = out.files as Array<Record<string, unknown>>;
    expect(files[0].name).toEqual({ redacted: true, length: 11 });
    expect(files[1].name).toEqual({ redacted: true, length: 5 });
    const meta = out.meta as Record<string, unknown>;
    expect(meta.query).toEqual({ redacted: true, length: 8 });
    expect(meta.limit).toBe(10);
  });

  it('keeps null as null', () => {
    expect(redactSensitiveValue({ text: null })).toEqual({ text: null });
    expect(redactSensitiveValue(null)).toBeNull();
  });

  it('redacts numbers/booleans under sensitive keys without length', () => {
    expect(redactSensitiveValue({ value: 5 })).toEqual({
      value: { redacted: true },
    });
  });
});

describe('redactSensitiveText', () => {
  it('redacts JSON string values under sensitive keys', () => {
    const line = `args={"text":"typed secret content","press_enter":true}`;
    const out = redactSensitiveText(line);
    expect(out).toContain('"text": "[REDACTED(len=20)]"');
    expect(out).toContain('"press_enter":true');
    expect(out).not.toContain('typed secret content');
  });

  it('leaves non-sensitive JSON untouched', () => {
    const line = `config={"x":10,"y":20,"coordinate_type":"auto"}`;
    expect(redactSensitiveText(line)).toBe(line);
  });

  it('redacts key=value assignments for sensitive keys', () => {
    const out = redactSensitiveText('selector=button.submit, query=balance');
    expect(out).toContain('selector=[REDACTED(len=13)]');
    expect(out).toContain('query=[REDACTED(len=7)]');
  });

  it('leaves structural assignments untouched', () => {
    const line = '[performClick] x=512, y=300, displayIndex=0';
    expect(redactSensitiveText(line)).toBe(line);
  });

  it('redacts base64 data URIs (screenshots/clipboard images)', () => {
    const blob = 'iVBORw0KGgoAAAANSUhEUg'.padEnd(300, 'A');
    const out = redactSensitiveText(`screenshot data:image/png;base64,${blob}`);
    expect(out).toContain('[REDACTED(');
    expect(out).not.toContain(blob);
  });

  it('redacts long base64 runs', () => {
    const run = 'Q'.repeat(250);
    const out = redactSensitiveText(`payload ${run}`);
    expect(out).toContain('[REDACTED(len=250)]');
  });

  it('does not mangle paths or timestamps', () => {
    const line = '[2026-11-08T15:56:00.000Z] path=/usr/local/bin/cliclick v1.2.3';
    expect(redactSensitiveText(line)).toBe(line);
  });

  it('redacts the legacy raw-args CallTool line (regression guard)', () => {
    const line = `[CallTool] name=type_text, args={"text":"my password 123","press_enter":false}`;
    const out = redactSensitiveText(line);
    expect(out).not.toContain('my password 123');
    expect(out).toContain('[REDACTED(');
  });
});

describe('summarizeToolArgs', () => {
  it('summarizes types and sizes without values', () => {
    const summary = summarizeToolArgs({
      text: 'abc',
      x: 5,
      flag: true,
      arr: [1, 2],
      obj: { a: 1 },
    });
    expect(summary).toBe(
      'text: string(3), x: number(5), flag: boolean(true), arr: array(2), obj: object(1 keys)'
    );
  });

  it('handles empty and null args', () => {
    expect(summarizeToolArgs({})).toBe('(none)');
    expect(summarizeToolArgs(null)).toBe('(none)');
    expect(summarizeToolArgs(undefined)).toBe('(none)');
  });

  it('never includes string values', () => {
    const summary = summarizeToolArgs({ text: 'super-secret-content' });
    expect(summary).toBe('text: string(20)');
    expect(summary).not.toContain('super-secret-content');
  });
});
