import { MEMORY_NAVIGATION_PROMPT } from './memory-prompts';
import type { MemoryLLMClientLike } from './memory-llm-client';
import type { NavigationAction, NavigationDecision } from './memory-types';
import { extractJson } from './memory-utils';

export class MemoryNavigator {
  constructor(
    private readonly llm: MemoryLLMClientLike,
    private readonly systemPrompt = MEMORY_NAVIGATION_PROMPT
  ) {}

  async decide(
    question: string,
    questionDate: string | undefined,
    visibleContext: string
  ): Promise<NavigationDecision> {
    const response = await this.llm.complete({
      systemPrompt: this.systemPrompt,
      userPrompt: [
        `Current Date: ${questionDate || 'unknown'}`,
        `Question: ${question}`,
        '',
        `Currently visible context:`,
        visibleContext,
      ].join('\n'),
      temperature: 0,
      maxTokens: 2_000,
    });
    const payload = extractJson(response.text);
    if (!payload || typeof payload !== 'object') {
      return {
        sufficient: true,
        reason: 'invalid_navigation_payload',
        actions: [],
      };
    }
    const record = payload as {
      sufficient?: unknown;
      reason?: unknown;
      actions?: unknown;
    };
    const actions = Array.isArray(record.actions)
      ? record.actions
          .map((action) => {
            if (!action || typeof action !== 'object') {
              return null;
            }
            const input = action as {
              type?: unknown;
              chunk_id?: unknown;
              chunkId?: unknown;
              session_id?: unknown;
              sessionId?: unknown;
            };
            const type = typeof input.type === 'string' ? input.type : '';
            if (type !== 'expand_chunk' && type !== 'expand_session' && type !== 'get_raw_session') {
              return null;
            }
            const normalized: NavigationAction = { type };
            const chunkId =
              typeof input.chunkId === 'string'
                ? input.chunkId
                : typeof input.chunk_id === 'string'
                  ? input.chunk_id
                  : undefined;
            const sessionId =
              typeof input.sessionId === 'string'
                ? input.sessionId
                : typeof input.session_id === 'string'
                  ? input.session_id
                  : undefined;
            if (chunkId) {
              normalized.chunkId = chunkId;
            }
            if (sessionId) {
              normalized.sessionId = sessionId;
            }
            return normalized;
          })
          .filter((item): item is NavigationAction => Boolean(item))
      : [];

    return {
      sufficient: record.sufficient !== false,
      reason: typeof record.reason === 'string' ? record.reason : '',
      actions,
    };
  }
}
