import { describe, expect, it } from 'vitest';
import {
  createCompactionExtensionFactory,
  pruneToolOutputs,
  buildCustomInstructions,
  DEFAULT_COMPACTION_INSTRUCTIONS,
  type CompactionConfig,
} from '../../main/agent/compaction-extension';

describe('compaction-extension', () => {
  describe('createCompactionExtensionFactory', () => {
    it('returns a valid extension factory function', () => {
      const factory = createCompactionExtensionFactory();
      expect(typeof factory).toBe('function');
    });

    it('factory accepts an ExtensionAPI-like object and registers handler', () => {
      const factory = createCompactionExtensionFactory({ pruneToolOutputAbove: 200 });
      const handlers: Record<string, unknown[]> = {};
      const mockApi = {
        on(event: string, handler: unknown) {
          if (!handlers[event]) handlers[event] = [];
          handlers[event].push(handler);
        },
      };

      factory(mockApi as never);

      expect(handlers['session_before_compact']).toBeDefined();
      expect(handlers['session_before_compact'].length).toBe(1);
      expect(typeof handlers['session_before_compact'][0]).toBe('function');
    });

    it('handler prunes messages and injects custom instructions', async () => {
      const factory = createCompactionExtensionFactory({
        pruneToolOutputAbove: 50,
        keepRecentToolResults: 1,
        customInstructions: 'Focus on the database schema changes.',
      });

      let capturedHandler: ((event: unknown) => Promise<unknown>) | undefined;
      const mockApi = {
        on(event: string, handler: unknown) {
          if (event === 'session_before_compact') {
            capturedHandler = handler as (event: unknown) => Promise<unknown>;
          }
        },
      };

      factory(mockApi as never);
      expect(capturedHandler).toBeDefined();

      // Create a mock event with messages containing long tool output
      const mockEvent = {
        type: 'session_before_compact',
        preparation: {
          firstKeptEntryId: 'entry-1',
          messagesToSummarize: [
            {
              role: 'assistant',
              content: [{ type: 'toolResult', toolUseId: 'tool-1', content: 'x'.repeat(200) }],
            },
            {
              role: 'assistant',
              content: [{ type: 'toolResult', toolUseId: 'tool-2', content: 'y'.repeat(100) }],
            },
          ],
          tokensBefore: 50000,
          isSplitTurn: false,
          turnPrefixMessages: [],
          fileOps: { read: new Set(), written: new Set(), edited: new Set() },
          settings: { enabled: true, reserveTokens: 8000, keepRecentTokens: 16000 },
        },
        branchEntries: [],
        customInstructions: undefined,
        signal: new AbortController().signal,
      };

      const result = await capturedHandler!(mockEvent);

      // The first tool result should be pruned (over threshold and not recent)
      expect(mockEvent.preparation.messagesToSummarize[0].content[0].content).toContain(
        '[Output truncated:'
      );
      // The last tool result should be kept (it's the most recent one, keepRecent=1)
      expect(mockEvent.preparation.messagesToSummarize[1].content[0].content).toBe('y'.repeat(100));

      // Custom instructions should be injected
      expect(mockEvent.customInstructions).toContain('Focus on preserving:');
      expect(mockEvent.customInstructions).toContain('Focus on the database schema changes.');

      // Should return empty object to let SDK handle summarization
      expect(result).toEqual({});
    });

    it('handler preserves existing customInstructions from manual compact', async () => {
      const factory = createCompactionExtensionFactory({});

      let capturedHandler: ((event: unknown) => Promise<unknown>) | undefined;
      const mockApi = {
        on(event: string, handler: unknown) {
          if (event === 'session_before_compact') {
            capturedHandler = handler as (event: unknown) => Promise<unknown>;
          }
        },
      };

      factory(mockApi as never);

      const mockEvent = {
        type: 'session_before_compact',
        preparation: {
          firstKeptEntryId: 'entry-1',
          messagesToSummarize: [],
          tokensBefore: 50000,
          isSplitTurn: false,
          turnPrefixMessages: [],
          fileOps: { read: new Set(), written: new Set(), edited: new Set() },
          settings: { enabled: true, reserveTokens: 8000, keepRecentTokens: 16000 },
        },
        branchEntries: [],
        customInstructions: 'User explicitly said: focus on the API refactor.',
        signal: new AbortController().signal,
      };

      await capturedHandler!(mockEvent);

      // User's instructions should come first (they take priority)
      expect(mockEvent.customInstructions).toMatch(
        /^User explicitly said: focus on the API refactor\./
      );
      // Our defaults should be appended
      expect(mockEvent.customInstructions).toContain('Focus on preserving:');
    });
  });

  describe('pruneToolOutputs', () => {
    it('returns zero counts for empty messages', () => {
      const messages: unknown[] = [];
      const result = pruneToolOutputs(messages, 500, 3);
      expect(result).toEqual({ prunedCount: 0, totalToolResults: 0 });
    });

    it('does not prune tool outputs below threshold', () => {
      const messages = [
        {
          role: 'assistant',
          content: [{ type: 'toolResult', toolUseId: 't-1', content: 'short output' }],
        },
      ];

      const result = pruneToolOutputs(messages, 500, 3);
      expect(result.prunedCount).toBe(0);
      expect(result.totalToolResults).toBe(1);
      expect(messages[0].content[0].content).toBe('short output');
    });

    it('prunes tool outputs above threshold', () => {
      const longOutput = 'x'.repeat(1000);
      const messages = [
        {
          role: 'assistant',
          content: [{ type: 'toolResult', toolUseId: 'tool-abc', content: longOutput }],
        },
        {
          role: 'assistant',
          content: [{ type: 'toolResult', toolUseId: 'tool-def', content: 'kept' }],
        },
      ];

      const result = pruneToolOutputs(messages, 500, 1);
      expect(result.prunedCount).toBe(1);
      expect(result.totalToolResults).toBe(2);
      // First result is pruned
      expect(messages[0].content[0].content).toContain('[Output truncated:');
      expect(messages[0].content[0].content).toContain('1000 chars');
      expect(messages[0].content[0].content).toContain('tool-abc');
      // Second result is kept (it's the most recent one)
      expect(messages[1].content[0].content).toBe('kept');
    });

    it('keeps the last N tool results regardless of length', () => {
      const longOutput = 'x'.repeat(1000);
      const messages = [
        {
          role: 'assistant',
          content: [{ type: 'toolResult', toolUseId: 't-1', content: longOutput }],
        },
        {
          role: 'assistant',
          content: [{ type: 'toolResult', toolUseId: 't-2', content: longOutput }],
        },
        {
          role: 'assistant',
          content: [{ type: 'toolResult', toolUseId: 't-3', content: longOutput }],
        },
      ];

      // keepRecent=2 means last 2 are preserved
      const result = pruneToolOutputs(messages, 500, 2);
      expect(result.prunedCount).toBe(1);
      // Only first is pruned
      expect(messages[0].content[0].content).toContain('[Output truncated:');
      // Last two are kept
      expect(messages[1].content[0].content).toBe(longOutput);
      expect(messages[2].content[0].content).toBe(longOutput);
    });

    it('handles array-style tool result content', () => {
      const longText = 'x'.repeat(1000);
      const messages = [
        {
          role: 'assistant',
          content: [
            {
              type: 'toolResult',
              toolUseId: 't-1',
              content: [{ type: 'text', text: longText }],
            },
          ],
        },
        {
          role: 'assistant',
          content: [{ type: 'toolResult', toolUseId: 't-2', content: 'short' }],
        },
      ];

      const result = pruneToolOutputs(messages, 500, 1);
      expect(result.prunedCount).toBe(1);
      // Array content is replaced with single-element array
      expect(messages[0].content[0].content).toEqual([
        { type: 'text', text: expect.stringContaining('[Output truncated:') },
      ]);
    });

    it('preserves non-text content blocks during pruning', () => {
      const messages = [
        {
          role: 'tool',
          content: [
            {
              type: 'toolResult',
              toolUseId: 'tool-1',
              content: [
                { type: 'text', text: 'a'.repeat(600) },
                { type: 'image', source: { data: 'base64data' } },
              ],
            },
          ],
        },
      ];

      pruneToolOutputs(messages, 500, 0);

      const resultContent = messages[0].content[0].content;
      expect(resultContent).toHaveLength(2);
      expect(resultContent[0].type).toBe('text');
      expect(resultContent[0].text).toContain('[Output truncated');
      expect(resultContent[1].type).toBe('image');
      expect(resultContent[1].source).toEqual({ data: 'base64data' });
    });

    it('handles tool_result type (underscore variant)', () => {
      const longOutput = 'x'.repeat(600);
      const messages = [
        {
          role: 'assistant',
          content: [{ type: 'tool_result', tool_use_id: 'tu-1', content: longOutput }],
        },
      ];

      const result = pruneToolOutputs(messages, 500, 0);
      expect(result.prunedCount).toBe(1);
      expect(messages[0].content[0].content).toContain('[Output truncated:');
    });

    it('handles messages without content array gracefully', () => {
      const messages = [{ role: 'user', content: 'just text' }, null, { role: 'assistant' }];

      const result = pruneToolOutputs(messages, 500, 3);
      expect(result.prunedCount).toBe(0);
      expect(result.totalToolResults).toBe(0);
    });

    it('handles multiple tool results in a single message', () => {
      const longOutput = 'x'.repeat(1000);
      const messages = [
        {
          role: 'assistant',
          content: [
            { type: 'toolResult', toolUseId: 't-1', content: longOutput },
            { type: 'toolResult', toolUseId: 't-2', content: longOutput },
            { type: 'toolResult', toolUseId: 't-3', content: longOutput },
          ],
        },
      ];

      const result = pruneToolOutputs(messages, 500, 1);
      // 3 total tool results, keep last 1, so prune first 2
      expect(result.prunedCount).toBe(2);
      expect(result.totalToolResults).toBe(3);
      expect(messages[0].content[0].content).toContain('[Output truncated:');
      expect(messages[0].content[1].content).toContain('[Output truncated:');
      expect(messages[0].content[2].content).toBe(longOutput); // kept (most recent)
    });
  });

  describe('buildCustomInstructions', () => {
    it('returns default instructions when no custom instructions provided', () => {
      const config: CompactionConfig = {};
      const result = buildCustomInstructions(config);
      expect(result).toBe(DEFAULT_COMPACTION_INSTRUCTIONS);
    });

    it('returns default instructions when custom instructions is empty', () => {
      const config: CompactionConfig = { customInstructions: '  ' };
      const result = buildCustomInstructions(config);
      expect(result).toBe(DEFAULT_COMPACTION_INSTRUCTIONS);
    });

    it('appends custom instructions after defaults', () => {
      const config: CompactionConfig = {
        customInstructions: 'Preserve all database migration details.',
      };
      const result = buildCustomInstructions(config);
      expect(result).toContain(DEFAULT_COMPACTION_INSTRUCTIONS);
      expect(result).toContain('Additional context-specific instructions:');
      expect(result).toContain('Preserve all database migration details.');
    });
  });

  describe('DEFAULT_COMPACTION_INSTRUCTIONS', () => {
    it('contains key preservation guidelines', () => {
      expect(DEFAULT_COMPACTION_INSTRUCTIONS).toContain('Key decisions');
      expect(DEFAULT_COMPACTION_INSTRUCTIONS).toContain('Important file paths');
      expect(DEFAULT_COMPACTION_INSTRUCTIONS).toContain('Current goals');
      expect(DEFAULT_COMPACTION_INSTRUCTIONS).toContain('Error context');
    });

    it('contains aggressive summarization guidelines', () => {
      expect(DEFAULT_COMPACTION_INSTRUCTIONS).toContain('File contents that were read');
      expect(DEFAULT_COMPACTION_INSTRUCTIONS).toContain('Long command outputs');
      expect(DEFAULT_COMPACTION_INSTRUCTIONS).toContain('Exploratory steps');
    });
  });
});
