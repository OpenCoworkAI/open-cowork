import { describe, expect, it } from 'vitest';
import {
  buildScheduledTaskFallbackTitle,
  buildScheduledTaskTitle,
  summarizeSchedulePrompt,
} from '../src/shared/schedule/task-title';

describe('scheduled task title', () => {
  it('always prefixes with [Scheduled]', () => {
    expect(buildScheduledTaskTitle('帮我整理今天的待办')).toBe('[Scheduled] 帮我整理今天的待办');
  });

  it('normalizes whitespace and line breaks', () => {
    expect(buildScheduledTaskTitle('  第一行\n\n第二行   第三行  ')).toBe(
      '[Scheduled] 第一行 第二行 第三行'
    );
  });

  it('strips duplicated schedule prefix', () => {
    expect(buildScheduledTaskTitle('[Scheduled] 每日汇总')).toBe('[Scheduled] 每日汇总');
  });

  it('truncates very long prompt summary', () => {
    const longPrompt = 'a'.repeat(70);
    expect(summarizeSchedulePrompt(longPrompt)).toBe(`${'a'.repeat(45)}...`);
  });

  it('falls back for empty prompt', () => {
    expect(buildScheduledTaskTitle('   ')).toBe('[Scheduled] Untitled task');
  });

  it('builds fallback title from prompt summary', () => {
    expect(buildScheduledTaskFallbackTitle('请帮我查一下近一周内的 Agent 论文')).toBe(
      '[Scheduled] 请帮我查一下近一周内的 Agent 论文'
    );
  });
});
