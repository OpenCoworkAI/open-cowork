import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SESSION_TITLE,
  getDefaultTitleFromPrompt,
  getInitialSessionTitle,
} from '../src/shared/session-title';

describe('session title defaults', () => {
  it('uses truncated prompt text as the initial session title', () => {
    expect(getInitialSessionTitle('帮我整理一下本周的工作计划和待办事项')).toBe('帮我整理一下本周的工作计划和待办事项');
  });

  it('falls back to the first attachment name when prompt text is empty', () => {
    expect(getInitialSessionTitle('', '季度总结-最终版.pptx')).toBe('季度总结-最终版.pptx');
  });

  it('uses the shared default title when neither prompt nor attachment name is available', () => {
    expect(getInitialSessionTitle('', '')).toBe(DEFAULT_SESSION_TITLE);
    expect(getDefaultTitleFromPrompt('')).toBe(DEFAULT_SESSION_TITLE);
  });
});
