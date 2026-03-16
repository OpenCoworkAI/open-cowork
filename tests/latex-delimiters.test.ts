import { describe, expect, it } from 'vitest';
import { normalizeLatexDelimiters } from '../src/renderer/utils/latex-delimiters';

describe('normalizeLatexDelimiters', () => {
  // --- inline math ---
  it('converts \\(...\\) to $...$', () => {
    expect(normalizeLatexDelimiters('The value \\(x + y\\) is positive.')).toBe(
      'The value $x + y$ is positive.'
    );
  });

  it('handles multiple inline math on one line', () => {
    expect(normalizeLatexDelimiters('\\(a\\) and \\(b\\)')).toBe('$a$ and $b$');
  });

  // --- display math ---
  it('converts \\[...\\] to $$...$$', () => {
    expect(normalizeLatexDelimiters('Formula:\n\\[E = mc^2\\]')).toBe(
      'Formula:\n$$E = mc^2$$'
    );
  });

  it('handles multiline display math', () => {
    const input = '\\[\n  \\sum_{i=1}^{n} x_i\n\\]';
    const expected = '$$\n  \\sum_{i=1}^{n} x_i\n$$';
    expect(normalizeLatexDelimiters(input)).toBe(expected);
  });

  // --- code block protection ---
  it('does not convert delimiters inside fenced code blocks', () => {
    const input = '```\n\\(x\\)\n```';
    expect(normalizeLatexDelimiters(input)).toBe(input);
  });

  it('does not convert delimiters inside inline code', () => {
    const input = 'Use `\\(x\\)` for inline math.';
    expect(normalizeLatexDelimiters(input)).toBe(input);
  });

  it('converts outside code but preserves inside', () => {
    const input = '\\(a\\) and `\\(b\\)` and \\(c\\)';
    expect(normalizeLatexDelimiters(input)).toBe('$a$ and `\\(b\\)` and $c$');
  });

  // --- mixed content ---
  it('handles both inline and display math together', () => {
    const input = 'Inline \\(x\\) and display:\n\\[y = x^2\\]';
    const expected = 'Inline $x$ and display:\n$$y = x^2$$';
    expect(normalizeLatexDelimiters(input)).toBe(expected);
  });

  // --- edge cases ---
  it('returns empty string for empty input', () => {
    expect(normalizeLatexDelimiters('')).toBe('');
  });

  it('passes through text with no delimiters unchanged', () => {
    const input = 'Hello world, no math here.';
    expect(normalizeLatexDelimiters(input)).toBe(input);
  });

  it('leaves existing $...$ delimiters untouched', () => {
    const input = 'Already $x + y$ correct.';
    expect(normalizeLatexDelimiters(input)).toBe(input);
  });

  it('leaves existing $$...$$ delimiters untouched', () => {
    const input = '$$E = mc^2$$';
    expect(normalizeLatexDelimiters(input)).toBe(input);
  });

  it('protects code blocks with language specifier', () => {
    const input = '```python\nresult = \\(x\\)\n```';
    expect(normalizeLatexDelimiters(input)).toBe(input);
  });
});
