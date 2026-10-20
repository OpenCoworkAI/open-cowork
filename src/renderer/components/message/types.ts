// Shared types for MessageCard sub-components
import type { Message, ContentBlock, ToolUseContent, ToolResultContent } from '../../types';
import type { TextDirection } from '../../utils/text-direction';

export type { Message, ContentBlock, ToolUseContent, ToolResultContent };

export interface ContentBlockViewProps {
  block: ContentBlock;
  isUser: boolean;
  isStreaming?: boolean;
  textDirection?: TextDirection;
  /** All blocks in the same message, used to locate the paired tool_result */
  allBlocks?: ContentBlock[];
  /** The full message, used to search across all session messages */
  message?: Message;
}

export interface ToolBlockBaseProps {
  allBlocks?: ContentBlock[];
  message?: Message;
}

// TodoWrite item shape as emitted by the AI tool
export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  id?: string;
  /** Optional short form displayed in the header while in progress */
  activeForm?: string;
}
