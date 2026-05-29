/**
 * Tests for the cold-start `<conversation_history>` rebuild path in
 * `src/main/claude/agent-runner.ts`.
 *
 * The rebuild path is exercised when the cached pi-coding-agent SDK session is
 * disposed (cwd change at `session-manager.ts:~993`, or runtime-signature
 * change at `agent-runner.ts:~1583`) and agent-runner has to reconstruct
 * conversation history from DB-persisted messages.
 *
 * Bug #162 (Bug B): the previous implementation filtered to `type === 'text'`
 * only, silently dropping `thinking`, `tool_use`, and `tool_result` blocks.
 * Providers that require previous reasoning/tool-call replay (DeepSeek V4
 * Flash, and any thinking-capable model after a cwd switch) then 400 on the
 * next turn. These tests pin the new serializer behavior so the regression
 * cannot return.
 */

import { describe, expect, it, vi } from 'vitest';

// agent-runner.ts pulls a wide tree of Electron + native deps via its
// constructor; we only need a pure helper, so stub the heaviest imports.
vi.mock('@mariozechner/pi-ai', () => ({
  completeSimple: vi.fn(),
  getModel: vi.fn(() => undefined),
}));

vi.mock('../../main/claude/shared-auth', () => ({
  getSharedAuthStorage: () => ({ setRuntimeApiKey: vi.fn() }),
  ModelRegistry: vi.fn(),
}));

import type { ContentBlock } from '../../renderer/types';
import { serializeMessageContentForHistory } from '../../main/claude/agent-runner';

describe('serializeMessageContentForHistory', () => {
  it('serializes a single text block as raw text (legacy compatible)', () => {
    const blocks: ContentBlock[] = [{ type: 'text', text: 'hello world' }];
    expect(serializeMessageContentForHistory(blocks)).toBe('hello world');
  });

  it('omits empty text blocks', () => {
    const blocks: ContentBlock[] = [
      { type: 'text', text: '' },
      { type: 'text', text: 'kept' },
    ];
    expect(serializeMessageContentForHistory(blocks)).toBe('kept');
  });

  it('wraps thinking blocks in <thinking> tags', () => {
    const blocks: ContentBlock[] = [{ type: 'thinking', thinking: 'reasoning trace' }];
    expect(serializeMessageContentForHistory(blocks)).toBe('<thinking>reasoning trace</thinking>');
  });

  it('serializes tool_use blocks with name, id, and JSON input', () => {
    const blocks: ContentBlock[] = [
      {
        type: 'tool_use',
        id: 'toolu_01',
        name: 'Bash',
        input: { command: 'ls -la' },
      },
    ];
    expect(serializeMessageContentForHistory(blocks)).toBe(
      '<tool_use name="Bash" id="toolu_01">{"command":"ls -la"}</tool_use>'
    );
  });

  it('serializes tool_result blocks with toolUseId and content', () => {
    const blocks: ContentBlock[] = [
      { type: 'tool_result', toolUseId: 'toolu_01', content: 'file1\nfile2' },
    ];
    expect(serializeMessageContentForHistory(blocks)).toBe(
      '<tool_result tool_use_id="toolu_01">file1\nfile2</tool_result>'
    );
  });

  it('marks tool_result errors with is_error="true"', () => {
    const blocks: ContentBlock[] = [
      { type: 'tool_result', toolUseId: 'toolu_02', content: 'boom', isError: true },
    ];
    expect(serializeMessageContentForHistory(blocks)).toBe(
      '<tool_result tool_use_id="toolu_02" is_error="true">boom</tool_result>'
    );
  });

  it('skips image and file_attachment blocks (binary / oversized)', () => {
    const blocks: ContentBlock[] = [
      { type: 'text', text: 'before' },
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: 'AAAA' },
      },
      {
        type: 'file_attachment',
        filename: 'data.bin',
        relativePath: 'tmp/data.bin',
        size: 1024,
      },
      { type: 'text', text: 'after' },
    ];
    expect(serializeMessageContentForHistory(blocks)).toBe('before\nafter');
  });

  it('preserves block ordering for a typical assistant turn (thinking → text → tool_use)', () => {
    // This is the exact shape that fails on DeepSeek V4 Flash without the fix:
    // an assistant turn with reasoning, followed by a textual answer fragment,
    // followed by a tool call. The model's next turn must see all three to
    // pass schema validation on providers that replay reasoning.
    const blocks: ContentBlock[] = [
      { type: 'thinking', thinking: 'need to inspect the dir first' },
      { type: 'text', text: 'Let me check the directory.' },
      {
        type: 'tool_use',
        id: 'toolu_99',
        name: 'Bash',
        input: { command: 'pwd' },
      },
    ];
    expect(serializeMessageContentForHistory(blocks)).toBe(
      [
        '<thinking>need to inspect the dir first</thinking>',
        'Let me check the directory.',
        '<tool_use name="Bash" id="toolu_99">{"command":"pwd"}</tool_use>',
      ].join('\n')
    );
  });

  it('preserves block ordering for a user turn carrying a tool_result + free text', () => {
    const blocks: ContentBlock[] = [
      { type: 'tool_result', toolUseId: 'toolu_99', content: '/home/user' },
      { type: 'text', text: 'thanks, now list it' },
    ];
    expect(serializeMessageContentForHistory(blocks)).toBe(
      ['<tool_result tool_use_id="toolu_99">/home/user</tool_result>', 'thanks, now list it'].join(
        '\n'
      )
    );
  });

  it('falls back to defaults when tool_use fields are missing or unserializable', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const blocks: ContentBlock[] = [
      // Force a JSON.stringify failure (circular ref) — should degrade to "{}"
      {
        type: 'tool_use',
        id: '',
        name: '',
        input: circular,
      } as ContentBlock,
    ];
    expect(serializeMessageContentForHistory(blocks)).toBe('<tool_use name="" id="">{}</tool_use>');
  });

  it('returns an empty string for messages composed entirely of skipped blocks', () => {
    const blocks: ContentBlock[] = [
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' },
      },
      {
        type: 'file_attachment',
        filename: 'a.bin',
        relativePath: 'a.bin',
        size: 1,
      },
    ];
    expect(serializeMessageContentForHistory(blocks)).toBe('');
  });

  it('XML-escapes thinking content so </thinking> or & literals cannot break the envelope', () => {
    const blocks: ContentBlock[] = [
      { type: 'thinking', thinking: 'I read </thinking> then ran A & B with <foo>' },
    ];
    expect(serializeMessageContentForHistory(blocks)).toBe(
      '<thinking>I read &lt;/thinking&gt; then ran A &amp; B with &lt;foo&gt;</thinking>'
    );
  });

  it('XML-escapes tool_use attributes and body', () => {
    const blocks: ContentBlock[] = [
      {
        type: 'tool_use',
        id: 'id"with&quote',
        name: 'name<x>',
        input: { cmd: 'echo "hi" & echo <bar>' },
      },
    ];
    const out = serializeMessageContentForHistory(blocks);
    // Attribute values must escape `"` so they don't break the attribute
    expect(out).toContain('name="name&lt;x&gt;"');
    expect(out).toContain('id="id&quot;with&amp;quote"');
    // Body keeps `"` literal (so JSON stays legible) but escapes `<`, `>`, `&`
    expect(out).toMatch(/<\/tool_use>$/);
    expect(out).not.toContain('<bar>');
    expect(out).toContain('&lt;bar&gt;');
    expect(out).toContain('"cmd"'); // body `"` not escaped
  });

  it('XML-escapes tool_result content (including </tool_result> literals)', () => {
    const blocks: ContentBlock[] = [
      {
        type: 'tool_result',
        toolUseId: 'call-1',
        content: 'output </tool_result> & more',
      },
    ];
    expect(serializeMessageContentForHistory(blocks)).toBe(
      '<tool_result tool_use_id="call-1">output &lt;/tool_result&gt; &amp; more</tool_result>'
    );
  });

  it('flattens tool_result.content when stored as a content-block array (defensive)', () => {
    // Older message rows or third-party providers may persist tool_result.content
    // as an Anthropic-style array of content blocks. The local TS type is `string`,
    // but the serializer must not produce "[object Object]" for legacy data.
    const blocks = [
      {
        type: 'tool_result',
        toolUseId: 'call-2',
        content: [
          { type: 'text', text: 'first line' },
          { type: 'text', text: 'second line' },
        ] as unknown as string,
      },
    ] as ContentBlock[];
    const out = serializeMessageContentForHistory(blocks);
    expect(out).toBe('<tool_result tool_use_id="call-2">first line\nsecond line</tool_result>');
    expect(out).not.toContain('[object Object]');
  });

  it('falls back to empty string when tool_result.content is neither string nor array', () => {
    const blocks = [
      {
        type: 'tool_result',
        toolUseId: 'call-3',
        content: 42 as unknown as string,
      },
    ] as ContentBlock[];
    expect(serializeMessageContentForHistory(blocks)).toBe(
      '<tool_result tool_use_id="call-3"></tool_result>'
    );
  });
});
