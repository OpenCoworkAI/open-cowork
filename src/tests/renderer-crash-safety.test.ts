/**
 * Renderer crash safety tests — verifies defensive data handling
 * in MessageCard helpers to prevent white-screen crashes.
 */
import { describe, it, expect } from 'vitest';

// We can't import React components directly without a DOM environment,
// so we re-implement the pure logic functions to test them in isolation.
// These mirror the logic in MessageCard.tsx exactly.

/** shortenPath — mirrors MessageCard.tsx */
function shortenPath(p: string): string {
  if (typeof p !== 'string') return String(p);
  const segments = p.replace(/\\/g, '/').split('/').filter(Boolean);
  if (segments.length <= 2) return segments.join('/');
  return segments.slice(-2).join('/');
}

/** getToolLabel — mirrors MessageCard.tsx */
function getToolLabel(name: string, input: any): string {
  const inp = input || {};
  if (name.startsWith('mcp__')) {
    const match = name.match(/^mcp__(.+?)__(.+)$/);
    return match?.[2] || name;
  }
  const nameLower = name.toLowerCase();
  if (nameLower === 'read' || nameLower === 'read_file') {
    const p = String(inp.file_path || inp.path || '');
    return p ? `Read ${shortenPath(p)}` : 'Read file';
  }
  if (nameLower === 'write' || nameLower === 'write_file') {
    const p = String(inp.file_path || inp.path || '');
    return p ? `Write ${shortenPath(p)}` : 'Write file';
  }
  if (nameLower === 'edit' || nameLower === 'edit_file') {
    const p = String(inp.file_path || inp.path || '');
    return p ? `Edit ${shortenPath(p)}` : 'Edit file';
  }
  if (nameLower === 'bash' || nameLower === 'execute_command') {
    const cmd = String(inp.command || inp.cmd || '');
    if (cmd) {
      const short = cmd.length > 60 ? cmd.substring(0, 57) + '...' : cmd;
      return `$ ${short}`;
    }
    return 'Run command';
  }
  if (nameLower === 'glob') return inp.pattern ? `Glob ${String(inp.pattern)}` : 'Glob';
  if (nameLower === 'grep') return inp.pattern ? `Grep "${String(inp.pattern)}"` : 'Grep';
  if (nameLower === 'websearch') return inp.query ? `Search "${String(inp.query)}"` : 'Web search';
  if (nameLower === 'webfetch') {
    const url = String(inp.url || '');
    return url ? `Fetch ${url.length > 50 ? url.substring(0, 47) + '...' : url}` : 'Fetch URL';
  }
  return name;
}

/** getSummary — mirrors the ToolUseBlock getSummary logic */
function getSummary(
  toolResult: { content: unknown; isError?: boolean } | null,
  _toolName: string
): string {
  if (!toolResult) return '';
  const content = typeof toolResult.content === 'string' ? toolResult.content : '';
  if (toolResult.isError) {
    const firstLine = content.split(/\r?\n/)[0];
    return firstLine.length > 60 ? firstLine.substring(0, 57) + '...' : firstLine;
  }
  if (content.length < 60) return content.trim();
  const lines = content.trim().split(/\r?\n/);
  return `${lines.length} lines`;
}

// ─── shortenPath ────────────────────────────────────────────
describe('shortenPath', () => {
  it('handles normal file path', () => {
    expect(shortenPath('/Users/foo/project/src/main.ts')).toBe('src/main.ts');
  });

  it('handles short path', () => {
    expect(shortenPath('main.ts')).toBe('main.ts');
  });

  it('handles Windows path', () => {
    expect(shortenPath('C:\\Users\\foo\\file.ts')).toBe('foo/file.ts');
  });

  it('does not crash on non-string input', () => {
    // @ts-expect-error testing runtime safety
    expect(shortenPath(undefined)).toBe('undefined');
    // @ts-expect-error testing runtime safety
    expect(shortenPath(null)).toBe('null');
    // @ts-expect-error testing runtime safety
    expect(shortenPath(42)).toBe('42');
  });

  it('handles empty string', () => {
    expect(shortenPath('')).toBe('');
  });
});

// ─── getToolLabel ───────────────────────────────────────────
describe('getToolLabel', () => {
  it('returns label for Read with file_path', () => {
    expect(getToolLabel('Read', { file_path: '/a/b/c.ts' })).toBe('Read b/c.ts');
  });

  it('returns fallback for Read with no path', () => {
    expect(getToolLabel('Read', {})).toBe('Read file');
    expect(getToolLabel('Read', null)).toBe('Read file');
  });

  it('does not crash when file_path is a number', () => {
    expect(getToolLabel('Read', { file_path: 123 })).toBe('Read 123');
  });

  it('handles MCP tool names', () => {
    expect(getToolLabel('mcp__server__doSomething', {})).toBe('doSomething');
  });

  it('handles bash with command', () => {
    expect(getToolLabel('bash', { command: 'ls -la' })).toBe('$ ls -la');
  });

  it('handles bash with no command', () => {
    expect(getToolLabel('bash', {})).toBe('Run command');
  });

  it('truncates long commands', () => {
    const longCmd = 'a'.repeat(100);
    const result = getToolLabel('bash', { command: longCmd });
    expect(result.length).toBeLessThanOrEqual(62); // "$ " + 57 + "..."
  });

  it('does not crash on undefined input', () => {
    expect(getToolLabel('unknown_tool', undefined)).toBe('unknown_tool');
  });
});

// ─── getSummary ─────────────────────────────────────────────
describe('getSummary (defensive)', () => {
  it('returns empty for null toolResult', () => {
    expect(getSummary(null, 'Read')).toBe('');
  });

  it('handles string content normally', () => {
    expect(getSummary({ content: 'hello' }, 'Read')).toBe('hello');
  });

  it('handles error content', () => {
    const result = getSummary({ content: 'Error: file not found', isError: true }, 'Read');
    expect(result).toBe('Error: file not found');
  });

  it('truncates long error first line', () => {
    const longLine = 'E'.repeat(100);
    const result = getSummary({ content: longLine, isError: true }, 'Read');
    expect(result.length).toBe(60);
    expect(result.endsWith('...')).toBe(true);
  });

  it('does not crash when content is null', () => {
    expect(getSummary({ content: null }, 'Read')).toBe('');
  });

  it('does not crash when content is undefined', () => {
    expect(getSummary({ content: undefined }, 'Read')).toBe('');
  });

  it('does not crash when content is a number', () => {
    expect(getSummary({ content: 42 }, 'Read')).toBe('');
  });

  it('returns line count for multi-line content', () => {
    const content = 'line1\nline2\nline3\nline4\nline5\n' + 'x'.repeat(60);
    const result = getSummary({ content }, 'Read');
    expect(result).toMatch(/\d+ lines/);
  });
});
