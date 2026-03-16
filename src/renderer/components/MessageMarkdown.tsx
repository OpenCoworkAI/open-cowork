import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';

export interface MessageMarkdownProps {
  normalizedText: string;
  isStreaming?: boolean;
  components?: Record<string, unknown>;
}

export const MessageMarkdown = memo(function MessageMarkdown({
  normalizedText,
  isStreaming,
  components,
}: MessageMarkdownProps) {
  return (
    <div className="prose-chat max-w-none text-text-primary">
      <ReactMarkdown
        remarkPlugins={[remarkMath, [remarkGfm, { singleTilde: false }]]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false }]]}
        components={components}
      >
        {normalizedText}
      </ReactMarkdown>
      {isStreaming && (
        <span className="inline-block w-2 h-4 bg-accent ml-1 animate-pulse" />
      )}
    </div>
  );
});
