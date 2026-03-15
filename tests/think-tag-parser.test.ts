import { describe, it, expect } from 'vitest';
import { ThinkTagStreamParser, extractThinkTags, splitThinkTagBlocks } from '../src/main/claude/think-tag-parser';

describe('ThinkTagStreamParser', () => {
  it('should separate thinking from text in a single chunk', () => {
    const parser = new ThinkTagStreamParser();
    const result = parser.push('<think>reasoning here</think>response text');
    expect(result.thinking).toBe('reasoning here');
    expect(result.text).toBe('response text');
  });

  it('should handle tag split across chunks', () => {
    const parser = new ThinkTagStreamParser();
    let thinking = '';
    let text = '';

    // Split <think> across two chunks
    let r = parser.push('<thi');
    thinking += r.thinking;
    text += r.text;

    r = parser.push('nk>some reasoning</think>answer');
    thinking += r.thinking;
    text += r.text;

    expect(thinking).toBe('some reasoning');
    expect(text).toBe('answer');
  });

  it('should handle close tag split across chunks', () => {
    const parser = new ThinkTagStreamParser();
    let thinking = '';
    let text = '';

    let r = parser.push('<think>deep thought</th');
    thinking += r.thinking;
    text += r.text;

    r = parser.push('ink>the answer');
    thinking += r.thinking;
    text += r.text;

    expect(thinking).toBe('deep thought');
    expect(text).toBe('the answer');
  });

  it('should pass through text without think tags', () => {
    const parser = new ThinkTagStreamParser();
    const r = parser.push('hello world');
    expect(r.thinking).toBe('');
    expect(r.text).toBe('hello world');
  });

  it('should handle empty think tags', () => {
    const parser = new ThinkTagStreamParser();
    const r = parser.push('<think></think>just the answer');
    expect(r.thinking).toBe('');
    expect(r.text).toBe('just the answer');
  });

  it('should handle unclosed think tag via flush', () => {
    const parser = new ThinkTagStreamParser();
    const r1 = parser.push('<think>still thinking');
    expect(r1.thinking).toBe('still thinking');
    expect(r1.text).toBe('');

    const r2 = parser.flush();
    expect(r2.thinking).toBe('');
    expect(r2.text).toBe('');
  });

  it('should flush pending open tag as text', () => {
    const parser = new ThinkTagStreamParser();
    const r1 = parser.push('hello <thi');
    expect(r1.text).toBe('hello ');

    const r2 = parser.flush();
    expect(r2.text).toBe('<thi');
    expect(r2.thinking).toBe('');
  });

  it('should flush pending close tag as thinking', () => {
    const parser = new ThinkTagStreamParser();
    parser.push('<think>reasoning</th');
    const r = parser.flush();
    expect(r.thinking).toBe('</th');
    expect(r.text).toBe('');
  });

  it('should handle multiple think blocks', () => {
    const parser = new ThinkTagStreamParser();
    let thinking = '';
    let text = '';

    const r = parser.push('<think>first thought</think>text1<think>second thought</think>text2');
    thinking += r.thinking;
    text += r.text;

    expect(thinking).toBe('first thoughtsecond thought');
    expect(text).toBe('text1text2');
  });

  it('should handle char-by-char streaming', () => {
    const parser = new ThinkTagStreamParser();
    const input = '<think>hi</think>ok';
    let thinking = '';
    let text = '';

    for (const ch of input) {
      const r = parser.push(ch);
      thinking += r.thinking;
      text += r.text;
    }

    expect(thinking).toBe('hi');
    expect(text).toBe('ok');
  });

  it('should handle angle bracket that is not a tag', () => {
    const parser = new ThinkTagStreamParser();
    const r = parser.push('1 < 2 and <b>bold</b>');
    expect(r.text).toBe('1 < 2 and <b>bold</b>');
    expect(r.thinking).toBe('');
  });
});

describe('extractThinkTags', () => {
  it('should extract thinking and text from a complete string', () => {
    const result = extractThinkTags('<think>reasoning</think>response');
    expect(result.thinking).toBe('reasoning');
    expect(result.text).toBe('response');
  });

  it('should handle no think tags', () => {
    const result = extractThinkTags('plain text');
    expect(result.thinking).toBe('');
    expect(result.text).toBe('plain text');
  });

  it('should handle empty think tags', () => {
    const result = extractThinkTags('<think></think>answer');
    expect(result.thinking).toBe('');
    expect(result.text).toBe('answer');
  });

  it('should handle unclosed think tag', () => {
    const result = extractThinkTags('<think>still thinking');
    expect(result.thinking).toBe('still thinking');
    expect(result.text).toBe('');
  });

  it('should handle multiple think blocks', () => {
    const result = extractThinkTags('<think>a</think>x<think>b</think>y');
    expect(result.thinking).toBe('ab');
    expect(result.text).toBe('xy');
  });

  it('should preserve surrounding whitespace', () => {
    const result = extractThinkTags('<think>  reasoning  </think>  answer  ');
    expect(result.thinking).toBe('  reasoning  ');
    expect(result.text).toBe('  answer  ');
  });

  it('should handle think tag with newlines', () => {
    const result = extractThinkTags('<think>\nstep 1\nstep 2\n</think>\nfinal answer');
    expect(result.thinking).toBe('\nstep 1\nstep 2\n');
    expect(result.text).toBe('\nfinal answer');
  });

  it('should preserve markdown boundaries across think blocks', () => {
    const result = extractThinkTags('Intro\n<think>reasoning</think>\n```ts\nconst x = 1;\n```');
    expect(result.thinking).toBe('reasoning');
    expect(result.text).toBe('Intro\n\n```ts\nconst x = 1;\n```');
  });
});

describe('splitThinkTagBlocks', () => {
  it('should preserve block ordering for interleaved text and thinking', () => {
    expect(splitThinkTagBlocks('before<think>reason</think>after')).toEqual([
      { type: 'text', text: 'before' },
      { type: 'thinking', thinking: 'reason' },
      { type: 'text', text: 'after' },
    ]);
  });

  it('should drop empty think tags without leaking raw markup', () => {
    expect(splitThinkTagBlocks('<think></think>')).toEqual([]);
  });

  it('should treat unclosed think tags as trailing thinking blocks', () => {
    expect(splitThinkTagBlocks('before<think>reasoning')).toEqual([
      { type: 'text', text: 'before' },
      { type: 'thinking', thinking: 'reasoning' },
    ]);
  });
});
