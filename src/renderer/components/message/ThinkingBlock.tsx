// Collapsible "thinking" block — Claude extended thinking display
import { Suspense, lazy, useState, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Brain } from 'lucide-react';
import { PanelErrorBoundary } from '../PanelErrorBoundary';

const MessageMarkdown = lazy(() =>
  import('../MessageMarkdown').then((module) => ({ default: module.MessageMarkdown }))
);

// Render **bold** markers in thinking preview text.
// Only handles double-asterisk bold to avoid false positives with single * in math/code.
function renderThinkingPreview(raw: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /\*\*(.+?)\*\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = regex.exec(raw)) !== null) {
    if (match.index > lastIndex) {
      parts.push(raw.slice(lastIndex, match.index));
    }
    parts.push(
      <strong key={key++} className="font-semibold not-italic">
        {match[1]}
      </strong>
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < raw.length) {
    parts.push(raw.slice(lastIndex));
  }
  return parts;
}

export function escapeThinkTags(text: string): string {
  return text.replace(/<(\/?think)>/g, '&lt;$1&gt;');
}

interface ThinkingBlockProps {
  block: { type: 'thinking'; thinking: string };
}

export const ThinkingBlock = memo(function ThinkingBlock({ block }: ThinkingBlockProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const text = block.thinking || '';
  if (!text) return null;

  // Preview: first ~80 chars, clean up broken ** markers from truncation
  let preview = text.length > 80 ? text.substring(0, 77) + '...' : text;
  // Strip a trailing unclosed ** that truncation may have created
  preview = preview.replace(/\*{1,2}(?:\.{3})?$/, (m) => {
    // Keep the ... suffix if present, just remove the dangling asterisks
    return m.endsWith('...') ? '...' : '';
  });
  const previewNodes = renderThinkingPreview(preview);

  return (
    <div
      className={`rounded-2xl border overflow-hidden ${
        expanded ? 'border-border-subtle bg-background/40' : 'border-transparent'
      }`}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-surface-hover/50 rounded-2xl transition-colors"
      >
        <Brain className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
        <span className="text-xs font-medium text-text-muted flex-shrink-0">
          {t('messageCard.thinking')}
        </span>
        {!expanded && (
          <span className="text-[11px] text-text-muted/60 truncate flex-1 min-w-0 italic">
            {previewNodes}
          </span>
        )}
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-text-muted flex-shrink-0 ml-auto" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-text-muted flex-shrink-0 ml-auto" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-border/50 px-4 py-3 animate-fade-in">
          <div className="text-sm text-text-secondary leading-relaxed prose-chat max-w-none">
            <PanelErrorBoundary
              name="ThinkingMarkdown"
              fallback={<div className="whitespace-pre-wrap">{text}</div>}
            >
              <Suspense fallback={<div className="whitespace-pre-wrap">{text}</div>}>
                <MessageMarkdown normalizedText={escapeThinkTags(text)} />
              </Suspense>
            </PanelErrorBoundary>
          </div>
        </div>
      )}
    </div>
  );
});
