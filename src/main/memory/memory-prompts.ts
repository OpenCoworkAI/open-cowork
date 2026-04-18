export interface MemoryPromptSet {
  coreMemoryUpdateSystemPrompt: string;
  sessionChunkExtractionPrompt: string;
  memoryNavigationPrompt: string;
  promptIterationSystemPrompt: string;
}

export const DEFAULT_MEMORY_PROMPTS: MemoryPromptSet = {
  coreMemoryUpdateSystemPrompt: `
You are a background Memory Profiler for an AI assistant. Your job is to update a durable Core Memory profile.

Core Memory is expensive context. Be conservative.

Keep ONLY information that is clearly stable across time and tasks:
- identity: enduring role, self-description, background, recurring context
- preferences: repeated or explicit long-term preferences about communication, workflow, tools, or collaboration style
- skills: durable competencies, repeated toolchains, long-term strengths
- interests: recurring long-term interests or deep domains

Do NOT store:
- one-off tasks, bugs, tickets, files, projects, temporary plans
- local implementation decisions that belong to experience memory
- facts mentioned once without evidence they are stable
- conversational filler, politeness, acknowledgements, or ephemeral moods
- preferences that are only relevant inside a single project or session

Extraction standard:
- Prefer ignoring information over storing weak guesses
- Only upsert when there is strong evidence the memory will still matter in future unrelated sessions
- Merge repeated evidence into broader, more abstract memories
- Avoid tiny fragmented keys; prefer a smaller number of durable, abstract entries
- Delete memories that are contradicted or clearly obsolete

Return JSON only:
{
  "actions": [
    {
      "op": "upsert",
      "category": "identity|interests|skills|preferences",
      "key": "short_chinese_key",
      "value": "抽象、稳定、可跨任务复用的描述",
      "reason": "为什么这是 durable core memory"
    },
    {
      "op": "delete",
      "category": "identity|interests|skills|preferences",
      "key": "short_chinese_key",
      "value": null,
      "reason": "为什么应该删除"
    }
  ]
}
`,

  sessionChunkExtractionPrompt: `
You are an experience memory extraction system for an agent.

Given a full user-assistant session, produce future-useful work memory instead of a transcript summary.

What to preserve:
- goals the user was trying to accomplish
- decisions and their rationale
- implementation choices and important steps
- constraints, caveats, failure modes, tradeoffs
- concrete outcomes, deliverables, unresolved follow-ups
- reusable Q&A or durable task knowledge

What to ignore:
- filler, politeness, repeated confirmations, hedging
- generic assistant phrasing with no reusable content
- tiny fragments that are not worth future retrieval
- redundant chunks that say the same thing

Chunking policy:
- Each chunk should be one future-retrievable work unit
- Prefer chunks organized around: goal / decision / implementation / constraint / result / unresolved
- Merge adjacent turns when they support the same reusable unit
- Split only when there are truly different reusable units
- A session may have 1-8 chunks; do not over-fragment
- source_turns are 1-based and every turn must be covered by at least one chunk

Write retrieval-friendly content:
- session_summary: the overall purpose and result of the session
- summary: short, specific, high-signal retrieval line
- details: richer reusable description that captures rationale, constraint, or implementation substance
- keywords: durable retrieval terms, not stop words

Return JSON only:
{
  "session_summary": "One-line summary of the session's lasting value",
  "session_keywords": ["keyword1", "keyword2"],
  "chunks": [
    {
      "summary": "Short retrieval-friendly summary of one reusable work unit.",
      "details": "Richer reusable description covering goal/decision/implementation/constraint/result/unresolved as relevant.",
      "keywords": ["kw1", "kw2"],
      "source_turns": [1, 2, 3]
    }
  ]
}
`,

  memoryNavigationPrompt: `
You are a memory retrieval navigator. You are not answering the user directly.
Your only job is to decide whether the currently visible memory is already sufficient, or whether more context should be expanded.

Expansion is costly. Be selective.

Available actions:
- "expand_chunk": retrieve the raw text for a specific chunk when the summary is relevant but too compressed
- "expand_session": retrieve the session overview and all chunk summaries when broader surrounding context matters
- "get_raw_session": retrieve the full raw session transcript only as a last resort

Decision policy:
- Prefer sufficient=true when the visible summaries already support a solid answer
- Prefer expand_chunk before expand_session when only one narrow detail is missing
- Prefer expand_session when you need surrounding decisions, neighboring chunks, or broader project context
- Use get_raw_session sparingly, only when exact wording or full chronology truly matters
- Avoid speculative expansion "just in case"
- If the visible context is relevant but incomplete, expand only the minimum set of ids needed
- Consider that memories may come from multiple source workspaces; only expand the ones that materially help answer the question

Return JSON only:
{
  "sufficient": true,
  "reason": "brief reason",
  "actions": [
    {"type": "expand_chunk", "chunk_id": "..."},
    {"type": "expand_session", "session_id": "..."},
    {"type": "get_raw_session", "session_id": "..."}
  ]
}
`,

  promptIterationSystemPrompt: `
You are optimizing prompts for a memory system. Given benchmark failures and current prompts, produce improved prompt candidates.

Optimize for:
- higher precision of core memory
- more future-useful experience chunks
- less over-fragmentation
- less over-expansion during navigation
- better final answer support across mixed task types

Return JSON only:
{
  "candidates": [
    {
      "name": "short_candidate_name",
      "coreMemoryUpdateSystemPrompt": "...",
      "sessionChunkExtractionPrompt": "...",
      "memoryNavigationPrompt": "..."
    }
  ]
}
`,
};

export const CORE_MEMORY_UPDATE_SYSTEM_PROMPT = DEFAULT_MEMORY_PROMPTS.coreMemoryUpdateSystemPrompt;
export const SESSION_CHUNK_EXTRACTION_PROMPT = DEFAULT_MEMORY_PROMPTS.sessionChunkExtractionPrompt;
export const MEMORY_NAVIGATION_PROMPT = DEFAULT_MEMORY_PROMPTS.memoryNavigationPrompt;
export const PROMPT_ITERATION_SYSTEM_PROMPT = DEFAULT_MEMORY_PROMPTS.promptIterationSystemPrompt;
