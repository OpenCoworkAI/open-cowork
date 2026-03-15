/**
 * Streaming parser for `<think>...</think>` tags used by Ollama reasoning models
 * (deepseek-r1, qwen3, etc.). Separates thinking content from normal text in
 * a stream where tag boundaries may span multiple chunks.
 */

const OPEN_TAG = '<think>';
const CLOSE_TAG = '</think>';

interface ParseResult {
  thinking: string;
  text: string;
}

export type ThinkTagBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string };

/**
 * Stateful stream parser that splits `<think>` tagged content from normal text.
 *
 * States:
 * - `text`:          Normal text output
 * - `think`:         Inside a `<think>` block
 * - `pending_open`:  Buffer matches a prefix of `<think>` — waiting for more chars
 * - `pending_close`: Inside think, buffer matches a prefix of `</think>` — waiting
 */
export class ThinkTagStreamParser {
  private state: 'text' | 'think' | 'pending_open' | 'pending_close' = 'text';
  private buffer = '';

  push(delta: string): ParseResult {
    let thinking = '';
    let text = '';

    for (let i = 0; i < delta.length; i++) {
      const ch = delta[i];

      switch (this.state) {
        case 'text': {
          if (ch === '<') {
            this.buffer = '<';
            this.state = 'pending_open';
          } else {
            text += ch;
          }
          break;
        }

        case 'pending_open': {
          this.buffer += ch;
          if (OPEN_TAG.startsWith(this.buffer)) {
            // Still a valid prefix of <think>
            if (this.buffer === OPEN_TAG) {
              // Full match — enter think mode
              this.state = 'think';
              this.buffer = '';
            }
            // else keep buffering
          } else {
            // Not a match — flush buffer as normal text
            text += this.buffer;
            this.buffer = '';
            this.state = 'text';
          }
          break;
        }

        case 'think': {
          if (ch === '<') {
            this.buffer = '<';
            this.state = 'pending_close';
          } else {
            thinking += ch;
          }
          break;
        }

        case 'pending_close': {
          this.buffer += ch;
          if (CLOSE_TAG.startsWith(this.buffer)) {
            if (this.buffer === CLOSE_TAG) {
              // Full match — exit think mode
              this.state = 'text';
              this.buffer = '';
            }
          } else {
            // Not a close tag — flush buffer as thinking content
            thinking += this.buffer;
            this.buffer = '';
            this.state = 'think';
          }
          break;
        }
      }
    }

    return { thinking, text };
  }

  /**
   * Call at end-of-stream to flush any buffered content.
   * Unclosed `<think>` blocks are emitted as thinking content.
   */
  flush(): ParseResult {
    let thinking = '';
    let text = '';

    switch (this.state) {
      case 'pending_open':
        // Incomplete open tag — treat buffer as normal text
        text = this.buffer;
        break;
      case 'pending_close':
        // Incomplete close tag inside think — treat as thinking
        thinking = this.buffer;
        break;
      case 'think':
        // Unclosed think block — nothing extra buffered
        break;
      case 'text':
        break;
    }

    this.buffer = '';
    this.state = 'text';
    return { thinking, text };
  }
}

/**
 * Static extraction for fully-buffered text (used at message_end assembly).
 * Strips all `<think>...</think>` blocks and returns separated content.
 */
export function splitThinkTagBlocks(input: string): ThinkTagBlock[] {
  const blocks: ThinkTagBlock[] = [];
  let cursor = 0;

  while (cursor < input.length) {
    const openIdx = input.indexOf(OPEN_TAG, cursor);
    if (openIdx === -1) {
      const trailingText = input.slice(cursor);
      if (trailingText) blocks.push({ type: 'text', text: trailingText });
      break;
    }

    const before = input.slice(cursor, openIdx);
    if (before) blocks.push({ type: 'text', text: before });

    const closeIdx = input.indexOf(CLOSE_TAG, openIdx + OPEN_TAG.length);
    if (closeIdx === -1) {
      const trailingThinking = input.slice(openIdx + OPEN_TAG.length);
      if (trailingThinking) blocks.push({ type: 'thinking', thinking: trailingThinking });
      break;
    }

    const thinking = input.slice(openIdx + OPEN_TAG.length, closeIdx);
    if (thinking) blocks.push({ type: 'thinking', thinking });
    cursor = closeIdx + CLOSE_TAG.length;
  }

  return blocks;
}

/**
 * Static extraction for fully-buffered text (used at message_end assembly).
 * Strips all `<think>...</think>` blocks and returns separated content.
 */
export function extractThinkTags(input: string): ParseResult {
  const blocks = splitThinkTagBlocks(input);

  return {
    thinking: blocks
      .filter((block): block is Extract<ThinkTagBlock, { type: 'thinking' }> => block.type === 'thinking')
      .map((block) => block.thinking)
      .join(''),
    text: blocks
      .filter((block): block is Extract<ThinkTagBlock, { type: 'text' }> => block.type === 'text')
      .map((block) => block.text)
      .join(''),
  };
}
