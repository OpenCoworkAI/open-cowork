import { describe, it, expect } from 'vitest';
import {
  buildTitlePrompt,
  normalizeGeneratedTitle,
  shouldGenerateTitle,
} from '../src/main/session/session-title-utils';

describe('session title utils', () => {
  it('generates title only for first user message and default title', () => {
    expect(
      shouldGenerateTitle({
        userMessageCount: 1,
        currentTitle: 'Hello world',
        prompt: 'Hello world',
        hasAttempted: false,
      })
    ).toBe(true);

    expect(
      shouldGenerateTitle({
        userMessageCount: 2,
        currentTitle: 'Hello world',
        prompt: 'Hello world',
        hasAttempted: false,
      })
    ).toBe(false);
  });

  it('skips when title was manually changed', () => {
    expect(
      shouldGenerateTitle({
        userMessageCount: 1,
        currentTitle: 'Custom title',
        prompt: 'Hello world',
        hasAttempted: false,
      })
    ).toBe(false);
  });

  it('skips when already attempted', () => {
    expect(
      shouldGenerateTitle({
        userMessageCount: 1,
        currentTitle: 'Hello world',
        prompt: 'Hello world',
        hasAttempted: true,
      })
    ).toBe(false);
  });

  it('builds a bilingual prompt requiring <=15 chars, same language, and the marker', () => {
    const prompt = buildTitlePrompt('帮我做一个PPT');
    expect(prompt).toContain('15');
    expect(prompt).toContain('同语言');
    expect(prompt).toContain('same language');
    expect(prompt).toContain('TITLE::');
  });

  it('falls back to the first non-empty line and strips quotes', () => {
    const title = normalizeGeneratedTitle('"  我的标题  "\n第二行');
    expect(title).toBe('我的标题');
  });

  it('prefers the last TITLE:: marker regardless of surrounding reasoning', () => {
    expect(normalizeGeneratedTitle('TITLE:: 我的标题')).toBe('我的标题');
    expect(normalizeGeneratedTitle('let me think...\nTITLE:: 我的标题')).toBe('我的标题');
    expect(normalizeGeneratedTitle('TITLE:: first guess\nTITLE:: 最终标题')).toBe('最终标题');
  });

  it('uses the marker even when inline reasoning tags are present', () => {
    const raw = '你好' + '<' + '/think>' + '你好\nTITLE:: 我的标题';
    expect(normalizeGeneratedTitle(raw)).toBe('我的标题');
  });

  it('drops synthetic empty placeholder titles', () => {
    expect(normalizeGeneratedTitle('(no content)')).toBeNull();
    expect(normalizeGeneratedTitle('(empty content)')).toBeNull();
  });
});
