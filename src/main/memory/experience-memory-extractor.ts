import { SESSION_CHUNK_EXTRACTION_PROMPT } from './memory-prompts';
import type { MemoryLLMClientLike } from './memory-llm-client';
import type { ExperienceSessionExtract, MemoryTranscriptTurn } from './memory-types';
import { compactTranscript, extractJson } from './memory-utils';

export class ExperienceMemoryExtractor {
  constructor(
    private readonly llm: MemoryLLMClientLike,
    private readonly systemPrompt = SESSION_CHUNK_EXTRACTION_PROMPT
  ) {}

  async extractSession(params: {
    sessionId: string;
    sessionDate?: string;
    turns: MemoryTranscriptTurn[];
  }): Promise<ExperienceSessionExtract> {
    const transcript = compactTranscript(params.turns);
    if (!transcript.trim()) {
      return {
        sessionSummary: '',
        sessionKeywords: [],
        chunks: [],
      };
    }

    const response = await this.llm.complete({
      systemPrompt: this.systemPrompt,
      userPrompt: [
        `Session ID: ${params.sessionId}`,
        params.sessionDate ? `Session Date: ${params.sessionDate}` : '',
        'Session transcript:',
        transcript,
      ]
        .filter(Boolean)
        .join('\n'),
      temperature: 0,
      maxTokens: 16_000,
    });

    const payload = extractJson(response.text);
    if (!payload || typeof payload !== 'object') {
      return {
        sessionSummary: '',
        sessionKeywords: [],
        chunks: [],
      };
    }

    const record = payload as {
      session_summary?: unknown;
      sessionSummary?: unknown;
      session_keywords?: unknown;
      sessionKeywords?: unknown;
      chunks?: unknown;
    };
    const rawChunks = Array.isArray(record.chunks) ? record.chunks : [];

    return {
      sessionSummary:
        typeof record.session_summary === 'string'
          ? record.session_summary.trim()
          : typeof record.sessionSummary === 'string'
            ? record.sessionSummary.trim()
            : '',
      sessionKeywords: Array.isArray(record.session_keywords)
        ? record.session_keywords.filter((item): item is string => typeof item === 'string')
        : Array.isArray(record.sessionKeywords)
          ? record.sessionKeywords.filter((item): item is string => typeof item === 'string')
          : [],
      chunks: rawChunks
        .map((item) => {
          if (!item || typeof item !== 'object') {
            return null;
          }
          const chunk = item as {
            summary?: unknown;
            details?: unknown;
            keywords?: unknown;
            source_turns?: unknown;
            sourceTurns?: unknown;
          };
          const sourceTurns = Array.isArray(chunk.source_turns)
            ? chunk.source_turns.filter((value): value is number => typeof value === 'number')
            : Array.isArray(chunk.sourceTurns)
              ? chunk.sourceTurns.filter((value): value is number => typeof value === 'number')
              : [];
          return {
            summary: typeof chunk.summary === 'string' ? chunk.summary.trim() : '',
            details:
              typeof chunk.details === 'string'
                ? chunk.details.trim()
                : typeof chunk.summary === 'string'
                  ? chunk.summary.trim()
                  : '',
            keywords: Array.isArray(chunk.keywords)
              ? chunk.keywords.filter((value): value is string => typeof value === 'string')
              : [],
            sourceTurns,
          };
        })
        .filter(
          (
            item
          ): item is ExperienceSessionExtract['chunks'][number] =>
            Boolean(item && item.summary && item.sourceTurns.length > 0)
        ),
    };
  }
}
