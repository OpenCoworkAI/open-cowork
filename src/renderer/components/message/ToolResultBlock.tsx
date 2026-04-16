// Fallback ToolResultBlock — only renders for truly orphan results (no matching tool_use anywhere)
import { useState, memo, useMemo } from 'react';
import { ChevronDown, ChevronRight, XCircle, CheckCircle2 } from 'lucide-react';
import { useAppStore } from '../../store';
import {
  shouldPreferToolResultImages,
  shouldRenderToolResultText,
  shouldUseScreenshotSummary,
} from '../../utils/tool-result-summary';
import type { ToolResultContent, ContentBlock, ToolUseContent, Message } from '../../types';

// Only allow safe image MIME types for data: URI rendering
const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

interface ToolResultBlockProps {
  block: ToolResultContent;
  allBlocks?: ContentBlock[];
  message?: Message;
}

export const ToolResultBlock = memo(function ToolResultBlock({
  block,
  allBlocks,
  message,
}: ToolResultBlockProps) {
  const traceSteps = useAppStore((s) =>
    message?.sessionId ? (s.sessionStates[message.sessionId]?.traceSteps ?? []) : []
  );
  const allMessages = useAppStore((s) =>
    message?.sessionId ? (s.sessionStates[message.sessionId]?.messages ?? []) : []
  );
  const [expanded, setExpanded] = useState(false);

  // If a ToolUseBlock in any message already merges this result, hide this block
  const isOrphan = useMemo(() => {
    if (!message?.sessionId) return true;
    for (const msg of allMessages) {
      if (!Array.isArray(msg.content)) continue;
      const hasMatchingToolUse = (msg.content as ContentBlock[]).some(
        (b) => b.type === 'tool_use' && (b as ToolUseContent).id === block.toolUseId
      );
      if (hasMatchingToolUse) return false;
    }
    return true;
  }, [allMessages, block.toolUseId, message?.sessionId]);

  if (!isOrphan) return null;

  // Try to find the tool name from trace steps
  let toolName: string | undefined;
  if (message?.sessionId) {
    const toolCallStep = traceSteps.find((s) => s.id === block.toolUseId && s.type === 'tool_call');
    if (toolCallStep) toolName = toolCallStep.toolName;
  }
  if (!toolName) {
    const toolUseBlock = allBlocks?.find(
      (b) => b.type === 'tool_use' && (b as ToolUseContent).id === block.toolUseId
    ) as ToolUseContent | undefined;
    toolName = toolUseBlock?.name;
  }

  const isMCPTool = toolName?.startsWith('mcp__') || false;
  const displayName = isMCPTool
    ? (toolName || '').match(/^mcp__(.+?)__(.+)$/)?.[2] || toolName || 'tool'
    : toolName || 'tool';

  const getSummary = (): string => {
    const content = typeof block.content === 'string' ? block.content : '';
    if (block.isError) {
      const firstLine = content.split(/\r?\n/)[0];
      return firstLine.length > 60 ? firstLine.substring(0, 57) + '...' : firstLine;
    }
    if (shouldUseScreenshotSummary(toolName, content)) return 'Screenshot captured';
    if (content.length < 60) return content.trim();
    const lines = content.trim().split(/\r?\n/);
    return `${lines.length} lines`;
  };

  const validImages =
    block.images?.filter(
      (image) => image?.mimeType && image?.data && ALLOWED_IMAGE_TYPES.has(image.mimeType)
    ) ?? [];
  const hasImages = validImages.length > 0;
  const preferImageOutput = shouldPreferToolResultImages(
    toolName,
    typeof block.content === 'string' ? block.content : '',
    hasImages,
    block.isError === true
  );
  const shouldShowOutputText = shouldRenderToolResultText(
    toolName,
    typeof block.content === 'string' ? block.content : '',
    hasImages,
    block.isError === true
  );

  return (
    <div
      className={`rounded-2xl border overflow-hidden ${
        block.isError ? 'border-error/25 bg-error/5' : 'border-border-subtle bg-background/40'
      }`}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-surface-hover/50 transition-colors"
      >
        {block.isError ? (
          <XCircle className="w-3.5 h-3.5 text-error flex-shrink-0" />
        ) : (
          <CheckCircle2 className="w-3.5 h-3.5 text-success flex-shrink-0" />
        )}
        <span
          className={`text-xs font-mono flex-shrink-0 ${block.isError ? 'text-error' : 'text-text-muted'}`}
        >
          {displayName}
        </span>
        <span className="text-[11px] text-text-muted truncate flex-1">{getSummary()}</span>
        {hasImages && (
          <span className="text-[11px] text-text-muted flex-shrink-0">
            +{block.images?.length ?? 0} img
          </span>
        )}
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-border/50 px-3 py-2 animate-fade-in">
          {preferImageOutput && hasImages && (
            <div className="space-y-2">
              {validImages.map((image, index) => (
                <div key={index} className="border border-border rounded-lg overflow-hidden">
                  <img
                    src={`data:${image.mimeType};base64,${image.data}`}
                    alt={`Screenshot ${index + 1}`}
                    className="w-full h-auto"
                    style={{ maxHeight: '400px', objectFit: 'contain' }}
                  />
                </div>
              ))}
            </div>
          )}
          {shouldShowOutputText && (
            <pre
              className={`text-xs font-mono whitespace-pre-wrap break-all rounded-lg p-2.5 border border-border-subtle max-h-[300px] overflow-y-auto ${
                block.isError ? 'text-error bg-error/5' : 'text-text-secondary bg-surface-muted'
              } ${preferImageOutput ? 'mt-2' : ''}`}
            >
              {block.content}
            </pre>
          )}
          {!preferImageOutput && hasImages && (
            <div className="mt-2 space-y-2">
              {validImages.map((image, index) => (
                <div key={index} className="border border-border rounded-lg overflow-hidden">
                  <img
                    src={`data:${image.mimeType};base64,${image.data}`}
                    alt={`Screenshot ${index + 1}`}
                    className="w-full h-auto"
                    style={{ maxHeight: '400px', objectFit: 'contain' }}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
});
