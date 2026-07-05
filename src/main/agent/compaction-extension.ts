/**
 * Custom compaction strategy extension.
 *
 * Hooks into the SDK's `session_before_compact` event to:
 * 1. Pre-prune verbose tool outputs (file contents, long command output)
 *    so the summarizer model processes less noise.
 * 2. Inject custom summarization instructions that emphasize preserving
 *    decisions and goals over raw tool output.
 *
 * This does NOT replace the SDK's summarization entirely — it mutates the
 * preparation data and sets custom instructions, then lets the SDK's
 * default compaction path run on the cleaned input.
 */
import type {
  ExtensionFactory,
  ExtensionAPI,
  SessionBeforeCompactEvent,
} from '@mariozechner/pi-coding-agent';

/**
 * Configuration for the custom compaction extension.
 */
export interface CompactionConfig {
  /**
   * Custom instructions appended to the SDK's summarization prompt.
   * If not provided, DEFAULT_COMPACTION_INSTRUCTIONS is used.
   */
  customInstructions?: string;

  /**
   * Tool output character threshold. Outputs longer than this are
   * replaced with a short placeholder noting the tool and outcome.
   * Default: 500
   */
  pruneToolOutputAbove?: number;

  /**
   * Number of most-recent tool results to keep un-pruned, regardless
   * of length. Helps preserve context for the model's immediate next steps.
   * Default: 3
   */
  keepRecentToolResults?: number;
}

/**
 * Default summarization instructions that guide the SDK's summarizer
 * to focus on decisions rather than raw tool data.
 */
export const DEFAULT_COMPACTION_INSTRUCTIONS = `Focus on preserving:
- Key decisions made during the conversation
- Important file paths and what was done to them
- Current goals and next steps
- Error context that hasn't been resolved
- User preferences and constraints mentioned

Aggressively summarize:
- File contents that were read (just note the filename and purpose)
- Long command outputs (just note what command ran and the outcome)
- Exploratory steps that didn't lead anywhere
- Redundant back-and-forth about resolved issues`;

/**
 * Prune verbose tool outputs in a messages array (mutates in place).
 *
 * Walks through messages looking for tool result content blocks.
 * Any tool result text exceeding `threshold` characters (except the
 * last `keepRecent` results) is replaced with a short summary placeholder.
 *
 * The pruning is intentionally conservative: it only shortens text content
 * in tool results, never removes messages entirely. The SDK's summarizer
 * still sees all messages — just with less noise.
 */
export function pruneToolOutputs(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  messages: any[],
  threshold: number,
  keepRecent: number
): { prunedCount: number; totalToolResults: number } {
  // First pass: collect indices of all tool result content blocks
  interface ToolResultLocation {
    messageIndex: number;
    contentIndex: number;
    textLength: number;
  }

  const toolResultLocations: ToolResultLocation[] = [];

  for (let mi = 0; mi < messages.length; mi++) {
    const msg = messages[mi];
    if (!msg || typeof msg !== 'object') continue;

    // AgentMessage format: { role, content: ContentBlock[] }
    const content = msg.content;
    if (!Array.isArray(content)) continue;

    for (let ci = 0; ci < content.length; ci++) {
      const block = content[ci];
      if (!block || typeof block !== 'object') continue;

      // Tool results have type 'toolResult' in pi-agent-core
      const blockType = block.type;
      if (blockType === 'toolResult' || blockType === 'tool_result') {
        // Content can be an array of text/image blocks or a string
        const resultContent = block.content;
        let textLength = 0;

        if (typeof resultContent === 'string') {
          textLength = resultContent.length;
        } else if (Array.isArray(resultContent)) {
          for (const item of resultContent) {
            if (item && typeof item === 'object' && item.type === 'text' && item.text) {
              textLength += String(item.text).length;
            }
          }
        }

        toolResultLocations.push({ messageIndex: mi, contentIndex: ci, textLength });
      }
    }
  }

  const totalToolResults = toolResultLocations.length;
  let prunedCount = 0;

  // Skip the last `keepRecent` tool results (preserve recent context)
  const pruneUpTo = Math.max(0, toolResultLocations.length - keepRecent);

  for (let i = 0; i < pruneUpTo; i++) {
    const loc = toolResultLocations[i];
    if (loc.textLength <= threshold) continue;

    const block = messages[loc.messageIndex].content[loc.contentIndex];
    // Extract a hint about what tool produced this
    const toolUseId = block.toolUseId || block.tool_use_id || '';
    const truncatedNote = `[Output truncated: ${loc.textLength} chars → see tool_use_id=${toolUseId || 'unknown'}]`;

    // Replace the content with the truncated note. Only text-type blocks are
    // replaced — non-text blocks (e.g., images) are preserved as-is.
    if (typeof block.content === 'string') {
      block.content = truncatedNote;
    } else if (Array.isArray(block.content)) {
      block.content = block.content.map((item: { type: string; text?: string }) =>
        item.type === 'text' ? { type: 'text', text: truncatedNote } : item
      );
    }

    prunedCount++;
  }

  return { prunedCount, totalToolResults };
}

/**
 * Build the effective custom instructions string from config.
 * Merges per-session instructions with the default template.
 */
export function buildCustomInstructions(config: CompactionConfig): string {
  const base = DEFAULT_COMPACTION_INSTRUCTIONS;
  const perSession = config.customInstructions?.trim();

  if (!perSession) return base;

  // If the user provided custom instructions, append them after the defaults
  return `${base}\n\nAdditional context-specific instructions:\n${perSession}`;
}

/**
 * Create the compaction extension factory.
 *
 * Returns an ExtensionFactory that registers a `session_before_compact`
 * handler. The handler pre-prunes verbose tool outputs and injects
 * custom summarization instructions before letting the SDK's default
 * compaction path run.
 */
export function createCompactionExtensionFactory(config: CompactionConfig = {}): ExtensionFactory {
  const threshold = config.pruneToolOutputAbove ?? 500;
  const keepRecent = config.keepRecentToolResults ?? 3;

  return (api: ExtensionAPI): void => {
    api.on('session_before_compact', async (event: SessionBeforeCompactEvent) => {
      const { preparation } = event;

      // Phase 1: Pre-prune verbose tool outputs in messagesToSummarize.
      // This reduces token count the summarizer model needs to process,
      // leading to faster and cheaper compaction without losing key context.
      pruneToolOutputs(preparation.messagesToSummarize, threshold, keepRecent);

      // Phase 2: Inject custom instructions for the summarizer.
      // The SDK reads event.customInstructions after extension handlers return.
      // If no instructions were already set (e.g., from a manual compact() call),
      // inject our defaults. If instructions already exist (user-triggered compact
      // with explicit instructions), merge them with ours.
      const builtInstructions = buildCustomInstructions(config);
      if (!event.customInstructions) {
        event.customInstructions = builtInstructions;
      } else {
        // Merge: user's explicit instructions take priority (listed first)
        event.customInstructions = `${event.customInstructions}\n\n${builtInstructions}`;
      }

      // Return empty object — let the SDK run its default summarization
      // on the now-pruned messages with our custom instructions injected.
      return {};
    });
  };
}
