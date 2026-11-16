import { describe, expect, it } from 'vitest';
import { isSafeRemoteAutoApprovedTool } from '../../main/remote/remote-tool-policy';

describe('remote safe tool canonical policy', () => {
  it.each([
    'read',
    'Read',
    'GLOB',
    'grep',
    'ls',
    'WebFetch',
    'web_search',
    'navigate_page',
    'mcp__Chrome__navigate_page',
    'mcp__chrome__take_screenshot',
  ])('accepts %s', (tool) => {
    expect(isSafeRemoteAutoApprovedTool(tool)).toBe(true);
  });

  it.each([
    'Task',
    'task',
    'bash',
    'write',
    'evaluate_script',
    'mcp__Chrome__evaluate_script',
    'mcp__Unknown__navigate_page',
    'mcp__Unknown__Read',
  ])('keeps %s behind explicit permission', (tool) => {
    expect(isSafeRemoteAutoApprovedTool(tool)).toBe(false);
  });
});
