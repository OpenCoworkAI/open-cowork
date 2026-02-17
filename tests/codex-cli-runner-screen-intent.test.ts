import { describe, expect, it } from 'vitest';
import { buildScreenInterpretVisionQuestion, isScreenInterpretationPrompt } from '../src/main/openai/screen-interpret-intent';

describe('CodexCliRunner screen interpretation intent helpers', () => {
  it('matches Chinese screenshot + interpretation prompt', () => {
    expect(isScreenInterpretationPrompt('截图 并为我解读屏幕信息')).toBe(true);
  });

  it('matches English screenshot + interpretation prompt', () => {
    expect(isScreenInterpretationPrompt('Please take a screenshot and describe what is on screen')).toBe(true);
  });

  it('does not match screenshot-only prompt', () => {
    expect(isScreenInterpretationPrompt('帮我截图一下')).toBe(false);
  });

  it('builds a structured vision question with original prompt', () => {
    const question = buildScreenInterpretVisionQuestion('截图 并为我解读屏幕信息');
    expect(question).toContain('用户原始请求');
    expect(question).toContain('截图 并为我解读屏幕信息');
    expect(question).toContain('1. 当前可见的应用或窗口');
  });
});
